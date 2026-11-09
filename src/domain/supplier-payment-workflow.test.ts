import { describe, expect, it } from 'vitest'
import type { SupplierBundle } from '@/data/suppliers'
import { billFixture, bundleFixture, lineFixture, paymentFixture, supplierFixture } from '@/test/purchase-fixtures'
import { buildPurchaseReadModel } from './purchase-read-model'
import { buildSupplierPaymentWorkflow, prepareSupplierPaymentInput, type SupplierPaymentDraft } from './supplier-payment-workflow'

const today = '2026-11-08'

function context(bundle: SupplierBundle = bundleFixture()) {
  return buildPurchaseReadModel([bundle.supplier], bundle, today).supplierContexts.get(bundle.supplier.id)!
}

function draft(overrides: Partial<SupplierPaymentDraft> = {}): SupplierPaymentDraft {
  return {
    supplierId: 'supplier1', date: today, pool: 'kacha', kind: 'payment', amountPaise: 50_000,
    mode: 'cash', reference: '', payeeName: '', privateNote: '', ...overrides,
  }
}

function workflow(bundle: SupplierBundle, input = draft(), selectedBillIds: ReadonlySet<string> = new Set()) {
  return buildSupplierPaymentWorkflow(context(bundle), { ...input, selectedBillIds, today })
}

