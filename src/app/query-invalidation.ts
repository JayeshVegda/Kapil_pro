import type { QueryClient } from '@tanstack/react-query'
import { DASHBOARD_QUERY_KEY } from '@/domain/dashboard'

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
