import { pb } from '@/data/pocketbase'
import { buildPartyEvents, buildPartyKpis, buildPartyRows, type LedgerBill, type LedgerBillItem, type LedgerCustomer, type LedgerPayment } from '@/domain/ledger'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'

type PBRecord = Record<string, unknown> & { id: string }

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)

export async function loadPartyDashboard(asOfDate: string, overdueDaysThreshold = 30) {
  const [customersRaw, billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
    pb.collection('customers').getFullList({ sort: 'name' }),
    pb.collection('bills').getFullList({ sort: 'date,bill_no' }),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList({ sort: 'date' }),
  ])

  const customers: LedgerCustomer[] = (customersRaw as PBRecord[]).map((row) => ({
    id: row.id,
    name: String(row.name ?? ''),
    active: Boolean(row.active),
    openingBalance: num(row.opening_balance),
  }))
  const bills: LedgerBill[] = (billsRaw as PBRecord[]).map((row) => ({
    id: row.id,
    customerId: String(row.customer ?? ''),
    date: datePart(row.date),
    bookNo: num(row.book_no),
    billNo: num(row.bill_no),
    transport: num(row.transport),
    gstRate: num(row.gst_rate),
  }))
  const billItems: LedgerBillItem[] = (billItemsRaw as PBRecord[]).map((row) => ({
    billId: String(row.bill ?? ''),
    amount: num(row.amount),
    qty: num(row.qty),
    bags: num(row.bags),
  }))
  const payments: LedgerPayment[] = (paymentsRaw as PBRecord[]).map((row) => ({
    id: row.id,
    customerId: String(row.customer ?? ''),
    date: datePart(row.date),
    amount: num(row.amount),
    mode: String(row.mode ?? ''),
  }))

  const rows = buildPartyRows({ customers, bills, billItems, payments, asOfDate, overdueDaysThreshold })
  const kpis = buildPartyKpis(rows)
  return { rows, kpis }
}

export async function loadPartyStatement(customerId: string, asOfDate: string) {
  const [customerRaw, billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
    pb.collection('customers').getOne(customerId),
    pb.collection('bills').getFullList({
      sort: 'date,bill_no',
      filter: `customer = "${customerId}" && date <= "${asOfDate}"`,
    }),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList({
      sort: 'date',
      filter: `customer = "${customerId}" && date <= "${asOfDate}"`,
    }),
  ])

  const billsRawTyped = billsRaw as PBRecord[]
  const billItemsRawTyped = billItemsRaw as PBRecord[]
  const paymentsRawTyped = paymentsRaw as PBRecord[]

  const itemSumByBill = new Map<string, number>()
  for (const row of billItemsRawTyped) {
    const billId = String(row.bill ?? '')
    itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(row.amount))
  }

  const bills = billsRawTyped.map((bill) => ({
    id: bill.id,
    date: datePart(bill.date),
    bookNo: num(bill.book_no),
    billNo: num(bill.bill_no),
    total: calculateBillTotalFromBase(itemSumByBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate)),
  }))
  const billDateById = new Map(bills.map((bill) => [bill.id, bill.date]))
  const payments = paymentsRawTyped.map((payment) => ({
    id: payment.id,
    date: datePart(payment.date),
    amount: num(payment.amount),
    mode: String(payment.mode ?? ''),
  }))

  const openingBalance = num((customerRaw as PBRecord).opening_balance)
  const events = buildPartyEvents({ openingBalance, bills, payments })
  const itemSummaryMap = new Map<
    string,
    {
      itemName: string
      totalQty: number
      totalBags: number
      totalAmount: number
      billCount: number
      lastDate: string
    }
  >()
  const billCountByItem = new Map<string, Set<string>>()
  for (const row of billItemsRawTyped) {
    const billId = String(row.bill ?? '')
    if (!billDateById.has(billId)) continue
    const itemName = String(row.item_name ?? '').trim() || 'Unknown Item'
    const entry = itemSummaryMap.get(itemName) ?? {
      itemName,
      totalQty: 0,
      totalBags: 0,
      totalAmount: 0,
      billCount: 0,
      lastDate: '',
    }
    entry.totalQty += num(row.qty)
    entry.totalBags += num(row.bags)
    entry.totalAmount += num(row.amount)
    const billDate = billDateById.get(billId) ?? ''
    if (billDate > entry.lastDate) entry.lastDate = billDate
    itemSummaryMap.set(itemName, entry)
    const seenBills = billCountByItem.get(itemName) ?? new Set<string>()
    seenBills.add(billId)
    billCountByItem.set(itemName, seenBills)
  }
  const itemSummary = [...itemSummaryMap.values()]
    .map((entry) => ({
      ...entry,
      billCount: billCountByItem.get(entry.itemName)?.size ?? 0,
      averageRate: entry.totalQty > 0 ? entry.totalAmount / entry.totalQty : 0,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount || b.totalQty - a.totalQty)

  return {
    customerId,
    customerName: String((customerRaw as PBRecord).name ?? ''),
    openingBalance,
    events,
    itemSummary,
  }
}

