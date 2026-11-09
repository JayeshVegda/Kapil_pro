import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type PropsWithChildren, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { AddBardanModal, CancelBillModal, PaymentDetailsModal, RecordPaymentModal, SettleToNilModal } from '@/components/suppliers/bill-modals'
import { addPurchaseBardanEntry, cancelPurchaseBill, cancelSupplierPayment, createSupplierPayment, type PurchaseBillDetail } from '@/data/suppliers'
import { buildPurchaseReadModel } from '@/domain/purchase-read-model'
import { bardanFixture, billFixture, bundleFixture, lineFixture, paymentFixture, supplierFixture } from './purchase-fixtures'

// Node-only component tests: query/write boundaries and portal primitives are stubbed;
// financial projections, modal render logic, and mutation preparation remain real.
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: vi.fn(), useQueryClient: vi.fn(), useMutation: vi.fn(),
}))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useState: vi.fn(react.useState) }
})
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <>{children}</>,
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h3>{children}</h3>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogClose: ({ children }: PropsWithChildren) => <>{children}</>,
}))
vi.mock('@/data/suppliers', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/data/suppliers')>(),
  addPurchaseBardanEntry: vi.fn(), createSupplierPayment: vi.fn(), cancelPurchaseBill: vi.fn(), cancelSupplierPayment: vi.fn(),
}))
vi.mock('@/app/query-invalidation', () => ({ invalidateAfterSupplierPurchaseWrite: vi.fn() }))

type ReadResult = { data: unknown; isLoading: boolean; isError: boolean; error?: unknown }
type CapturedMutation = { mutationFn: () => Promise<unknown>; onSuccess: (result: unknown) => Promise<void> }
let mutation: CapturedMutation
const onClose = vi.fn()
const client = {} as ReturnType<typeof useQueryClient>
const writes = [addPurchaseBardanEntry, createSupplierPayment, cancelPurchaseBill, cancelSupplierPayment]
const realReact = await vi.importActual<typeof import('react')>('react')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useState).mockImplementation(realReact.useState)
  vi.mocked(useQueryClient).mockReturnValue(client)
  vi.mocked(useMutation).mockImplementation((options) => {
    mutation = options as unknown as CapturedMutation
    return { isPending: false, mutate: vi.fn() } as unknown as ReturnType<typeof useMutation>
  })
})

function read(result: ReadResult) {
  vi.mocked(useQuery).mockReturnValue(result as ReturnType<typeof useQuery>)
}

function enteredState(values: unknown[]) {
  let index = 0
  vi.mocked(useState).mockImplementation((initial?: unknown) => {
    const value = index < values.length ? values[index] : typeof initial === 'function' ? initial() : initial
    index++
    return [value, vi.fn()] as ReturnType<typeof useState>
  })
}

function billDetail(overrides: Partial<PurchaseBillDetail> = {}): PurchaseBillDetail {
  return { bill: billFixture(), lines: [lineFixture()], adjustments: [], bardan: [], allocations: [], ...overrides }
}

function model(bundle = bundleFixture()) {
  return buildPurchaseReadModel([bundle.supplier], bundle, '2026-11-08')
}

function render(node: ReactNode) {
  return renderToStaticMarkup(node)
}

