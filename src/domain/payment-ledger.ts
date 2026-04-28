import { isOnOrBeforeDay } from '@/domain/financial-math'
import { compareBusinessDateThenCreatedAsc, computeCustomerOutstanding, type CanonicalBillRecord, type CanonicalPaymentRecord } from '@/domain/records'

export type LedgerBill = CanonicalBillRecord & {
  date?: string
  businessDate?: string
  bookNo: number
  billNo: number
  total: number
  compactDetails?: string
}

export type LedgerPayment = CanonicalPaymentRecord & { date?: string }

export type PaymentAllocationLine = {
  dueRef: string
  dueDate: string
  compactDetails: string
  dueAmount: number
  paidAmount: number
  remainingAmount: number
}

export type PaymentPreview = {
  openingBalance: number
  openingBalanceDate: string
  outstandingBeforePayment: number
  paymentApplied: number
  outstandingAfterPayment: number
  advanceAfterPayment: number
  lines: PaymentAllocationLine[]
}

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const byDateAndBill = (a: LedgerBill, b: LedgerBill) => {
  const aDate = a.businessDate || a.date || ''
  const bDate = b.businessDate || b.date || ''
  const dateCmp = aDate.localeCompare(bDate)
  if (dateCmp !== 0) return dateCmp
  const createdCmp = compareBusinessDateThenCreatedAsc(a, b)
  if (createdCmp !== 0) return createdCmp
  if (a.billNo !== b.billNo) return a.billNo - b.billNo
  return a.bookNo - b.bookNo
}

export function buildPaymentPreview(params: {
  openingBalance: number
  openingBalanceDate?: string
  bills: LedgerBill[]
  payments: LedgerPayment[]
  paymentAmount: number
  asOfDate: string
}): PaymentPreview {
  const openingBalance = num(params.openingBalance)
  const openingBalanceDate = String(params.openingBalanceDate ?? '').trim()
  const paymentAmount = Math.max(0, num(params.paymentAmount))
  const asOfDate = String(params.asOfDate ?? '')

  const bills = params.bills
    .filter((bill) => isOnOrBeforeDay(bill.businessDate || bill.date || '', asOfDate))
    .sort(byDateAndBill)
    .map((bill) => ({
      dueRef: `${bill.bookNo}/${bill.billNo}`,
      dueDate: bill.businessDate || bill.date || '',
      compactDetails: bill.compactDetails ?? '-',
      dueAmount: Math.max(0, num(bill.total)),
      remainingAmount: Math.max(0, num(bill.total)),
    }))

  const dues: Array<{ dueRef: string; dueDate: string; compactDetails: string; dueAmount: number; remainingAmount: number }> = []
  if (openingBalance > 0) {
    dues.push({
      dueRef: 'Opening Balance',
      dueDate: openingBalanceDate || 'Opening',
      compactDetails: 'Opening balance carry-forward',
      dueAmount: openingBalance,
      remainingAmount: openingBalance,
    })
  }
  dues.push(...bills)

  const payments = params.payments
    .filter((payment) => isOnOrBeforeDay(payment.businessDate || payment.date || '', asOfDate))
    .sort(compareBusinessDateThenCreatedAsc)

  // First settle historical dues with historical payments.
  for (const payment of payments) {
    let remainingPayment = Math.max(0, num(payment.amount))
    for (const due of dues) {
      if (remainingPayment <= 0) break
      if (due.remainingAmount <= 0) continue
      const settled = Math.min(due.remainingAmount, remainingPayment)
      due.remainingAmount -= settled
      remainingPayment -= settled
    }
  }

  const canonicalOutstanding = computeCustomerOutstanding({
    openingBalance,
    bills: params.bills,
    payments: params.payments,
    asOfDate,
  }).netBalance
  const outstandingBeforePayment = canonicalOutstanding
  let remainingNewPayment = paymentAmount
  const lines: PaymentAllocationLine[] = dues
    .filter((due) => due.remainingAmount > 0)
    .map((due) => {
      const paidAmount = Math.min(due.remainingAmount, remainingNewPayment)
      remainingNewPayment -= paidAmount
      return {
        dueRef: due.dueRef,
        dueDate: due.dueDate,
        compactDetails: due.compactDetails,
        dueAmount: due.remainingAmount,
        paidAmount,
        remainingAmount: due.remainingAmount - paidAmount,
      }
    })

  const paymentApplied = paymentAmount - remainingNewPayment
  const outstandingAfterPayment = outstandingBeforePayment - paymentAmount
  const advanceAfterPayment = outstandingAfterPayment < 0 ? Math.abs(outstandingAfterPayment) : 0

  return {
    openingBalance,
    openingBalanceDate,
    outstandingBeforePayment,
    paymentApplied,
    outstandingAfterPayment,
    advanceAfterPayment,
    lines,
  }
}

