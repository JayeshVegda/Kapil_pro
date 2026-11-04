import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { nextPurchaseInNo } from '@/domain/in-no'
import { findItemNameCollision, itemNameKey, normalizeItemName } from '@/domain/purchase-item-name'
import {
  CREDIT_KINDS,
  computeSupplierSettlement,
  type SupplierSettlementBillRow,
  type SupplierSettlementInput,
  type SupplierSettlementPaymentRow,
  type SupplierSettlementResult,
} from '@/domain/supplier-settlement'
import {
  extractUserNote,
  parseBagsAtReceiptKg,
} from '@/domain/supplier-purchases'
import {
  buildSupplierLedger,
  type SupplierLedgerInput,
  type SupplierLedgerResult,
  type SupplierPool,
} from '@/domain/supplier-ledger'

/**
 * Supplier Purchase module data layer. Phase 2.
 *
 * PocketBase access only — money stays in integer paise, weights in integer
 * grams, rates in integer milli-rupees. UI converts via supplier-units.
 * Ordering discipline: fetches sort by date, then created; domain code applies
 * the (date, created, id) tie-break. Soft delete only: suppliers deactivate,
 * bills/payments use cancelled + cancel_reason (never a hard delete of business
 * records; reusable config rows replaced for payment pins are recorded in the
 * audit log).
 *
 * Every successful write appends a purchase_audit_log row with before/after
 * JSON and the operator email.
 */

export type SupplierView = {
  id: string
  companyName: string
  contactName: string
  phone: string
  gstNo: string
  city: string
  notes: string
  openingKachaPaise: number
  openingGstPaise: number
  openingBalanceDate: string
  active: boolean
  created: string
}

export type PurchaseItemView = {
  id: string
  name: string
  active: boolean
  created: string
}

export type PurchaseBillView = {
  id: string
  supplierId: string
  inNo: string
  supplierBillNo: string
  date: string
  pool: SupplierPool
  taxMode: string
  gstRateBp: number
  groupId: string
  vehicleNo: string
  privateNote: string
  photos: string[]
  cancelled: boolean
  cancelReason: string
  created: string
}

export type PurchaseLineView = {
  id: string
  billId: string
  itemId: string
  itemName: string
  weightG: number
  rateMilli: number
  amountPaise: number
  created: string
}

export type PurchaseAdjustmentView = {
  id: string
  billId: string
  type: string
  amountPaise: number
  note?: string
  created: string
}

export type PurchaseBardanView = {
  id: string
  billId: string
  bardanG: number
  rateLineId: string
  rateMilli: number
  method: string
  creditPaise: number
  cashAmountPaise: number
  date: string
  note: string
  created: string
}

export type SupplierPaymentView = {
  id: string
  supplierId: string
  date: string
  pool: SupplierPool
  kind: string
  amountPaise: number
  mode: string
  reference: string
  payeeName: string
  privateNote: string
  photos: string[]
  cancelled: boolean
  cancelReason: string
  created: string
}

export type SupplierAllocationView = {
  id: string
  paymentId: string
  billId: string
  amountPaise: number
  created: string
}

export type SupplierBundle = {
  supplier: SupplierView
  bills: PurchaseBillView[]
  lines: PurchaseLineView[]
  adjustments: PurchaseAdjustmentView[]
  bardan: PurchaseBardanView[]
  payments: SupplierPaymentView[]
  allocations: SupplierAllocationView[]
}

export type SupplierSummary = {
  supplier: SupplierView
  kachaDuePaise: number
  gstDuePaise: number
  advancePaise: number
  outstandingPaise: number
  lastActivityDate: string
  bardanPendingCount: number
  oldestDueDays: number | null
}

export type SupplierUpsertInput = {
  companyName: string
  contactName?: string
  phone?: string
  gstNo?: string
  city?: string
  notes?: string
  openingKachaPaise?: number
  openingGstPaise?: number
  openingBalanceDate?: string
  active?: boolean
}

type PBRow = Record<string, unknown> & { id: string }

