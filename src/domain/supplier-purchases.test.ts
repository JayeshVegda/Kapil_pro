import { describe, expect, it } from 'vitest'
import { computeBillNet } from './supplier-purchases'
import { lineAmountPaise } from './supplier-units'

describe('computeBillNet', () => {
  it('GST mode adds tax computed on taxable value after bardan deduct and quality cuts', () => {
    // lines: 100,000.00 paise total (i.e. ₹1,00,000) -> 10_000_000 paise
    const lines = [{ amountPaise: 10_000_000 }]
    const bardan = [{ method: 'deduct', creditPaise: 1_000_000 }] // ₹10,000 bag credit
    const adjustments = [{ type: 'quality_cut', amountPaise: 500_000 }] // ₹5,000
    const result = computeBillNet(lines, adjustments, bardan, 'gst', 1_800)
    expect(result.taxablePaise).toBe(8_500_000)
    expect(result.taxPaise).toBe(1_530_000) // 18% of 8,500,00.00
    expect(result.rcmLiabilityPaise).toBe(0)
    expect(result.otherAdjustmentsPaise).toBe(0)
    expect(result.roundOffPaise).toBe(0)
    expect(result.netPaise).toBe(10_030_000) // 8.5M + 1.53M
  })

  it('RCM mode reports tax as liability but excludes it from supplier payable', () => {
    const result = computeBillNet([{ amountPaise: 10_000_000 }], [], [], 'rcm', 1_800)
    expect(result.taxPaise).toBe(1_800_000)
    expect(result.rcmLiabilityPaise).toBe(1_800_000)
    expect(result.netPaise).toBe(10_000_000) // no tax added
  })

  it('none mode has no tax regardless of rate', () => {
    const result = computeBillNet([{ amountPaise: 10_000_000 }], [], [{ method: 'deduct', creditPaise: 300_000 }], 'none', 1_800)
    expect(result.taxPaise).toBe(0)
    expect(result.rcmLiabilityPaise).toBe(0)
    expect(result.taxablePaise).toBe(9_700_000)
    expect(result.netPaise).toBe(9_700_000)
  })

  it('cash_back and in_kind bardan never touch the payable, advance neither', () => {
    const plain = computeBillNet([{ amountPaise: 5_000_000 }], [], [], 'none', 0).netPaise
    const withEverything = computeBillNet(
      [{ amountPaise: 5_000_000 }],
      [],
      [
        { method: 'in_kind', creditPaise: 0, cashAmountPaise: 0 },
        { method: 'cash_back', creditPaise: 0, cashAmountPaise: 250_000 },
        { method: 'advance', creditPaise: 0 },
      ],
      'none',
      0,
    )
    expect(withEverything.netPaise).toBe(plain)
    expect(withEverything.bardanDeductPaise).toBe(0)
  })

  it('only deduct bardan lowers taxable value (and therefore GST tax)', () => {
    const withoutBardan = computeBillNet([{ amountPaise: 10_000_000 }], [], [], 'gst', 1_800)
    const withBardan = computeBillNet([{ amountPaise: 10_000_000 }], [], [{ method: 'deduct', creditPaise: 1_000_000 }], 'gst', 1_800)
    expect(withoutBardan.taxablePaise).toBe(10_000_000)
    expect(withoutBardan.taxPaise).toBe(1_800_000)
    expect(withBardan.taxablePaise).toBe(9_000_000)
    expect(withBardan.taxPaise).toBe(1_620_000) // 40,000 paise lower
  })

  it('round-off is always computed here so the net is a whole rupee', () => {
    // taxable 1,23,456.78 -> 12_345_678 paise? (that's ₹1,23,456.78)
    const result = computeBillNet([{ amountPaise: 12_345_999 }], [], [], 'none', 0)
    expect(result.netPaise).toBe(12_346_000)
    expect(result.roundOffPaise).toBe(1) // remainder 99 -> nearest rupee up
    expect(result.netPaise % 100).toBe(0)
    // nearest-rounding down: .49 -> down 49 paise
    expect(computeBillNet([{ amountPaise: 12_346_049 }], [], [], 'none', 0).roundOffPaise).toBe(-49)
    // exact .50 half-up: up 50 paise
    expect(computeBillNet([{ amountPaise: 12_346_050 }], [], [], 'none', 0).roundOffPaise).toBe(50)
  })

  it('other adjustments apply after tax and round-off lands after them', () => {
    // taxable 9M (10M - 1M deduct), tax 1.62M, labour +50,000, transport -20,000
    const result = computeBillNet(
      [{ amountPaise: 10_000_000 }],
      [{ type: 'labour', amountPaise: 50_000 }, { type: 'transport', amountPaise: -20_000 }],
      [{ method: 'deduct', creditPaise: 1_000_000 }],
      'gst',
      1_800,
    )
    expect(result.otherAdjustmentsPaise).toBe(30_000)
    expect(result.netPaise).toBe(10_650_000)
  })

  it('quality_cut is treated as a deduction while signed negatives lower the payable', () => {
    const result = computeBillNet(
      [{ amountPaise: 3_000_000 }],
      [{ type: 'quality_cut', amountPaise: 250_000 }, { type: 'other', amountPaise: -100_000 }],
      [],
      'none',
      0,
    )
    expect(result.taxablePaise).toBe(2_750_000)
    expect(result.netPaise).toBe(2_650_000)
  })

  it('taxable is floored at zero when cuts exceed the line total', () => {
    const result = computeBillNet(
      [{ amountPaise: 1_000_000 }],
      [{ type: 'quality_cut', amountPaise: 2_000_000 }],
      [],
      'gst',
      1_800,
    )
    expect(result.taxablePaise).toBe(0)
    expect(result.taxPaise).toBe(0)
    expect(result.netPaise).toBe(0)
  })

  it('spec scenario: 400.000 kg of brass at 880.000 produces ₹3,52,000 net', () => {
    const amount = lineAmountPaise(400_000, 880_000) // 35_200_000 paise
    const result = computeBillNet([{ amountPaise: amount }], [], [], 'none', 0)
    expect(result.netPaise).toBe(35_200_000)
  })
})
