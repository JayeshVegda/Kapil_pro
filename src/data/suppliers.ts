import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import {
  computeSupplierSettlement,
  type SupplierSettlementInput,
  type SupplierSettlementResult,
} from '@/domain/supplier-settlement'
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
    sort: options?.sort ?? 'date,created,id',
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
    const row = (await pb.collection('purchase_items').create({ name: name.trim(), active: true })) as PBRow
    await writeAuditRow({ collection: 'purchase_items', recordId: row.id, action: 'create', after: { name: name.trim() } })
    return mapItem(row)
  })
}

export async function renamePurchaseItem(itemId: string, name: string): Promise<PurchaseItemView> {
  return runDataOperation('rename-purchase-item', async () => {
    const before = (await pb.collection('purchase_items').getOne(itemId)) as PBRow
    const row = (await pb.collection('purchase_items').update(itemId, { name: name.trim() })) as PBRow
    await writeAuditRow({ collection: 'purchase_items', recordId: itemId, action: 'rename', before, after: { name: name.trim() } })
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

export async function createPurchaseBill(input: PurchaseBillCreateInput): Promise<PurchaseBillView> {
  return runDataOperation('create-purchase-bill', async () => {
    const billId = generateRecordId()
    const billPayload = {
      id: billId,
      supplier: input.supplierId,
      in_no: input.inNo,
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
    return mapBill((await pb.collection('purchase_bills').getOne(billId)) as PBRow)
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
    batch.collection('purchase_audit_log').create({
      collection: 'supplier_payments',
      record_id: paymentId,
      action: 'create',
      after_json: JSON.stringify(payload),
      actor: currentActor(),
    })
    await batch.send()
    return mapPayment((await pb.collection('supplier_payments').getOne(paymentId)) as PBRow)
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
      fetchAll<PurchaseBillView>(SUPPLIER_COLLECTIONS.bills, mapBill),
      fetchAll<PurchaseLineView>(SUPPLIER_COLLECTIONS.lines, mapLine),
      fetchAll<PurchaseAdjustmentView>(SUPPLIER_COLLECTIONS.adjustments, mapAdjustment),
      fetchAll<PurchaseBardanView>(SUPPLIER_COLLECTIONS.bardan, mapBardan),
      fetchAll<SupplierPaymentView>(SUPPLIER_COLLECTIONS.payments, mapPayment),
      fetchAll<SupplierAllocationView>(SUPPLIER_COLLECTIONS.allocations, mapAllocation),
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

export async function computeSupplierBundleSettlement(bundle: SupplierBundle): Promise<SupplierSettlementResult> {
  return computeSupplierSettlement(bundleToSettlementInput(bundle))
}

export async function computeSupplierBundleLedger(bundle: SupplierBundle, filter?: SupplierLedgerInput['filter']): Promise<SupplierLedgerResult> {
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
      fetchAll<PurchaseBillView>(SUPPLIER_COLLECTIONS.bills, mapBill),
      fetchAll<PurchaseLineView>(SUPPLIER_COLLECTIONS.lines, mapLine),
      fetchAll<PurchaseAdjustmentView>(SUPPLIER_COLLECTIONS.adjustments, mapAdjustment),
      fetchAll<PurchaseBardanView>(SUPPLIER_COLLECTIONS.bardan, mapBardan),
      fetchAll<SupplierPaymentView>(SUPPLIER_COLLECTIONS.payments, mapPayment),
      fetchAll<SupplierAllocationView>(SUPPLIER_COLLECTIONS.allocations, mapAllocation),
    ])

    const rows: SupplierSummary[] = []
    for (const supplier of suppliers) {
      const bills = allBills.filter((bill) => bill.supplierId === supplier.id)
      if (bills.length === 0 && allPayments.every((payment) => payment.supplierId !== supplier.id)) {
        rows.push({
          supplier,
          kachaDuePaise: supplier.openingKachaPaise,
          gstDuePaise: supplier.openingGstPaise,
          advancePaise: 0,
          outstandingPaise: 0,
          lastActivityDate: '',
        })
        continue
      }
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
      rows.push({
        supplier,
        kachaDuePaise: settlement.pools.kacha.outstandingPaise,
        gstDuePaise: settlement.pools.gst.outstandingPaise,
        advancePaise: settlement.combined.advancePaise,
        outstandingPaise: settlement.combined.netPositionPaise,
        lastActivityDate: lastActivity({ supplier, bills, lines: [], adjustments: [], bardan: allBardan.filter((row) => billIds.has(row.billId)), payments, allocations: [] }),
      })
    }
    return rows
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
