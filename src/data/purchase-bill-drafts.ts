import { pb } from '@/data/pocketbase'
import { parsePurchaseBillDraft, type PurchaseBillDraftPayloadV1 } from '@/domain/purchase-bill-draft'

export type PurchaseBillDraftRecord = {
  id: string
  schema_version: number
  payload: unknown
  status: string
  source_message_id: string
  raw_text: string
  confidence: number
  notes: string
  converted_bill: string
  created: string
  updated: string
}

export type PurchaseBillDraftView = PurchaseBillDraftRecord & {
  parsed: ReturnType<typeof parsePurchaseBillDraft>
}

function toView(row: PurchaseBillDraftRecord): PurchaseBillDraftView {
  return { ...row, parsed: parsePurchaseBillDraft(row.schema_version, row.payload) }
}

export async function loadPurchaseBillDraft(id: string): Promise<PurchaseBillDraftView> {
  const row = await pb.collection('purchase_bill_drafts').getOne(id) as unknown as PurchaseBillDraftRecord
  return toView(row)
}

export async function loadPurchaseBillDraftLane(showHistory: boolean): Promise<PurchaseBillDraftView[]> {
  const result = await pb.collection('purchase_bill_drafts').getList(1, 50, {
    sort: '-created',
    filter: showHistory ? undefined : 'status = "pending_review"',
  })
  return (result.items as unknown as PurchaseBillDraftRecord[]).map(toView)
}

export async function countPendingPurchaseBillDrafts(): Promise<number> {
  const result = await pb.collection('purchase_bill_drafts').getList(1, 1, { filter: 'status = "pending_review"', fields: 'id' })
  return result.totalItems
}

export async function rejectPurchaseBillDraft(id: string, reason: string): Promise<void> {
  const current = await loadPurchaseBillDraft(id)
  if (current.status !== 'pending_review') throw new Error('This draft was already processed.')
  await pb.collection('purchase_bill_drafts').update(id, {
    status: 'rejected',
    notes: reason.trim() ? [current.notes, `Rejected: ${reason.trim()}`].filter(Boolean).join('\n') : current.notes,
  })
}

export function requireEditablePurchaseBillDraft(view: PurchaseBillDraftView): PurchaseBillDraftPayloadV1 {
  if (view.status !== 'pending_review') throw new Error('This draft was already processed.')
  if (view.parsed.kind === 'invalid') throw new Error('Invalid draft: fix its source payload before opening the editor.')
  return view.parsed.value
}