function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function text(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

function day(value: unknown): string {
  return text(value).slice(0, 10)
}

function bool(value: unknown): boolean {
  return value === true
}

function photoList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

const mapSupplier = (row: PBRow): SupplierView => ({
  id: row.id,
  companyName: text(row.company_name),
  contactName: text(row.contact_name),
  phone: text(row.phone),
  gstNo: text(row.gst_no),
  city: text(row.city),
  notes: text(row.notes),
  openingKachaPaise: num(row.opening_kacha_paise),
  openingGstPaise: num(row.opening_gst_paise),
  openingBalanceDate: day(row.opening_balance_date),
  active: row.active === undefined ? true : bool(row.active),
  created: text(row.created),
})

const mapItem = (row: PBRow): PurchaseItemView => ({
  id: row.id,
  name: text(row.name),
  active: row.active === undefined ? true : bool(row.active),
  created: text(row.created),
})

const mapBill = (row: PBRow): PurchaseBillView => ({
  id: row.id,
  supplierId: text(row.supplier),
  inNo: text(row.in_no),
  supplierBillNo: text(row.supplier_bill_no),
  date: day(row.date),
  pool: text(row.pool) === 'gst' ? 'gst' : 'kacha',
  taxMode: text(row.tax_mode) || 'none',
  gstRateBp: num(row.gst_rate_bp),
  groupId: text(row.group_id),
  vehicleNo: text(row.vehicle_no),
  privateNote: text(row.private_note),
  photos: photoList(row.photos),
  cancelled: bool(row.cancelled),
  cancelReason: text(row.cancel_reason),
  created: text(row.created),
})

const mapLine = (row: PBRow): PurchaseLineView => ({
  id: row.id,
  billId: text(row.bill),
  itemId: text(row.item),
  itemName: text(row.item_name),
  weightG: num(row.weight_g),
  rateMilli: num(row.rate_milli),
  amountPaise: num(row.amount_paise),
  created: text(row.created),
})

const mapAdjustment = (row: PBRow): PurchaseAdjustmentView => ({
  id: row.id,
  billId: text(row.bill),
  type: text(row.type),
  amountPaise: num(row.amount_paise),
  note: text(row.note),
  created: text(row.created),
})

const mapBardan = (row: PBRow): PurchaseBardanView => ({
  id: row.id,
  billId: text(row.bill),
  bardanG: num(row.bardan_g),
  rateLineId: text(row.rate_line),
  rateMilli: num(row.rate_milli),
  method: text(row.method),
  creditPaise: num(row.credit_paise),
  cashAmountPaise: num(row.cash_amount_paise),
  date: day(row.date),
  note: text(row.note),
  created: text(row.created),
})

const mapPayment = (row: PBRow): SupplierPaymentView => ({
  id: row.id,
  supplierId: text(row.supplier),
  date: day(row.date),
  pool: text(row.pool) === 'gst' ? 'gst' : 'kacha',
  kind: text(row.kind),
  amountPaise: num(row.amount_paise),
  mode: text(row.mode),
  reference: text(row.reference),
  payeeName: text(row.payee_name),
  privateNote: text(row.private_note),
  photos: photoList(row.photos),
  cancelled: bool(row.cancelled),
  cancelReason: text(row.cancel_reason),
  created: text(row.created),
})

const mapAllocation = (row: PBRow): SupplierAllocationView => ({
  id: row.id,
  paymentId: text(row.payment),
  billId: text(row.bill),
  amountPaise: num(row.amount_paise),
  created: text(row.created),
})

function currentActor(): string {
  const record = pb.authStore.record
  const actor = record && typeof record.get === 'function' ? text(record.get('email')) : ''
  return actor.trim()
}

type AuditInput = {
  collection: string
  recordId: string
  action: string
  before?: unknown
  after?: unknown
}

/** Append-only paper trail actor row. Never blocks the main write on failure. */
async function writeAuditRow(input: AuditInput): Promise<void> {
  try {
    await pb.collection('purchase_audit_log').create({
      collection: input.collection,
      record_id: input.recordId,
      action: input.action,
      before_json: input.before == null ? '' : JSON.stringify(input.before),
      after_json: input.after == null ? '' : JSON.stringify(input.after),
      actor: currentActor(),
    })
  } catch (error) {
    console.warn(`[suppliers] audit row failed for ${input.collection}/${input.recordId}`, error)
  }
}

async function fetchAll<T>(collection: string, map: (row: PBRow) => T, options?: { sort?: string; filter?: string }): Promise<T[]> {
  const result = await pb.collection(collection).getFullList({
    sort: options?.sort ?? 'created,id',
    filter: options?.filter,
  })
  return (result as unknown as PBRow[]).map(map)
}

export function bundleToSettlementInput(bundle: SupplierBundle): SupplierSettlementInput {
  return {
    supplier: {
      openingKachaPaise: bundle.supplier.openingKachaPaise,
      openingGstPaise: bundle.supplier.openingGstPaise,
    },
    bills: bundle.bills.map((bill) => ({
      id: bill.id,
      date: bill.date,
      created: bill.created,
      pool: bill.pool,
      taxMode: bill.taxMode,
      gstRateBp: bill.gstRateBp,
      cancelled: bill.cancelled,
    })),
    lines: bundle.lines.map((line) => ({ billId: line.billId, amountPaise: line.amountPaise })),
    adjustments: bundle.adjustments.map((row) => ({ billId: row.billId, type: row.type, amountPaise: row.amountPaise })),
    bardan: bundle.bardan.map((row) => ({
      billId: row.billId,
      method: row.method,
      creditPaise: row.creditPaise,
      cashAmountPaise: row.cashAmountPaise,
      note: row.note,
    })),
    payments: bundle.payments.map((payment) => ({
      id: payment.id,
      date: payment.date,
      created: payment.created,
      pool: payment.pool,
      kind: payment.kind,
      amountPaise: payment.amountPaise,
      cancelled: payment.cancelled,
    })),
    allocations: bundle.allocations.map((pin) => ({
      paymentId: pin.paymentId,
      billId: pin.billId,
      amountPaise: pin.amountPaise,
    })),
  }
}

export function bundleToLedgerInput(bundle: SupplierBundle, filter?: SupplierLedgerInput['filter']): SupplierLedgerInput {
  const billIds = new Set(bundle.bills.filter((bill) => !bill.cancelled).map((bill) => bill.id))
  return {
    bills: bundle.bills.map((bill) => ({
      id: bill.id,
      date: bill.date,
      created: bill.created,
      pool: bill.pool,
      taxMode: bill.taxMode,
      gstRateBp: bill.gstRateBp,
      cancelled: bill.cancelled,
    })),
    lines: bundle.lines.filter((line) => billIds.has(line.billId)).map((line) => ({ billId: line.billId, amountPaise: line.amountPaise })),
    adjustments: bundle.adjustments
      .filter((row) => billIds.has(row.billId))
      .map((row) => ({ billId: row.billId, type: row.type, amountPaise: row.amountPaise })),
    bardan: bundle.bardan.map((row) => ({
      id: row.id,
      billId: row.billId,
      date: row.date,
      created: row.created,
      method: row.method,
      creditPaise: row.creditPaise,
      cashAmountPaise: row.cashAmountPaise,
      note: row.note,
    })),
    payments: bundle.payments.map((payment) => ({
      id: payment.id,
      date: payment.date,
      created: payment.created,
      pool: payment.pool,
      kind: payment.kind,
      amountPaise: payment.amountPaise,
      cancelled: payment.cancelled,
    })),
    openingKachaPaise: bundle.supplier.openingKachaPaise,
    openingGstPaise: bundle.supplier.openingGstPaise,
    filter,
  }
}

// ---------------------------------------------------------------------------
// Suppliers master
// ---------------------------------------------------------------------------

export async function listSuppliers(options?: { includeInactive?: boolean }): Promise<SupplierView[]> {
  return runDataOperation('list-suppliers', async () => {
    const filters: string[] = []
    if (!options?.includeInactive) filters.push('active = true')
    const result = await pb.collection('suppliers').getFullList({
      sort: 'company_name',
      filter: filters.join(' && ') || undefined,
    })
    return (result as unknown as PBRow[]).map(mapSupplier)
  })
}

export async function getSupplier(supplierId: string): Promise<SupplierView> {
  return runDataOperation('get-supplier', async () => mapSupplier((await pb.collection('suppliers').getOne(supplierId)) as PBRow))
}

export async function createSupplier(input: SupplierUpsertInput, before?: SupplierView): Promise<SupplierView> {
  return runDataOperation('create-supplier', async () => {
    const payload = {
      company_name: input.companyName.trim(),
      contact_name: input.contactName ?? '',
      phone: input.phone ?? '',
      gst_no: input.gstNo ?? '',
      city: input.city ?? '',
      notes: input.notes ?? '',
      opening_kacha_paise: input.openingKachaPaise ?? 0,
      opening_gst_paise: input.openingGstPaise ?? 0,
      opening_balance_date: input.openingBalanceDate ?? '',
      active: input.active ?? true,
    }
    const row = (await pb.collection('suppliers').create(payload)) as PBRow
    await writeAuditRow({ collection: 'suppliers', recordId: row.id, action: 'create', before: before ?? null, after: payload })
    return mapSupplier(row)
  })
}

export async function updateSupplier(supplierId: string, input: SupplierUpsertInput): Promise<SupplierView> {
  return runDataOperation('update-supplier', async () => {
    const before = (await pb.collection('suppliers').getOne(supplierId)) as PBRow
    const payload = {
      company_name: text(before.company_name) !== input.companyName ? input.companyName.trim() : undefined,
      contact_name: input.contactName,
      phone: input.phone,
      gst_no: input.gstNo,
      city: input.city,
      notes: input.notes,
      opening_kacha_paise: input.openingKachaPaise,
      opening_gst_paise: input.openingGstPaise,
      opening_balance_date: input.openingBalanceDate,
      active: input.active,
    }
    const clean = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
    const row = (await pb.collection('suppliers').update(supplierId, clean)) as PBRow
    await writeAuditRow({ collection: 'suppliers', recordId: supplierId, action: 'update', before, after: clean })
    return mapSupplier(row)
  })
}

/** Soft delete: the supplier just becomes inactive. */
export async function deactivateSupplier(supplierId: string): Promise<SupplierView> {
  return runDataOperation('deactivate-supplier', async () => {
    const before = (await pb.collection('suppliers').getOne(supplierId)) as PBRow
    const row = (await pb.collection('suppliers').update(supplierId, { active: false })) as PBRow
    await writeAuditRow({ collection: 'suppliers', recordId: supplierId, action: 'deactivate', before, after: { active: false } })
    return mapSupplier(row)
  })
}

export async function reactivateSupplier(supplierId: string): Promise<SupplierView> {
  return runDataOperation('reactivate-supplier', async () => {
    const before = (await pb.collection('suppliers').getOne(supplierId)) as PBRow
    const row = (await pb.collection('suppliers').update(supplierId, { active: true })) as PBRow
    await writeAuditRow({ collection: 'suppliers', recordId: supplierId, action: 'reactivate', before, after: { active: true } })
    return mapSupplier(row)
  })
}

// ---------------------------------------------------------------------------
// Purchase items master
// ---------------------------------------------------------------------------

export async function listPurchaseItems(): Promise<PurchaseItemView[]> {
  return runDataOperation('list-purchase-items', async () => fetchAll<PurchaseItemView>('purchase_items', mapItem, { sort: 'name' }))
}

export async function createPurchaseItem(name: string): Promise<PurchaseItemView> {
  return runDataOperation('create-purchase-item', async () => {
    const candidate = normalizeItemName(name)
    if (!candidate) throw new Error('Item name cannot be empty.')
    const existing = await pb.collection('purchase_items').getFullList({ fields: 'name' })
    const collision = findItemNameCollision(candidate, (existing as unknown as Array<{ name?: string }>).map((row) => ({ name: String(row.name ?? '') })))
    if (collision) throw new Error(`Item "${collision.name}" already exists.`)
    const row = (await pb.collection('purchase_items').create({ name: candidate, active: true })) as PBRow
    await writeAuditRow({ collection: 'purchase_items', recordId: row.id, action: 'create', after: { name: candidate } })
    return mapItem(row)
  })
}

export async function renamePurchaseItem(itemId: string, name: string): Promise<PurchaseItemView> {
  return runDataOperation('rename-purchase-item', async () => {
    const candidate = normalizeItemName(name)
    if (!candidate) throw new Error('Item name cannot be empty.')
    const before = (await pb.collection('purchase_items').getOne(itemId)) as PBRow
    const existing = await pb.collection('purchase_items').getFullList({ fields: 'id,name' })
    const collision = existing.find((row) => String((row as unknown as { id: string }).id) !== itemId && itemNameKey(String((row as unknown as { name?: string }).name ?? '')) === itemNameKey(candidate))
    if (collision) throw new Error(`Item "${String((collision as unknown as { name?: string }).name ?? '')}" already exists.`)
    const row = (await pb.collection('purchase_items').update(itemId, { name: candidate })) as PBRow
    await writeAuditRow({ collection: 'purchase_items', recordId: itemId, action: 'rename', before, after: { name: candidate } })
    return mapItem(row)
  })
}

export async function setPurchaseItemActive(itemId: string, active: boolean): Promise<PurchaseItemView> {
  return runDataOperation('set-purchase-item-active', async () => {
    const before = (await pb.collection('purchase_items').getOne(itemId)) as PBRow
    const row = (await pb.collection('purchase_items').update(itemId, { active })) as PBRow
    await writeAuditRow({ collection: 'purchase_items', recordId: itemId, action: active ? 'activate' : 'deactivate', before, after: { active } })
    return mapItem(row)
  })
}

// ---------------------------------------------------------------------------
// Purchase bills / lines / adjustments / bardan (create only in Phase 2; UI is
// the Phase 3 lanes) — wrappers are typed so later phases plug in directly.
// ---------------------------------------------------------------------------

export type PurchaseBillCreateInput = {
  supplierId: string
  inNo: string
  supplierBillNo?: string
  date: string
  pool: SupplierPool
  taxMode: string
  gstRateBp?: number
  vehicleNo?: string
  privateNote?: string
  groupId?: string
  photos?: File[]
  lines: Array<{ itemId?: string; itemName: string; weightG: number; rateMilli: number; amountPaise: number }>
  adjustments?: Array<{ type: string; amountPaise: number; note?: string }>
  bardan?: Array<{ bardanG: number; rateLineIndex?: number; rateMilli: number; method: string; creditPaise?: number; cashAmountPaise?: number; date?: string; note?: string }>
}

function generateRecordId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 15; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return id
}

