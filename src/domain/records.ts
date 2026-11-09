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

export type AgeingBucketKey = '0_30' | '31_60' | '60_plus'

export type AgeingBucketItem = {
  key: AgeingBucketKey
  label: string
  amount: number
  count: number
}

export type AgeingSummary = {
  bucket0to30: number
  bucket31to60: number
  bucket60plus: number
  count0to30: number
  count31to60: number
  count60plus: number
  totalAmount: number
  buckets: AgeingBucketItem[]
}

/**
 * Canonical 3-bucket ageing calculation (0-30, 31-60, 60+ days).
 * Strict boundary rules:
 * - 0-30 days: dueDays <= 30
 * - 31-60 days: dueDays > 30 && dueDays <= 60
 * - 60+ days: dueDays > 60
 */
export function computeAgeingBuckets(rows: Array<{ amount: number; dueDays: number }>): AgeingSummary {
  let bucket0to30 = 0
  let bucket31to60 = 0
  let bucket60plus = 0
  let count0to30 = 0
  let count31to60 = 0
  let count60plus = 0

  for (const row of rows) {
    if (row.amount <= 0) continue
    if (row.dueDays <= 30) {
      bucket0to30 += row.amount
      count0to30 += 1
    } else if (row.dueDays <= 60) {
      bucket31to60 += row.amount
      count31to60 += 1
    } else {
      bucket60plus += row.amount
      count60plus += 1
    }
  }

  const totalAmount = bucket0to30 + bucket31to60 + bucket60plus
  return {
    bucket0to30,
    bucket31to60,
    bucket60plus,
    count0to30,
    count31to60,
    count60plus,
    totalAmount,
    buckets: [
      { key: '0_30', label: '0–30 days', amount: bucket0to30, count: count0to30 },
      { key: '31_60', label: '31–60 days', amount: bucket31to60, count: count31to60 },
      { key: '60_plus', label: '60+ days', amount: bucket60plus, count: count60plus },
    ],
  }
}

