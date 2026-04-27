import { pb } from '@/data/pocketbase'

type PBRecord = Record<string, unknown> & { id: string }

export type BackupSnapshot = {
  exportedAt: string
  schemaVersion: number
  counts: {
    customers: number
    items: number
    bills: number
    billItems: number
    payments: number
  }
  data: {
    customers: PBRecord[]
    items: PBRecord[]
    bills: PBRecord[]
    billItems: PBRecord[]
    payments: PBRecord[]
  }
}

export async function buildBackupSnapshot(): Promise<BackupSnapshot> {
  const [customers, items, bills, billItems, payments] = await Promise.all([
    pb.collection('customers').getFullList({ sort: 'name' }),
    pb.collection('items').getFullList({ sort: 'name' }),
    pb.collection('bills').getFullList({ sort: 'date,bill_no' }),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList({ sort: 'date' }),
  ])

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    counts: {
      customers: customers.length,
      items: items.length,
      bills: bills.length,
      billItems: billItems.length,
      payments: payments.length,
    },
    data: {
      customers: customers as PBRecord[],
      items: items as PBRecord[],
      bills: bills as PBRecord[],
      billItems: billItems as PBRecord[],
      payments: payments as PBRecord[],
    },
  }
}

export function snapshotToCsvFiles(snapshot: BackupSnapshot) {
  const toCsv = (rows: string[][]) =>
    rows
      .map((row) =>
        row
          .map((cell) => {
            const value = String(cell ?? '')
            return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
          })
          .join(','),
      )
      .join('\n')

  const customers = [
    ['ID', 'Name', 'Phone', 'GSTIN', 'Opening Balance', 'Active'],
    ...snapshot.data.customers.map((row) => [
      row.id,
      String(row.name ?? ''),
      String(row.phone ?? ''),
      String(row.gstin ?? ''),
      String(row.opening_balance ?? 0),
      String(Boolean(row.active)),
    ]),
  ]
  const items = [
    ['ID', 'Name', 'Default Rate'],
    ...snapshot.data.items.map((row) => [row.id, String(row.name ?? ''), String(row.default_rate ?? 0)]),
  ]
  const bills = [
    ['ID', 'Date', 'Book No', 'Bill No', 'Customer ID', 'Customer Name', 'Transport', 'GST Rate', 'MKT', 'LR No'],
    ...snapshot.data.bills.map((row) => [
      row.id,
      String(row.date ?? ''),
      String(row.book_no ?? ''),
      String(row.bill_no ?? ''),
      String(row.customer ?? ''),
      String(row.customer_name ?? ''),
      String(row.transport ?? 0),
      String(row.gst_rate ?? 0),
      String(row.mkt ?? 0),
      String(row.lr_no ?? ''),
    ]),
  ]
  const billItems = [
    ['ID', 'Bill ID', 'Item Name', 'Qty', 'Rate', 'Amount', 'Bags'],
    ...snapshot.data.billItems.map((row) => [
      row.id,
      String(row.bill ?? ''),
      String(row.item_name ?? ''),
      String(row.qty ?? 0),
      String(row.rate ?? 0),
      String(row.amount ?? 0),
      String(row.bags ?? 0),
    ]),
  ]
  const payments = [
    ['ID', 'Date', 'Customer ID', 'Amount', 'Mode', 'Note'],
    ...snapshot.data.payments.map((row) => [
      row.id,
      String(row.date ?? ''),
      String(row.customer ?? ''),
      String(row.amount ?? 0),
      String(row.mode ?? ''),
      String(row.note ?? ''),
    ]),
  ]

  return [
    { filename: 'billing-customers.csv', content: toCsv(customers) },
    { filename: 'billing-items.csv', content: toCsv(items) },
    { filename: 'billing-bills.csv', content: toCsv(bills) },
    { filename: 'billing-bill-items.csv', content: toCsv(billItems) },
    { filename: 'billing-payments.csv', content: toCsv(payments) },
  ]
}

export function validateBackupSnapshot(raw: unknown) {
  if (typeof raw !== 'object' || raw === null) return { ok: false as const, message: 'Invalid JSON object.' }
  const obj = raw as Record<string, unknown>
  const data = obj.data as Record<string, unknown> | undefined
  if (!data) return { ok: false as const, message: 'Missing data section.' }

  const customers = Array.isArray(data.customers) ? data.customers : []
  const items = Array.isArray(data.items) ? data.items : []
  const bills = Array.isArray(data.bills) ? data.bills : []
  const billItems = Array.isArray(data.billItems) ? data.billItems : []
  const payments = Array.isArray(data.payments) ? data.payments : []

  const billIds = new Set((bills as PBRecord[]).map((row) => row.id))
  const brokenBillItems = (billItems as PBRecord[]).filter((row) => !billIds.has(String(row.bill ?? ''))).length

  const duplicateItemNames = countDuplicates((items as PBRecord[]).map((row) => String(row.name ?? '').trim().toLowerCase()))
  const duplicateBillRefs = countDuplicates((bills as PBRecord[]).map((row) => `${String(row.book_no ?? '')}/${String(row.bill_no ?? '')}`))

  return {
    ok: true as const,
    schemaVersion: Number(obj.schemaVersion ?? 0) || 0,
    exportedAt: String(obj.exportedAt ?? ''),
    counts: {
      customers: customers.length,
      items: items.length,
      bills: bills.length,
      billItems: billItems.length,
      payments: payments.length,
    },
    integrity: {
      brokenBillItems,
      duplicateItemNames,
      duplicateBillRefs,
    },
  }
}

function countDuplicates(values: string[]) {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const value of values) {
    if (!value) continue
    if (seen.has(value)) dup.add(value)
    else seen.add(value)
  }
  return dup.size
}