export async function getNextPurchaseInNo(dateYyyyMmDd: string): Promise<string> {
  const records = await pb.collection('purchase_bills').getFullList({ fields: 'in_no' })
  const existingInNos = (records as unknown as Array<{ in_no?: string }>).map((r) => String(r.in_no ?? ''))
  return nextPurchaseInNo(existingInNos, dateYyyyMmDd)
}

export async function createPurchaseBill(input: PurchaseBillCreateInput): Promise<PurchaseBillView> {
  return runDataOperation('create-purchase-bill', async () => {
    let inNo = (input.inNo || '').trim()
    if (!inNo) {
      inNo = await getNextPurchaseInNo(input.date)
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const billId = generateRecordId()
        const billPayload = {
          id: billId,
          supplier: input.supplierId,
          in_no: inNo,
          supplier_bill_no: input.supplierBillNo ?? '',
          date: input.date,
          pool: input.pool,
          tax_mode: input.taxMode,
          gst_rate_bp: input.gstRateBp ?? 0,
          vehicle_no: input.vehicleNo ?? '',
          private_note: input.privateNote ?? '',
          group_id: input.groupId ?? '',
        }
        const batch = pb.createBatch()
        batch.collection('purchase_bills').create(billPayload)
        const lineIds: string[] = []
        for (const line of input.lines) {
          const lineId = generateRecordId()
          lineIds.push(lineId)
          batch.collection('purchase_bill_lines').create({
            id: lineId,
            bill: billId,
            item: line.itemId ?? '',
            item_name: line.itemName,
            weight_g: line.weightG,
            rate_milli: line.rateMilli,
            amount_paise: line.amountPaise,
          })
        }
        for (const adjustment of input.adjustments ?? []) {
          batch.collection('purchase_bill_adjustments').create({
            id: generateRecordId(),
            bill: billId,
            type: adjustment.type,
            amount_paise: adjustment.amountPaise,
            note: adjustment.note ?? '',
          })
        }
        for (const entry of input.bardan ?? []) {
          batch.collection('purchase_bardan').create({
            id: generateRecordId(),
            bill: billId,
            bardan_g: entry.bardanG,
            rate_line: entry.rateLineIndex != null && entry.rateLineIndex >= 0 ? lineIds[entry.rateLineIndex] ?? '' : '',
            rate_milli: entry.rateMilli,
            method: entry.method,
            credit_paise: entry.creditPaise ?? 0,
            cash_amount_paise: entry.cashAmountPaise ?? 0,
            date: entry.date ?? input.date,
            note: entry.note ?? '',
          })
        }
        batch.collection('purchase_audit_log').create({
          collection: 'purchase_bills',
          record_id: billId,
          action: 'create',
          after_json: JSON.stringify(billPayload),
          actor: currentActor(),
        })
        await batch.send()
        if (input.photos && input.photos.length > 0) {
          try {
            const formData = new FormData()
            for (const file of input.photos) {
              formData.append('photos', file)
            }
            await pb.collection('purchase_bills').update(billId, formData)
          } catch (e) {
            console.warn('[suppliers] Failed to upload bill photos', e)
          }
        }
        return mapBill((await pb.collection('purchase_bills').getOne(billId)) as PBRow)
      } catch (err) {
        if (attempt < 2) {
          inNo = await getNextPurchaseInNo(input.date)
          continue
        }
        throw err
      }
    }
    throw new Error('Failed to create purchase bill after retries')
  })
}