describe('supplier payment workflow', () => {
  it('simulates selected full dues while persisting only the portion this payment actually applies', () => {
    const bundle = bundleFixture({ supplier: supplierFixture({ openingKachaPaise: 30_000 }) })
    const input = draft()
    const result = workflow(bundle, input, new Set(['bill1']))
    expect(result.openBills[0]).toMatchObject({ billId: 'bill1', inNo: 'IN-001', duePaise: 100_000, itemsLabel: 'Scrap 100.000kg @ ₹10.000' })
    expect(result).toMatchObject({ totalDuePaise: 100_000, totalSelectedPaise: 100_000, outstandingBefore: 130_000 })
    expect(result.allocationPreview.lines[0]).toMatchObject({ paidNowPaise: 50_000, remainingDuePaise: 50_000, paidPercent: 50 })
    expect(result.allocationPreview).toMatchObject({ appliedToDuesPaise: 50_000, outstandingAfterPaise: 80_000, advancePaise: 0 })
    expect(result.coveragePercent).toBeCloseTo(50_000 / 130_000 * 100)
    expect(prepareSupplierPaymentInput(input, result).allocations).toEqual([{ billId: 'bill1', amountPaise: 50_000 }])
  })

  it('preserves explicit quick-payment selection priority while the default remains chronological', () => {
    const bundle = bundleFixture({
      bills: [billFixture({ id: 'newer', date: '2026-10-03' }), billFixture({ id: 'older', date: '2026-10-02' })],
      lines: [lineFixture({ billId: 'newer' }), lineFixture({ id: 'older-line', billId: 'older' })],
    })
    const input = draft()
    const selectedBillIds = new Set(['newer', 'older'])
    const quick = buildSupplierPaymentWorkflow(context(bundle), { ...input, selectedBillIds, pinOrder: 'selection', today })
    expect(prepareSupplierPaymentInput(input, quick).allocations).toEqual([{ billId: 'newer', amountPaise: 50_000 }])
    const chronological = workflow(bundle, input, selectedBillIds)
    expect(prepareSupplierPaymentInput(input, chronological).allocations).toEqual([{ billId: 'older', amountPaise: 50_000 }])
  })

  it('pays unpinned opening, refund and FIFO dues without persisting synthetic pins', () => {
    const bundle = bundleFixture({
      supplier: supplierFixture({ openingKachaPaise: 10_000 }),
      bills: [billFixture({ id: 'selected', date: '2026-10-03' }), billFixture({ id: 'older', date: '2026-10-02' })],
      lines: [lineFixture({ billId: 'selected', amountPaise: 20_000 }), lineFixture({ id: 'old-line', billId: 'older', amountPaise: 15_000 })],
      payments: [paymentFixture({ id: 'refund', date: '2026-10-01', kind: 'refund_received', amountPaise: 5_000 })],
    })
    const input = draft({ amountPaise: 60_000 })
    const result = workflow(bundle, input, new Set(['selected']))
    expect(result.openBills.map((bill) => bill.billId)).toEqual(['older', 'selected'])
    expect(result.allocationPreview.lines.map((line) => [line.billId, line.paidNowPaise, line.remainingDuePaise])).toEqual([
      ['older', 15_000, 0], ['selected', 20_000, 0],
    ])
    expect(result.allocationPreview).toMatchObject({ appliedToDuesPaise: 50_000, outstandingAfterPaise: 0, advancePaise: 10_000 })
    expect(result.coveragePercent).toBe(100)
    expect(prepareSupplierPaymentInput(input, result).allocations).toEqual([{ billId: 'selected', amountPaise: 20_000 }])
    expect(prepareSupplierPaymentInput(input, workflow(bundle, input)).allocations).toEqual([])
  })

  it('preserves full-due pins under backdating even when earlier credit is redistributed', () => {
    const bundle = bundleFixture({
      bills: [billFixture({ id: 'older', date: '2026-10-01' }), billFixture({ id: 'selected', date: '2026-10-02' })],
      lines: [lineFixture({ billId: 'older', amountPaise: 6_000 }), lineFixture({ id: 'second-line', billId: 'selected', amountPaise: 10_000 })],
      payments: [paymentFixture({ id: 'later', date: '2026-10-05', amountPaise: 10_000 })],
    })
    const input = draft({ date: '2026-09-30', amountPaise: 8_000 })
    const result = workflow(bundle, input, new Set(['selected']))
    expect(result.totalSelectedPaise).toBe(6_000)
    // The preview first pins the current full due (6,000), then its FIFO remainder (2,000) pays the older bill.
    expect(result.allocationPreview.lines[0]).toMatchObject({ billId: 'selected', duePaise: 6_000, paidNowPaise: 6_000, remainingDuePaise: 0, paidPercent: 100 })
    expect(result.allocationPreview).toMatchObject({ appliedToDuesPaise: 8_000, outstandingAfterPaise: 0, advancePaise: 2_000 })
    expect(prepareSupplierPaymentInput(input, result).allocations).toEqual([{ billId: 'selected', amountPaise: 6_000 }])
  })

  it('never offers or allocates bills in another pool or cancelled/settled bills', () => {
    const bundle = bundleFixture({
      bills: [billFixture(), billFixture({ id: 'gst', pool: 'gst', taxMode: 'gst', gstRateBp: 500 }), billFixture({ id: 'cancelled', cancelled: true }), billFixture({ id: 'nil' })],
      lines: [lineFixture(), lineFixture({ id: 'gst-line', billId: 'gst' }), lineFixture({ id: 'cancel-line', billId: 'cancelled' })],
    })
    const input = draft({ amountPaise: 110_000 })
    const before = structuredClone(bundle)
    const result = workflow(bundle, input, new Set(['gst', 'cancelled', 'nil']))
    expect(result.openBills.map((bill) => bill.billId)).toEqual(['bill1'])
    expect(result.totalSelectedPaise).toBe(0)
    expect(result.allocationPreview).toMatchObject({ appliedToDuesPaise: 100_000, advancePaise: 10_000, outstandingAfterPaise: 0 })
    expect(prepareSupplierPaymentInput(input, result).allocations).toEqual([])
    expect(bundle).toEqual(before)
  })

  it('uses the cached baseline without a simulation for zero input', () => {
    const cached = context(bundleFixture({ supplier: supplierFixture({ openingKachaPaise: -130_000 }) }))
    const result = buildSupplierPaymentWorkflow(cached, { ...draft({ amountPaise: 0 }), selectedBillIds: new Set(['bill1']), today })
    expect(result).toMatchObject({ openBills: [], totalDuePaise: 0, totalSelectedPaise: 0, outstandingBefore: 0, coveragePercent: 0 })
    expect(result.allocationPreview).toEqual({ lines: [], appliedToDuesPaise: 0, advancePaise: 30_000, outstandingAfterPaise: 0 })
    expect(() => prepareSupplierPaymentInput(draft({ amountPaise: 0 }), result)).toThrow('Payment amount must be greater than zero.')
  })

  it('ignores pins on refunds and consumes an existing advance before showing new dues', () => {
    const bundle = bundleFixture({ supplier: supplierFixture({ openingKachaPaise: -150_000 }) })
    const input = draft({ kind: 'refund_received', amountPaise: 80_000 })
    const result = workflow(bundle, input, new Set(['bill1']))
    expect(result.allowPins).toBe(false)
    expect(result.totalSelectedPaise).toBe(0)
    expect(result.coveragePercent).toBe(0)
    expect(result.allocationPreview).toMatchObject({ appliedToDuesPaise: 0, advancePaise: 0, outstandingAfterPaise: 30_000 })
    expect(prepareSupplierPaymentInput(input, result).allocations).toBeUndefined()
  })

  it('retains cancelled payment history in date/created/id order, newest six first', () => {
    const payments = ['a', 'g', 'd', 'b', 'f', 'e', 'c'].map((id) => paymentFixture({ id, cancelled: id === 'g' }))
    const result = workflow(bundleFixture({ payments }))
    expect(result.recentPayments.map((payment) => payment.id)).toEqual(['g', 'f', 'e', 'd', 'c', 'b'])
    expect(payments.map((payment) => payment.id)).toEqual(['a', 'g', 'd', 'b', 'f', 'e', 'c'])
  })
})

