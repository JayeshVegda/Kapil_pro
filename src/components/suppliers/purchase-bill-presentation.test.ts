import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PurchaseBillDetail, SupplierBundle } from '@/data/suppliers'
import { buildPurchaseReadModel } from '@/domain/purchase-read-model'
import { formatPurchaseLineMemos } from '@/domain/purchase-receipt-memos'
import { bardanFixture, billFixture, bundleFixture, lineFixture, paymentFixture, supplierFixture } from '@/test/purchase-fixtures'
import { BillChitty, computeChittyTotals } from './bill-chitty'
import { buildPurchaseBillPresentation } from './purchase-bill-presentation'

function fixture(bundle: SupplierBundle = bundleFixture()) {
  const model = buildPurchaseReadModel([bundle.supplier], bundle, '2026-11-08')
  const context = model.supplierContexts.get(bundle.supplier.id)!
  const bill = bundle.bills[0]
  const detail: PurchaseBillDetail = {
    bill,
    lines: context.bundle.lines.filter((line) => line.billId === bill.id),
    adjustments: bundle.adjustments.filter((row) => row.billId === bill.id),
    bardan: bundle.bardan.filter((row) => row.billId === bill.id),
    allocations: bundle.allocations.filter((row) => row.billId === bill.id),
  }
  return { detail, context }
}

