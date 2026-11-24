import { roundPaise } from '@/domain/financial-math'

export type BillStatus = 'pending' | 'partial' | 'paid'

type BillStatusBillInput = {
  id: string
  businessDate: string
  createdAt: string
  amount: number
}

type BillStatusPaymentInput = {
  id: string
  businessDate: string
  createdAt: string
  amount: number
}

const toTimestamp = (value: string) => {
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? ts : 0
}

const compareDateThenCreatedAsc = <T extends { id: string; businessDate: string; createdAt: string }>(a: T, b: T) => {
  const dateDiff = a.businessDate.localeCompare(b.businessDate)
  if (dateDiff !== 0) return dateDiff
  const createdDiff = toTimestamp(a.createdAt) - toTimestamp(b.createdAt)
  if (createdDiff !== 0) return createdDiff
  return a.id.localeCompare(b.id)
}

export function allocateBillPayments(params: {
  openingBalance: number
  bills: BillStatusBillInput[]
  payments: BillStatusPaymentInput[]
}) {
  const sortedBills = [...params.bills].sort(compareDateThenCreatedAsc)
  const sortedPayments = [...params.payments].sort(compareDateThenCreatedAsc)

  const credits = sortedPayments.reduce((sum, payment) => sum + payment.amount, 0) + Math.max(0, -params.openingBalance)
  const openingRemaining = Math.max(0, params.openingBalance - credits)
  let remainingPayments = Math.max(0, credits - Math.max(0, params.openingBalance))

  const bills = sortedBills.map((bill) => {
    const billAmount = Math.max(0, roundPaise(bill.amount))
    const appliedToBill = Math.min(billAmount, remainingPayments)
    remainingPayments -= appliedToBill
    // Half-paise tolerance: a payment matching the displayed (rounded) total must count as paid.
    const remaining = Math.max(0, roundPaise(billAmount - appliedToBill))
    const status: BillStatus = remaining <= 0 ? 'paid' : appliedToBill <= 0 ? 'pending' : 'partial'
    return { ...bill, remaining, status }
  })
  return { openingRemaining, bills }
}

export function computeBillStatuses(params: Parameters<typeof allocateBillPayments>[0]) {
  return new Map(allocateBillPayments(params).bills.map((bill) => [bill.id, bill.status]))
}
