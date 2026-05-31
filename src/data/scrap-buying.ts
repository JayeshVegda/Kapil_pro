import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import {
  allocateSupplierPayment,
  calculatePurchaseTotals,
  computePurchasePaidStatuses,
  normalizeBillMode,
} from '@/domain/scrap-buying'
import type {
  BillMode,
  PurchaseDeductionKind,
  PurchaseDeductionLine,
  PurchaseDeductionLineInput,
  PurchaseEntry,
  PurchaseMaterialLine,
  PurchaseMaterialLineInput,
  PurchasePaidStatus,
  SupplierMaster,
  SupplierPayment,
  SupplierPaymentAllocation,
  SupplierPaymentMode,
} from '@/domain/scrap-buying-types'

type PBRecord = Record<string, unknown> & { id: string }
const PAGE_SIZE = 200

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const datePart = (value: unknown) => String(value ?? '').slice(0, 10)

async function listAllPaged(collection: string, options: { sort?: string; filter?: string } = {}) {
  const out: PBRecord[] = []
  let page = 1
  for (;;) {
    const res = await pb.collection(collection).getList(page, PAGE_SIZE, {
      sort: options.sort,
      filter: options.filter,
    })
    out.push(...(res.items as PBRecord[]))
    if (page >= res.totalPages) break
    page += 1
  }
  return out
}

function mapSupplier(row: PBRecord): SupplierMaster {
  return {
    id: row.id,
    name: String(row.name ?? ''),
    active: Boolean(row.active ?? true),
    phone: String(row.phone ?? ''),
    gstin: String(row.gstin ?? ''),
    address: String(row.address ?? ''),
    defaultBillMode: normalizeBillMode(row.default_bill_mode),
    openingPayable: num(row.opening_payable),
    openingPayableDate: datePart(row.opening_payable_date),
    notes: String(row.notes ?? ''),
    createdAt: String(row.created ?? ''),
    updatedAt: String(row.updated ?? ''),
  }
}

function mapPurchaseItem(row: PBRecord): PurchaseMaterialLine {
  return {
    id: row.id,
    purchaseBillId: String(row.purchase_bill ?? ''),
    materialName: String(row.material_name ?? ''),
    grossKg: num(row.gross_kg),
    bagCount: num(row.bag_count),
    bagKg: num(row.bag_kg),
    netKg: num(row.net_kg),
    rate: num(row.rate),
    calculationMode: String(row.calculation_mode ?? '') === 'deduct_after_amount' ? 'deduct_after_amount' : 'deduct_before_amount',
    grossAmount: num(row.gross_amount),
    bagDeductionAmount: num(row.bag_deduction_amount),
    lineAmount: num(row.line_amount),
  }
}

function mapPurchaseDeduction(row: PBRecord): PurchaseDeductionLine {
  const kind = String(row.kind ?? 'other') as PurchaseDeductionKind
  return {
    id: row.id,
    purchaseBillId: String(row.purchase_bill ?? ''),
    kind: ['faulty_return', 'rate_cut', 'bardan', 'other'].includes(kind) ? kind : 'other',
    materialName: String(row.material_name ?? ''),
    description: String(row.description ?? ''),
    qtyKg: num(row.qty_kg),
    rate: num(row.rate),
    amount: num(row.amount),
    affectsStock: Boolean(row.affects_stock),
  }
}

function mapPurchase(row: PBRecord, items: PurchaseMaterialLine[], deductions: PurchaseDeductionLine[]): PurchaseEntry {
  const status = String(row.paid_status ?? 'pending') as PurchasePaidStatus
  return {
    id: row.id,
    date: datePart(row.date),
    supplierId: String(row.supplier ?? ''),
    supplierName: String(row.supplier_name ?? ''),
    billMode: normalizeBillMode(row.bill_mode),
    supplierBillNo: String(row.supplier_bill_no ?? ''),
    internalRef: String(row.internal_ref ?? ''),
    materialTotal: num(row.material_total),
    deductionTotal: num(row.deduction_total),
    taxableValue: num(row.taxable_value),
    gstRate: num(row.gst_rate),
    gstAmount: num(row.gst_amount),
    grandTotal: num(row.grand_total),
    paidStatus: ['pending', 'partial', 'paid'].includes(status) ? status : 'pending',
    supplierGstin: String(row.supplier_gstin ?? ''),
    invoiceNo: String(row.invoice_no ?? ''),
    invoiceDate: datePart(row.invoice_date),
    note: String(row.note ?? ''),
    createdAt: String(row.created ?? ''),
    updatedAt: String(row.updated ?? ''),
    materialLines: items,
    deductionLines: deductions,
  }
}

