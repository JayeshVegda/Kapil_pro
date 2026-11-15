import { z } from 'zod'
import { parsePurchaseDecimal } from './purchase-bill-draft'
import { SUPPLIER_PAYMENT_MODES } from './supplier-payment-modes'

// Bardan advances are generated from bill entries, not the outward-payment editor.
export const PURCHASE_PAYMENT_DRAFT_KINDS = ['payment', 'paid_on_behalf', 'settle_off', 'refund_received'] as const
const id = z.string().regex(/^[a-z0-9]{15}$/)

export const purchasePaymentDraftPayloadV1 = z.strictObject({
  supplier_name: z.string().trim().min(1),
  supplier_id: id.optional(),
  date: z.iso.date(),
  pool: z.enum(['kacha', 'gst']).optional(),
  kind: z.enum(PURCHASE_PAYMENT_DRAFT_KINDS),
  amount_rs: z.string().min(1),
  mode: z.enum(SUPPLIER_PAYMENT_MODES).optional(), // absent means owner must choose
  reference: z.string().optional(),
  payee: z.string().optional(),
  note: z.string().optional(),
  bill_pins: z.array(id).optional(),
})

export type PurchasePaymentDraftPayloadV1 = z.infer<typeof purchasePaymentDraftPayloadV1>
export type ParsedPurchasePaymentDraft =
  | { kind: 'valid'; value: PurchasePaymentDraftPayloadV1 & { pool: 'kacha' | 'gst' }; amountPaise: number }
  | { kind: 'invalid'; issues: string[] }

export function parsePurchasePaymentDraft(version: unknown, payload: unknown): ParsedPurchasePaymentDraft {
  if (version !== 1) return { kind: 'invalid', issues: ['Unsupported draft schema version'] }
  const parsed = purchasePaymentDraftPayloadV1.safeParse(payload)
  if (!parsed.success) return { kind: 'invalid', issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`) }
  try {
    const amountPaise = parsePurchaseDecimal(parsed.data.amount_rs, 2, 'Amount')
    if (amountPaise <= 0) throw new Error('Amount must be greater than zero')
    return { kind: 'valid', value: { ...parsed.data, pool: parsed.data.pool ?? 'kacha' }, amountPaise }
  } catch (error) {
    return { kind: 'invalid', issues: [error instanceof Error ? error.message : 'Invalid amount'] }
  }
}
