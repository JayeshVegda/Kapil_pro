import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data/pocketbase', () => ({
  pb: {
    collection: vi.fn(),
    createBatch: vi.fn(),
  },
}))

vi.mock('@/data/bill-statuses', () => ({
  recalculateAndPersistBillStatusesForCustomer: vi.fn().mockResolvedValue(undefined),
}))

import { pb } from '@/data/pocketbase'
import { countPendingPaymentDrafts, loadPaymentDraftPage, rejectPaymentDraft, savePaymentFromDraft } from '@/data/payment-drafts'

const draftCollection = {
  getOne: vi.fn(),
  update: vi.fn(),
  getList: vi.fn(),
}
const paymentCreate = vi.fn()
const draftBatchUpdate = vi.fn()
const batchSend = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(pb as unknown as { collection: ReturnType<typeof vi.fn>; createBatch: ReturnType<typeof vi.fn> }).collection = vi.fn(() => draftCollection)
  ;(pb as unknown as { createBatch: ReturnType<typeof vi.fn> }).createBatch = vi.fn(() => ({
    collection: () => ({ create: paymentCreate, update: draftBatchUpdate }),
    send: batchSend,
  }))
  batchSend.mockResolvedValue(undefined)
  draftCollection.update.mockResolvedValue({})
  draftCollection.getList.mockResolvedValue({ items: [], totalItems: 0, page: 1, totalPages: 1 })
})

const baseDraft = (overrides: Record<string, unknown> = {}) => ({
  id: 'draft000000000',
  status: 'pending_review',
  customer: 'cust000000000',
  customer_name: 'Adesh Brass',
  date: '2026-11-02',
  amount: 25000,
  mode: 'Bank',
  note: 'RTGS',
  raw_text: 'adeshe 25 hajar rtgs aavyo che',
  ...overrides,
})

describe('savePaymentFromDraft', () => {
  it('scenario accept: batches the payment insert with the draft approval atomically', async () => {
    draftCollection.getOne.mockResolvedValue(baseDraft())

    const saved = await savePaymentFromDraft({
      draftId: 'draft000000000',
      customerId: 'cust000000000',
      customerName: 'Adesh Brass',
      date: '2026-11-02',
      amount: 25000,
      mode: 'Bank',
      note: 'Receipt via Muse 2026-11-02 - RTGS',
    })

    expect(paymentCreate).toHaveBeenCalledTimes(1)
    const [paymentPayload] = paymentCreate.mock.calls[0]
    expect(paymentPayload).toMatchObject({
      customer: 'cust000000000',
      customer_name: 'Adesh Brass',
      date: '2026-11-02',
      amount: 25000,
      mode: 'Bank',
      note: 'Receipt via Muse 2026-11-02 - RTGS',
    })
    expect(paymentPayload.id).toHaveLength(15)
    expect(draftBatchUpdate).toHaveBeenCalledWith('draft000000000', {
      status: 'approved',
      converted_payment: paymentPayload.id,
    })
    expect(batchSend).toHaveBeenCalledTimes(1)
    expect(saved.customerId).toBe('cust000000000')
    expect(saved.mode).toBe('Bank')
  })

  it('scenario double-click accept: refuses when the draft is already approved, creates nothing', async () => {
    draftCollection.getOne.mockResolvedValue(baseDraft({ status: 'approved', converted_payment: 'pay00000000001' }))

    await expect(
      savePaymentFromDraft({
        draftId: 'draft000000000',
        customerId: 'cust000000000',
        customerName: 'Adesh Brass',
        date: '2026-11-02',
        amount: 25000,
        mode: 'Bank',
        note: 'x',
      }),
    ).rejects.toThrow(/already accepted/)

    expect(batchSend).not.toHaveBeenCalled()
    expect(paymentCreate).not.toHaveBeenCalled()
  })

  it('scenario reject: refuses when the draft was rejected before', async () => {
    draftCollection.getOne.mockResolvedValue(baseDraft({ status: 'rejected' }))

    await expect(
      savePaymentFromDraft({
        draftId: 'draft000000000',
        customerId: 'cust000000000',
        customerName: 'Adesh Brass',
        date: '2026-11-02',
        amount: 25000,
        mode: 'Bank',
        note: 'x',
      }),
    ).rejects.toThrow(/rejected/)

    expect(batchSend).not.toHaveBeenCalled()
  })

  it('scenario edited amount: whatever the operator set (₹30,000 vs ₹25,000 dictated) is what posts', async () => {
    draftCollection.getOne.mockResolvedValue(baseDraft({ amount: 25000 }))

    await savePaymentFromDraft({
      draftId: 'draft000000000',
      customerId: 'cust000000000',
      customerName: 'Adesh Brass',
      date: '2026-11-02',
      amount: 30000,
      mode: 'Bank',
      note: 'adjusted as operator decided',
    })

    const [paymentPayload] = paymentCreate.mock.calls[0]
    expect(paymentPayload.amount).toBe(30000)
    expect(paymentPayload.note).toBe('adjusted as operator decided')
    expect(draftBatchUpdate.mock.calls[0][1].converted_payment).toBe(paymentPayload.id)
  })

  it('scenario failed batch: throws a save error and never marks the draft approved', async () => {
    draftCollection.getOne.mockResolvedValue(baseDraft())
    batchSend.mockRejectedValue(new Error('network crash'))

    await expect(
      savePaymentFromDraft({
        draftId: 'draft000000000',
        customerId: 'cust000000000',
        customerName: 'Adesh Brass',
        date: '2026-11-02',
        amount: 25000,
        mode: 'Bank',
        note: 'x',
      }),
    ).rejects.toThrow(/Failed to save receipt details: network crash/)

    expect(draftCollection.update).not.toHaveBeenCalled()
  })

  it('keeps the payment saved even when the derived bill-status recalculation fails', async () => {
    draftCollection.getOne.mockResolvedValue(baseDraft())
    const { recalculateAndPersistBillStatusesForCustomer } = await import('@/data/bill-statuses')
    vi.mocked(recalculateAndPersistBillStatusesForCustomer).mockRejectedValueOnce(new Error('recalc boom'))

    const saved = await savePaymentFromDraft({
      draftId: 'draft000000000',
      customerId: 'cust000000000',
      customerName: 'Adesh Brass',
      date: '2026-11-02',
      amount: 25000,
      mode: 'Bank',
      note: 'x',
    })

    expect(saved.id).toHaveLength(15)
    expect(batchSend).toHaveBeenCalledTimes(1)
  })

  it('blocks bad input before any PocketBase call', async () => {
    draftCollection.getOne.mockResolvedValue(baseDraft())

    await expect(
      savePaymentFromDraft({
        draftId: 'draft000000000',
        customerId: '',
        customerName: 'Adesh Brass',
        date: '2026-11-02',
        amount: 25000,
        mode: 'Bank',
        note: 'x',
      }),
    ).rejects.toThrow(/matching party/)

    await expect(
      savePaymentFromDraft({
        draftId: 'draft000000000',
        customerId: 'cust000000000',
        customerName: 'Adesh Brass',
        date: '2026-11-02',
        amount: 0,
        mode: 'Bank',
        note: 'x',
      }),
    ).rejects.toThrow(/greater than zero/)

    await expect(
      savePaymentFromDraft({
        draftId: 'draft000000000',
        customerId: 'cust000000000',
        customerName: 'Adesh Brass',
        date: '',
        amount: 25000,
        mode: 'Bank',
        note: 'x',
      }),
    ).rejects.toThrow(/date/)

    expect(draftCollection.getOne).not.toHaveBeenCalled()
  })
})