function mapSupplierPayment(row: PBRecord): SupplierPayment {
  const mode = String(row.mode ?? 'cash') as SupplierPaymentMode
  return {
    id: row.id,
    date: datePart(row.date),
    supplierId: String(row.supplier ?? ''),
    supplierName: String(row.supplier_name ?? ''),
    amount: num(row.amount),
    mode: ['cash', 'bank', 'upi', 'cheque', 'other'].includes(mode) ? mode : 'cash',
    billModeScope: normalizeBillMode(row.bill_mode_scope),
    note: String(row.note ?? ''),
    createdAt: String(row.created ?? ''),
    updatedAt: String(row.updated ?? ''),
  }
}

function mapAllocation(row: PBRecord): SupplierPaymentAllocation {
  return {
    id: row.id,
    supplierPaymentId: String(row.supplier_payment ?? ''),
    purchaseBillId: String(row.purchase_bill ?? ''),
    amount: num(row.amount),
  }
}

export async function loadSuppliers(): Promise<SupplierMaster[]> {
  const rows = await listAllPaged('suppliers', { sort: 'name' }).catch(() => [])
  return rows.map(mapSupplier)
}

export async function loadBuyingCollections(): Promise<{
  suppliers: SupplierMaster[]
  purchases: PurchaseEntry[]
  payments: SupplierPayment[]
  allocations: SupplierPaymentAllocation[]
}> {
  const [suppliersRaw, purchasesRaw, itemsRaw, deductionsRaw, paymentsRaw, allocationsRaw] = await Promise.all([
    listAllPaged('suppliers', { sort: 'name' }).catch(() => []),
    listAllPaged('purchase_bills', { sort: '-date,-created' }).catch(() => []),
    listAllPaged('purchase_items').catch(() => []),
    listAllPaged('purchase_deductions').catch(() => []),
    listAllPaged('supplier_payments', { sort: '-date,-created' }).catch(() => []),
    listAllPaged('supplier_payment_allocations').catch(() => []),
  ])

  const itemsByBill = new Map<string, PurchaseMaterialLine[]>()
  for (const item of itemsRaw.map(mapPurchaseItem)) {
    const list = itemsByBill.get(item.purchaseBillId) ?? []
    list.push(item)
    itemsByBill.set(item.purchaseBillId, list)
  }

  const deductionsByBill = new Map<string, PurchaseDeductionLine[]>()
  for (const deduction of deductionsRaw.map(mapPurchaseDeduction)) {
    const list = deductionsByBill.get(deduction.purchaseBillId) ?? []
    list.push(deduction)
    deductionsByBill.set(deduction.purchaseBillId, list)
  }

  const purchases = purchasesRaw.map((row) => mapPurchase(row, itemsByBill.get(row.id) ?? [], deductionsByBill.get(row.id) ?? []))
  const payments = paymentsRaw.map(mapSupplierPayment)
  const statuses = computePurchasePaidStatuses(purchases, payments)
  return {
    suppliers: suppliersRaw.map(mapSupplier),
    purchases: purchases.map((purchase) => ({ ...purchase, paidStatus: statuses.get(purchase.id) ?? purchase.paidStatus })),
    payments,
    allocations: allocationsRaw.map(mapAllocation),
  }
}

export async function saveSupplier(input: {
  name: string
  phone: string
  gstin: string
  address: string
  defaultBillMode: BillMode
  openingPayable: number
  openingPayableDate: string
  notes: string
}) {
  return runDataOperation('save-supplier', async () => {
    const name = input.name.trim()
    if (!name) throw new Error('Supplier name is required')
    return mapSupplier(
      (await pb.collection('suppliers').create({
        name,
        active: true,
        phone: input.phone.trim(),
        gstin: input.gstin.trim(),
        address: input.address.trim(),
        default_bill_mode: input.defaultBillMode,
        opening_payable: Math.max(0, num(input.openingPayable)),
        opening_payable_date: input.openingPayableDate,
        notes: input.notes.trim(),
      })) as PBRecord,
    )
  })
}

