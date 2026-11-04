import { describe, expect, it } from 'vitest'
import { computeChittyTotals, type BillChittyData } from './bill-chitty'

function sampleData(): BillChittyData {
  return {
    inNo: 'IN-101',
    date: '2026-11-01',
    supplierName: 'Shakti Metals',
    pool: 'gst',
    taxMode: 'rcm',
    gstRateBp: 1800,
    supplierBillNo: 'SB-9',
    vehicleNo: 'MH12XY1234',
    lines: [
      { itemName: 'Brass Scrap', weightG: 40_000, rateMilli: 7_200_000, amountPaise: 2_880_000 },
      { itemName: 'Copper', weightG: 10_000, rateMilli: 6_500_000, amountPaise: 650_000 },
    ],
    adjustments: [
      { type: 'labour', amountPaise: -2500 },
      { type: 'quality_cut', amountPaise: -1000 },
      { type: 'other', amountPaise: 500, note: 'Weighing' },
    ],
    bardan: [
      { bardanG: 3000, rateMilli: 1_000_000, method: 'deduct', creditPaise: 30_000, cashAmountPaise: 0, date: '2026-11-01', note: '' },
      { bardanG: 0, rateMilli: 0, method: 'cash_back', creditPaise: 0, cashAmountPaise: 12_000, date: '2026-11-02', note: '' },
    ],
    paidRows: [
      { date: '2026-11-03', mode: 'cash', reference: '', amountPaise: 1_500_000, pinned: false },
      { date: '2026-11-04', mode: 'upi', reference: 'UPI-7', amountPaise: 400_000, pinned: false },
    ],
  }
}

describe('computeChittyTotals', () => {
  it('returns identical totals for view and preview modes', () => {
    expect(computeChittyTotals(sampleData(), 'preview')).toEqual(computeChittyTotals(sampleData(), 'view'))
  })

  it('accumulates lines and payments, then derives due', () => {
    const totals = computeChittyTotals(sampleData())
    expect(totals.linesTotalPaise).toBe(3_530_000)
    expect(totals.paidPaise).toBe(1_900_000)
    expect(totals.duePaise).toBe(Math.max(0, totals.netPaise - 1_900_000))
    expect(totals.bardanCreditPaise).toBeGreaterThan(0)
  })

  it('status derives from cancellation override, then paid/due', () => {
    expect(computeChittyTotals({ ...sampleData(), cancelled: true, cancelReason: 'dup' }).status).toBe('cancelled')
    expect(computeChittyTotals({ ...sampleData(), statusOverride: 'nil' }).status).toBe('nil')
    const t = computeChittyTotals(sampleData())
    expect(t.duePaise > 0).toBe(t.status !== 'nil')
  })
})
