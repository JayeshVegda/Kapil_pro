import { DatabaseSync } from 'node:sqlite'
import {
  mapSupplier, mapItem, mapBill, mapLine, mapAdjustment, mapBardan, mapPayment, mapAllocation, type PBRow,
} from '@/data/purchase-record-mappers'
import { buildPurchaseReadModel } from '@/domain/purchase-read-model'
import { remainingPurchaseBags, purchaseReceiptBagCount } from '@/domain/purchase-receipt-memos'
import { computeSupplierPositions } from '@/domain/supplier-settlement'
import { itemNameKey } from '@/domain/purchase-item-name'

export class MusePurchaseError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function indiaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts()
  return ['year', 'month', 'day'].map((name) => parts.find((part) => part.type === name)?.value).join('-')
}

export function readMusePurchaseLedger(databasePath: string, asOf: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 1500 })
  try {
    db.exec('PRAGMA query_only=ON; BEGIN')
    const settings = db.prepare("SELECT purchase_enabled FROM app_settings WHERE id = 'globalsettings1'").get()
    if (settings && !settings.purchase_enabled) throw new MusePurchaseError(403, 'PURCHASE_DISABLED', 'Purchase is disabled in Kapil Settings.')
    const rows = (table: string) => db.prepare('SELECT * FROM ' + table).all() as PBRow[]
    const suppliers = rows('suppliers').map(mapSupplier).map((supplier) => {
      if (!supplier.openingBalanceDate || supplier.openingBalanceDate <= asOf) return supplier
      return { ...supplier, openingKachaPaise: 0, openingGstPaise: 0 }
    })
    const asOfOnly = <T extends { date: string }>(records: T[]) => records.filter((record) => record.date <= asOf)
    const model = buildPurchaseReadModel(suppliers, {
      bills: asOfOnly(rows('purchase_bills').map(mapBill)), lines: rows('purchase_bill_lines').map(mapLine),
      adjustments: rows('purchase_bill_adjustments').map(mapAdjustment), bardan: asOfOnly(rows('purchase_bardan').map(mapBardan)),
      payments: asOfOnly(rows('supplier_payments').map(mapPayment)), allocations: rows('supplier_payment_allocations').map(mapAllocation),
    }, asOf)
    return { ...model, items: rows('purchase_items').map(mapItem), asOf }
  } finally { db.close() }
}

export type MusePurchaseLedger = ReturnType<typeof readMusePurchaseLedger>

type Master = { id: string; name: string; aliases?: string; active: boolean }

function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]))
    previous = next
  }
  return previous[b.length]
}

function masterKeys(master: Master) {
  return [master.name, ...(master.aliases ?? '').split(/[,\n]/)].map(itemNameKey).filter(Boolean)
}

export function pageMasters(choices: Master[], query: string, page: number, includeInactive = false) {
  const key = itemNameKey(query)
  const list = choices.filter((choice) => (includeInactive || choice.active) && (!key || masterKeys(choice).some((name) => name.includes(key))))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return { page, pageSize: 25, total: list.length, records: list.slice((page - 1) * 25, page * 25) }
}

export function masterLookup(term: string, choices: Master[], allowInactive = false) {
  const key = itemNameKey(term)
  const matches = !key ? [] : choices.filter((m) => (allowInactive || m.active) && (
    m.id === term || itemNameKey(m.name) === key || (m.aliases ?? '').split(/[,\n]/).some((alias) => itemNameKey(alias) === key)
  ))
  if (matches.length !== 1) {
    const candidates = matches.length ? matches : choices.filter((m) => key.length >= 2 && (allowInactive || m.active)).map((m) => ({
      master: m, score: Math.min(...masterKeys(m).map((name) => name.includes(key) ? 0 : distance(key, name))),
    })).filter(({ score }) => score <= Math.min(3, Math.max(1, Math.floor(key.length / 3))))
      .sort((a, b) => a.score - b.score || a.master.name.localeCompare(b.master.name)).map(({ master }) => master)
    throw new MusePurchaseError(matches.length > 1 ? 409 : 404, matches.length > 1 ? 'AMBIGUOUS_NAME' : 'NO_EXACT_MATCH',
      'Choose the exact master record from the options or give a more specific name.',
      candidates.slice(0, 12).map(({ id, name, active }) => ({ id, name, active })))
  }
  return matches[0]
}

