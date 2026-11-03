/**
 * Pure payment-draft view model for the AI Drafts page. Data access lives in
 * src/data/payment-drafts.ts; this module only shapes and computes.
 */

export type PaymentDraftRecordInput = {
  id: string
  created?: string
  status?: string
  customer?: string
  customer_name?: string
  date?: string
  amount?: number
  mode?: string
  note?: string
  confidence?: number
  raw_text?: string
  converted_payment?: string
  expand?: {
    customer?: { id: string; name?: string; company_name?: string } | null
  }
}

export type PaymentDraftView = {
  id: string
  created: string
  status: string
  customerId: string
  customerName: string
  isPartyLinked: boolean
  confidence: number
  date: string
  amount: number
  mode: 'Cash' | 'Bank'
  note: string
  rawText: string
  convertedPayment: string
}

export const PAYMENT_MODES: Array<PaymentDraftView['mode']> = ['Cash', 'Bank']

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function buildPaymentDraftView(draft: PaymentDraftRecordInput): PaymentDraftView {
  const rawMode = String(draft.mode ?? 'Cash')
  const customerName =
    String(draft.customer_name ?? '') ||
    String(draft.expand?.customer?.company_name ?? '') ||
    String(draft.expand?.customer?.name ?? '') ||
    ''
  const customerId = String(draft.customer || draft.expand?.customer?.id || '')
  const amount = num(draft.amount)
  return {
    id: draft.id,
    created: String(draft.created ?? ''),
    status: String(draft.status ?? 'pending_review'),
    customerId,
    customerName,
    isPartyLinked: Boolean(customerId),
    confidence: num(draft.confidence),
    date: String(draft.date ?? '').slice(0, 10),
    amount,
    mode: rawMode === 'Bank' ? 'Bank' : 'Cash',
    note: String(draft.note ?? ''),
    rawText: String(draft.raw_text ?? ''),
    convertedPayment: String(draft.converted_payment ?? ''),
  }
}

/** "Receipt via Muse {date}" prefix + Muse's note, with any operator edit replacing it. */
export function composeReceiptNote(date: string, museNote: string, operatorEdit?: string): string {
  const prefix = `Receipt via Muse ${date || 'unknown-date'}`
  const body = operatorEdit !== undefined && operatorEdit.trim() !== '' ? operatorEdit.trim() : (museNote ?? '').trim()
  return body ? `${prefix} - ${body}` : prefix
}

/** True when this receipt would duplicate another accepted payment for the same party, date and amount. */
export function isDuplicateReceipt(candidate: { customerId: string; date: string; amount: number }, recentPayments: Array<{ customerId?: string; customer?: string; date: string; amount: number; id?: string }>): boolean {
  return recentPayments.some((existing) =>
    String(existing.customerId ?? existing.customer) === candidate.customerId &&
    existing.date === candidate.date &&
    num(existing.amount) === candidate.amount,
  )
}
