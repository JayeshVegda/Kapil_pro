import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PropsWithChildren, ReactNode } from 'react'
import { createSavedView, listSavedViews, type PurchaseBillsFilterConfig } from '@/data/saved-views'
import { PurchaseBillEditDialog } from '@/components/suppliers/purchase-bill-editor'

// Saved views (operational redesign Phase 2): the owner's named filter snapshots.
// Invariants tested without a browser:
//  1. A saved view stores ONLY known URL filter keys, so re-applying one can never
//     smuggle junk parameters past the page's own search schema.
//  2. The shared edit dialog renders centered-modal chrome for the same editor
//     the full page uses (Edit stays a modal; View stays a dedicated full page).

const { coll, pbStub } = vi.hoisted(() => {
  const coll = {
    create: vi.fn(),
    getFullList: vi.fn(async () => []),
    update: vi.fn(),
    delete: vi.fn(),
  }
  const pbStub = {
    authStore: { record: { id: 'owner_len1_len2_len3' } },
    collection: (name: string) => (name === 'saved_views' ? coll : {}),
  }
  return { coll, pbStub }
})

vi.mock('@/data/pocketbase', () => ({ pb: pbStub }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => Promise.resolve<void>(undefined),
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: () => ({ data: undefined, isLoading: true, isError: false }),
  useQueryClient: () => ({}) as never,
  useMutation: (options: unknown) => ({ isPending: false, mutate: vi.fn(), options }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <>{children}</>,
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h3>{children}</h3>,
  DialogDescription: ({ children, asChild }: PropsWithChildren & { asChild?: boolean }) =>
    asChild ? <>{children}</> : <p>{children}</p>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: () => null as unknown as ReactNode,
}))

beforeEach(() => {
  coll.create.mockClear()
})

describe('saved views (Phase 2)', () => {
  it('stores only known purchase-bills filter keys when creating a view', async () => {
    coll.create.mockResolvedValue({ ...({} as Record<string, unknown>), id: 'saved_len1_len2_len' })
    const junkConfig = {
      junkKey: 'x',
      script: '<img>',
      tooLong: 'a'.repeat(200),
      supplier: 'SUP1',
      kind: 'payment',
    } as unknown as PurchaseBillsFilterConfig
    await createSavedView('purchase-bills', 'July kacha', junkConfig)

    const body = (coll.create as Mock).mock.calls[0]?.[0] as Record<string, unknown>
    const stored = JSON.parse(String(body.config))
    expect(Object.keys(stored).sort()).toEqual(['kind', 'supplier'])
    expect(stored.supplier).toBe('SUP1')
    expect(body.owner).toBe('owner_len1_len2_len3')
  })

  it('sanitizes config on read as well, so a hand-edited record cannot leak params', async () => {
    const getFullList = coll.getFullList as Mock
    getFullList.mockResolvedValue([
      { id: 'view_len1_len2_len3_l', name: 'Odd', config: JSON.stringify({ view: 'payments', tab: 'open', bogus: '/', kind: 'settle_off' }) },
      { id: 'badj_len1_len2_len3_l', name: 'Broken', config: 'not json at all' },
    ])
    const views = await listSavedViews('purchase-bills')
    expect(views).toHaveLength(2)
    expect(views[0].config).toEqual({ view: 'payments', tab: 'open', kind: 'settle_off' })
    expect(views[1].config).toEqual({})
  })

  it('renders the shared edit dialog with Edit chrome and the same editor, preview absent', () => {
    const html = renderToStaticMarkup(<PurchaseBillEditDialog billId="bill_len1_len2_l" inNo="IN-2627-0021" onClose={() => {}} />)

    expect(html).toContain('role="dialog"')
    expect(html).toContain('Edit purchase bill')
    expect(html).toContain('IN-2627-0021')
    // The page variant renders the live chitty preview; the modal must not.
    expect(html).not.toContain('aria-label="Live bill preview"')
  })
})
