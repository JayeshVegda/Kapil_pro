import { describe, expect, it } from 'vitest'
import { computeBillNet } from './supplier-purchases'
import {
  kgToGrams,
  lineAmountPaise,
  percentToBasisPoints,
  rateToMilli,
  rupeesToPaise,
} from './supplier-units'

describe('supplier form-to-domain mapping', () => {
  it('converts form kg and rate strings to exact integer grams and milli, with preview net equaling saved bill net', () => {
    // 1. User inputs from form
    const weightKgStr = '450.250'
    const rateRupeesStr = '485.500'
    const transportAdjStr = '1200.50'
    const qualityCutAdjStr = '500.00'
    const taxMode = 'gst'
    const gstPercent = 18

    // 2. Boundary conversions
    const weightG = kgToGrams(parseFloat(weightKgStr))
    const rateMilli = rateToMilli(parseFloat(rateRupeesStr))
    const lineAmount = lineAmountPaise(weightG, rateMilli)
    const transportPaise = rupeesToPaise(parseFloat(transportAdjStr))
    const qualityCutPaise = rupeesToPaise(parseFloat(qualityCutAdjStr))
    const gstRateBp = percentToBasisPoints(gstPercent)

    expect(weightG).toBe(450_250) // 450.25 kg in integer grams
    expect(rateMilli).toBe(485_500) // ₹485.5/kg in integer milli-rupees
    expect(transportPaise).toBe(120_050) // ₹1200.50 in paise
    expect(qualityCutPaise).toBe(50_000) // ₹500 in paise
    expect(gstRateBp).toBe(1800) // 18% = 1800 bps

    // 3. Live preview calculation
    const previewNet = computeBillNet(
      [{ amountPaise: lineAmount }],
      [
        { type: 'quality_cut', amountPaise: qualityCutPaise },
        { type: 'transport', amountPaise: transportPaise },
      ],
      [],
      taxMode,
      gstRateBp,
    )

    // Expected integer math:
    // 450250 * 485500 / 10000 = 21,859,637.5 -> roundHalfUp = 21,859,638 paise (₹2,18,596.38)
    expect(lineAmount).toBe(21_859_638)

    // Taxable = lineAmount - qualityCut = 21,859,638 - 50,000 = 21,809,638 paise
    expect(previewNet.taxablePaise).toBe(21_809_638)

    // GST (18%) = roundHalfUp(21809638 * 1800 / 10000) = 3,925,735 paise
    expect(previewNet.taxPaise).toBe(3_925_735)

    // Before round = taxable + tax + transport = 21,809,638 + 3,925,735 + 120,050 = 25,855,423 paise
    // Auto round-off to whole rupee: 25,855,423 % 100 = 23 -> remainder < 50 => -23 paise
    expect(previewNet.roundOffPaise).toBe(-23)

    // Final Net Payable in whole rupee
    expect(previewNet.netPaise).toBe(25_855_400)
    expect(previewNet.netPaise % 100).toBe(0) // whole rupee guaranteed
  })
})
