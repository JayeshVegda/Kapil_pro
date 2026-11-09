import { queryOptions } from '@tanstack/react-query'
import type { PurchaseReadModel } from '@/domain/purchase-read-model'
import { listSuppliers, loadPurchaseAuditLog, loadPurchaseBill, loadPurchaseReadModel } from './suppliers'

export const PURCHASE_READ_MODEL_QUERY_KEY = ['purchase-read-model'] as const

export function purchaseReadModelQueryOptions() {
  return queryOptions({
    queryKey: PURCHASE_READ_MODEL_QUERY_KEY,
    queryFn: loadPurchaseReadModel,
    staleTime: 60_000,
  })
}

const selectBills = (model: PurchaseReadModel) => model.bills
const selectPayments = (model: PurchaseReadModel) => model.payments
const selectSummaries = (model: PurchaseReadModel) => model.summaries

export function purchaseBillsQueryOptions() {
  return queryOptions({ ...purchaseReadModelQueryOptions(), select: selectBills })
}

export function supplierPaymentsQueryOptions() {
  return queryOptions({ ...purchaseReadModelQueryOptions(), select: selectPayments })
}

export function suppliersSummaryQueryOptions() {
  return queryOptions({ ...purchaseReadModelQueryOptions(), select: selectSummaries })
}

export function supplierContextQueryOptions(supplierId: string) {
  return queryOptions({
    ...purchaseReadModelQueryOptions(),
    enabled: Boolean(supplierId),
    select: (model: PurchaseReadModel) => model.supplierContexts.get(supplierId) ?? null,
  })
}

export function supplierBundleQueryOptions(supplierId: string) {
  return queryOptions({
    ...purchaseReadModelQueryOptions(),
    enabled: Boolean(supplierId),
    select: (model: PurchaseReadModel) => model.supplierContexts.get(supplierId)?.bundle ?? null,
  })
}

export function purchaseBillQueryOptions(billId: string) {
  return queryOptions({
    queryKey: ['purchase-bill', billId] as const,
    queryFn: () => billId ? loadPurchaseBill(billId) : Promise.resolve(null),
    enabled: Boolean(billId),
  })
}

export function supplierListQueryOptions() {
  return queryOptions({
    queryKey: ['suppliers-list'] as const,
    queryFn: () => listSuppliers({ includeInactive: false }),
  })
}

export function purchaseAuditQueryOptions(fromDate: string) {
  return queryOptions({ queryKey: ['purchase-logs-audit', fromDate] as const, queryFn: () => loadPurchaseAuditLog(fromDate) })
}
