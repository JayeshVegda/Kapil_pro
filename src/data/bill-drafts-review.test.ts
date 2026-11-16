import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ collection: vi.fn() }))
vi.mock('@/data/pocketbase', () => ({ pb: {
  collection: mocks.collection,
  filter: (_template: string, params: { draftId: string }) => `draft = "${params.draftId}"`,
} }))
import { loadPendingBillDraftForReview } from './bill-drafts'

it('reloads a pending Sales draft by validated URL ID with its children', async () => {
  const id = 'abcdefghijklmn1'
  mocks.collection.mockImplementation((name: string) => ({
    getOne: async () => ({ id, status: 'pending_review', customer_name: 'Jay', date: '2026-11-16' }),
    getFullList: async ({ filter }: { filter: string }) => {
      expect(filter).toContain(id)
      return name === 'bill_draft_items'
        ? [{ item: 'item1', item_name: 'Brass', qty: 10, rate: 500 }]
        : [{ date: '2026-11-16', amount: 100, mode: 'Bank' }]
    },
  }))
  await expect(loadPendingBillDraftForReview(id)).resolves.toMatchObject({
    id, items: [{ itemId: 'item1', itemName: 'Brass' }], payments: [{ amount: 100, mode: 'Bank' }],
  })
  await expect(loadPendingBillDraftForReview('bad')).rejects.toThrow('Invalid Sales draft ID')
  mocks.collection.mockImplementation(() => ({ getOne: async () => ({ status: 'approved' }) }))
  await expect(loadPendingBillDraftForReview(id)).rejects.toThrow('already processed')
})
