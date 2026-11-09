import { describe, expect, it } from 'vitest'
import { bundleToLedgerInput, bundleToSettlementInput, type SupplierBundle } from '@/data/suppliers'
import { buildSupplierLedger } from './supplier-ledger'
import { computeSupplierSettlement } from './supplier-settlement'

function bundle(): SupplierBundle {
  return {
    supplier: {
      id: 'supplier1', companyName: 'Test Metals', contactName: '', phone: '', gstNo: '', city: '', notes: '',
      openingKachaPaise: 0, openingGstPaise: 0, openingBalanceDate: '2026-04-01', active: true, created: '2026-04-01 08:00:00Z',
    },
    bills: [{
      id: 'bill1', supplierId: 'supplier1', inNo: 'IN-001', supplierBillNo: '', date: '2026-04-02', pool: 'kacha',
      taxMode: 'none', gstRateBp: 0, groupId: '', vehicleNo: '', privateNote: '', photos: [], cancelled: false,
      cancelReason: '', created: '2026-04-02 10:00:00Z',
    }],
    lines: [{ id: 'line1', billId: 'bill1', itemId: '', itemName: 'Scrap', weightG: 100_000, rateMilli: 1_000_000, amountPaise: 10_000_000, created: '2026-04-02 10:00:00Z' }],
    adjustments: [], bardan: [], payments: [], allocations: [],
  }
}

function addBardan(input: SupplierBundle, method: string, creditPaise: number, id = 'bardan1') {
  input.bardan.push({
    id, billId: 'bill1', bardanG: 1_000, rateLineId: 'line1', rateMilli: 1_000_000, method, creditPaise,
    cashAmountPaise: 0, date: '2026-04-03', note: '', created: `2026-04-03 10:00:00Z`,
  })
}

