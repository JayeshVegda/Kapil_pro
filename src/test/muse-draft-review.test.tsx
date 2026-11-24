import { renderToStaticMarkup } from 'react-dom/server'
import type { PropsWithChildren } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { MuseDraftReview, type DraftReviewIntent } from '@/components/drafts/muse-draft-review'
import { prepareMuseDraftReview } from '@/data/muse-draft-review'

vi.mock('@tanstack/react-query', async (original) => ({
  ...await original<typeof import('@tanstack/react-query')>(),
  useMutation: vi.fn(), useQuery: vi.fn(), useQueryClient: vi.fn(),
}))
vi.mock('@/data/muse-draft-review', () => ({ prepareMuseDraftReview: vi.fn(), rejectReviewedDraft: vi.fn() }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <>{children}</>,
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}))

const commit = vi.fn(async () => undefined)
const load = vi.fn(async () => undefined)
const review = { view: 'summary', info: { party: 'Demo One', date: '2026-11-24', amount: '₹2,64,000' }, fingerprint: 'shown', raw: '', commit } as const
let mutations: Array<() => Promise<unknown>>

function render(intent: DraftReviewIntent) {
  return renderToStaticMarkup(<MuseDraftReview source="purchase-bill" id="demodraft000001" intent={intent}
    party="Demo One" date="2026-11-24" amount="₹2,64,000" canLoad onClose={vi.fn()} onLoad={load} onDone={vi.fn()} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mutations = []
  vi.mocked(useQuery).mockReturnValue({ data: review, isPending: false, isFetching: false } as unknown as ReturnType<typeof useQuery>)
  vi.mocked(useQueryClient).mockReturnValue({} as ReturnType<typeof useQueryClient>)
  vi.mocked(useMutation).mockImplementation((options) => {
    mutations.push(options?.mutationFn as () => Promise<unknown>)
    return { mutate: vi.fn() } as unknown as ReturnType<typeof useMutation>
  })
})

it('does not post on preview and blocks confirmation when the preview became stale', async () => {
  expect(render('confirm')).toContain('Confirm &amp; Save')
  expect(commit).not.toHaveBeenCalled()
  vi.mocked(prepareMuseDraftReview).mockResolvedValueOnce({ ...review, fingerprint: 'changed' })
  await expect(mutations[0]()).rejects.toThrow('Refresh the preview')
  expect(commit).not.toHaveBeenCalled()
  vi.mocked(prepareMuseDraftReview).mockResolvedValueOnce(review)
  await mutations[0]()
  expect(commit).toHaveBeenCalledOnce()
})

it('loads without posting and disables rejection until a reason is entered', async () => {
  expect(render('load')).toContain('Load into editor')
  await mutations[1]()
  expect(load).toHaveBeenCalledOnce()
  expect(commit).not.toHaveBeenCalled()
  const html = render('reject')
  expect(html).toContain('Rejection reason (required)')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reject draft/)
})
