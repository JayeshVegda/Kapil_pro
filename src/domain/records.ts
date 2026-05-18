import { computeNetBalance, isOnOrBeforeDay } from '@/domain/financial-math'

export type CanonicalBillRecord = {
  id: string
  businessDate?: string
  date?: string
  createdAt?: string
  customerId?: string
  customerName?: string
  bookNo?: number
  billNo?: number
  total?: number
  transport?: number
  gstRate?: number
  gstAmount?: number
  mktRate?: number
  lrNo?: string
}

export type CanonicalPaymentRecord = {
  id: string
  businessDate?: string
  date?: string
  createdAt?: string
  customerId?: string
  customerName?: string
  amount: number
  mode?: string
  note?: string
}

export type CanonicalCustomerBalanceRecord = {
  customerId: string
  openingBalance: number
}

const toTimestamp = (value: string) => {
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? ts : 0
}

export function compareBusinessDateThenCreatedAsc<T extends { businessDate?: string; date?: string; createdAt?: string; id: string }>(a: T, b: T) {
  const aDate = a.businessDate ?? a.date ?? ''
  const bDate = b.businessDate ?? b.date ?? ''
  if (aDate !== bDate) return aDate.localeCompare(bDate)
  const createdDiff = toTimestamp(a.createdAt ?? '') - toTimestamp(b.createdAt ?? '')
  if (createdDiff !== 0) return createdDiff
  return a.id.localeCompare(b.id)
}

export function compareBusinessDateThenCreatedDesc<T extends { businessDate?: string; date?: string; createdAt?: string; id: string }>(a: T, b: T) {
  return compareBusinessDateThenCreatedAsc(b, a)
}

export function computeCustomerOutstanding(params: {
  openingBalance: number
  bills: CanonicalBillRecord[]
  payments: CanonicalPaymentRecord[]
  asOfDate: string
}) {
  const asOfBills = params.bills.filter((bill) => isOnOrBeforeDay(bill.businessDate ?? bill.date ?? '', params.asOfDate))
  const asOfPayments = params.payments.filter((payment) => isOnOrBeforeDay(payment.businessDate ?? payment.date ?? '', params.asOfDate))
  const billedTotal = asOfBills.reduce((sum, bill) => sum + Number(bill.total ?? 0), 0)
  const paidTotal = asOfPayments.reduce((sum, payment) => sum + payment.amount, 0)
  const netBalance = computeNetBalance(params.openingBalance, billedTotal, paidTotal)
  return {
    billedTotal,
    paidTotal,
    netBalance,
    dueAmount: netBalance > 0 ? netBalance : 0,
    advanceAmount: netBalance < 0 ? Math.abs(netBalance) : 0,
  }
}