describe('supplier financial regressions', () => {
  it.each([
    { opening: -5_000_000, due: 5_000_000, advance: 0 },
    { opening: -10_000_000, due: 0, advance: 0 },
    { opening: -12_000_000, due: 0, advance: 2_000_000 },
  ])('consumes opening $opening within its pool', ({ opening, due, advance }) => {
    const input = bundle()
    input.supplier.openingKachaPaise = opening

    const settlement = computeSupplierSettlement(bundleToSettlementInput(input))

    expect(settlement.pools.kacha.outstandingPaise).toBe(due)
    expect(settlement.pools.kacha.advancePaise).toBe(advance)
    expect(settlement.pools.kacha.bills[0].paidPaise).toBe(10_000_000 - due)
    expect(settlement.pools.kacha.bills[0].creditsApplied).toEqual([
      { reference: 'Opening Advance', date: '', amountPaise: Math.min(-opening, 10_000_000), pinned: false },
    ])
  })

  it('does not use a GST opening advance to settle a kacha bill', () => {
    const input = bundle()
    input.supplier.openingGstPaise = -5_000_000

    const settlement = computeSupplierSettlement(bundleToSettlementInput(input))

    expect(settlement.pools.kacha.outstandingPaise).toBe(10_000_000)
    expect(settlement.pools.gst.advancePaise).toBe(5_000_000)
  })

  it('opening advance also offsets an incoming refund payable', () => {
    const input = bundle()
    input.bills = []
    input.lines = []
    input.supplier.openingKachaPaise = -50_000
    input.payments.push({ id: 'refund1', supplierId: 'supplier1', date: '2026-04-03', pool: 'kacha', kind: 'refund_received', amountPaise: 30_000, mode: 'cash', reference: '', payeeName: '', privateNote: '', photos: [], cancelled: false, cancelReason: '', created: '2026-04-03 10:00:00Z' })

    const settlement = computeSupplierSettlement(bundleToSettlementInput(input))

    expect(settlement.pools.kacha.outstandingPaise).toBe(0)
    expect(settlement.pools.kacha.advancePaise).toBe(20_000)
  })

  it.each([
    { taxMode: 'gst', gstRateBp: 1800, expected: 10_620_000 },
    { taxMode: 'rcm', gstRateBp: 1800, expected: 9_000_000 },
    { taxMode: 'none', gstRateBp: 0, expected: 9_000_000 },
  ])('reconciles a bardan deduction with $taxMode bill net', ({ taxMode, gstRateBp, expected }) => {
    const input = bundle()
    Object.assign(input.bills[0], { pool: taxMode === 'none' ? 'kacha' : 'gst', taxMode, gstRateBp })
    addBardan(input, 'deduct', 1_000_000)

    const settlement = computeSupplierSettlement(bundleToSettlementInput(input))
    const ledger = buildSupplierLedger(bundleToLedgerInput(input))

    expect(ledger.closingPaise).toBe(expected)
    expect(ledger.closingPaise).toBe(settlement.combined.netPositionPaise)
  })

  it('partial deductions preserve the same tax and whole-rupee rounding as settlement', () => {
    const input = bundle()
    Object.assign(input.bills[0], { pool: 'gst', taxMode: 'gst', gstRateBp: 1800 })
    input.lines[0].amountPaise = 10_049
    addBardan(input, 'deduct', 51, 'bardan2')
    addBardan(input, 'deduct', 75, 'bardan1')

    const settlement = computeSupplierSettlement(bundleToSettlementInput(input))
    const ledger = buildSupplierLedger(bundleToLedgerInput(input))

    expect(ledger.closingPaise).toBe(11_700)
    expect(ledger.closingPaise).toBe(settlement.combined.netPositionPaise)
    expect(ledger.entries.map((entry) => entry.id)).toEqual(['bill1', 'bardan1', 'bardan2'])
  })

  it('counts bardan advance only through its generated payment', () => {
    const input = bundle()
    addBardan(input, 'advance', 10_000)
    input.payments.push({ id: 'advance1', supplierId: 'supplier1', date: '2026-04-03', pool: 'kacha', kind: 'bardan_advance', amountPaise: 10_000, mode: 'other', reference: 'Bardan Advance (Bill IN-001)', payeeName: '', privateNote: '', photos: [], cancelled: false, cancelReason: '', created: '2026-04-03 10:00:01Z' })

    const settlement = computeSupplierSettlement(bundleToSettlementInput(input))
    const ledger = buildSupplierLedger(bundleToLedgerInput(input))

    expect(ledger.entries.find((entry) => entry.id === 'bardan1')?.amountPaise).toBe(0)
    expect(ledger.closingPaise).toBe(9_990_000)
    expect(ledger.closingPaise).toBe(settlement.combined.netPositionPaise)
  })

  it('cancelling an advance payment removes its effect despite the bardan memo', () => {
    const input = bundle()
    addBardan(input, 'advance', 10_000)
    input.payments.push({ id: 'advance1', supplierId: 'supplier1', date: '2026-04-03', pool: 'kacha', kind: 'bardan_advance', amountPaise: 10_000, mode: 'other', reference: '', payeeName: '', privateNote: '', photos: [], cancelled: true, cancelReason: 'Correction', created: '2026-04-03 10:00:01Z' })

    const ledger = buildSupplierLedger(bundleToLedgerInput(input))

    expect(ledger.closingPaise).toBe(10_000_000)
  })

  it('cancelled parent bills do not leave monetary bardan behind', () => {
    const input = bundle()
    input.bills[0].cancelled = true
    addBardan(input, 'deduct', 10_000)

    const ledger = buildSupplierLedger(bundleToLedgerInput(input))
    const settlement = computeSupplierSettlement(bundleToSettlementInput(input))

    expect(ledger.entries).toEqual([])
    expect(ledger.closingPaise).toBe(0)
    expect(ledger.closingPaise).toBe(settlement.combined.netPositionPaise)
  })

  it('a date range with no entries carries its actual prior closing balance', () => {
    const input = bundle()

    const ledger = buildSupplierLedger(bundleToLedgerInput(input, { from: '2026-05-01', to: '2026-05-31' }))

    expect(ledger.entries).toEqual([])
    expect(ledger.openingPaise).toBe(10_000_000)
    expect(ledger.closingPaise).toBe(10_000_000)
  })
})
