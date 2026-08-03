import { calculateBillTotals } from './billing-calculations'

export function buildCommandBillSummary(input: {
  items: Array<{ qty: number; rate: number }>
  transport: number
  gstRate: number
  gstAmount: number
  previousBalance: number
}) {
  const totals = calculateBillTotals({
    items: input.items,
    transport: input.transport,
    gstRate: input.gstRate,
    gstAmountOverride: input.gstAmount,
  })
  return {
    itemsTotal: totals.itemsTotal,
    gstAmount: totals.gstAmount,
    grandTotal: totals.grandTotal,
    amountDue: input.previousBalance + totals.grandTotal,
  }
}

export function buildCommandPaymentSummary(input: { currentBalance: number; paymentAmount: number }) {
  return {
    currentBalance: input.currentBalance,
    balanceAfterPayment: input.currentBalance - input.paymentAmount,
  }
}
