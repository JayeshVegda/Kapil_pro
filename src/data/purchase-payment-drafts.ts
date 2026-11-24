import { pb } from './pocketbase'
import { parsePurchasePaymentDraft } from '@/domain/purchase-payment-draft'

export type PurchasePaymentDraftRecord = {
  id: string; schema_version: number; payload: unknown; status: string
  source_message_id: string; raw_text: string; confidence: number; notes: string
  rejection_reason?: string
  converted_payment: string; direct_save: boolean; created: string; updated: string
  supplier_draft?: string
}
export type PurchasePaymentDraftView = PurchasePaymentDraftRecord & { parsed: ReturnType<typeof parsePurchasePaymentDraft> }
const toView = (row: PurchasePaymentDraftRecord): PurchasePaymentDraftView => ({ ...row, parsed: parsePurchasePaymentDraft(row.schema_version, row.payload) })

export async function loadPurchasePaymentDraft(id: string): Promise<PurchasePaymentDraftView> {
  return toView(await pb.collection('purchase_payment_drafts').getOne(id) as unknown as PurchasePaymentDraftRecord)
}
export async function loadPurchasePaymentDraftLane(history: boolean): Promise<PurchasePaymentDraftView[]> {
  const result = await pb.collection('purchase_payment_drafts').getFullList({ sort: '-created,-id', filter: history ? undefined : 'status = "pending_review"' })
  return (result as unknown as PurchasePaymentDraftRecord[]).map(toView)
}
export async function repairPurchasePaymentDraft(id: string, updated: string, payload: unknown): Promise<void> {
  const current = await loadPurchasePaymentDraft(id)
  if (current.status !== 'pending_review' || current.updated !== updated) throw new Error('This draft changed. Reopen it before correcting it.')
  const parsed = parsePurchasePaymentDraft(1, payload)
  if (parsed.kind === 'invalid') throw new Error(parsed.issues.join('; '))
  await pb.collection('purchase_payment_drafts').update(id, { schema_version: 1, payload })
}
export async function countPendingPurchasePaymentDrafts(): Promise<number> {
  const result = await pb.collection('purchase_payment_drafts').getList(1, 1, { filter: 'status = "pending_review"', fields: 'id' })
  return result.totalItems
}
export async function rejectPurchasePaymentDraft(id: string, reason: string): Promise<void> {
  const draft = await loadPurchasePaymentDraft(id)
  if (draft.status !== 'pending_review') throw new Error('This draft was already processed.')
  await pb.collection('purchase_payment_drafts').update(id, { status: 'rejected', notes: reason.trim() ? [draft.notes, `Rejected: ${reason.trim()}`].filter(Boolean).join('\n') : draft.notes })
}