export type PurchaseBillUpdateInput = {
  supplierId: string
  supplierBillNo?: string
  date: string
  pool: SupplierPool
  taxMode: string
  gstRateBp?: number
  vehicleNo?: string
  privateNote?: string
  photos?: File[]
  lines: Array<{ id?: string; itemId?: string; itemName: string; weightG: number; rateMilli: number; amountPaise: number }>
  adjustments?: Array<{ type: string; amountPaise: number; note?: string }>
}

export async function updatePurchaseBill(billId: string, input: PurchaseBillUpdateInput): Promise<PurchaseBillView> {
  return runDataOperation('update-purchase-bill', async () => {
    const beforeBill = (await pb.collection('purchase_bills').getOne(billId)) as PBRow
    const oldLines = await pb.collection('purchase_bill_lines').getFullList({ filter: `bill = "${billId}"` })
    const oldAdjustments = await pb.collection('purchase_bill_adjustments').getFullList({ filter: `bill = "${billId}"` })

    const billPayload = {
      supplier: input.supplierId,
      supplier_bill_no: input.supplierBillNo ?? '',
      date: input.date,
      pool: input.pool,
      tax_mode: input.taxMode,
      gst_rate_bp: input.gstRateBp ?? 0,
      vehicle_no: input.vehicleNo ?? '',
      private_note: input.privateNote ?? '',
    }

    // Keep existing line ids wherever the edit still carries them: bardan
    // entries reference rate lines by id, and rewriting every id would orphan
    // (or, with the old cascadeDelete, silently destroy) those entries.
    const oldLineIds = new Set(oldLines.map((row) => row.id))
    const claimedLineIds = new Set<string>()
    const lineOps = input.lines.map((line) => {
      const keepId = line.id && oldLineIds.has(line.id) && !claimedLineIds.has(line.id) ? line.id : ''
      if (keepId) claimedLineIds.add(keepId)
      return { line, keepId }
    })

    const batch = pb.createBatch()
    batch.collection('purchase_bills').update(billId, billPayload)

    for (const { line, keepId } of lineOps) {
      const linePayload = {
        bill: billId,
        item: line.itemId ?? '',
        item_name: line.itemName,
        weight_g: line.weightG,
        rate_milli: line.rateMilli,
        amount_paise: line.amountPaise,
      }
      if (keepId) {
        batch.collection('purchase_bill_lines').update(keepId, linePayload)
      } else {
        batch.collection('purchase_bill_lines').create({ id: generateRecordId(), ...linePayload })
      }
    }

    // Lines removed by the edit are unlinked from bardan first, so the entries
    // survive with their rate_milli snapshot instead of being cascade-deleted.
    for (const oldLine of oldLines) {
      if (claimedLineIds.has(oldLine.id)) continue
      const linkedBardan = await pb.collection('purchase_bardan').getFullList({ filter: `rate_line = "${oldLine.id}"` })
      for (const entry of linkedBardan) {
        const unlinkPayload = { rate_line: '' }
        batch.collection('purchase_bardan').update(entry.id, unlinkPayload)
        batch.collection('purchase_audit_log').create({
          collection: 'purchase_bardan',
          record_id: entry.id,
          action: 'unlink_rate_line',
          before_json: JSON.stringify({ rate_line: oldLine.id }),
          after_json: JSON.stringify(unlinkPayload),
          actor: currentActor(),
        })
      }
      batch.collection('purchase_bill_lines').delete(oldLine.id)
    }

    for (const oldAdj of oldAdjustments) {
      batch.collection('purchase_bill_adjustments').delete(oldAdj.id)
    }

    for (const adjustment of input.adjustments ?? []) {
      batch.collection('purchase_bill_adjustments').create({
        id: generateRecordId(),
        bill: billId,
        type: adjustment.type,
        amount_paise: adjustment.amountPaise,
        note: adjustment.note ?? '',
      })
    }

    batch.collection('purchase_audit_log').create({
      collection: 'purchase_bills',
      record_id: billId,
      action: 'update',
      before_json: JSON.stringify(beforeBill),
      after_json: JSON.stringify(billPayload),
      actor: currentActor(),
    })

    await batch.send()
    if (input.photos && input.photos.length > 0) {
      try {
        const formData = new FormData()
        for (const file of input.photos) {
          formData.append('photos', file)
        }
        await pb.collection('purchase_bills').update(billId, formData)
      } catch (e) {
        console.warn('[suppliers] Failed to upload bill photos', e)
      }
    }
    return mapBill((await pb.collection('purchase_bills').getOne(billId)) as PBRow)
  })
}

export type PurchaseBardanEntryInput = {
  billId: string
  bardanG: number
  rateLineId?: string
  rateMilli: number
  method: string // 'deduct' | 'in_kind' | 'cash_back' | 'advance'
  creditPaise?: number
  cashAmountPaise?: number
  date?: string
  note?: string
}

export async function addPurchaseBardanEntry(input: PurchaseBardanEntryInput): Promise<PurchaseBardanView> {
  return runDataOperation('add-purchase-bardan-entry', async () => {
    const bill = (await pb.collection('purchase_bills').getOne(input.billId)) as PBRow
    const bardanId = generateRecordId()
    const bardanPayload = {
      id: bardanId,
      bill: input.billId,
      bardan_g: input.bardanG,
      rate_line: input.rateLineId ?? '',
      rate_milli: input.rateMilli,
      method: input.method,
      credit_paise: input.creditPaise ?? 0,
      cash_amount_paise: input.cashAmountPaise ?? 0,
      date: input.date || String(bill.date ?? ''),
      note: input.note ?? '',
    }

    const batch = pb.createBatch()
    batch.collection('purchase_bardan').create(bardanPayload)

    if (input.method === 'advance' && (input.creditPaise ?? 0) > 0) {
      const paymentId = generateRecordId()
      const paymentPayload = {
        id: paymentId,
        supplier: bill.supplier,
        date: input.date || String(bill.date ?? ''),
        pool: bill.pool,
        kind: 'bardan_advance',
        amount_paise: input.creditPaise ?? 0,
        mode: 'other',
        reference: `Bardan Advance (Bill ${bill.in_no})`,
        payee_name: '',
        private_note: input.note ?? '',
      }
      batch.collection('supplier_payments').create(paymentPayload)
      batch.collection('purchase_audit_log').create({
        collection: 'supplier_payments',
        record_id: paymentId,
        action: 'create',
        after_json: JSON.stringify(paymentPayload),
        actor: currentActor(),
      })
    }

    batch.collection('purchase_audit_log').create({
      collection: 'purchase_bardan',
      record_id: bardanId,
      action: 'create',
      after_json: JSON.stringify(bardanPayload),
      actor: currentActor(),
    })

    await batch.send()
    return mapBardan((await pb.collection('purchase_bardan').getOne(bardanId)) as PBRow)
  })
}

