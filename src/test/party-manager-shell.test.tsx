import { describe, expect, it, vi, type Mock } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { CustomerLedgerSummary } from '@/domain/customers'
import type { SupplierSummary } from '@/data/suppliers'
import { CustomersPage } from '@/routes/customers'
import { SupplierPartiesManager } from '@/components/suppliers/supplier-parties-manager'

// Phase 3 — shared PartyManagerShell: the same manager chrome serves both the
// Sales customer table and the Purchase supplier table, while financial
// rendering stays adapter-side (sales floats / purchase integer paise).
// These node-only render tests pin the chrome, default sorting, adapter data
// plumbing, and that the two money vocabularies never bleed into each other.

const state = vi.hoisted(() => ({ queryData: new Map<string, unknown>() }))

const customerRow: CustomerLedgerSummary = {
  customer: {
    id: 'cus_patel_len1_l',
    companyName: 'Patel Hardware',
    name: 'Ramesh Patel',
    active: true,
    openingBalance: 0,
    phone: '9876543210',
    custType: 'gas',
  },
  billedTotal: 20000,
  paidTotal: 7500,
  openingBalance: 0,
  netBalance: 12500,
  dueAmount: 12500,
  advanceAmount: 0,
  balanceLabel: 'Due',
  lastBillDate: '2026-11-01',
  lastPaymentDate: '2026-10-28',
}

const supplierRow: SupplierSummary = {
  supplier: {
    id: 'sup_kansara_1l',
    companyName: 'Kansara Scrap',
    contactName: 'Minesh',
    phone: '9812345678',
    gstNo: '',
    city: 'Jamnagar',
    notes: '',
    openingKachaPaise: 0,
    openingGstPaise: 0,
    openingBalanceDate: '',
    active: true,
    created: '2026-01-01T00:00:04.000Z',
  },
  kachaDuePaise: 450000,
  gstDuePaise: 0,
  advancePaise: 0,
  outstandingPaise: 1234000,
  lastActivityDate: '2026-11-03',
  bardanPendingCount: 0,
  oldestDueDays: null,
}

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

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  redirect: (arg: unknown) => arg,
  Link: ({ children, className }: { children?: ReactNode; className?: string }) => <a className={className}>{children}</a>,
}))

vi.mock('@/data/customers', () => ({
  loadCustomersWithLedgerContext: () => Promise.resolve(state.queryData.get('customers-ledger')),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  toggleCustomerActive: vi.fn() as unknown as Mock,
}))

vi.mock('@/data/purchase-queries', () => ({
  suppliersSummaryQueryOptions: () => ({ queryKey: ['suppliers-list'], queryFn: () => Promise.resolve([]) }),
}))

vi.mock('@/data/suppliers', () => ({
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  deactivateSupplier: vi.fn(),
  reactivateSupplier: vi.fn(),
}))

vi.mock('@/app/query-invalidation', () => ({
  invalidateAfterSupplierPurchaseWrite: () => Promise.resolve(undefined),
}))

describe('party managers (Phase 3)', () => {
  it('renders the customer manager on the shared shell with sales data', () => {
    state.queryData.set('customers-ledger', [customerRow])
    const html = renderToStaticMarkup(<CustomersPage />)

    // Shared manager chrome
    expect(html).toContain('Search customers')
    expect(html).toContain('Add customer')
    expect(html).toContain('Highest outstanding')
    expect(html).toContain('With due')
    expect(html).toContain('Inactive')
    // Adapter row data (sales vocabulary + float rupee formatting)
    expect(html).toContain('Patel Hardware')
    expect(html).toContain('Outstanding')
    expect(html).toContain('12,500')
    expect(html).toContain('Deactivate')
    // 1 customer with due owes the total shown in the heading badge
    expect(html).toContain('1 owe')
    // The confirm dialog only appears after a click; not open on first paint
    expect(html).not.toContain('Deactivate this customer?')
  })

  it('renders the supplier manager on the same shell with purchase data', () => {
    state.queryData.set('suppliers-list', [supplierRow])
    const html = renderToStaticMarkup(<SupplierPartiesManager />)

    // Same chrome as customers
    expect(html).toContain('Search suppliers')
    expect(html).toContain('Add supplier')
    expect(html).toContain('Highest due')
    expect(html).toContain('Deactivate')
    // Purchase vocabulary: paise columns and ₹ formatting
    expect(html).toContain('Kacha due')
    expect(html).toContain('GST due')
    expect(html).toContain('Net payable')
    expect(html).toContain('12,340')
    expect(html).toContain('Kansara Scrap')
    // Module isolation: customers money words must not leak into the supplier table
    expect(html).not.toContain('Outstanding')
  })

  it('keeps the money vocabularies isolated between adapters', () => {
    state.queryData.set('customers-ledger', [customerRow])
    const customerHtml = renderToStaticMarkup(<CustomersPage />)
    state.queryData.set('suppliers-list', [supplierRow])
    const supplierHtml = renderToStaticMarkup(<SupplierPartiesManager />)

    // Sales page: receivable words only; purchase page: payable words only
    expect(customerHtml).not.toContain('Kacha due')
    expect(customerHtml).not.toContain('Net payable')
    expect(supplierHtml).not.toContain('With due')
    expect(supplierHtml).not.toContain('Highest outstanding')
  })
})
