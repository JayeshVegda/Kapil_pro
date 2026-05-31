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

export function computeBillStatuses(params: {
  openingBalance: number
  bills: BillStatusBillInput[]
  payments: BillStatusPaymentInput[]
}) {
  const sortedBills = [...params.bills].sort(compareDateThenCreatedAsc)
  const sortedPayments = [...params.payments].sort(compareDateThenCreatedAsc)

  let remainingPayments = sortedPayments.reduce((sum, payment) => sum + payment.amount, 0)
  remainingPayments = Math.max(0, remainingPayments - Math.max(0, params.openingBalance))

  const statusByBillId = new Map<string, BillStatus>()
  for (const bill of sortedBills) {
    const billAmount = Math.max(0, bill.amount)
    const appliedToBill = Math.min(billAmount, remainingPayments)
    remainingPayments -= appliedToBill
    const status: BillStatus = appliedToBill <= 0 ? 'pending' : appliedToBill < billAmount ? 'partial' : 'paid'
    statusByBillId.set(bill.id, status)
  }

  return statusByBillId
}
