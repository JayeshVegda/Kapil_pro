import { calculateBillTotalFromBase } from '@/domain/billing-calculations'

export type StatementLedgerInput = {
  customer: Record<string, unknown>
  range: { start: string; end: string; label?: string }
  bills: Array<Record<string, unknown>>
  billItems: Array<Record<string, unknown>>
  payments: Array<Record<string, unknown>>
}

export type StatementLedgerRow = {
  id: string
  date: string
  kind: 'bill' | 'payment'
  ref: string
  debit: number
  credit: number
  runningBalance: number
  detailText: string
}

export type StatementLedger = {
  openingBalance: number
  closingBalance: number
  rows: StatementLedgerRow[]
}

type NormalizedEvent = {
  id: string
  date: string
  kind: 'bill' | 'payment'
  ref: string
  debit: number
  credit: number
  detailText: string
  sortKey: number
}

export function buildPartyStatementLedger(input: StatementLedgerInput): StatementLedger {
  const customerId = String(input.customer.id ?? '')
  const openingBalance = num(input.customer.opening_balance)
  const itemBaseByBill = billItemBaseMap(input.billItems)
  const billItemsByBill = groupBy(input.billItems, (row) => String(row.bill ?? ''))

  const events: NormalizedEvent[] = [
    ...input.bills
      .filter((bill) => String(bill.customer ?? '') === customerId)
      .map((bill) => ({
        id: String(bill.id ?? ''),
        date: datePart(bill.date),
        kind: 'bill' as const,
        ref: `${num(bill.book_no)}/${num(bill.bill_no)}`,
        debit: calculateBillTotalFromBase(
          itemBaseByBill.get(String(bill.id ?? '')) ?? 0,
          num(bill.transport),
          num(bill.gst_rate),
          num(bill.gst_amount),
        ),
        credit: 0,
        detailText: itemDetails(billItemsByBill.get(String(bill.id ?? '')) ?? []),
        sortKey: num(bill.bill_no),
      })),
    ...input.payments
      .filter((payment) => String(payment.customer ?? '') === customerId)
      .map((payment) => ({
        id: String(payment.id ?? ''),
        date: datePart(payment.date),
        kind: 'payment' as const,
        ref: String(payment.mode ?? 'Payment') || 'Payment',
        debit: 0,
        credit: num(payment.amount),
        detailText: String(payment.note ?? ''),
        sortKey: 999999,
      })),
  ].sort(compareEvents)

  let opening = openingBalance
  for (const event of events) {
    if (event.date && event.date < input.range.start) opening += event.debit - event.credit
  }

  let runningBalance = opening
  const rows = events
    .filter((event) => event.date >= input.range.start && event.date <= input.range.end)
    .map((event) => {
      runningBalance += event.debit - event.credit
      return {
        id: event.id,
        date: event.date,
        kind: event.kind,
        ref: event.ref,
        debit: event.debit,
        credit: event.credit,
        runningBalance,
        detailText: event.detailText,
      }
    })

  return {
    openingBalance: opening,
    closingBalance: runningBalance,
    rows,
  }
}

function compareEvents(a: NormalizedEvent, b: NormalizedEvent) {
  return a.date.localeCompare(b.date) || kindRank(a.kind) - kindRank(b.kind) || a.sortKey - b.sortKey || a.id.localeCompare(b.id)
}

function kindRank(kind: 'bill' | 'payment') {
  return kind === 'bill' ? 0 : 1
}

function billItemBaseMap(billItems: Array<Record<string, unknown>>) {
  const map = new Map<string, number>()
  for (const item of billItems) {
    const billId = String(item.bill ?? '')
    map.set(billId, (map.get(billId) ?? 0) + num(item.amount))
  }
  return map
}

function groupBy<T>(rows: T[], getKey: (row: T) => string) {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = getKey(row)
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return map
}

function itemDetails(items: Array<Record<string, unknown>>) {
  return items.map((item) => `${String(item.item_name ?? '')} ${num(item.qty)} kg`).join(' | ')
}

function datePart(value: unknown) {
  return String(value ?? '').slice(0, 10)
}

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
