import type {
  EnrichedPurchaseBill, EnrichedSupplierPayment, PurchaseAdjustmentView, PurchaseBardanView,
  PurchaseBillView, PurchaseLineView, SupplierAllocationView, SupplierBundle, SupplierPaymentView,
  SupplierSummary, SupplierView,
} from '@/data/suppliers'
import { parsePurchaseLineMemos } from './purchase-receipt-memos'
import { bundleToSettlementInput } from './supplier-bundle'
import { computeDaysSince, extractUserNote, parseBagsAtReceiptKg } from './supplier-purchases'
import {
  CREDIT_KINDS, computeSupplierSettlement, settlementOrderKey,
  type SupplierSettlementBillRow, type SupplierSettlementPaymentRow, type SupplierSettlementResult,
} from './supplier-settlement'

export type PurchaseCollections = {
  bills: PurchaseBillView[]
  lines: PurchaseLineView[]
  adjustments: PurchaseAdjustmentView[]
  bardan: PurchaseBardanView[]
  payments: SupplierPaymentView[]
  allocations: SupplierAllocationView[]
}

export type SupplierPurchaseContext = { bundle: SupplierBundle; settlement: SupplierSettlementResult }
export type PurchaseReadModel = {
  suppliers: SupplierView[]
  summaries: SupplierSummary[]
  bills: EnrichedPurchaseBill[]
  payments: EnrichedSupplierPayment[]
  supplierContexts: Map<string, SupplierPurchaseContext>
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    const group = groups.get(id) ?? []
    group.push(row)
    groups.set(id, group)
  }
  return groups
}

function compareKey(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function chronological<T extends { id: string; date: string; created: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => compareKey(settlementOrderKey(a), settlementOrderKey(b)))
}

function creationOrder<T extends { id: string; created: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => compareKey(`${a.created}|${a.id}`, `${b.created}|${b.id}`))
}

export function groupPurchaseCollections(collections: PurchaseCollections) {
  const bills = chronological(collections.bills)
  const payments = chronological(collections.payments)
  const billById = new Map(bills.map((bill) => [bill.id, bill]))
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]))
  const memosByBill = new Map(bills.map((bill) => [bill.id, parsePurchaseLineMemos(bill.privateNote)]))
  const lines = creationOrder(collections.lines).map((line) => ({ ...line, receiptMemo: memosByBill.get(line.billId)?.[line.id] ?? '' }))
  const adjustments = creationOrder(collections.adjustments)
  const bardan = chronological(collections.bardan)
  const allocations = creationOrder(collections.allocations)
  const billOwner = (row: { billId: string }) => billById.get(row.billId)?.supplierId ?? ''
  return {
    bills, payments, billById,
    billsBySupplier: groupBy(bills, (bill) => bill.supplierId),
    paymentsBySupplier: groupBy(payments, (payment) => payment.supplierId),
    linesByBill: groupBy(lines, (line) => line.billId),
    adjustmentsByBill: groupBy(adjustments, (row) => row.billId),
    bardanByBill: groupBy(bardan, (row) => row.billId),
    linesBySupplier: groupBy(lines, billOwner),
    adjustmentsBySupplier: groupBy(adjustments, billOwner),
    bardanBySupplier: groupBy(bardan, billOwner),
    allocationsBySupplier: groupBy(allocations, (pin) => paymentById.get(pin.paymentId)?.supplierId ?? ''),
    allocationsByPayment: groupBy(allocations, (pin) => pin.paymentId),
  }
}

export function buildSupplierBundle(supplier: SupplierView, groups: ReturnType<typeof groupPurchaseCollections>): SupplierBundle {
  return {
    supplier,
    bills: groups.billsBySupplier.get(supplier.id) ?? [],
    lines: groups.linesBySupplier.get(supplier.id) ?? [],
    adjustments: groups.adjustmentsBySupplier.get(supplier.id) ?? [],
    bardan: groups.bardanBySupplier.get(supplier.id) ?? [],
    payments: groups.paymentsBySupplier.get(supplier.id) ?? [],
    allocations: groups.allocationsBySupplier.get(supplier.id) ?? [],
  }
}