export async function cancelPurchaseBill(billId: string, reason: string): Promise<PurchaseBillView> {
  return runDataOperation('cancel-purchase-bill', async () => {
    const before = (await pb.collection('purchase_bills').getOne(billId)) as PBRow
    const row = (await pb.collection('purchase_bills').update(billId, { cancelled: true, cancel_reason: reason })) as PBRow
    await writeAuditRow({ collection: 'purchase_bills', recordId: billId, action: 'cancel', before, after: { cancelled: true, cancel_reason: reason } })
    return mapBill(row)
  })
}

export async function uncancelPurchaseBill(billId: string): Promise<PurchaseBillView> {
  return runDataOperation('uncancel-purchase-bill', async () => {
    const before = (await pb.collection('purchase_bills').getOne(billId)) as PBRow
    const row = (await pb.collection('purchase_bills').update(billId, { cancelled: false, cancel_reason: '' })) as PBRow
    await writeAuditRow({ collection: 'purchase_bills', recordId: billId, action: 'uncancel', before, after: { cancelled: false } })
    return mapBill(row)
  })
}

// ---------------------------------------------------------------------------
// Supplier payments + manual pins
// ---------------------------------------------------------------------------

export type SupplierPaymentCreateInput = {
  supplierId: string
  date: string
  pool: SupplierPool
  kind: string
  amountPaise: number
  mode?: string
  reference?: string
  payeeName?: string
  privateNote?: string
  photos?: File[]
  allocations?: Array<{ billId: string; amountPaise: number }>
}

export async function createSupplierPayment(input: SupplierPaymentCreateInput): Promise<SupplierPaymentView> {
  return runDataOperation('create-supplier-payment', async () => {
    const paymentId = generateRecordId()
    const payload = {
      id: paymentId,
      supplier: input.supplierId,
      date: input.date,
      pool: input.pool,
      kind: input.kind,
      amount_paise: input.amountPaise,
      mode: input.mode ?? '',
      reference: input.reference ?? '',
      payee_name: input.payeeName ?? '',
      private_note: input.privateNote ?? '',
    }
    const batch = pb.createBatch()
    batch.collection('supplier_payments').create(payload)

    for (const alloc of input.allocations ?? []) {
      if (alloc.amountPaise > 0) {
        const allocId = generateRecordId()
        batch.collection('supplier_payment_allocations').create({
          id: allocId,
          payment: paymentId,
          bill: alloc.billId,
          amount_paise: alloc.amountPaise,
        })
        batch.collection('purchase_audit_log').create({
          collection: 'supplier_payment_allocations',
          record_id: allocId,
          action: 'create',
          after_json: JSON.stringify({ payment: paymentId, bill: alloc.billId, amount_paise: alloc.amountPaise }),
          actor: currentActor(),
        })
      }
    }

    batch.collection('purchase_audit_log').create({
      collection: 'supplier_payments',
      record_id: paymentId,
      action: 'create',
      after_json: JSON.stringify(payload),
      actor: currentActor(),
    })
    await batch.send()
    if (input.photos && input.photos.length > 0) {
      try {
        const formData = new FormData()
        for (const file of input.photos) {
          formData.append('photos', file)
        }
        await pb.collection('supplier_payments').update(paymentId, formData)
      } catch (e) {
        console.warn('[suppliers] Failed to upload payment photos', e)
      }
    }
    return mapPayment((await pb.collection('supplier_payments').getOne(paymentId)) as PBRow)
  })
}

export type PurchaseBillDetail = {
  bill: PurchaseBillView
  lines: PurchaseLineView[]
  adjustments: PurchaseAdjustmentView[]
  bardan: PurchaseBardanView[]
  allocations: SupplierAllocationView[]
}

