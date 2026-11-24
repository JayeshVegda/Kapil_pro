import { pb } from '@/data/pocketbase'
import { buildSalesBalanceContext, type AutoBalanceContext } from '@/domain/sales-balance-context'

export type { AutoBalanceContext, CreditAdjustment } from '@/domain/sales-balance-context'

export async function loadCustomerAutoBalanceContext(customerId: string, date: string): Promise<AutoBalanceContext> {
  const [billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
    pb.collection('bills').getFullList({
      sort: 'date,bill_no',
      filter: `customer = "${customerId}"`,
    }),
    pb.collection('bill_items').getFullList({ filter: `bill.customer = "${customerId}"` }),
    pb.collection('payments').getFullList({
      sort: 'date',
      filter: `customer = "${customerId}"`,
    }),
  ])
  const customerRecord = await pb.collection('customers').getOne(customerId)

  type PBRecord = Record<string, unknown> & { id: string }
  return buildSalesBalanceContext(customerRecord as PBRecord, billsRaw as PBRecord[], billItemsRaw as PBRecord[], paymentsRaw as PBRecord[], date)
}
