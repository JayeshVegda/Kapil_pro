import { countItemReferences, countNameOnlyReferences } from '@/data/item-usage'
import { toast } from 'sonner'
import { AppError } from '@/app/errors'
import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { executeConfirmedBatch, generatePurchaseRecordId } from '@/data/confirmed-write'
import { isValidCalendarDay } from '@/lib/date'
import { validateSupplierPaymentMode, type SupplierPaymentMode } from '@/domain/supplier-payment-modes'
import { formatPurchaseLineMemos, parsePurchaseLineMemos, purchaseReceiptBagCount, remainingPurchaseBags, writeSettledBagCount } from '@/domain/purchase-receipt-memos'
import { num, text, day, bool, mapSupplier, mapItem, mapBill, mapLine, mapAdjustment, mapBardan, mapPayment, mapAllocation, type PBRow } from '@/data/purchase-record-mappers'
import { nextPurchaseInNo } from '@/domain/in-no'
import { findItemNameCollision, itemNameKey, normalizeItemName } from '@/domain/purchase-item-name'
import { matchPurchaseMaster, normalizePurchaseAliases } from '@/domain/purchase-bill-draft'
import { MAX_PURCHASE_BILL_PAISE, MAX_PURCHASE_RATE_MILLI, MAX_PURCHASE_WEIGHT_G, sumPaise } from '@/domain/supplier-units'
import { parsePurchasePaymentDraft } from '@/domain/purchase-payment-draft'
import { prepareMusePurchaseAction } from '@/domain/muse-purchase-actions'
import { bundleToLedgerInput, bundleToSettlementInput } from '@/domain/supplier-bundle'
import {
  buildPurchaseReadModel, buildSupplierBundle, groupPurchaseCollections,
  type PurchaseCollections, type PurchaseReadModel,
} from '@/domain/purchase-read-model'
export { bundleToLedgerInput, bundleToSettlementInput } from '@/domain/supplier-bundle'
import {
  computeSupplierSettlement,
  type SupplierSettlementResult,
} from '@/domain/supplier-settlement'
import {
  computeBillNet,
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
  aliases?: string
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
  aliases?: string
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
  receiptMemo?: string
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
  bagCount?: number
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
  aliases?: string
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


function currentActor(): string {
  const record = pb.authStore.record
  const actor = record && typeof record.get === 'function' ? text(record.get('email')) : text(record?.email)
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
      aliases: normalizePurchaseAliases(input.aliases ?? '', input.companyName),
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
      aliases: input.aliases == null ? undefined : normalizePurchaseAliases(
        text(before.company_name) !== input.companyName ? `${input.aliases}\n${text(before.company_name)}` : input.aliases,
        input.companyName,
      ),
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

export async function renamePurchaseItem(itemId: string, name: string, aliases?: string): Promise<PurchaseItemView> {
  return runDataOperation('rename-purchase-item', async () => {
    const candidate = normalizeItemName(name)
    if (!candidate) throw new Error('Item name cannot be empty.')
    const before = (await pb.collection('purchase_items').getOne(itemId)) as PBRow
    const existing = await pb.collection('purchase_items').getFullList({ fields: 'id,name' })
    const collision = existing.find((row) => String((row as unknown as { id: string }).id) !== itemId && itemNameKey(String((row as unknown as { name?: string }).name ?? '')) === itemNameKey(candidate))
    if (collision) throw new Error(`Item "${String((collision as unknown as { name?: string }).name ?? '')}" already exists.`)
    if (itemNameKey(text(before.name)) !== itemNameKey(candidate) && await countNameOnlyReferences('purchase', text(before.name)) > 0) throw new Error('Old bills use this name without an item link. Deactivate it and add a new item instead.')
    const nextAliases = normalizePurchaseAliases(
      `${aliases ?? text(before.aliases)}${itemNameKey(text(before.name)) !== itemNameKey(candidate) ? `\n${text(before.name)}` : ''}`,
      candidate,
    )
    const row = (await pb.collection('purchase_items').update(itemId, { name: candidate, aliases: nextAliases })) as PBRow
    await writeAuditRow({ collection: 'purchase_items', recordId: itemId, action: 'rename', before, after: { name: candidate, aliases: nextAliases } })
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

export async function deletePurchaseItem(itemId: string): Promise<void> {
  return runDataOperation('delete-purchase-item', async () => {
    const before = (await pb.collection('purchase_items').getOne(itemId)) as PBRow
    const count = await countItemReferences('purchase', itemId, text(before.name))
    if (count > 0) throw new Error(`Used in ${count} purchase bill lines. Deactivate this item instead.`)
    await pb.collection('purchase_items').delete(itemId)
    await writeAuditRow({ collection: 'purchase_items', recordId: itemId, action: 'delete', before, after: null })
  })
}

// ---------------------------------------------------------------------------
// Purchase bills / lines / adjustments / bardan (create only in Phase 2; UI is
// the Phase 3 lanes) — wrappers are typed so later phases plug in directly.
// ---------------------------------------------------------------------------

export type PurchaseBillCreateInput = {
  requestId?: string
  draftId?: string
  newSupplierDraft?: { name: string; actionDraftId: string }
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
  payment?: { amountPaise: number; date?: string; mode: SupplierPaymentMode; reference?: string; note?: string }
  lines: Array<{ itemId?: string; itemName: string; weightG: number; rateMilli: number; amountPaise: number; receiptMemo?: string }>
  adjustments?: Array<{ type: string; amountPaise: number; note?: string }>
  bardan?: Array<{ bardanG: number; bagCount?: number; rateLineIndex?: number; rateMilli: number; method: string; creditPaise?: number; cashAmountPaise?: number; date?: string; note?: string }>
}

function generateRecordId(): string {
  return generatePurchaseRecordId()
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive whole number.`)
}

function validatePurchaseLines(lines: PurchaseBillCreateInput['lines']): void {
  if (lines.length === 0) throw new Error('A purchase bill needs at least one item line.')
  for (const [index, line] of lines.entries()) {
    if (!line.itemName.trim()) throw new Error(`Item name is required on line ${index + 1}.`)
    requirePositiveInteger(line.weightG, `Weight on line ${index + 1}`)
    requirePositiveInteger(line.rateMilli, `Rate on line ${index + 1}`)
    requirePositiveInteger(line.amountPaise, `Amount on line ${index + 1}`)
    if (line.weightG > MAX_PURCHASE_WEIGHT_G || line.rateMilli > MAX_PURCHASE_RATE_MILLI || line.amountPaise > MAX_PURCHASE_BILL_PAISE) throw new Error(`Purchase line ${index + 1} exceeds the weight, rate or amount limit.`)
  }
  if (sumPaise(lines.map((line) => line.amountPaise)) > MAX_PURCHASE_BILL_PAISE) throw new Error('Purchase bill total exceeds the limit.')
}

export async function getNextPurchaseInNo(dateYyyyMmDd: string): Promise<string> {
  const records = await pb.collection('purchase_bills').getFullList({ fields: 'in_no' })
  const existingInNos = (records as unknown as Array<{ in_no?: string }>).map((r) => String(r.in_no ?? ''))
  return nextPurchaseInNo(existingInNos, dateYyyyMmDd)
}

async function assertMuseSupplierReady(dependency: unknown, supplierId: string) {
  const id = text(dependency)
  if (!id) return
  if (supplierId !== id) throw new Error('This draft is linked to a specific new supplier. Do not switch it to another supplier.')
  const parent = await pb.collection('muse_purchase_action_drafts').getOne(id)
  if (parent.status !== 'approved' || !parent.converted_record || prepareMusePurchaseAction(parent.payload).kind !== 'new_supplier_bill') {
    throw new Error('Approve the linked new supplier and first bill before saving this follow-up.')
  }
  const supplier = await getSupplier(supplierId)
  if (!supplier.active) throw new Error('The linked supplier is inactive.')
}

export async function createPurchaseBill(input: PurchaseBillCreateInput): Promise<PurchaseBillView> {
  return runDataOperation('create-purchase-bill', async () => {
    if (input.draftId) {
      const draft = await pb.collection('purchase_bill_drafts').getOne(input.draftId)
      if (draft.status === 'approved' && draft.converted_bill) {
        throw new AppError({ code: 'CONFLICT', message: 'Draft already converted.', details: { billId: String(draft.converted_bill) } })
      }
      if (draft.status !== 'pending_review') throw new AppError({ code: 'CONFLICT', message: 'This draft was already processed.' })
      await assertMuseSupplierReady(draft.supplier_draft, input.supplierId)
    }
    if (input.newSupplierDraft && input.draftId) throw new Error('Use only one purchase proposal at a time.')
    validatePurchaseLines(input.lines)
    const paymentDate = input.payment?.date ?? input.date
    if (input.payment) {
      requirePositiveInteger(input.payment.amountPaise, 'Payment amount')
      validateSupplierPaymentMode(input.payment.mode, input.payment.reference)
      const parts = /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ? paymentDate.split('-').map(Number) : []
      if (parts.length !== 3 || !isValidCalendarDay(parts[0], parts[1], parts[2])) throw new Error('Enter a valid payment date.')
    }
    let inNo = (input.inNo || '').trim()
    if (!inNo) {
      inNo = await getNextPurchaseInNo(input.date)
    }

    const saved = await executeConfirmedBatch({
      confirmationCollection: 'purchase_bills', scope: input.supplierId,
      label: `Purchase bill ${inNo}`, input, resultIndex: input.newSupplierDraft ? 1 : 0,
      build: async (billId) => {
        const lineIds = input.lines.map(() => generateRecordId())
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
          private_note: formatPurchaseLineMemos(input.privateNote ?? '', Object.fromEntries(input.lines.map((line, index) => [lineIds[index], line.receiptMemo ?? '']))),
          group_id: input.groupId ?? '',
        }
        const batch = pb.createBatch()
        if (input.newSupplierDraft) {
          const name = input.newSupplierDraft.name.trim()
          const suppliers = await listSuppliers({ includeInactive: true })
          if (suppliers.some((s) => matchPurchaseMaster(name, undefined, [{ id: s.id, name: s.companyName, aliases: s.aliases, active: true }]))) {
            throw new Error('A supplier with this name or alias already exists. Reject the proposal and use the existing supplier.')
          }
          batch.collection('suppliers').create({ id: input.supplierId, company_name: name, active: true })
        }
        batch.collection('purchase_bills').create(billPayload)
        if (input.newSupplierDraft) {
          batch.collection('purchase_audit_log').create({
            collection: 'suppliers', record_id: input.supplierId, action: 'create',
            after_json: JSON.stringify({ company_name: input.newSupplierDraft.name }), actor: currentActor(),
          })
          batch.collection('muse_purchase_action_drafts').update(input.newSupplierDraft.actionDraftId, {
            status: 'approved', converted_record: billId,
          })
        }
        for (const [index, line] of input.lines.entries()) {
          const lineId = lineIds[index]
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
            note: writeSettledBagCount(entry.note ?? '', entry.bagCount),
          })
          if (entry.method === 'advance' && (entry.creditPaise ?? 0) > 0) {
            const paymentId = generateRecordId()
            const paymentPayload = {
              id: paymentId, supplier: input.supplierId, date: entry.date ?? input.date,
              pool: input.pool, kind: 'bardan_advance', amount_paise: entry.creditPaise,
              mode: 'other', reference: `Bardan Advance (Bill ${inNo})`,
              payee_name: '', private_note: entry.note ?? '',
            }
            batch.collection('supplier_payments').create(paymentPayload)
            batch.collection('purchase_audit_log').create({
              collection: 'supplier_payments', record_id: paymentId, action: 'create',
              after_json: JSON.stringify(paymentPayload), actor: currentActor(),
            })
          }
        }
        if (input.payment) {
          const paymentId = generateRecordId()
          const paymentPayload = {
            id: paymentId, supplier: input.supplierId, date: paymentDate, pool: input.pool,
            kind: 'payment', amount_paise: input.payment.amountPaise,
            mode: input.payment.mode, reference: input.payment.reference ?? '',
            payee_name: '', private_note: input.payment.note?.trim() || `Paid with purchase bill ${inNo}`,
          }
          batch.collection('supplier_payments').create(paymentPayload)
          const billNetPaise = computeBillNet(input.lines, input.adjustments ?? [], (input.bardan ?? []).map((entry) => ({ ...entry, creditPaise: entry.creditPaise ?? 0 })), input.taxMode, input.gstRateBp ?? 0).netPaise
          const pinnedPaise = Math.min(input.payment.amountPaise, Math.max(0, billNetPaise))
          if (pinnedPaise > 0) {
            const allocationId = generateRecordId()
            batch.collection('supplier_payment_allocations').create({
              id: allocationId, payment: paymentId, bill: billId, amount_paise: pinnedPaise,
            })
            batch.collection('purchase_audit_log').create({
              collection: 'supplier_payment_allocations', record_id: allocationId, action: 'create',
              after_json: JSON.stringify({ payment: paymentId, bill: billId, amount_paise: pinnedPaise }), actor: currentActor(),
            })
          }
          batch.collection('purchase_audit_log').create({
            collection: 'supplier_payments', record_id: paymentId, action: 'create',
            after_json: JSON.stringify(paymentPayload), actor: currentActor(),
          })
        }
        batch.collection('purchase_audit_log').create({
          collection: 'purchase_bills',
          record_id: billId,
          action: 'create',
          after_json: JSON.stringify(billPayload),
          actor: currentActor(),
        })
        if (input.draftId) {
          batch.collection('purchase_bill_drafts').update(input.draftId, {
            status: 'approved', converted_bill: billId,
          })
        }
        return { batch, record: billPayload }
      },
    }).catch(async (error: unknown) => {
      if (input.draftId) {
        const draft = await pb.collection('purchase_bill_drafts').getOne(input.draftId).catch(() => null)
        if (draft?.status === 'approved' && draft.converted_bill) {
          throw new AppError({ code: 'CONFLICT', message: 'Draft already converted.', details: { billId: String(draft.converted_bill) }, cause: error })
        }
        if (draft?.status === 'rejected') throw new AppError({ code: 'CONFLICT', message: 'This draft was rejected.', cause: error })
      }
      throw error
    })
    const billId = saved.id
    if (input.photos && input.photos.length > 0) {
      try {
        const formData = new FormData()
        for (const file of input.photos) formData.append('photos', file)
        const uploaded = await pb.collection('purchase_bills').update(billId, formData)
        saved.photos = uploaded.photos
      } catch (error) {
        console.warn('[suppliers] Failed to upload bill photos', error)
        toast.warning('Bill saved, but its photos did not upload. Open the bill and add them again.')
      }
    }
    return mapBill(saved)
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
  lines: Array<{ id?: string; itemId?: string; itemName: string; weightG: number; rateMilli: number; amountPaise: number; receiptMemo?: string }>
  adjustments?: Array<{ type: string; amountPaise: number; note?: string }>
}

export async function updatePurchaseBill(billId: string, input: PurchaseBillUpdateInput): Promise<PurchaseBillView> {
  return runDataOperation('update-purchase-bill', async () => {
    validatePurchaseLines(input.lines)
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
      vehicle_no: input.vehicleNo ?? text(beforeBill.vehicle_no),
      private_note: input.privateNote ?? text(beforeBill.private_note),
    }

    // Keep existing line ids wherever the edit still carries them: bardan
    // entries reference rate lines by id, and rewriting every id would orphan
    // (or, with the old cascadeDelete, silently destroy) those entries.
    const oldLineIds = new Set(oldLines.map((row) => row.id))
    const claimedLineIds = new Set<string>()
    const oldMemos = parsePurchaseLineMemos(text(beforeBill.private_note))
    const lineOps = input.lines.map((line) => {
      const keepId = line.id && oldLineIds.has(line.id) && !claimedLineIds.has(line.id) ? line.id : ''
      if (keepId) claimedLineIds.add(keepId)
      return { line, keepId, recordId: keepId || generateRecordId() }
    })
    billPayload.private_note = formatPurchaseLineMemos(billPayload.private_note, Object.fromEntries(lineOps.map(({ line, keepId, recordId }) => [recordId, line.receiptMemo ?? (keepId ? oldMemos[keepId] ?? '' : '')])))

    const saved = await executeConfirmedBatch({
      confirmationCollection: 'purchase_audit_log', scope: `bill-update:${billId}`,
      label: `Changes to purchase bill ${text(beforeBill.in_no)}`, input,
      recover: (audit) => {
        const snapshot = parseAuditJson(text(audit.after_json))
        const header = snapshot?.bill && typeof snapshot.bill === 'object' ? snapshot.bill as Record<string, unknown> : billPayload
        return { ...beforeBill, ...header, id: billId, updated: audit.created }
      },
      build: async (auditId) => {
    const batch = pb.createBatch()
    batch.collection('purchase_bills').update(billId, billPayload)

    for (const { line, keepId, recordId } of lineOps) {
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
        batch.collection('purchase_bill_lines').create({ id: recordId, ...linePayload })
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
      id: auditId,
      collection: 'purchase_bills',
      record_id: billId,
      action: 'update',
      before_json: JSON.stringify({ bill: beforeBill, lines: oldLines, adjustments: oldAdjustments }),
      after_json: JSON.stringify({ bill: billPayload, lines: input.lines, adjustments: input.adjustments ?? [] }),
      actor: currentActor(),
    })

    return { batch, record: { ...beforeBill, ...billPayload, id: billId } }
      },
    })
    if (input.photos && input.photos.length > 0) {
      try {
        const formData = new FormData()
        for (const file of input.photos) {
          formData.append('photos', file)
        }
        const uploaded = await pb.collection('purchase_bills').update(billId, formData)
        saved.photos = uploaded.photos
      } catch (e) {
        console.warn('[suppliers] Failed to upload bill photos', e)
        toast.warning('Bill changes saved, but its photos did not upload. Add them again.')
      }
    }
    return mapBill(saved)
  })
}

export type PurchaseBardanEntryInput = {
  bagCount?: number
  actionDraftId?: string
  requestId?: string
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
    if (bool(bill.cancelled)) throw new Error('Bardan cannot be added to a voided bill.')
    const saved = await executeConfirmedBatch({
      confirmationCollection: 'purchase_bardan', scope: input.billId,
      label: `Bardan entry for bill ${text(bill.in_no)}`, input,
      build: async (bardanId) => {
    if (input.bagCount !== undefined) {
      const detail = await loadPurchaseBill(input.billId)
      const line = detail.lines.find((row) => row.id === input.rateLineId)
      const allowPreviouslyUnrecorded = input.actionDraftId && line && purchaseReceiptBagCount(line.receiptMemo) === 0 && detail.bardan.length === 0
      if (detail.bill.cancelled || !line || !Number.isSafeInteger(input.bagCount) || input.bagCount <= 0 ||
        (!allowPreviouslyUnrecorded && input.bagCount > remainingPurchaseBags(line, detail.bardan))) {
        throw new Error('The remaining bag count changed. Reopen Add Bardan and review the bill.')
      }
      if ((input.method === 'deduct' || input.method === 'advance' || input.actionDraftId) && line.rateMilli !== input.rateMilli) {
        throw new Error('The bill rate changed. Reopen Add Bardan and review the rate.')
      }
    }
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
      note: writeSettledBagCount(input.note ?? '', input.bagCount),
    }

    const batch = pb.createBatch()
    batch.collection('purchase_bardan').create(bardanPayload)
    if (input.actionDraftId) {
      batch.collection('muse_purchase_action_drafts').update(input.actionDraftId, { status: 'approved', converted_record: bardanId })
    }

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

    return { batch, record: bardanPayload }
      },
    })
    return mapBardan(saved)
  })
}

async function voidPurchaseRecord(collection: 'purchase_bills' | 'supplier_payments', id: string, reason: string): Promise<PBRow> {
  const cancelReason = reason.trim()
  if (!cancelReason) throw new Error('Void reason is required.')
  const before = await pb.collection(collection).getOne<PBRow>(id)
  if (bool(before.cancelled)) throw new Error('This record is already voided.')
  const patch = { cancelled: true, cancel_reason: cancelReason }
  return executeConfirmedBatch({
    confirmationCollection: 'purchase_audit_log',
    scope: `void:${collection}:${id}`,
    label: 'Purchase void',
    input: { id, cancelReason },
    recover: (audit) => ({ ...before, ...patch, updated: audit.created }),
    build: async (auditId) => {
      const batch = pb.createBatch()
      batch.collection(collection).update(id, patch)
      batch.collection('purchase_audit_log').create({
        id: auditId, collection, record_id: id, action: 'cancel',
        before_json: JSON.stringify(before), after_json: JSON.stringify(patch), actor: currentActor(),
      })
      return { batch, record: { ...before, ...patch } }
    },
  })
}

export async function cancelPurchaseBill(billId: string, reason: string): Promise<PurchaseBillView> {
  return runDataOperation('cancel-purchase-bill', async () => {
    return mapBill(await voidPurchaseRecord('purchase_bills', billId, reason))
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
  requestId?: string
  draftId?: string
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
    if (input.draftId) {
      const draft = await pb.collection('purchase_payment_drafts').getOne(input.draftId)
      if (draft.status === 'approved' && draft.converted_payment) {
        throw new AppError({ code: 'CONFLICT', message: 'Draft already converted.', details: { paymentId: String(draft.converted_payment) } })
      }
      if (draft.status !== 'pending_review') throw new AppError({ code: 'CONFLICT', message: 'This draft was already processed.' })
      await assertMuseSupplierReady(draft.supplier_draft, input.supplierId)
      if (parsePurchasePaymentDraft(draft.schema_version, draft.payload).kind === 'invalid') {
        throw new AppError({ code: 'VALIDATION', message: 'Invalid Purchase payment draft cannot be saved.' })
      }
    }
    requirePositiveInteger(input.amountPaise, 'Payment amount')
    const pinnedTotal = (input.allocations ?? []).reduce((sum, allocation) => {
      requirePositiveInteger(allocation.amountPaise, 'Allocation amount')
      return sum + allocation.amountPaise
    }, 0)
    if (pinnedTotal > input.amountPaise) throw new Error('Allocations exceed the payment amount.')
    validateSupplierPaymentMode(input.mode || 'cash', input.reference)
    if (input.kind === 'refund_received' && pinnedTotal > 0) throw new Error('Refunds cannot be pinned to purchase bills.')
    const saved = await executeConfirmedBatch({
      confirmationCollection: 'supplier_payments', scope: input.supplierId,
      label: 'Supplier payment', input,
      build: (paymentId) => {
    const payload = {
      id: paymentId,
      supplier: input.supplierId,
      date: input.date,
      pool: input.pool,
      kind: input.kind,
      amount_paise: input.amountPaise,
      mode: input.mode || 'cash',
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
    if (input.draftId) batch.collection('purchase_payment_drafts').update(input.draftId, { status: 'approved', converted_payment: paymentId })
    return { batch, record: payload }
      },
    }).catch(async (error: unknown) => {
      if (input.draftId) {
        const draft = await pb.collection('purchase_payment_drafts').getOne(input.draftId).catch(() => null)
        if (draft?.status === 'approved' && draft.converted_payment) {
          throw new AppError({ code: 'CONFLICT', message: 'Draft already converted.', details: { paymentId: String(draft.converted_payment) }, cause: error })
        }
        if (draft?.status === 'rejected') throw new AppError({ code: 'CONFLICT', message: 'This draft was rejected.', cause: error })
      }
      throw error
    })
    const paymentId = saved.id
    if (input.photos && input.photos.length > 0) {
      try {
        const formData = new FormData()
        for (const file of input.photos) {
          formData.append('photos', file)
        }
        const uploaded = await pb.collection('supplier_payments').update(paymentId, formData)
        saved.photos = uploaded.photos
      } catch (e) {
        console.warn('[suppliers] Failed to upload payment photos', e)
        toast.warning('Payment saved, but its photos did not upload. Add them again.')
      }
    }
    return mapPayment(saved)
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
  return runDataOperation('load-purchase-bill-id', async () => {
    const safe = String(inNo ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    try {
      const row = await pb.collection('purchase_bills').getFirstListItem(`in_no = "${safe}"`, { fields: 'id' })
      return String(row.id)
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null
      throw error
    }
  })
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
      lines: lines.map((line) => ({ ...line, receiptMemo: parsePurchaseLineMemos(text(billRaw.private_note))[line.id] ?? '' })),
      adjustments,
      bardan,
      allocations,
    }
  })
}

export async function cancelSupplierPayment(paymentId: string, reason: string): Promise<SupplierPaymentView> {
  return runDataOperation('cancel-supplier-payment', async () => {
    return mapPayment(await voidPurchaseRecord('supplier_payments', paymentId, reason))
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

async function readPurchaseCollections(): Promise<PurchaseCollections> {
  const [bills, lines, adjustments, bardan, payments, allocations] = await Promise.all([
    fetchAll(SUPPLIER_COLLECTIONS.bills, mapBill, { sort: 'date,created,id' }),
    fetchAll(SUPPLIER_COLLECTIONS.lines, mapLine, { sort: 'created,id' }),
    fetchAll(SUPPLIER_COLLECTIONS.adjustments, mapAdjustment, { sort: 'created,id' }),
    fetchAll(SUPPLIER_COLLECTIONS.bardan, mapBardan, { sort: 'date,created,id' }),
    fetchAll(SUPPLIER_COLLECTIONS.payments, mapPayment, { sort: 'date,created,id' }),
    fetchAll(SUPPLIER_COLLECTIONS.allocations, mapAllocation, { sort: 'created,id' }),
  ])
  return { bills, lines, adjustments, bardan, payments, allocations }
}

async function readPurchaseModel(): Promise<PurchaseReadModel> {
  const [suppliers, collections] = await Promise.all([
    fetchAll('suppliers', mapSupplier, { sort: 'company_name' }),
    readPurchaseCollections(),
  ])
  return buildPurchaseReadModel(suppliers, collections)
}

export async function loadPurchaseReadModel(): Promise<PurchaseReadModel> {
  return runDataOperation('load-purchase-read-model', readPurchaseModel)
}

export async function loadSupplierBundle(supplierId: string): Promise<SupplierBundle> {
  return runDataOperation('load-supplier-bundle', async () => {
    const supplier = await getSupplier(supplierId)
    return buildSupplierBundle(supplier, groupPurchaseCollections(await readPurchaseCollections()))
  })
}

export function computeSupplierBundleSettlement(bundle: SupplierBundle): SupplierSettlementResult {
  return computeSupplierSettlement(bundleToSettlementInput(bundle))
}

export function computeSupplierBundleLedger(bundle: SupplierBundle, filter?: SupplierLedgerInput['filter']): SupplierLedgerResult {
  return buildSupplierLedger(bundleToLedgerInput(bundle, filter))
}

export async function loadSuppliersSummary(): Promise<SupplierSummary[]> {
  return runDataOperation('load-suppliers-summary', async () => (await readPurchaseModel()).summaries)
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
  return runDataOperation('load-all-purchase-bills', async () => (await readPurchaseModel()).bills)
}

export async function loadAllSupplierPayments(): Promise<EnrichedSupplierPayment[]> {
  return runDataOperation('load-all-supplier-payments', async () => (await readPurchaseModel()).payments)
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
  return runDataOperation('load-bardan-pending-count', async () =>
    (await readPurchaseModel()).bills.filter((bill) => bill.bardanPending).length,
  )
}


// ---------------------------------------------------------------------------
// Purchase audit log — read-only feed for the /purchase-logs screen
// ---------------------------------------------------------------------------

export type PurchaseAuditEntryView = {
  id: string
  collection: string
  recordId: string
  action: string
  beforeJson: string
  afterJson: string
  actor: string
  created: string
  /** Human-readable one-liner resolved against live master data. */
  title: string
  /** Optional context line (supplier, bill IN no, payment mode, ...). */
  detail: string
  /** Amount snapshot from the after_json, in paise, when it can be extracted. */
  amountPaise: number | null
}

type AuditRow = Record<string, unknown> & { id: string }

function parseAuditJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function loadPurchaseAuditLog(fromDate?: string): Promise<PurchaseAuditEntryView[]> {
  return runDataOperation('load-purchase-audit-log', async () => {
    const [rawEntries, bills, payments, suppliers, items] = await Promise.all([
      pb.collection('purchase_audit_log').getFullList({
        sort: '-created',
        ...(fromDate ? { filter: pb.filter('created >= {:from}', { from: `${fromDate} 00:00:00` }) } : {}),
      }),
      pb.collection('purchase_bills').getFullList({ fields: 'id,in_no,supplier' }),
      pb.collection('supplier_payments').getFullList({ fields: 'id,supplier,kind,mode,amount_paise,reference' }),
      pb.collection('suppliers').getFullList({ fields: 'id,company_name' }),
      pb.collection('purchase_items').getFullList({ fields: 'id,name' }),
    ])
    const billById = new Map((bills as unknown as AuditRow[]).map((row) => [row.id, { inNo: String(row.in_no ?? ''), supplierId: String(row.supplier ?? '') }]))
    const paymentById = new Map((payments as unknown as AuditRow[]).map((row) => [row.id, { supplierId: String(row.supplier ?? ''), kind: String(row.kind ?? ''), mode: String(row.mode ?? ''), amountPaise: num(row.amount_paise), reference: String(row.reference ?? '') }]))
    const supplierById = new Map((suppliers as unknown as AuditRow[]).map((row) => [row.id, String(row.company_name ?? '')]))
    const itemById = new Map((items as unknown as AuditRow[]).map((row) => [row.id, String(row.name ?? '')]))

    const supplierNameOfBill = (billId: string) => {
      const bill = billById.get(billId)
      return bill ? supplierById.get(bill.supplierId) ?? '' : ''
    }

    return (rawEntries as unknown as AuditRow[]).map((row) => {
      const collection = String(row.collection ?? '')
      const recordId = String(row.record_id ?? '')
      const action = String(row.action ?? '')
      const beforeJson = text(row.before_json)
      const afterJson = text(row.after_json)
      const before = parseAuditJson(beforeJson)
      const after = parseAuditJson(afterJson)
      const actor = text(row.actor)
      const created = text(row.created)
      const unwrapBill = (snapshot: AuditRow | Record<string, unknown> | null): Record<string, unknown> => snapshot?.bill && typeof snapshot.bill === 'object' ? snapshot.bill as Record<string, unknown> : snapshot ?? {}
      const source = { ...unwrapBill(before), ...unwrapBill(after) }
      const rawAmount = source.amount_paise ?? (source.method === 'cash_back' ? source.cash_amount_paise : source.credit_paise)
      const amountPaise = rawAmount != null ? num(rawAmount) : null

      let title = `${collection.replace(/_/g, ' ')} — ${action.replace(/_/g, ' ')}`
      let detail = ''

      switch (collection) {
        case 'purchase_bills': {
          const inNo = String(source.in_no ?? billById.get(recordId)?.inNo ?? '')
          const sup = supplierById.get(String(source.supplier ?? '')) || supplierNameOfBill(recordId)
          title = action === 'create' ? `Bill ${inNo} created` : action === 'cancel' ? `Bill ${inNo} cancelled` : action === 'uncancel' ? `Bill ${inNo} restored` : `Bill ${inNo} edited`
          detail = sup
          break
        }
        case 'purchase_bill_lines': {
          const billId = String(source.bill ?? '')
          const inNo = billById.get(billId)?.inNo ?? ''
          const itemName = String(source.item_name ?? itemById.get(String(source.item ?? '')) ?? '')
          const kg = num(source.weight_g) > 0 ? ` · ${(num(source.weight_g) / 1000).toFixed(3)} kg` : ''
          title = `${action === 'delete' ? 'Line removed from' : 'Line on'} Bill ${inNo}`
          detail = [itemName, kg.replace(' · ', '')].filter(Boolean).join(' · ')
          break
        }
        case 'purchase_bill_adjustments': {
          const billId = String(source.bill ?? '')
          const inNo = billById.get(billId)?.inNo ?? ''
          const type = String(source.type ?? '').replace(/_/g, ' ')
          title = action === 'delete' ? `Adjustment removed from Bill ${inNo}` : `${type || 'Adjustment'} on Bill ${inNo}`
          detail = amountPaise != null ? formatRupeesShort(amountPaise) : ''
          break
        }
        case 'purchase_bardan': {
          const billId = String(source.bill ?? '')
          const inNo = billById.get(billId)?.inNo ?? ''
          const method = String(source.method ?? '').replace(/_/g, ' ')
          title = action === 'unlink_rate_line' ? `Bardan rate line unlinked on Bill ${inNo}` : `Bardan (${method}) on Bill ${inNo}`
          detail = amountPaise ? formatRupeesShort(amountPaise) : ''
          break
        }
        case 'supplier_payments': {
          const payment = paymentById.get(recordId)
          const sup = supplierById.get(String(source.supplier ?? payment?.supplierId ?? '')) ?? ''
          const kind = String(source.kind ?? payment?.kind ?? 'payment').replace(/_/g, ' ')
          const amount = amountPaise ?? payment?.amountPaise ?? 0
          title = `${action === 'cancel' ? 'Payment cancelled' : 'Payment recorded'} · ${kind}`
          detail = [sup, amount ? formatRupeesShort(amount) : '', String(source.mode ?? payment?.mode ?? '').toUpperCase()].filter(Boolean).join(' · ')
          break
        }
        case 'supplier_payment_allocations': {
          const billId = String(source.bill ?? '')
          const inNo = billById.get(billId)?.inNo ?? ''
          title = `Payment pinned to Bill ${inNo}`
          detail = amountPaise ? formatRupeesShort(amountPaise) : ''
          break
        }
        case 'suppliers': {
          const name = String(source.company_name ?? before?.company_name ?? '')
          title = action === 'create' ? `Supplier ${name} added` : action === 'deactivate' ? `Supplier ${name} deactivated` : action === 'reactivate' ? `Supplier ${name} reactivated` : `Supplier ${name} edited`
          detail = name
          break
        }
        case 'purchase_items': {
          const name = String(source.name ?? before?.name ?? '')
          title = action === 'create' ? `Item "${name}" added` : action === 'rename' ? `Item renamed to "${name}"` : action === 'deactivate' ? `Item "${name}" deactivated` : action === 'activate' ? `Item "${name}" reactivated` : `Item "${name}" updated`
          detail = name
          break
        }
        default:
          break
      }

      return { id: row.id, collection, recordId, action, beforeJson, afterJson, actor, created, title, detail, amountPaise }
    })
  })
}

function formatRupeesShort(paise: number): string {
  const rupees = Math.abs(paise) / 100
  const text = rupees >= 100_000 ? `₹${(rupees / 100_000).toFixed(2)}L` : `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: rupees % 1 === 0 ? 0 : 2 })}`
  return paise < 0 ? `-${text}` : text
}