function buildSummary({ bundle, settlement }: SupplierPurchaseContext, today: string): SupplierSummary {
  const bills = [...settlement.pools.kacha.bills, ...settlement.pools.gst.bills]
  const openBills = bills.filter((bill) => bill.status === 'open' || bill.status === 'partial')
  const earliestDate = openBills.reduce((min, bill) => (!min || bill.date < min ? bill.date : min), '')
  const lastActivityDate = [...bundle.bills, ...bundle.bardan, ...bundle.payments]
    .reduce((latest, row) => {
      const candidate = row.date || row.created.slice(0, 10)
      return candidate > latest ? candidate : latest
    }, '')
  return {
    supplier: bundle.supplier,
    kachaDuePaise: settlement.pools.kacha.outstandingPaise,
    gstDuePaise: settlement.pools.gst.outstandingPaise,
    advancePaise: settlement.combined.advancePaise,
    outstandingPaise: settlement.combined.netPositionPaise,
    lastActivityDate,
    bardanPendingCount: bills.filter((bill) => bill.bardanPending).length,
    oldestDueDays: earliestDate ? computeDaysSince(earliestDate, today) : null,
  }
}

export function buildPurchaseReadModel(
  suppliers: SupplierView[], collections: PurchaseCollections, today = new Date().toISOString().slice(0, 10),
): PurchaseReadModel {
  const groups = groupPurchaseCollections(collections)
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]))
  const supplierContexts = new Map<string, SupplierPurchaseContext>()
  const billSettlements = new Map<string, SupplierSettlementBillRow>()
  const paymentSettlements = new Map<string, SupplierSettlementPaymentRow>()
  for (const supplier of suppliers) {
    const bundle = buildSupplierBundle(supplier, groups)
    const settlement = computeSupplierSettlement(bundleToSettlementInput(bundle))
    supplierContexts.set(supplier.id, { bundle, settlement })
    for (const pool of Object.values(settlement.pools)) {
      for (const bill of pool.bills) billSettlements.set(bill.billId, bill)
      for (const payment of pool.payments) paymentSettlements.set(payment.paymentId, payment)
    }
  }

  const bills: EnrichedPurchaseBill[] = [...groups.bills].reverse().map((bill) => {
    const lines = groups.linesByBill.get(bill.id) ?? []
    const bardan = groups.bardanByBill.get(bill.id) ?? []
    const settlement = billSettlements.get(bill.id)
    const totalWeightG = lines.reduce((sum, line) => sum + line.weightG, 0)
    const netPaise = settlement?.netPaise ?? 0
    return {
      id: bill.id, inNo: bill.inNo, date: bill.date, created: bill.created, supplierId: bill.supplierId,
      supplierName: supplierById.get(bill.supplierId)?.companyName ?? 'Unknown Supplier',
      pool: bill.pool, taxMode: bill.taxMode, gstRateBp: bill.gstRateBp,
      supplierBillNo: bill.supplierBillNo, vehicleNo: bill.vehicleNo, privateNote: bill.privateNote,
      userNote: extractUserNote(bill.privateNote), bagsAtReceiptKg: parseBagsAtReceiptKg(bill.privateNote),
      photos: bill.photos, cancelled: bill.cancelled, cancelReason: bill.cancelReason,
      totalWeightG, totalKg: totalWeightG / 1000, netPaise,
      paidPaise: settlement?.paidPaise ?? 0,
      duePaise: settlement?.duePaise ?? (bill.cancelled ? 0 : netPaise),
      status: settlement?.status ?? (bill.cancelled ? 'cancelled' : 'open'),
      bardanPending: settlement?.bardanPending ?? (!bill.cancelled && bardan.length === 0),
      bardanEntryCount: bardan.length, lines, adjustments: groups.adjustmentsByBill.get(bill.id) ?? [], bardan,
    }
  })
  const payments: EnrichedSupplierPayment[] = [...groups.payments].reverse().map((payment) => {
    const appliedPaise = paymentSettlements.get(payment.id)?.appliedPaise ?? 0
    return {
      ...payment,
      supplierName: supplierById.get(payment.supplierId)?.companyName ?? 'Unknown Supplier',
      appliedPaise,
      advancePaise: !payment.cancelled && CREDIT_KINDS.has(payment.kind) ? Math.max(0, payment.amountPaise - appliedPaise) : 0,
      allocations: (groups.allocationsByPayment.get(payment.id) ?? []).map((pin) => ({
        billId: pin.billId, inNo: groups.billById.get(pin.billId)?.inNo ?? '', amountPaise: pin.amountPaise, isManual: true,
      })),
    }
  })
  return {
    suppliers, supplierContexts, bills, payments,
    summaries: [...supplierContexts.values()].map((context) => buildSummary(context, today)),
  }
}