export async function savePurchase(input: {
  date: string
  supplierId: string
  supplierName: string
  billMode: BillMode
  supplierBillNo: string
  internalRef: string
  gstRate: number
  supplierGstin: string
  invoiceNo: string
  invoiceDate: string
  note: string
  materialLines: PurchaseMaterialLineInput[]
  deductionLines: PurchaseDeductionLineInput[]
}) {
  return runDataOperation('save-purchase', async () => {
    if (!input.supplierId) throw new Error('Supplier is required')
    const totals = calculatePurchaseTotals({
      billMode: input.billMode,
      gstRate: input.gstRate,
      materialLines: input.materialLines,
      deductionLines: input.deductionLines,
    })
    if (totals.lines.length === 0) throw new Error('Add at least one material row')

    const purchase = await pb.collection('purchase_bills').create({
      date: input.date,
      supplier: input.supplierId,
      supplier_name: input.supplierName.trim(),
      bill_mode: input.billMode,
      supplier_bill_no: input.supplierBillNo.trim(),
      internal_ref: input.internalRef.trim(),
      material_total: totals.materialTotal,
      deduction_total: totals.deductionTotal,
      taxable_value: totals.taxableValue,
      gst_rate: input.billMode === 'gst' ? Math.max(0, num(input.gstRate)) : 0,
      gst_amount: totals.gstAmount,
      grand_total: totals.grandTotal,
      paid_status: 'pending',
      supplier_gstin: input.billMode === 'gst' ? input.supplierGstin.trim() : '',
      invoice_no: input.billMode === 'gst' ? input.invoiceNo.trim() : '',
      invoice_date: input.billMode === 'gst' ? input.invoiceDate : '',
      note: input.note.trim(),
    })

    const createdIds: Array<{ collection: string; id: string }> = []
    try {
      for (const line of totals.lines) {
        const created = await pb.collection('purchase_items').create({
          purchase_bill: purchase.id,
          material_name: line.materialName,
          gross_kg: line.grossKg,
          bag_count: line.bagCount,
          bag_kg: line.bagKg,
          net_kg: line.netKg,
          rate: line.rate,
          calculation_mode: line.calculationMode,
          gross_amount: line.grossAmount,
          bag_deduction_amount: line.bagDeductionAmount,
          line_amount: line.lineAmount,
        })
        createdIds.push({ collection: 'purchase_items', id: created.id })
      }
      for (const deduction of totals.deductions) {
        const created = await pb.collection('purchase_deductions').create({
          purchase_bill: purchase.id,
          kind: deduction.kind,
          material_name: deduction.materialName,
          description: deduction.description,
          qty_kg: deduction.qtyKg,
          rate: deduction.rate,
          amount: deduction.amount,
          affects_stock: deduction.affectsStock,
        })
        createdIds.push({ collection: 'purchase_deductions', id: created.id })
      }
    } catch (error) {
      await Promise.allSettled(createdIds.map((row) => pb.collection(row.collection).delete(row.id)))
      await pb.collection('purchase_bills').delete(purchase.id).catch(() => undefined)
      throw new Error(error instanceof Error ? error.message : 'Failed to save purchase lines')
    }

    return { id: purchase.id }
  })
}

export async function saveSupplierPayment(input: {
  date: string
  supplierId: string
  supplierName: string
  amount: number
  mode: SupplierPaymentMode
  billModeScope: BillMode
  note: string
}) {
  return runDataOperation('save-supplier-payment', async () => {
    if (!input.supplierId) throw new Error('Supplier is required')
    if (!(input.amount > 0)) throw new Error('Payment amount must be greater than zero')
    const data = await loadBuyingCollections()
    const preview = allocateSupplierPayment({
      purchases: data.purchases,
      payments: data.payments,
      supplierId: input.supplierId,
      billMode: input.billModeScope,
      amount: input.amount,
    })

    const payment = await pb.collection('supplier_payments').create({
      date: input.date,
      supplier: input.supplierId,
      supplier_name: input.supplierName.trim(),
      amount: input.amount,
      mode: input.mode,
      bill_mode_scope: input.billModeScope,
      note: input.note.trim(),
    })
    const allocationIds: string[] = []
    try {
      for (const allocation of preview.allocations) {
        const created = await pb.collection('supplier_payment_allocations').create({
          supplier_payment: payment.id,
          purchase_bill: allocation.purchaseBillId,
          amount: allocation.amount,
        })
        allocationIds.push(created.id)
      }
    } catch (error) {
      await Promise.allSettled(allocationIds.map((id) => pb.collection('supplier_payment_allocations').delete(id)))
      await pb.collection('supplier_payments').delete(payment.id).catch(() => undefined)
      throw new Error(error instanceof Error ? error.message : 'Failed to save payment allocations')
    }

    await refreshPurchaseStatuses(input.supplierId, input.billModeScope)
    return { id: payment.id }
  })
}

export async function refreshPurchaseStatuses(supplierId?: string, billMode?: BillMode) {
  const data = await loadBuyingCollections()
  const statuses = computePurchasePaidStatuses(data.purchases, data.payments)
  await Promise.allSettled(
    data.purchases
      .filter((purchase) => (!supplierId || purchase.supplierId === supplierId) && (!billMode || purchase.billMode === billMode))
      .map((purchase) => {
        const next = statuses.get(purchase.id) ?? 'pending'
        if (next === purchase.paidStatus) return Promise.resolve()
        return pb.collection('purchase_bills').update(purchase.id, { paid_status: next })
      }),
  )
}