export function supplierChoices(ledger: MusePurchaseLedger): Master[] {
  return ledger.suppliers.map(({ id, companyName, active, aliases }) => ({ id, name: companyName, active, aliases }))
}

export function publicBill(row: MusePurchaseLedger['bills'][number]) {
  return {
    id: row.id, inNo: row.inNo, invoice: row.supplierBillNo, supplier: row.supplierName, date: row.date, pool: row.pool,
    netPaise: row.netPaise, paidPaise: row.paidPaise, duePaise: row.duePaise,
    bardanPending: row.bardanPending,
    lines: row.lines.map((line) => ({
      id: line.id, item: line.itemName, weightG: line.weightG, rateMilli: line.rateMilli, amountPaise: line.amountPaise,
      recordedBags: purchaseReceiptBagCount(line.receiptMemo), remainingBags: remainingPurchaseBags(line, row.bardan),
    })),
  }
}

export function purchaseDues(ledger: MusePurchaseLedger, supplier?: Master, includeSuppliers = false) {
  const selected = [...ledger.supplierContexts.values()].filter(({ bundle }) => !supplier || bundle.supplier.id === supplier.id)
  const position = computeSupplierPositions(selected.map(({ settlement }) => ({
    kachaDuePaise: settlement.pools.kacha.outstandingPaise,
    gstDuePaise: settlement.pools.gst.outstandingPaise,
    kachaAdvancePaise: settlement.pools.kacha.advancePaise,
    gstAdvancePaise: settlement.pools.gst.advancePaise,
  })))
  const billDue = { kacha: 0, gst: 0 }
  for (const bill of ledger.bills) {
    if (!bill.cancelled && (!supplier || bill.supplierId === supplier.id)) billDue[bill.pool] += Math.max(0, bill.duePaise)
  }
  return {
    asOf: ledger.asOf, supplier: supplier?.name ?? null, ...position,
    dueNotOnSlipsPaise: { kacha: position.kachaPayablePaise - billDue.kacha, gst: position.gstPayablePaise - billDue.gst },
    ...(includeSuppliers ? { suppliers: selected.map(({ bundle, settlement }) => ({
      id: bundle.supplier.id,
      name: bundle.supplier.companyName,
      kachaPayablePaise: settlement.pools.kacha.outstandingPaise,
      gstPayablePaise: settlement.pools.gst.outstandingPaise,
      totalPayablePaise: settlement.combined.outstandingPaise,
      kachaAdvancePaise: settlement.pools.kacha.advancePaise,
      gstAdvancePaise: settlement.pools.gst.advancePaise,
      totalAdvancePaise: settlement.combined.advancePaise,
    })).sort((a, b) => b.totalPayablePaise - a.totalPayablePaise || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) } : {}),
  }
}

export function purchaseActivity(ledger: MusePurchaseLedger, days: number, page: number, supplier?: Master) {
  const date = new Date(ledger.asOf + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() - days + 1)
  const from = date.toISOString().slice(0, 10)
  const matches = (row: { supplierId: string; date: string; cancelled: boolean }) =>
    !row.cancelled && row.date >= from && row.date <= ledger.asOf && (!supplier || row.supplierId === supplier.id)
  const activity = [
    ...ledger.bills.filter(matches).map((row) => ({
      id: row.id, date: row.date, created: row.created, supplier: row.supplierName,
      type: 'slip' as const, inNo: row.inNo, pool: row.pool, netPaise: row.netPaise, duePaise: row.duePaise,
    })),
    ...ledger.payments.filter(matches).map((row) => ({
      id: row.id, date: row.date, created: row.created, supplier: row.supplierName, pool: row.pool,
      type: 'payment' as const, kind: row.kind, amountPaise: row.amountPaise, mode: row.mode, reference: row.reference,
      direction: row.kind === 'refund_received' ? 'incoming' : ['payment', 'paid_on_behalf'].includes(row.kind) ? 'outgoing' : 'non_cash',
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created) || b.id.localeCompare(a.id) || b.type.localeCompare(a.type))
  return { asOf: ledger.asOf, from, days, page, pageSize: 25, total: activity.length,
    entries: activity.slice((page - 1) * 25, page * 25).map(({ created, ...entry }) => { void created; return entry }),
  }
}
