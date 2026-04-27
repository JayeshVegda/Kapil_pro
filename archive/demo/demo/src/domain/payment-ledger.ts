export type LedgerBill = {
  id: string
  date: string
  billNo: number
  bookNo: number
  total: number
  compactDetails?: string
}

export type LedgerPayment = {
  id?: string
  date: string
  amount: number
  mode?: string
}

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
  const dateCmp = a.date.localeCompare(b.date)
  if (dateCmp !== 0) return dateCmp
  if (a.billNo !== b.billNo) return a.billNo - b.billNo
  return a.bookNo - b.bookNo
}

export function buildPaymentPreview(params: {
  openingBalance: number
  bills: LedgerBill[]
  payments: LedgerPayment[]
  paymentAmount: number
  asOfDate: string
}): PaymentPreview {
  const openingBalance = num(params.openingBalance)
  const paymentAmount = Math.max(0, num(params.paymentAmount))
  const asOfDate = String(params.asOfDate ?? '')

  const bills = params.bills
    .filter((bill) => bill.date <= asOfDate)
    .sort(byDateAndBill)
    .map((bill) => ({
      dueRef: `${bill.bookNo}/${bill.billNo}`,
      dueDate: bill.date,
      compactDetails: bill.compactDetails ?? '-',
      dueAmount: Math.max(0, num(bill.total)),
      remainingAmount: Math.max(0, num(bill.total)),
    }))

  const dues: Array<{ dueRef: string; dueDate: string; compactDetails: string; dueAmount: number; remainingAmount: number }> = []
  if (openingBalance > 0) {
    dues.push({
      dueRef: 'Opening Balance',
      dueDate: 'Opening',
      compactDetails: 'Opening balance carry-forward',
      dueAmount: openingBalance,
      remainingAmount: openingBalance,
    })
  }
  dues.push(...bills)

  const payments = params.payments
    .filter((payment) => payment.date <= asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date))

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

  const duesOutstandingBeforePayment = dues.reduce((sum, due) => sum + due.remainingAmount, 0)
  const outstandingBeforePayment = openingBalance < 0 ? -Math.abs(openingBalance) + duesOutstandingBeforePayment : duesOutstandingBeforePayment
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
    outstandingBeforePayment,
    paymentApplied,
    outstandingAfterPayment,
    advanceAfterPayment,
    lines,
  }
}

