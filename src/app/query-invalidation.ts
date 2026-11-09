import type { QueryClient } from '@tanstack/react-query'
import { DASHBOARD_QUERY_KEY } from '@/domain/dashboard'
import { PURCHASE_READ_MODEL_QUERY_KEY } from '@/data/purchase-queries'

export async function invalidateAfterPaymentWrite(queryClient: QueryClient, customerId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ['transactions-page'] }),
    queryClient.invalidateQueries({ queryKey: ['payment-ledger-context', customerId] }),
    queryClient.invalidateQueries({ queryKey: ['party-dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['party-statement', customerId] }),
    queryClient.invalidateQueries({ queryKey: ['company-report'] }),
    queryClient.invalidateQueries({ queryKey: ['print-bill-data'] }),
    queryClient.invalidateQueries({ queryKey: ['customers-ledger'] }),
    // New Bill previews previous balance + credits from this key.
    queryClient.invalidateQueries({ queryKey: ['customer-auto-balance'] }),
  ])
}

export async function invalidateAfterSupplierPurchaseWrite(queryClient: QueryClient, supplierId?: string) {
  const promises: Promise<unknown>[] = [
    queryClient.invalidateQueries({ queryKey: PURCHASE_READ_MODEL_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
    queryClient.invalidateQueries({ queryKey: ['suppliers-list'] }),
    queryClient.invalidateQueries({ queryKey: ['purchase-items'] }),
    queryClient.invalidateQueries({ queryKey: ['purchase-bills'] }),
    queryClient.invalidateQueries({ queryKey: ['supplier-payments'] }),
    queryClient.invalidateQueries({ queryKey: ['purchase-bill'] }),
    // Keep legacy keys fresh for callers outside the shared purchase snapshot.
    queryClient.invalidateQueries({ queryKey: ['supplier-bundle-context'] }),
    queryClient.invalidateQueries({ queryKey: ['purchase-bill-edit'] }),
    queryClient.invalidateQueries({ queryKey: ['purchase-logs-audit'] }),
  ]
  if (supplierId) {
    promises.push(queryClient.invalidateQueries({ queryKey: ['supplier-bundle', supplierId] }))
  } else {
    promises.push(queryClient.invalidateQueries({ queryKey: ['supplier-bundle'] }))
  }
  await Promise.all(promises)
}