function submitButton(html: string, label: string) {
  return (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((button) => button.includes(label))
}

const unavailable = [
  { name: 'loading', data: undefined, isLoading: true, isError: false, failure: 'still loading' },
  { name: 'error', data: undefined, isLoading: false, isError: true, error: new Error('Read failed'), failure: 'Unable to load' },
  { name: 'not-found', data: null, isLoading: false, isError: false, failure: 'not found' },
]

const dialogs = [
  { name: 'bardan', subject: 'bill', label: 'Save Bardan', preview: 'Credit preview', node: () => <AddBardanModal billId="bill1" onClose={onClose} /> },
  { name: 'quick payment', subject: 'supplier', label: 'Save Payment', preview: 'Pinned to', node: () => <RecordPaymentModal supplierId="supplier1" pool="kacha" pins={[{ billId: 'bill1', inNo: 'IN-001', duePaise: 100_000 }]} onClose={onClose} /> },
  { name: 'settle-off', subject: 'supplier', label: 'Settle to NIL', preview: 'Remaining due on', node: () => <SettleToNilModal supplierId="supplier1" pool="kacha" billId="bill1" inNo="IN-001" duePaise={100_000} onClose={onClose} /> },
  { name: 'bill cancellation', subject: 'bill', label: 'Cancel Bill', preview: 'Soft cancellation', node: () => <CancelBillModal billId="bill1" inNo="IN-001" onClose={onClose} /> },
  { name: 'payment details', subject: 'payment', label: '', preview: 'Advance left', node: () => <PaymentDetailsModal paymentId="payment1" onClose={onClose} /> },
]

describe.each(dialogs)('$name record availability', ({ subject, label, preview, node }) => {
  it.each(unavailable)('shows $name and blocks submission without a required record', async ({ name, failure, ...result }) => {
    read(result)
    const html = render(node())
    const message = name === 'loading' ? `Loading ${subject === 'supplier' ? 'supplier ledger' : subject}`
      : name === 'error' ? `Unable to load ${subject === 'supplier' ? 'supplier ledger' : subject}`
        : `${subject[0].toUpperCase()}${subject.slice(1)} not found`
    expect(html).toContain(message)
    expect(html).not.toContain(preview)
    if (name !== 'loading') expect(html).not.toContain('Loading')
    if (label) expect(submitButton(html, label)).toContain('disabled=""')
    await expect(mutation.mutationFn()).rejects.toThrow(failure)
    for (const write of writes) expect(write).not.toHaveBeenCalled()
  })
})

describe('cached record and identity safeguards', () => {
  it('blocks bardan and cancellation if the bill read failed despite a cached record', async () => {
    for (const node of [<AddBardanModal billId="bill1" onClose={onClose} />, <CancelBillModal billId="bill1" inNo="IN-001" onClose={onClose} />]) {
      read({ data: billDetail(), isLoading: false, isError: true })
      const html = render(node)
      expect(html).toContain('Unable to load bill')
      await expect(mutation.mutationFn()).rejects.toThrow('Unable to load bill.')
    }
    expect(addPurchaseBardanEntry).not.toHaveBeenCalled()
    expect(cancelPurchaseBill).not.toHaveBeenCalled()
  })

  it('does not allow a mismatched detail response to target a different bill', async () => {
    read({ data: billDetail({ bill: billFixture({ id: 'other' }) }), isLoading: false, isError: false })
    render(<CancelBillModal billId="bill1" inNo="IN-001" onClose={onClose} />)
    await expect(mutation.mutationFn()).rejects.toThrow('Bill not found.')
    expect(cancelPurchaseBill).not.toHaveBeenCalled()
  })

  it('blocks a cached supplier context after its shared snapshot read failed', async () => {
    read({ data: model().supplierContexts.get('supplier1'), isLoading: false, isError: true })
    const html = render(<RecordPaymentModal supplierId="supplier1" pool="kacha" pins={[]} onClose={onClose} />)
    expect(html).toContain('Unable to load supplier ledger')
    expect(html).not.toContain('Pinned')
    await expect(mutation.mutationFn()).rejects.toThrow('Unable to load supplier.')
    expect(createSupplierPayment).not.toHaveBeenCalled()
  })

  it.each(['missing', 'wrong-pool'])('refuses %s payment targets rather than silently recording an advance', async (target) => {
    const snapshot = model(bundleFixture({ bills: [billFixture({ pool: target === 'wrong-pool' ? 'gst' : 'kacha' })] }))
    read({ data: snapshot.supplierContexts.get('supplier1'), isLoading: false, isError: false })
    const html = render(<RecordPaymentModal supplierId="supplier1" pool="kacha" pins={[{ billId: target === 'missing' ? 'missing' : 'bill1', inNo: 'IN-001', duePaise: 100_000 }]} onClose={onClose} />)
    expect(html).toContain('Bill not found')
    expect(submitButton(html, 'Save Payment')).toContain('disabled=""')
    await expect(mutation.mutationFn()).rejects.toThrow('Bill not found.')
    expect(createSupplierPayment).not.toHaveBeenCalled()
  })

  it('refuses a supplier context belonging to another supplier', async () => {
    const snapshot = model(bundleFixture({ supplier: supplierFixture({ id: 'other' }) }))
    read({ data: snapshot.supplierContexts.get('other'), isLoading: false, isError: false })
    const html = render(<RecordPaymentModal supplierId="supplier1" pool="kacha" pins={[]} onClose={onClose} />)
    expect(html).toContain('Supplier not found')
    await expect(mutation.mutationFn()).rejects.toThrow('Supplier not found.')
    expect(createSupplierPayment).not.toHaveBeenCalled()
  })

  it('uses the current settlement due for settle-off instead of a stale caller amount', async () => {
    const snapshot = model(bundleFixture({ payments: [paymentFixture({ amountPaise: 70_000 })] }))
    read({ data: snapshot.supplierContexts.get('supplier1'), isLoading: false, isError: false })
    enteredState(['  Rounding  ', false, ''])
    const html = render(<SettleToNilModal supplierId="supplier1" pool="kacha" billId="bill1" inNo="IN-001" duePaise={100_000} onClose={onClose} />)
    expect(html).not.toContain('larger than ₹500')
    expect(submitButton(html, 'Settle to NIL')).not.toContain('disabled=""')
    await mutation.mutationFn()
    expect(createSupplierPayment).toHaveBeenCalledWith(expect.objectContaining({ amountPaise: 30_000, allocations: [{ billId: 'bill1', amountPaise: 30_000 }], reference: 'Rounding' }))
  })

  it('enforces large settle-off confirmation inside the mutation as well as the button', async () => {
    read({ data: model().supplierContexts.get('supplier1'), isLoading: false, isError: false })
    enteredState(['Write-off', false, ''])
    const html = render(<SettleToNilModal supplierId="supplier1" pool="kacha" billId="bill1" inNo="IN-001" duePaise={100_000} onClose={onClose} />)
    expect(submitButton(html, 'Settle to NIL')).toContain('disabled=""')
    await expect(mutation.mutationFn()).rejects.toThrow('Please confirm this write-off.')
    expect(createSupplierPayment).not.toHaveBeenCalled()
  })

  it('blocks payment cancellation after a failed read even when its cached payment is present', async () => {
    const snapshot = model(bundleFixture({ payments: [paymentFixture()] }))
    read({ data: snapshot.payments, isLoading: false, isError: true })
    enteredState(['Duplicate', true, ''])
    const html = render(<PaymentDetailsModal paymentId="payment1" onClose={onClose} />)
    expect(html).toContain('Unable to load payment')
    expect(html).not.toContain('Confirm Cancel')
    await expect(mutation.mutationFn()).rejects.toThrow('Unable to load payment.')
    expect(cancelSupplierPayment).not.toHaveBeenCalled()
  })

  it('refreshes only the confirmed payment supplier after a successful save', async () => {
    read({ data: model().supplierContexts.get('supplier1'), isLoading: false, isError: false })
    const saved = paymentFixture({ supplierId: 'confirmed-supplier' })
    vi.mocked(createSupplierPayment).mockResolvedValueOnce(saved)
    render(<RecordPaymentModal supplierId="supplier1" pool="kacha" pins={[]} onClose={onClose} />)
    await mutation.onSuccess(saved)
    expect(invalidateAfterSupplierPurchaseWrite).toHaveBeenCalledExactlyOnceWith(client, 'confirmed-supplier')
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('quick-payment remainder preview', () => {
  it.each([
    { amountPaise: 40_000, advance: null },
    { amountPaise: 60_000, advance: '₹100.00' },
  ])('reveals bug: $amountPaise pays other same-pool opening, refund and FIFO dues before advance', async ({ amountPaise, advance }) => {
    const snapshot = model(bundleFixture({
      supplier: supplierFixture({ openingKachaPaise: 10_000 }),
      bills: [billFixture({ id: 'selected', date: '2026-10-03' }), billFixture({ id: 'older' }), billFixture({ id: 'gst', pool: 'gst', taxMode: 'gst', gstRateBp: 500 })],
      lines: [lineFixture({ billId: 'selected', amountPaise: 20_000 }), lineFixture({ id: 'older-line', billId: 'older', amountPaise: 15_000 }), lineFixture({ id: 'gst-line', billId: 'gst' })],
      payments: [paymentFixture({ id: 'refund', date: '2026-10-01', kind: 'refund_received', amountPaise: 5_000 })],
    }))
    read({ data: snapshot.supplierContexts.get('supplier1'), isLoading: false, isError: false })
    enteredState([amountPaise / 100, 'cash', '', ''])
    const text = render(<RecordPaymentModal supplierId="supplier1" pool="kacha" pins={[{ billId: 'selected', inNo: 'IN-001', duePaise: 20_000 }]} onClose={onClose} />).replace(/<[^>]*>/g, '')

    expect(text).toContain('Pinned ₹200.00')
    if (advance) expect(text).toContain(`· advance ${advance}`)
    else expect(text).not.toContain('· advance')
    await mutation.mutationFn()
    expect(createSupplierPayment).toHaveBeenCalledWith(expect.objectContaining({
      pool: 'kacha', amountPaise, allocations: [{ billId: 'selected', amountPaise: 20_000 }],
    }))
    expect(snapshot.supplierContexts.get('supplier1')?.settlement.pools.gst.outstandingPaise).toBe(105_000)
  })

  it('characterizes the advance label as this payment remainder rather than the existing standing advance', async () => {
    const snapshot = model(bundleFixture({ supplier: supplierFixture({ openingKachaPaise: -150_000 }) }))
    read({ data: snapshot.supplierContexts.get('supplier1'), isLoading: false, isError: false })
    enteredState([200, 'cash', '', ''])
    const text = render(<RecordPaymentModal supplierId="supplier1" pool="kacha" pins={[]} onClose={onClose} />).replace(/<[^>]*>/g, '')
    expect(text).toContain('· advance ₹200.00')
    expect(text).not.toContain('· advance ₹700.00')
    await mutation.mutationFn()
    expect(createSupplierPayment).toHaveBeenCalledWith(expect.objectContaining({ amountPaise: 20_000, allocations: [] }))
  })
})

describe('quick-payment allocation compatibility', () => {
  it.each([
    { amountPaise: 50_000, allocations: [{ billId: 'newer', amountPaise: 50_000 }] },
    { amountPaise: 150_000, allocations: [{ billId: 'newer', amountPaise: 100_000 }, { billId: 'older', amountPaise: 50_000 }] },
  ])('preserves caller pin order and applies only $amountPaise', async ({ amountPaise, allocations }) => {
    const snapshot = model(bundleFixture({
      bills: [billFixture({ id: 'newer', date: '2026-10-03' }), billFixture({ id: 'older', date: '2026-10-02' })],
      lines: [lineFixture({ billId: 'newer' }), lineFixture({ id: 'older-line', billId: 'older' })],
    }))
    read({ data: snapshot.supplierContexts.get('supplier1'), isLoading: false, isError: false })
    enteredState([amountPaise / 100, 'cash', '', ''])
    render(<RecordPaymentModal supplierId="supplier1" pool="kacha" pins={[
      { billId: 'newer', inNo: 'IN-002', duePaise: 100_000 },
      { billId: 'older', inNo: 'IN-001', duePaise: 100_000 },
    ]} onClose={onClose} />)
    await mutation.mutationFn()
    expect(createSupplierPayment).toHaveBeenCalledWith(expect.objectContaining({ amountPaise, allocations }))
  })

  it('resolves quick-payment pin dues from the cached settlement rather than the caller', async () => {
    const snapshot = model(bundleFixture({ payments: [paymentFixture({ amountPaise: 70_000 })] }))
    read({ data: snapshot.supplierContexts.get('supplier1'), isLoading: false, isError: false })
    enteredState([500, 'cash', '', ''])
    const text = render(<RecordPaymentModal supplierId="supplier1" pool="kacha" pins={[{ billId: 'bill1', inNo: 'IN-001', duePaise: 100_000 }]} onClose={onClose} />).replace(/<[^>]*>/g, '')
    expect(text).toContain('due ₹300.00')
    expect(text).toContain('Pinned ₹300.00')
    await mutation.mutationFn()
    expect(createSupplierPayment).toHaveBeenCalledWith(expect.objectContaining({ allocations: [{ billId: 'bill1', amountPaise: 30_000 }] }))
  })
})

describe('bill cancellation net preview', () => {
  it.each([
    { taxMode: 'gst' as const, pool: 'gst' as const, expected: '₹939.00', omittedBardan: '₹1,044.00' },
    { taxMode: 'rcm' as const, pool: 'gst' as const, expected: '₹895.00', omittedBardan: '₹995.00' },
    { taxMode: 'none' as const, pool: 'kacha' as const, expected: '₹895.00', omittedBardan: '₹995.00' },
  ])('reveals bug: $taxMode cancellation omits bardan before tax and whole-rupee rounding', async ({ taxMode, pool, expected, omittedBardan }) => {
    read({
      data: billDetail({
        bill: billFixture({ pool, taxMode, gstRateBp: 500 }),
        lines: [lineFixture({ amountPaise: 100_005 })],
        adjustments: [
          { id: 'quality', billId: 'bill1', type: 'quality_cut', amountPaise: 2_000, note: '', created: '' },
          { id: 'transport', billId: 'bill1', type: 'transport', amountPaise: 1_500, note: '', created: '' },
        ],
        bardan: [bardanFixture(), bardanFixture({ id: 'memo', method: 'cash_back', creditPaise: 50_000, cashAmountPaise: 50_000 })],
      }),
      isLoading: false, isError: false,
    })
    enteredState(['  Duplicate bill  ', ''])
    const text = render(<CancelBillModal billId="bill1" inNo="IN-001" onClose={onClose} />).replace(/<[^>]*>/g, '')
    expect(text).toContain(`net ${expected}`)
    expect(text).not.toContain(`net ${omittedBardan}`)
    await mutation.mutationFn()
    expect(cancelPurchaseBill).toHaveBeenCalledExactlyOnceWith('bill1', 'Duplicate bill')
  })
})
