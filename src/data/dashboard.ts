import { pb } from '@/data/pocketbase'

export type PBRecord = Record<string, unknown> & { id: string }

export async function loadDashboardCollections() {
  const [billsRaw, billItemsRaw, paymentsRaw, customersRaw] = await Promise.all([
    pb.collection('bills').getFullList({ sort: '-date,-bill_no' }),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList({ sort: '-date' }),
    pb.collection('customers').getFullList({ sort: 'company_name,name' }),
  ])

  return {
    billsRaw: billsRaw as PBRecord[],
    billItemsRaw: billItemsRaw as PBRecord[],
    paymentsRaw: paymentsRaw as PBRecord[],
    customersRaw: customersRaw as PBRecord[],
  }
}
