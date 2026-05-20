import { pb } from '@/data/pocketbase'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { matchesAnyRankedQuery } from '@/lib/search'

type PBRecord = Record<string, unknown> & { id: string }

export type QuickSearchResult = {
  id: string
  kind: 'Customer' | 'Bill' | 'Payment'
  title: string
  subtitle: string
  customerId: string
  billId?: string
  paymentId?: string
}

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)

export async function loadQuickSearchResults(query: string): Promise<QuickSearchResult[]> {
  const q = query.trim()
  if (!q) return []

  const [customersRaw, billsRaw, paymentsRaw] = await Promise.all([
    pb.collection('customers').getFullList({ sort: 'company_name,name' }),
    pb.collection('bills').getFullList({ sort: '-date,-bill_no' }),
    pb.collection('payments').getFullList({ sort: '-date' }),
  ])

  const customers = (customersRaw as PBRecord[]).map((row) => ({
    id: row.id,
    name: formatCustomerDisplayName(row.company_name, row.name),
    rawName: String(row.name ?? ''),
    companyName: String(row.company_name ?? ''),
  }))
  const customerById = new Map(customers.map((row) => [row.id, row]))

  const customerResults = customers
    .filter((row) => matchesAnyRankedQuery([row.name, row.rawName, row.companyName], q))
    .map((row): QuickSearchResult => ({
      id: `customer-${row.id}`,
      kind: 'Customer',
      title: row.name,
      subtitle: 'Open party ledger',
      customerId: row.id,
    }))

  const billResults = (billsRaw as PBRecord[])
    .map((row) => {
      const customerId = String(row.customer ?? '')
      const customerName = customerById.get(customerId)?.name ?? String(row.customer_name ?? '')
      const billRef = `${num(row.book_no)}/${num(row.bill_no)}`
      const date = datePart(row.date)
      return {
        id: `bill-${row.id}`,
        kind: 'Bill' as const,
        title: `Bill ${billRef}`,
        subtitle: `${formatFullDate(date)} · ${customerName}`,
        customerId,
        billId: row.id,
        searchable: [billRef, String(row.bill_ref ?? ''), customerName, date, formatFullDate(date)],
      }
    })
    .filter((row) => row.customerId && matchesAnyRankedQuery(row.searchable, q))
    .map(({ searchable: _searchable, ...row }) => row)

  const paymentResults = (paymentsRaw as PBRecord[])
    .map((row) => {
      const customerId = String(row.customer ?? '')
      const customerName = customerById.get(customerId)?.name ?? String(row.customer_name ?? '')
      const date = datePart(row.date)
      const amount = num(row.amount)
      return {
        id: `payment-${row.id}`,
        kind: 'Payment' as const,
        title: `Payment ${formatInrInteger(amount)}`,
        subtitle: `${formatFullDate(date)} · ${customerName} · ${String(row.mode ?? 'Bank')}`,
        customerId,
        paymentId: row.id,
        searchable: [customerName, date, formatFullDate(date), String(row.mode ?? ''), String(amount)],
      }
    })
    .filter((row) => row.customerId && matchesAnyRankedQuery(row.searchable, q))
    .map(({ searchable: _searchable, ...row }) => row)

  return [...customerResults, ...billResults, ...paymentResults].slice(0, 12)
}
