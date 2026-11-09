type PaymentActivity = { label: string; direction: 'outgoing' | 'incoming' | 'non-cash' }

export function supplierPaymentActivity(kind: string): PaymentActivity {
  if (kind === 'refund_received') return { label: 'Refund received', direction: 'incoming' }
  if (kind === 'settle_off') return { label: 'Settle-off credit', direction: 'non-cash' }
  if (kind === 'bardan_advance') return { label: 'Bardan advance', direction: 'non-cash' }
  if (kind === 'paid_on_behalf') return { label: 'Paid on behalf', direction: 'outgoing' }
  return { label: 'Payment', direction: 'outgoing' }
}

export function computePurchaseLogMetrics(
  bills: readonly { netPaise: number; cancelled: boolean; bardanPending: boolean }[],
  payments: readonly { kind: string; amountPaise: number; cancelled: boolean }[],
  summaries: readonly { outstandingPaise: number; advancePaise: number }[],
) {
  const activeBills = bills.filter((bill) => !bill.cancelled)
  const activePayments = payments.filter((payment) => !payment.cancelled)
  let totalPaymentsPaise = 0
  let refundsReceivedPaise = 0
  let nonCashCreditsPaise = 0
  for (const payment of activePayments) {
    const direction = supplierPaymentActivity(payment.kind).direction
    if (direction === 'incoming') refundsReceivedPaise += payment.amountPaise
    else if (direction === 'non-cash') nonCashCreditsPaise += payment.amountPaise
    else totalPaymentsPaise += payment.amountPaise
  }
  const totalDuePaise = summaries.reduce((sum, row) => sum + row.outstandingPaise, 0)
  const availableAdvancePaise = summaries.reduce((sum, row) => sum + row.advancePaise, 0)
  return {
    totalBillsPaise: activeBills.reduce((sum, bill) => sum + bill.netPaise, 0),
    totalPaymentsPaise, refundsReceivedPaise, nonCashCreditsPaise, totalDuePaise, availableAdvancePaise,
    netPositionPaise: totalDuePaise - availableAdvancePaise,
    bardanCount: activeBills.filter((bill) => bill.bardanPending).length,
    activeCount: activeBills.length + activePayments.length,
  }
}
