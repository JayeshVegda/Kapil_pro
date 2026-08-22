export type BillPreviewCredit = { id: string; date: string; amount: number }

const ATTACHED_PAYMENT_NOTE = /^quick payment with bill\s+(\d{1,4})\/(\d{1,5})$/i

export function getAttachedPaymentBillRef(note: string) {
  const match = String(note ?? '').trim().match(ATTACHED_PAYMENT_NOTE)
  if (!match) return null
  return `${Number(match[1])}/${Number(match[2])}`
}

export function isPaymentAttachedToPriorBill(note: string, priorBillRefs: ReadonlySet<string>) {
  const billRef = getAttachedPaymentBillRef(note)
  return billRef != null && priorBillRefs.has(billRef)
}

export type BillCutoffPayment = BillPreviewCredit & { createdTs: number; note: string }

export function partitionPaymentsForNextBill(
  payments: BillCutoffPayment[],
  cutoff: {
    cutoffDate: string
    cutoffCreatedTs: number
    currentBillDate: string
    priorBillRefs: ReadonlySet<string>
  },
) {
  const previousBalancePayments: BillCutoffPayment[] = []
  const periodCredits: BillCutoffPayment[] = []

  for (const payment of payments) {
    if (!(payment.amount > 0) || payment.date > cutoff.currentBillDate) continue
    const attachedToPriorBill = isPaymentAttachedToPriorBill(payment.note, cutoff.priorBillRefs)
    const isBeforeCutoff = payment.date < cutoff.cutoffDate
    const isSameDayBeforeCutoff = payment.date === cutoff.cutoffDate && (
      attachedToPriorBill ||
      payment.createdTs <= 0 ||
      cutoff.cutoffCreatedTs <= 0 ||
      payment.createdTs <= cutoff.cutoffCreatedTs
    )

    if (attachedToPriorBill || isBeforeCutoff || isSameDayBeforeCutoff) previousBalancePayments.push(payment)
    else if (payment.date > cutoff.cutoffDate || payment.date === cutoff.cutoffDate) periodCredits.push(payment)
  }

  return { previousBalancePayments, periodCredits }
}

export function dedupeBillPreviewCredits(entries: BillPreviewCredit[]) {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (!entry.id || seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
}
