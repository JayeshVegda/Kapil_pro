import { pb } from './pocketbase'
import { parseCastingSessionDraft } from '@/domain/casting-session-draft'

export type CastingSessionDraftRecord = {
  id: string; schema_version: number; payload: unknown; status: string
  source_message_id: string; raw_text: string; confidence: number; notes: string
  converted_session: string; direct_save: boolean; created: string; updated: string
}
export type CastingSessionDraftView = CastingSessionDraftRecord & { parsed: ReturnType<typeof parseCastingSessionDraft> }
const toView = (row: CastingSessionDraftRecord): CastingSessionDraftView => ({ ...row, parsed: parseCastingSessionDraft(row.schema_version, row.payload) })
export async function loadCastingSessionDraft(id: string): Promise<CastingSessionDraftView> {
  return toView(await pb.collection('casting_session_drafts').getOne(id) as unknown as CastingSessionDraftRecord)
}
export async function loadCastingSessionDraftLane(history: boolean): Promise<CastingSessionDraftView[]> {
  const result = await pb.collection('casting_session_drafts').getList(1, 50, { sort: '-created', filter: history ? undefined : 'status = "pending_review"' })
  return (result.items as unknown as CastingSessionDraftRecord[]).map(toView)
}
export async function countPendingCastingSessionDrafts(): Promise<number> {
  const result = await pb.collection('casting_session_drafts').getList(1, 1, { filter: 'status = "pending_review"', fields: 'id' })
  return result.totalItems
}
export async function rejectCastingSessionDraft(id: string, reason: string): Promise<void> {
  const draft = await loadCastingSessionDraft(id)
  if (draft.status !== 'pending_review') throw new Error('This draft was already processed.')
  await pb.collection('casting_session_drafts').update(id, { status: 'rejected', notes: reason.trim() ? [draft.notes, `Rejected: ${reason.trim()}`].filter(Boolean).join('\n') : draft.notes })
}