describe('supplier payment payload preparation', () => {
  it('preserves form messages for missing supplier, payee and electronic reference', () => {
    expect(() => prepareSupplierPaymentInput(draft({ supplierId: '' }), null)).toThrow('Please select a supplier.')
    const input = draft({ kind: 'paid_on_behalf', payeeName: '  ' })
    expect(() => prepareSupplierPaymentInput(input, workflow(bundleFixture(), input))).toThrow('Payee name is required when paying on behalf.')
    for (const mode of ['upi', 'rtgs', 'neft', 'cheque'] as const) {
      const electronic = draft({ mode, reference: '  ' })
      expect(() => prepareSupplierPaymentInput(electronic, workflow(bundleFixture(), electronic))).toThrow(`Reference number is required for ${mode.toUpperCase()} payments.`)
    }
  })

  it('trims entry fields, omits non-behalf payee names, and keeps paise unchanged', () => {
    const input = draft({ kind: 'paid_on_behalf', mode: 'neft', reference: '  UTR-123  ', payeeName: '  Freight Co  ', privateNote: '  private memo  ' })
    expect(prepareSupplierPaymentInput(input, workflow(bundleFixture(), input))).toEqual({
      supplierId: 'supplier1', date: today, pool: 'kacha', kind: 'paid_on_behalf', amountPaise: 50_000,
      mode: 'neft', reference: 'UTR-123', payeeName: 'Freight Co', privateNote: 'private memo', allocations: [],
    })
    const ordinary = draft({ payeeName: 'ignored', privateNote: '  memo  ' })
    expect(prepareSupplierPaymentInput(ordinary, workflow(bundleFixture(), ordinary))).toMatchObject({ payeeName: undefined, privateNote: 'memo' })
  })

  it('refuses writes without a matching supplier financial context', () => {
    expect(() => prepareSupplierPaymentInput(draft(), null)).toThrow('Supplier financial context is unavailable.')
    const otherSupplier = workflow(bundleFixture({ supplier: supplierFixture({ id: 'other' }) }))
    expect(() => prepareSupplierPaymentInput(draft(), otherSupplier)).toThrow('Supplier financial context is unavailable.')
  })

  it.each([NaN, Infinity, -1, 0, 0.5])('rejects invalid paise input %s before constructing a write', (amountPaise) => {
    const input = draft({ amountPaise })
    expect(() => prepareSupplierPaymentInput(input, workflow(bundleFixture(), input))).toThrow()
  })
})
