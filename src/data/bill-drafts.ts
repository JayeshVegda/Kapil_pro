import { pb } from '@/data/pocketbase'
import type { DraftItemMaster, DraftPaymentInput, DraftRecordInput } from '@/domain/drafts'

export type DraftStatusFilter = 'pending' | 'approved' | 'rejected' | 'all'

export type DraftPage = {
  drafts: Array<{ draft: DraftRecordInput; items: Array<Record<string, unknown>>; payments: DraftPaymentInput[] }>
  totalItems: number
  totalPages: number
  page: number
}

/** Rehydrate a Sales draft by ID; inbox page limits must not affect review. */
export async function loadPendingBillDraftForReview(draftId: string) {
  if (!/^[a-z0-9]{15}$/.test(draftId)) throw new Error('Invalid Sales draft ID')
  const draft = await pb.collection('bill_drafts').getOne<DraftRecordInput>(draftId, { expand: 'customer' })
  if (draft.status !== 'pending_review') throw new Error('This Sales draft was already processed')
  const [items, payments] = await Promise.all([
    pb.collection('bill_draft_items').getFullList({ filter: pb.filter('draft = {:draftId}', { draftId }), sort: 'created,id' }),
    pb.collection('bill_draft_payments').getFullList({ filter: pb.filter('draft = {:draftId}', { draftId }), sort: 'created,id' }),
  ])
  return {
    ...draft,
    customer_name: draft.customer_name || draft.expand?.customer?.company_name || draft.expand?.customer?.name || '',
    items: items.map((line) => ({ itemId: String(line.item ?? ''), itemName: String(line.item_name ?? ''), qty: Number(line.qty ?? 0), bags: Number(line.bags ?? 0), rate: Number(line.rate ?? 0) })),
    payments: payments.map((payment) => ({ date: String(payment.date || draft.date || '').slice(0, 10), amount: Number(payment.amount ?? 0), mode: payment.mode === 'Bank' ? 'Bank' as const : 'Cash' as const, note: String(payment.note ?? '') })),
  }
}

const statusFilter = (status: DraftStatusFilter) => {
  if (status === 'approved') return 'status = "approved"'
  if (status === 'rejected') return 'status = "rejected"'
  if (status === 'pending') return 'status != "approved" && status != "rejected"'
  return ''
}

function escapeFilter(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Loads one page of drafts with server-side status/search filtering, plus the
 * item and payment rows for exactly the drafts on this page (never the whole
 * table), so the page stays fast as the draft history grows.
 */
export async function loadDraftPage({ page, perPage, status, search }: { page: number; perPage: number; status: DraftStatusFilter; search?: string }): Promise<DraftPage> {
  const filters: string[] = []
  const statusPart = statusFilter(status)
  if (statusPart) filters.push(`(${statusPart})`)

  const trimmed = (search ?? '').trim()
  if (trimmed) {
    const escaped = escapeFilter(trimmed)
    const searchParts = [`customer_name ~ "${escaped}"`, `notes ~ "${escaped}"`, `raw_text ~ "${escaped}"`]
    const asNumber = Number(trimmed)
    if (Number.isInteger(asNumber) && asNumber > 0) searchParts.push(`bill_no = ${asNumber}`)
    filters.push(`(${searchParts.join(' || ')})`)
  }

  const result = await pb.collection('bill_drafts').getList(page, perPage, {
    sort: '-created',
    expand: 'customer,converted_bill',
    filter: filters.join(' && ') || undefined,
  })

  const drafts = result.items as unknown as DraftRecordInput[]
  const ids = drafts.map((draft) => draft.id)

  const [itemsRes, paymentsRes] = await Promise.all([
    ids.length
      ? pb.collection('bill_draft_items').getFullList({ filter: `(${ids.map((id) => `draft="${escapeFilter(id)}"`).join(' || ')})`, sort: 'created,id' })
      : Promise.resolve([] as Array<Record<string, unknown>>),
    ids.length
      ? pb.collection('bill_draft_payments').getFullList({ filter: `(${ids.map((id) => `draft="${escapeFilter(id)}"`).join(' || ')})`, sort: 'created,id' })
      : Promise.resolve([] as Array<Record<string, unknown>>),
  ])

  return {
    page: result.page,
    totalPages: result.totalPages,
    totalItems: result.totalItems,
    drafts: drafts.map((draft) => ({
      draft,
      items: (itemsRes as Array<Record<string, unknown>>).filter((row) => String(row.draft ?? '') === draft.id),
      payments: (paymentsRes as Array<Record<string, unknown>>)
        .filter((row) => String(row.draft ?? '') === draft.id)
        .map((row) => ({
          id: String(row.id ?? ''),
          amount: Number(row.amount ?? 0),
          mode: String(row.mode ?? 'Bank'),
          date: String(row.date ?? ''),
          note: String(row.note ?? ''),
        })),
    })),
  }
}

/** Pending count for the tab badge and the sidebar chip. */
export async function countPendingDrafts(): Promise<number> {
  const res = await pb.collection('bill_drafts').getList(1, 1, {
    filter: '(status != "approved" && status != "rejected")',
    fields: 'id',
  })
  return res.totalItems
}

/** Lean item master with aliases for matching draft rows (no usage stats). */
export async function loadDraftItemMasters(): Promise<DraftItemMaster[]> {
  const rows = (await pb.collection('items').getFullList({ sort: 'name' })) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    type: String(row.type ?? ''),
    unit: String(row.unit ?? ''),
    bagWeight: Number(row.bag_weight ?? 50) || 50,
    aliases: String(row.aliases ?? ''),
  }))
}
