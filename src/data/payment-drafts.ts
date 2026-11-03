import { pb } from '@/data/pocketbase'
import { recalculateAndPersistBillStatusesForCustomer } from '@/data/bill-statuses'
import { runDataOperation } from '@/data/reliability'
import type { PaymentDraftRecordInput, PaymentDraftView } from '@/domain/payment-drafts'
import { buildPaymentDraftView } from '@/domain/payment-drafts'

export type PaymentDraftStatusFilter = 'pending' | 'approved' | 'rejected' | 'all'

export type PaymentDraftPage = {
  drafts: PaymentDraftView[]
  totalItems: number
  totalPages: number
  page: number
}

const statusFilter = (status: PaymentDraftStatusFilter) => {
  if (status === 'approved') return 'status = "approved"'
  if (status === 'rejected') return 'status = "rejected"'
  if (status === 'pending') return 'status != "approved" && status != "rejected"'
  return ''
}

function escapeFilter(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function generateRecordId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 15; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return id
}

/**
 * Loads one page of payment drafts with server-side status/search filtering.
 * Charges go through savePaymentFromDraft; this loader is read-only.
 */
export async function loadPaymentDraftPage({ page, perPage, status, search }: { page: number; perPage: number; status: PaymentDraftStatusFilter; search?: string }): Promise<PaymentDraftPage> {
  const filters: string[] = []
  const statusPart = statusFilter(status)
  if (statusPart) filters.push(`(${statusPart})`)

  const trimmed = (search ?? '').trim()
  if (trimmed) {
    const escaped = escapeFilter(trimmed)
    filters.push(`(customer_name ~ "${escaped}" || note ~ "${escaped}" || raw_text ~ "${escaped}")`)
  }

  const result = await pb.collection('payment_drafts').getList(page, perPage, {
    sort: '-created',
    expand: 'customer,converted_payment',
    filter: filters.join(' && ') || undefined,
  })

  const drafts = (result.items as unknown as PaymentDraftRecordInput[]).map(buildPaymentDraftView)

  return {
    page: result.page,
    totalPages: result.totalPages,
    totalItems: result.totalItems,
    drafts,
  }
}

/** Pending count for the payments tab badge inside the drafts page. */
export async function countPendingPaymentDrafts(): Promise<number> {
  const res = await pb.collection('payment_drafts').getList(1, 1, {
    filter: '(status != "approved" && status != "rejected")',
    fields: 'id',
  })
  return res.totalItems
}

export type SavedPaymentReceiptFromDraft = {
  id: string
  draftId: string
  customerId: string
  customerName: string
  date: string
  amount: number
  mode: 'Cash' | 'Bank'
  note: string
}

/**
 * Accepts a pending payment draft: one atomic batch creates the real payments
 * record and flips the draft to approved. Mirrors saveBillWithItems.
 * Cloned batch pattern from src/data/bills.ts; re-checks pending_review first
 * so a stale second click cannot double-post.
 */
export async function savePaymentFromDraft(input: {
  draftId: string
  customerId: string
  customerName: string
  date: string
  amount: number
  mode: 'Cash' | 'Bank'
  note: string
}): Promise<SavedPaymentReceiptFromDraft> {
  if (!input.customerId) throw new Error('Pick a matching party before accepting this payment draft')
  if (!(input.amount > 0)) throw new Error('Enter a receipt amount greater than zero')
  if (!input.date) throw new Error('Receipt date is required')

  return runDataOperation('save-payment-from-draft', async () => {
    // Guard: the draft must still be pending_review at accept time. A
    // previously-approved draft (double click, two reviewers) must never post twice.
    const draft = await pb.collection('payment_drafts').getOne(input.draftId)
    if (String(draft.status) === 'approved') {
      throw new Error('This draft was already accepted. Fix the payment record, add nothing new here.')
    }
    if (String(draft.status) === 'rejected') {
      throw new Error('This draft was rejected. Fixes happen on the payment record, not here.')
    }
    if (String(draft.status) !== 'pending_review') {
      throw new Error(`Receipt draft is in unexpected state "${String(draft.status)}"`)
    }

    const paymentId = generateRecordId()
    const batch = pb.createBatch()

    batch.collection('payments').create({
      id: paymentId,
      customer: input.customerId,
      customer_name: input.customerName,
      date: input.date,
      amount: input.amount,
      mode: input.mode,
      note: input.note,
    })
    batch.collection('payment_drafts').update(input.draftId, {
      status: 'approved',
      converted_payment: paymentId,
    })

    try {
      // Atomic: the receipts record and draft approval commit together.
      await batch.send()
    } catch (error) {
      throw new Error(error instanceof Error ? `Failed to save receipt details: ${error.message}` : 'Failed to save receipt details', {
        cause: error,
      })
    }

    try {
      await recalculateAndPersistBillStatusesForCustomer(input.customerId)
    } catch (error) {
      // The payment IS saved; a failed derived-status refresh must not look like a failed save.
      console.warn('[save-payment-from-draft] status recalculation failed after save', error)
    }

    return {
      id: paymentId,
      draftId: input.draftId,
      customerId: input.customerId,
      customerName: input.customerName,
      date: input.date,
      amount: input.amount,
      mode: input.mode,
      note: input.note,
    }
  })
}

/** Reject: dead-end like rejected bill drafts. No re-open path. */
export async function rejectPaymentDraft(draftId: string) {
  const draft = await pb.collection('payment_drafts').getOne(draftId)
  if (String(draft.status) !== 'pending_review') {
    throw new Error('This draft was already processed. Fixes happen on the payment record, not here.')
  }
  await pb.collection('payment_drafts').update(draftId, { status: 'rejected' })
}