describe('rejectPaymentDraft', () => {
  it('scenario reject: marks only a still-pending draft rejected', async () => {
    draftCollection.getOne.mockResolvedValue(baseDraft())

    await rejectPaymentDraft('draft000000000')

    expect(draftCollection.update).toHaveBeenCalledWith('draft000000000', { status: 'rejected' })
  })

  it('refuses to flip a draft that is already dead (approved or rejected)', async () => {
    draftCollection.getOne.mockResolvedValue(baseDraft({ status: 'approved' }))
    await expect(rejectPaymentDraft('draft000000000')).rejects.toThrow(/already processed/)
    expect(draftCollection.update).not.toHaveBeenCalled()

    draftCollection.getOne.mockResolvedValue(baseDraft({ status: 'rejected' }))
    await expect(rejectPaymentDraft('draft000000000')).rejects.toThrow(/already processed/)
    expect(draftCollection.update).not.toHaveBeenCalled()
  })
})

describe('loadPaymentDraftPage / countPendingPaymentDrafts', () => {
  it('sends the status + search filter for the payments tab', async () => {
    await loadPaymentDraftPage({ page: 2, perPage: 25, status: 'pending', search: 'Adesh' })
    const [page, perPage, options] = draftCollection.getList.mock.calls[0]
    expect(page).toBe(2)
    expect(perPage).toBe(25)
    expect(options.sort).toBe('-created')
    expect(String(options.filter)).toContain('status != "approved"')
    expect(String(options.filter)).toContain('Adesh')
  })

  it('pending count uses the not-terminal status filter', async () => {
    draftCollection.getList.mockResolvedValue({ items: [], totalItems: 3, page: 1, totalPages: 1 })
    const count = await countPendingPaymentDrafts()
    expect(count).toBe(3)
    expect(String(draftCollection.getList.mock.calls[0][2].filter)).toContain('status != "approved"')
  })
})