/** Look up a purchase bill by its IN document number (globally unique). */
export async function loadPurchaseBillIdByInNo(inNo: string): Promise<string | null> {
  const safe = String(inNo ?? '').replace(/"/g, '\\"')
  const row = await pb.collection('purchase_bills').getFirstListItem(`in_no = "${safe}"`, { fields: 'id' }).catch(() => null)
  return row ? String(row.id) : null
}

export async function loadPurchaseBill(billId: string): Promise<PurchaseBillDetail> {
  return runDataOperation('load-purchase-bill', async () => {
    const [billRaw, lines, adjustments, bardan, allocations] = await Promise.all([
      pb.collection('purchase_bills').getOne(billId),
      fetchAll<PurchaseLineView>('purchase_bill_lines', mapLine, { filter: `bill = "${billId}"`, sort: 'created,id' }),
      fetchAll<PurchaseAdjustmentView>('purchase_bill_adjustments', mapAdjustment, { filter: `bill = "${billId}"`, sort: 'created,id' }),
      fetchAll<PurchaseBardanView>('purchase_bardan', mapBardan, { filter: `bill = "${billId}"`, sort: 'date,created,id' }),
      fetchAll<SupplierAllocationView>('supplier_payment_allocations', mapAllocation, { filter: `bill = "${billId}"`, sort: 'created,id' }),
    ])
    return {
      bill: mapBill(billRaw as PBRow),
      lines,
      adjustments,
      bardan,
      allocations,
    }
  })
}

export async function cancelSupplierPayment(paymentId: string, reason: string): Promise<SupplierPaymentView> {
  return runDataOperation('cancel-supplier-payment', async () => {
    const before = (await pb.collection('supplier_payments').getOne(paymentId)) as PBRow
    const row = (await pb.collection('supplier_payments').update(paymentId, { cancelled: true, cancel_reason: reason })) as PBRow
    await writeAuditRow({ collection: 'supplier_payments', recordId: paymentId, action: 'cancel', before, after: { cancelled: true, cancel_reason: reason } })
    return mapPayment(row)
  })
}

export async function createPurchasePaymentAllocation(paymentId: string, billId: string, amountPaise: number): Promise<SupplierAllocationView> {
  return runDataOperation('create-payment-allocation', async () => {
    const row = (await pb.collection('supplier_payment_allocations').create({ payment: paymentId, bill: billId, amount_paise: amountPaise })) as PBRow
    await writeAuditRow({ collection: 'supplier_payment_allocations', recordId: row.id, action: 'create', after: { paymentId, billId, amountPaise } })
    return mapAllocation(row)
  })
}

// ---------------------------------------------------------------------------
// Reads supplying domain + screens
// ---------------------------------------------------------------------------

const SUPPLIER_COLLECTIONS = {
  bills: 'purchase_bills',
  lines: 'purchase_bill_lines',
  adjustments: 'purchase_bill_adjustments',
  bardan: 'purchase_bardan',
  payments: 'supplier_payments',
  allocations: 'supplier_payment_allocations',
} as const

export async function loadSupplierBundle(supplierId: string): Promise<SupplierBundle> {
  return runDataOperation('load-supplier-bundle', async () => {
    const supplier = await getSupplier(supplierId)
    const [bills, lines, adjustments, bardan, payments, allocations] = await Promise.all([
      fetchAll<PurchaseBillView>(SUPPLIER_COLLECTIONS.bills, mapBill, { sort: 'date,created,id' }),
      fetchAll<PurchaseLineView>(SUPPLIER_COLLECTIONS.lines, mapLine, { sort: 'created,id' }),
      fetchAll<PurchaseAdjustmentView>(SUPPLIER_COLLECTIONS.adjustments, mapAdjustment, { sort: 'created,id' }),
      fetchAll<PurchaseBardanView>(SUPPLIER_COLLECTIONS.bardan, mapBardan, { sort: 'date,created,id' }),
      fetchAll<SupplierPaymentView>(SUPPLIER_COLLECTIONS.payments, mapPayment, { sort: 'date,created,id' }),
      fetchAll<SupplierAllocationView>(SUPPLIER_COLLECTIONS.allocations, mapAllocation, { sort: 'created,id' }),
    ])
    const supplierBillIds = new Set(bills.filter((bill) => bill.supplierId === supplierId).map((bill) => bill.id))
    const paymentsOfSupplier = payments.filter((payment) => payment.supplierId === supplierId)
    const paymentsById = new Set(paymentsOfSupplier.map((payment) => payment.id))
    return {
      supplier,
      bills: bills.filter((bill) => bill.supplierId === supplierId),
      lines: lines.filter((line) => supplierBillIds.has(line.billId)),
      adjustments: adjustments.filter((row) => supplierBillIds.has(row.billId)),
      bardan: bardan.filter((row) => supplierBillIds.has(row.billId)),
      payments: paymentsOfSupplier,
      allocations: allocations.filter((pin) => paymentsById.has(pin.paymentId)),
    }
  })
}

export function computeSupplierBundleSettlement(bundle: SupplierBundle): SupplierSettlementResult {
  return computeSupplierSettlement(bundleToSettlementInput(bundle))
}

export function computeSupplierBundleLedger(bundle: SupplierBundle, filter?: SupplierLedgerInput['filter']): SupplierLedgerResult {
  return buildSupplierLedger(bundleToLedgerInput(bundle, filter))
}

function lastActivity(bundle: SupplierBundle): string {
  let latest = ''
  const touch = (date: string, created: string) => {
    const candidate = date || day(created)
    if (candidate && candidate > latest) latest = candidate
  }
  for (const bill of bundle.bills) touch(bill.date, bill.created)
  for (const entry of bundle.bardan) touch(entry.date, entry.created)
  for (const payment of bundle.payments) touch(payment.date, payment.created)
  return latest
}

export async function loadSuppliersSummary(): Promise<SupplierSummary[]> {
  return runDataOperation('load-suppliers-summary', async () => {
    const suppliers = await listSuppliers({ includeInactive: true })
    const [allBills, allLines, allAdjustments, allBardan, allPayments, allAllocations] = await Promise.all([
      fetchAll<PurchaseBillView>(SUPPLIER_COLLECTIONS.bills, mapBill, { sort: 'date,created,id' }),
      fetchAll<PurchaseLineView>(SUPPLIER_COLLECTIONS.lines, mapLine, { sort: 'created,id' }),
      fetchAll<PurchaseAdjustmentView>(SUPPLIER_COLLECTIONS.adjustments, mapAdjustment, { sort: 'created,id' }),
      fetchAll<PurchaseBardanView>(SUPPLIER_COLLECTIONS.bardan, mapBardan, { sort: 'date,created,id' }),
      fetchAll<SupplierPaymentView>(SUPPLIER_COLLECTIONS.payments, mapPayment, { sort: 'date,created,id' }),
      fetchAll<SupplierAllocationView>(SUPPLIER_COLLECTIONS.allocations, mapAllocation, { sort: 'created,id' }),
    ])

    const rows: SupplierSummary[] = []
    for (const supplier of suppliers) {
      const bills = allBills.filter((bill) => bill.supplierId === supplier.id)
      const billIds = new Set(bills.map((bill) => bill.id))
      const payments = allPayments.filter((payment) => payment.supplierId === supplier.id)
      const paymentIds = new Set(payments.map((payment) => payment.id))
      const settlement = computeSupplierSettlement({
        supplier: { openingKachaPaise: supplier.openingKachaPaise, openingGstPaise: supplier.openingGstPaise },
        bills,
        lines: allLines.filter((line) => billIds.has(line.billId)).map((line) => ({ billId: line.billId, amountPaise: line.amountPaise })),
        adjustments: allAdjustments
          .filter((row) => billIds.has(row.billId))
          .map((row) => ({ billId: row.billId, type: row.type, amountPaise: row.amountPaise })),
        bardan: allBardan
          .filter((row) => billIds.has(row.billId))
          .map((row) => ({ billId: row.billId, method: row.method, creditPaise: row.creditPaise, cashAmountPaise: row.cashAmountPaise, note: row.note })),
        payments: payments.map((payment) => ({
          id: payment.id,
          date: payment.date,
          created: payment.created,
          pool: payment.pool,
          kind: payment.kind,
          amountPaise: payment.amountPaise,
          cancelled: payment.cancelled,
        })),
        allocations: allAllocations.filter((pin) => paymentIds.has(pin.paymentId)).map((pin) => ({
          paymentId: pin.paymentId,
          billId: pin.billId,
          amountPaise: pin.amountPaise,
        })),
      })
      const poolBills = [...settlement.pools.kacha.bills, ...settlement.pools.gst.bills]
      const bardanPendingCount = poolBills.filter((b) => b.bardanPending).length
      const openBills = poolBills.filter((b) => b.status === 'open' || b.status === 'partial')
      let oldestDueDays: number | null = null
      if (openBills.length > 0) {
        const today = new Date().toISOString().slice(0, 10)
        const earliestDate = openBills.reduce((min, b) => (!min || b.date < min ? b.date : min), '')
        if (earliestDate) {
          const diffMs = new Date(today).getTime() - new Date(earliestDate).getTime()
          oldestDueDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
        }
      }

      rows.push({
        supplier,
        kachaDuePaise: settlement.pools.kacha.outstandingPaise,
        gstDuePaise: settlement.pools.gst.outstandingPaise,
        advancePaise: settlement.combined.advancePaise,
        outstandingPaise: settlement.combined.netPositionPaise,
        lastActivityDate: lastActivity({ supplier, bills, lines: [], adjustments: [], bardan: allBardan.filter((row) => billIds.has(row.billId)), payments, allocations: [] }),
        bardanPendingCount,
        oldestDueDays,
      })
    }
    return rows
  })
}

/** Vilaity history for the internal-only premium column (₨/kg -> milli). */
export type EnrichedPurchaseBill = {
  id: string
  inNo: string
  date: string
  created: string
  supplierId: string
  supplierName: string
  pool: SupplierPool
  taxMode: string
  gstRateBp: number
  supplierBillNo: string
  vehicleNo: string
  privateNote: string
  userNote: string
  bagsAtReceiptKg: number | null
  photos: string[]
  cancelled: boolean
  cancelReason: string
  totalWeightG: number
  totalKg: number
  netPaise: number
  paidPaise: number
  duePaise: number
  status: 'open' | 'partial' | 'nil' | 'cancelled'
  bardanPending: boolean
  bardanEntryCount: number
  lines: PurchaseLineView[]
  adjustments: PurchaseAdjustmentView[]
  bardan: PurchaseBardanView[]
}

export type EnrichedSupplierPayment = {
  id: string
  date: string
  created: string
  supplierId: string
  supplierName: string
  pool: SupplierPool
  kind: string
  mode: string
  reference: string
  payeeName: string
  privateNote: string
  photos: string[]
  amountPaise: number
  appliedPaise: number
  advancePaise: number
  cancelled: boolean
  cancelReason: string
  allocations: Array<{ billId: string; inNo: string; amountPaise: number; isManual: boolean }>
}

export async function loadAllPurchaseBills(): Promise<EnrichedPurchaseBill[]> {
  return runDataOperation('load-all-purchase-bills', async () => {
    const [suppliers, allBills, allLines, allAdjustments, allBardan, allPayments, allAllocations] =
      await Promise.all([
        fetchAll<SupplierView>('suppliers', mapSupplier),
        fetchAll<PurchaseBillView>(SUPPLIER_COLLECTIONS.bills, mapBill, { sort: '-date,-created,-id' }),
        fetchAll<PurchaseLineView>(SUPPLIER_COLLECTIONS.lines, mapLine, { sort: 'created,id' }),
        fetchAll<PurchaseAdjustmentView>(SUPPLIER_COLLECTIONS.adjustments, mapAdjustment, { sort: 'created,id' }),
        fetchAll<PurchaseBardanView>(SUPPLIER_COLLECTIONS.bardan, mapBardan, { sort: 'date,created,id' }),
        fetchAll<SupplierPaymentView>(SUPPLIER_COLLECTIONS.payments, mapPayment, { sort: 'date,created,id' }),
        fetchAll<SupplierAllocationView>(SUPPLIER_COLLECTIONS.allocations, mapAllocation, { sort: 'created,id' }),
      ])

    const supplierMap = new Map(suppliers.map((s) => [s.id, s]))
    const settlementBillMap = new Map<string, SupplierSettlementBillRow>()

    // Run settlement per supplier to calculate true bill dues and bardan pending
    for (const supplier of suppliers) {
      const supplierBills = allBills.filter((b) => b.supplierId === supplier.id)
      if (supplierBills.length === 0) continue
      const billIds = new Set(supplierBills.map((b) => b.id))
      const supplierPayments = allPayments.filter((p) => p.supplierId === supplier.id)
      const paymentIds = new Set(supplierPayments.map((p) => p.id))

      const settlement = computeSupplierSettlement({
        supplier: { openingKachaPaise: supplier.openingKachaPaise, openingGstPaise: supplier.openingGstPaise },
        bills: supplierBills,
        lines: allLines.filter((l) => billIds.has(l.billId)).map((l) => ({ billId: l.billId, amountPaise: l.amountPaise })),
        adjustments: allAdjustments
          .filter((a) => billIds.has(a.billId))
          .map((a) => ({ billId: a.billId, type: a.type, amountPaise: a.amountPaise })),
        bardan: allBardan
          .filter((b) => billIds.has(b.billId))
          .map((b) => ({ billId: b.billId, method: b.method, creditPaise: b.creditPaise, cashAmountPaise: b.cashAmountPaise, note: b.note })),
        payments: supplierPayments.map((p) => ({
          id: p.id,
          date: p.date,
          created: p.created,
          pool: p.pool,
          kind: p.kind,
          amountPaise: p.amountPaise,
          cancelled: p.cancelled,
        })),
        allocations: allAllocations
          .filter((a) => paymentIds.has(a.paymentId))
          .map((a) => ({ paymentId: a.paymentId, billId: a.billId, amountPaise: a.amountPaise })),
      })

      for (const row of [...settlement.pools.kacha.bills, ...settlement.pools.gst.bills]) {
        settlementBillMap.set(row.billId, row)
      }
    }

    const linesByBill = new Map<string, PurchaseLineView[]>()
    for (const l of allLines) {
      const list = linesByBill.get(l.billId) ?? []
      list.push(l)
      linesByBill.set(l.billId, list)
    }

    const adjsByBill = new Map<string, PurchaseAdjustmentView[]>()
    for (const a of allAdjustments) {
      const list = adjsByBill.get(a.billId) ?? []
      list.push(a)
      adjsByBill.set(a.billId, list)
    }

    const bardanByBill = new Map<string, PurchaseBardanView[]>()
    for (const b of allBardan) {
      const list = bardanByBill.get(b.billId) ?? []
      list.push(b)
      bardanByBill.set(b.billId, list)
    }

    return allBills.map((bill) => {
      const supplier = supplierMap.get(bill.supplierId)
      const bLines = linesByBill.get(bill.id) ?? []
      const bAdjs = adjsByBill.get(bill.id) ?? []
      const bBardan = bardanByBill.get(bill.id) ?? []
      const sBill = settlementBillMap.get(bill.id)

      const totalWeightG = bLines.reduce((sum, l) => sum + l.weightG, 0)
      const netPaise = sBill?.netPaise ?? 0
      const paidPaise = sBill?.paidPaise ?? 0
      const duePaise = sBill?.duePaise ?? (bill.cancelled ? 0 : netPaise)
      const status = sBill?.status ?? (bill.cancelled ? 'cancelled' : 'open')
      const bardanPending = sBill?.bardanPending ?? (!bill.cancelled && bBardan.length === 0)

      return {
        id: bill.id,
        inNo: bill.inNo,
        date: bill.date,
        created: bill.created,
        supplierId: bill.supplierId,
        supplierName: supplier?.companyName ?? 'Unknown Supplier',
        pool: bill.pool,
        taxMode: bill.taxMode,
        gstRateBp: bill.gstRateBp,
        supplierBillNo: bill.supplierBillNo,
        vehicleNo: bill.vehicleNo,
        privateNote: bill.privateNote,
        userNote: extractUserNote(bill.privateNote),
        bagsAtReceiptKg: parseBagsAtReceiptKg(bill.privateNote),
        photos: bill.photos,
        cancelled: bill.cancelled,
        cancelReason: bill.cancelReason,
        totalWeightG,
        totalKg: totalWeightG / 1000,
        netPaise,
        paidPaise,
        duePaise,
        status,
        bardanPending,
        bardanEntryCount: bBardan.length,
        lines: bLines,
        adjustments: bAdjs,
        bardan: bBardan,
      }
    })
  })
}

export async function loadAllSupplierPayments(): Promise<EnrichedSupplierPayment[]> {
  return runDataOperation('load-all-supplier-payments', async () => {
    const [suppliers, allBills, allLines, allAdjustments, allBardan, allPayments, allAllocations] = await Promise.all([
      fetchAll<SupplierView>('suppliers', mapSupplier),
      fetchAll<PurchaseBillView>(SUPPLIER_COLLECTIONS.bills, mapBill, { sort: 'date,created,id' }),
      fetchAll<PurchaseLineView>(SUPPLIER_COLLECTIONS.lines, mapLine, { sort: 'created,id' }),
      fetchAll<PurchaseAdjustmentView>(SUPPLIER_COLLECTIONS.adjustments, mapAdjustment, { sort: 'created,id' }),
      fetchAll<PurchaseBardanView>(SUPPLIER_COLLECTIONS.bardan, mapBardan, { sort: 'date,created,id' }),
      fetchAll<SupplierPaymentView>(SUPPLIER_COLLECTIONS.payments, mapPayment, { sort: '-date,-created,-id' }),
      fetchAll<SupplierAllocationView>(SUPPLIER_COLLECTIONS.allocations, mapAllocation, { sort: 'created,id' }),
    ])

    const supplierMap = new Map(suppliers.map((s) => [s.id, s]))
    const billMap = new Map(allBills.map((b) => [b.id, b]))
    const settlementPaymentMap = new Map<string, SupplierSettlementPaymentRow>()

    for (const supplier of suppliers) {
      const supplierBills = allBills.filter((b) => b.supplierId === supplier.id)
      const supplierPayments = allPayments.filter((p) => p.supplierId === supplier.id)
      if (supplierPayments.length === 0) continue
      const billIds = new Set(supplierBills.map((b) => b.id))
      const paymentIds = new Set(supplierPayments.map((p) => p.id))

      // Full bill inputs are required here: without line amounts every bill net
      // is 0, no payables exist, and every payment would report as pure advance.
      const settlement = computeSupplierSettlement({
        supplier: { openingKachaPaise: supplier.openingKachaPaise, openingGstPaise: supplier.openingGstPaise },
        bills: supplierBills,
        lines: allLines.filter((l) => billIds.has(l.billId)).map((l) => ({ billId: l.billId, amountPaise: l.amountPaise })),
        adjustments: allAdjustments
          .filter((a) => billIds.has(a.billId))
          .map((a) => ({ billId: a.billId, type: a.type, amountPaise: a.amountPaise })),
        bardan: allBardan
          .filter((b) => billIds.has(b.billId))
          .map((b) => ({ billId: b.billId, method: b.method, creditPaise: b.creditPaise, cashAmountPaise: b.cashAmountPaise, note: b.note })),
        payments: supplierPayments.map((p) => ({
          id: p.id,
          date: p.date,
          created: p.created,
          pool: p.pool,
          kind: p.kind,
          amountPaise: p.amountPaise,
          cancelled: p.cancelled,
        })),
        allocations: allAllocations
          .filter((a) => paymentIds.has(a.paymentId))
          .map((a) => ({ paymentId: a.paymentId, billId: a.billId, amountPaise: a.amountPaise })),
      })

      for (const row of [...settlement.pools.kacha.payments, ...settlement.pools.gst.payments]) {
        settlementPaymentMap.set(row.paymentId, row)
      }
    }

    const allocsByPayment = new Map<string, SupplierAllocationView[]>()
    for (const a of allAllocations) {
      const list = allocsByPayment.get(a.paymentId) ?? []
      list.push(a)
      allocsByPayment.set(a.paymentId, list)
    }

    return allPayments.map((payment) => {
      const supplier = supplierMap.get(payment.supplierId)
      const pRow = settlementPaymentMap.get(payment.id)
      const appliedPaise = pRow?.appliedPaise ?? 0
      // Only credit kinds can leave advance; refunds are payables, not prepayments.
      const advancePaise = CREDIT_KINDS.has(payment.kind) ? Math.max(0, payment.amountPaise - appliedPaise) : 0
      const manualAllocs = allocsByPayment.get(payment.id) ?? []

      const allocations = manualAllocs.map((a) => ({
        billId: a.billId,
        inNo: billMap.get(a.billId)?.inNo ?? '',
        amountPaise: a.amountPaise,
        isManual: true,
      }))

      return {
        id: payment.id,
        date: payment.date,
        created: payment.created,
        supplierId: payment.supplierId,
        supplierName: supplier?.companyName ?? 'Unknown Supplier',
        pool: payment.pool,
        kind: payment.kind,
        mode: payment.mode,
        reference: payment.reference,
        payeeName: payment.payeeName,
        privateNote: payment.privateNote,
        photos: payment.photos,
        amountPaise: payment.amountPaise,
        appliedPaise,
        advancePaise,
        cancelled: payment.cancelled,
        cancelReason: payment.cancelReason,
        allocations,
      }
    })
  })
}

/** Vilaity history for the internal-only premium column (₨/kg -> milli). */
export async function loadVilaityHistory(): Promise<Array<{ date: string; vilaityMilli: number }>> {
  return runDataOperation('load-vilaity-history', async () => {
    const result = await pb.collection('brass_rates').getFullList({
      sort: 'date',
      filter: 'vilaity > 0',
    })
    const rows = (result as unknown as PBRow[]).map((row) => ({
      date: day(row.date),
      vilaityMilli: Math.round(num(row.vilaity) * 1000),
    }))
    return rows.filter((row, index, list) => index === 0 || list[index - 1].date !== row.date)
  })
}

/**
 * Lightweight bardan-pending count for the sidebar badge: active bills with no
 * bardan entries. Same rule as the settlement engine's bardanPending, without
 * pulling lines/payments or running the settlement.
 */
export async function loadBardanPendingCount(): Promise<number> {
  return runDataOperation('load-bardan-pending-count', async () => {
    const [bills, bardan] = await Promise.all([
      pb.collection('purchase_bills').getFullList({ fields: 'id,cancelled' }),
      pb.collection('purchase_bardan').getFullList({ fields: 'bill' }),
    ])
    const billsWithBardan = new Set(
      (bardan as unknown as Array<{ bill?: string }>).map((row) => String(row.bill ?? '')),
    )
    return (bills as unknown as Array<{ id: string; cancelled?: boolean }>).filter(
      (bill) => !bill.cancelled && !billsWithBardan.has(bill.id),
    ).length
  })
}