describe('buildPurchaseBillPresentation', () => {
  it('preserves tax, item units, adjustment notes, and every bardan method field', () => {
    const { detail, context } = fixture(bundleFixture({
      bills: [billFixture({ pool: 'gst', taxMode: 'gst', gstRateBp: 1800, supplierBillNo: 'SB-9' })],
      lines: [lineFixture({ weightG: 12_345, rateMilli: 8_765_432 })],
      adjustments: [{ id: 'adjustment1', billId: 'bill1', type: 'quality_cut', amountPaise: 5000, note: 'Moisture', created: '2026-10-02' }],
      bardan: [
        bardanFixture({ note: 'Returned bags' }),
        bardanFixture({ id: 'cash', method: 'cash_back', creditPaise: 0, cashAmountPaise: 1200 }),
        bardanFixture({ id: 'kind', method: 'in_kind', creditPaise: 0 }),
        bardanFixture({ id: 'advance', method: 'advance', creditPaise: 0 }),
      ],
    }))
    const presentation = buildPurchaseBillPresentation(detail, context)!

    expect(presentation.chitty).toMatchObject({
      inNo: 'IN-001', date: '2026-10-02', supplierName: 'Test Metals', pool: 'gst',
      taxMode: 'gst', gstRateBp: 1800, supplierBillNo: 'SB-9',
      lines: [{ itemName: 'Scrap', weightG: 12_345, rateMilli: 8_765_432, amountPaise: 100_000 }],
      adjustments: [{ type: 'quality_cut', amountPaise: 5000, note: 'Moisture' }],
      bardan: detail.bardan.map(({ bardanG, rateMilli, method, creditPaise, cashAmountPaise, date, note }) =>
        ({ bardanG, rateMilli, method, creditPaise, cashAmountPaise, date, note })),
      statusOverride: 'open',
    })
    expect(computeChittyTotals(presentation.chitty)).toMatchObject({ taxablePaise: 85_000, taxPaise: 15_300, netPaise: 100_300 })
    expect(presentation.settlementBillRow).toBe(context.settlement.pools.gst.bills[0])
    expect(presentation.chitty.paidRows).toBe(presentation.paymentRows)
  })

  it('retains RCM liability without adding it to the supplier payable', () => {
    const { detail, context } = fixture(bundleFixture({
      bills: [billFixture({ pool: 'gst', taxMode: 'rcm', gstRateBp: 1800 })],
      bardan: [bardanFixture()],
    }))
    const { chitty } = buildPurchaseBillPresentation(detail, context)!

    expect(chitty).toMatchObject({ pool: 'gst', taxMode: 'rcm', gstRateBp: 1800 })
    expect(computeChittyTotals(chitty)).toMatchObject({ netPaise: 90_000, rcmLiabilityPaise: 16_200 })
  })

  it('keeps raw and parsed internal notes separate from the printable chitty', () => {
    const privateNote = formatPurchaseLineMemos('[bags_at_receipt:2.500]\nInternal weighing note', { line1: '2' })
    const { detail, context } = fixture(bundleFixture({ bills: [billFixture({ privateNote })] }))
    const presentation = buildPurchaseBillPresentation(detail, context)!

    expect(presentation.privateNote).toBe(privateNote)
    expect(presentation.userNote).toBe('Internal weighing note')
    expect(presentation.bagsAtReceiptKg).toBe(2.5)
    expect(presentation.chitty).not.toHaveProperty('privateNote')
    expect(presentation.chitty.lines[0]).toMatchObject({ itemName: 'Scrap', bardanText: '2 bags' })
    const html = renderToStaticMarkup(createElement(BillChitty, { data: presentation.chitty }))
    expect(html).not.toContain('bags_at_receipt')
    expect(html).not.toContain('purchase_line_memos_v1')
    expect(html).not.toContain('Internal weighing note')
  })

  it('leaves receipt memos in the bardan column unless item-name presentation is explicitly requested', () => {
    const privateNote = formatPurchaseLineMemos('', { line1: 'Blue bags', line2: '3' })
    const { detail, context } = fixture(bundleFixture({
      bills: [billFixture({ privateNote })],
      lines: [lineFixture(), lineFixture({ id: 'line2', itemName: 'Copper' }), lineFixture({ id: 'line3', itemName: 'Brass' })],
    }))
    const before = structuredClone(detail)

    expect(buildPurchaseBillPresentation(detail, context)!.chitty.lines.map((line) => [line.itemName, line.bardanText]))
      .toEqual([['Scrap', 'Blue bags'], ['Copper', '3 bags'], ['Brass', undefined]])
    expect(buildPurchaseBillPresentation(detail, context, { receiptMemosInItemName: true })!.chitty.lines.map((line) => line.itemName))
      .toEqual(['Scrap (Blue bags)', 'Copper (3 bags)', 'Brass'])
    expect(detail).toEqual(before)
  })

  it('shows opening-advance credits before applied payments and prefers settlement amounts over stored pins', () => {
    const { detail, context } = fixture(bundleFixture({
      supplier: supplierFixture({ openingKachaPaise: -20_000 }),
      payments: [paymentFixture({ amountPaise: 30_000, reference: 'UTR-1', mode: 'bank' })],
      allocations: [{ id: 'pin1', paymentId: 'payment1', billId: 'bill1', amountPaise: 50_000, created: '2026-10-03' }],
    }))
    const presentation = buildPurchaseBillPresentation(detail, context)!

    expect(presentation.paymentRows).toEqual([
      { date: '', mode: '', reference: 'Opening Advance', amountPaise: 20_000, pinned: false },
      { date: '2026-10-03', mode: 'bank', reference: 'UTR-1', amountPaise: 30_000, pinned: true },
    ])
    expect(computeChittyTotals(presentation.chitty)).toMatchObject({ paidPaise: 50_000, duePaise: 50_000, status: 'partial' })
  })

  it('preserves business-date, created-timestamp, and record-id payment chronology', () => {
    const { detail, context } = fixture(bundleFixture({ payments: [
      paymentFixture({ id: 'later-date', date: '2026-10-04', amountPaise: 1000, reference: 'D' }),
      paymentFixture({ id: 'b', date: '2026-10-03', created: '2026-10-03 10:00:00Z', amountPaise: 1000, reference: 'B' }),
      paymentFixture({ id: 'a', date: '2026-10-03', created: '2026-10-03 10:00:00Z', amountPaise: 1000, reference: 'A' }),
      paymentFixture({ id: 'earlier-created', date: '2026-10-03', created: '2026-10-03 09:00:00Z', amountPaise: 1000, reference: 'C' }),
    ] }))

    expect(buildPurchaseBillPresentation(detail, context)!.paymentRows.map((row) => row.reference)).toEqual(['C', 'A', 'B', 'D'])
  })

  it('falls back to positive stored allocations in their read order, skips cancelled payments, and keeps unknown metadata blank', () => {
    const { detail, context } = fixture(bundleFixture({
      payments: [paymentFixture({ cancelled: true }), paymentFixture({ id: 'active', reference: 'Live', amountPaise: 2000 })],
      allocations: [
        { id: 'cancelled', paymentId: 'payment1', billId: 'bill1', amountPaise: 1000, created: '2026-10-03' },
        { id: 'missing', paymentId: 'missing-payment', billId: 'bill1', amountPaise: 3000, created: '2026-10-04' },
        { id: 'zero', paymentId: 'active', billId: 'bill1', amountPaise: 0, created: '2026-10-05' },
        { id: 'negative', paymentId: 'active', billId: 'bill1', amountPaise: -1000, created: '2026-10-05' },
        { id: 'active', paymentId: 'active', billId: 'bill1', amountPaise: 2000, created: '2026-10-06' },
      ],
    }))
    context.settlement.pools.kacha.bills[0].creditsApplied = []

    expect(buildPurchaseBillPresentation(detail, context)!.paymentRows).toEqual([
      { date: '', mode: '', reference: '', amountPaise: 3000, pinned: true },
      { date: '2026-10-03', mode: 'cash', reference: 'Live', amountPaise: 2000, pinned: true },
    ])
  })

  it('retains credit fallback labels when a legacy settlement has no matching payment record', () => {
    const { detail, context } = fixture()
    context.settlement.pools.kacha.bills[0].creditsApplied = [
      { paymentId: 'missing', date: '2026-10-01', reference: 'Legacy credit', amountPaise: 1000, pinned: false },
    ]

    expect(buildPurchaseBillPresentation(detail, context)!.paymentRows).toEqual([
      { date: '2026-10-01', mode: '', reference: 'Legacy credit', amountPaise: 1000, pinned: false },
    ])
  })

  it('retains cancellation metadata and the settlement status override', () => {
    const { detail, context } = fixture(bundleFixture({ bills: [billFixture({ cancelled: true, cancelReason: 'Duplicate' })] }))

    expect(buildPurchaseBillPresentation(detail, context)!.chitty).toMatchObject({ cancelled: true, cancelReason: 'Duplicate', statusOverride: 'cancelled' })
  })

  it('does not build a success-shaped chitty for unavailable or mismatched supplier records', () => {
    const { detail, context } = fixture()

    expect(buildPurchaseBillPresentation(undefined, context)).toBeNull()
    expect(buildPurchaseBillPresentation(detail, null)).toBeNull()
    expect(buildPurchaseBillPresentation({ ...detail, bill: { ...detail.bill, supplierId: 'different' } }, context)).toBeNull()
  })
})
