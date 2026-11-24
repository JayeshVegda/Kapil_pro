import { describe, expect, it, vi } from 'vitest'
import { renderPage } from './render-page'
import type { CastingSessionWithInputs } from '@/domain/casting-types'
import { CastingTicket, summarizeMaterials } from '@/components/casting/casting-ticket'
import { CastingLogPage } from '@/routes/casting/log'
import { CastingBillPage } from '@/routes/casting/bill'

// Casting log toolbar and a single shared on-screen/print chitty.
// The same ticket backs the log View modal and the printed bill page.

const state = vi.hoisted(() => ({ queryData: new Map<string, unknown>() }))

const session: CastingSessionWithInputs = {
  id: 'sess_abcd1234ef',
  costFormulaVersion: 1,
  date: '2026-11-05',
  coalKg: 40,
  coalRate: 12,
  workerSalary: 1200,
  unit: 5,
  wireOut: 96.5,
  wastage: 3.5,
  cholIn: 2,
  costPerKg: 40,
  metalCostPerKg: 25,
  coalCostPerKg: 5,
  workerCostPerKg: 10,
  finalProductCostPerKg: 95,
  totalWireOut: 96.5,
  totalMel: 3.5,
  totalInputCost: 24000,
  totalInputKg: 960,
  note: 'Shiny batch',
  createdAt: '2026-11-05T04:00:00.000Z',
  updatedAt: '2026-11-05T04:00:00.000Z',
  batches: [],
  inputs: [
    { id: 'i1', sessionId: 'sess_abcd1234ef', materialName: 'Brass', qty: 800, rate: 25, amount: 20000 },
    { id: 'i2', sessionId: 'sess_abcd1234ef', materialName: 'Lead', qty: 160, rate: 25, amount: 4000 },
  ],
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useSearch: () => ({}) }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: (options: { queryKey?: readonly unknown[] }) => ({
    data: state.queryData.get(String(options?.queryKey?.[0] ?? '')),
    isLoading: false,
    isError: false,
    error: null,
  }),
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve(undefined) }),
  useMutation: (options?: unknown) => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(), options }),
}))

vi.mock('@/data/casting', () => ({
  loadCastingSessions: () => Promise.resolve(state.queryData.get('casting-sessions') ?? []),
  loadCastingMaterials: () => Promise.resolve([]),
  deleteCastingSession: vi.fn(),
  saveCastingSession: vi.fn(),
  updateCastingSession: vi.fn(),
}))

describe('CastingTicket (Phase 4)', () => {
  it('renders saved remarks on the shared chithi and hides the section when blank', async () => {
    expect(await renderPage(<CastingTicket session={session} />)).toContain('Shiny batch')
    expect(await renderPage(<CastingTicket session={{ ...session, note: '  ' }} />)).not.toContain('Remarks')
  })

  it('shows the current Brass basis and separately labels the original saved cost', async () => {
    const html = await renderPage(<CastingTicket session={session} />)

    // Header facts straight from the record
    expect(html).toContain('Kapil Products')
    expect(html).toContain('Kapil Product Casting')
    expect(html).toContain('05-11-2026')
    expect(html).toContain('Thursday')
    expect(html).not.toContain('sess_abc')
    expect(html).toContain('Batches')

    // Material rows summarized for display, money total from the record
    expect(html).toContain('Brass')
    expect(html).toContain('Lead')
    expect(html).toContain('₹25.00')
    expect(html).toContain('24,000')

    expect(html).toContain('× 7% × 2')
    expect(html).toContain('₹58.50')
    expect(html).toContain('₹95.00')
    expect(html).toContain('Original saved cost')
    expect(html.indexOf('Final ready cost')).toBeGreaterThan(html.indexOf('Cost per kg'))
  })

  it('summarizes material inputs by name', () => {
    const rows = summarizeMaterials(session)
    expect(rows.map((row) => row.name)).toEqual(['Brass', 'Lead'])
    expect(rows[0]).toMatchObject({ qty: 800, amount: 20000, avgRate: 25 })
  })
})

describe('Casting Log (Phase 4)', () => {
  it('renders one short toolbar with view switch, dates, and quick ranges, and View·Edit·Delete actions', async () => {
    state.queryData.set('casting-log', [session])
    const html = await renderPage(<CastingLogPage />)

    // Merged single-card toolbar
    expect(html).toContain('Active logs')
    expect(html).toContain('Temporary trash')
    expect(html).toContain('Search casting sessions')
    expect(html).toContain('From date')
    expect(html).toContain('To date')
    expect(html).toContain('This Month')
    expect(html).toContain('Last 3 Months')
    expect(html).toContain('Clear filters')

    // Row actions become View · Edit · Delete; restore is trash-mode only
    expect(html).toContain('View')
    expect(html).toContain('Edit')
    expect(html).toContain('Delete')
    expect(html).not.toContain('Restore')

    // View modal is closed on first paint (centered dialog, opened on click)
    expect(html).not.toContain('Casting session ticket')
    expect(html).not.toContain('Same ticket the Casting Bill page prints')
  })
})

describe('Casting Bill (Phase 4)', () => {
  it('renders a date search and the bill actions above the shared chitti', async () => {
    state.queryData.set('casting-sessions', [session])
    const html = await renderPage(<CastingBillPage />)

    expect(html).toContain('Search bills by date or weekday')
    expect(html).not.toContain('Filter sessions by material')
    expect(html).not.toContain('From date')
    expect(html).toContain('960.0 kg')
    expect(html).toContain('96.5 kg')
    expect(html).toContain('Edit')
    expect(html).toContain('Delete')
    expect(html).toContain('Print chitti')
    expect(html).toContain('Kapil Product Casting')
    expect(html).toContain('Materials')
    expect(html).toContain('Cost per kg')
    expect(html).toContain('Final ready cost')
    expect(html).not.toContain('hidden print:block')
  })
})
