import { describe, expect, it } from 'vitest'
import {
  applyBasisPoints,
  gramsToKgText,
  kgToGrams,
  lineAmountPaise,
  milliToRateText,
  percentToBasisPoints,
  paiseToRupeesText,
  rateToMilli,
  roundHalfUp,
  rupeesToPaise,
  sumPaise,
} from './supplier-units'

describe('supplier-units integer math', () => {
  it('spec check: 400.000kg x 880.000/kg = 35,200,000 paise', () => {
    expect(lineAmountPaise(400_000, 880_000)).toBe(35_200_000)
  })

  it('line amounts round half up across the 4-decimal boundary', () => {
    // 1.235 kg x ₹100.500/kg = 124.1175 rupees = 12_411.75 paise -> 12_412
    expect(lineAmountPaise(1_235, rateToMilli(100.5))).toBe(12_412)
    // exact division stays exact
    expect(lineAmountPaise(1_000, 100_000)).toBe(10_000)
    // rounding up above the half: 1.234kg x ₹100.500 = ₹124.017 = 12401.7 paise -> 12402
    expect(lineAmountPaise(1_234, 100_500)).toBe(12_402)
  })

  it('rate and weight conversions are integer-exact at 3 decimals', () => {
    expect(kgToGrams(400)).toBe(400_000)
    expect(kgToGrams(0.034)).toBe(34)
    expect(kgToGrams(12.345)).toBe(12_345)
    expect(rateToMilli(880)).toBe(880_000)
    expect(rateToMilli(890.5)).toBe(890_500)
    expect(rupeesToPaise(352000)).toBe(35_200_000)
    expect(rupeesToPaise(0.005)).toBe(1)
  })

  it('basis points convert from percent and apply proportionally', () => {
    expect(percentToBasisPoints(18)).toBe(1_800)
    expect(applyBasisPoints(35_200_000, 1_800)).toBe(6_336_000)
    // half up on the paise floor
    expect(applyBasisPoints(999_999, 500)).toBe(50_000) // 499999.5 -> 500000
  })

  it('roundHalfUp snaps half away from zero', () => {
    expect(roundHalfUp(2)).toBe(2)
  })

  it('roundHalfUp keeps integers exact and rejects non-finite input', () => {
    expect(roundHalfUp(12_345)).toBe(12_345)
    expect(roundHalfUp(Number.NaN)).toBe(0)
  })

  it('sumPaise is a plain exact integer sum', () => {
    expect(sumPaise([10_000, 20_000, -5_000])).toBe(25_000)
  })

  it('display helpers render 3-decimal kg, 3-decimal rate and 2-decimal rupees', () => {
    expect(gramsToKgText(400_000)).toBe('400.000')
    expect(gramsToKgText(34)).toBe('0.034')
    expect(milliToRateText(880_000)).toBe('880.000')
    expect(paiseToRupeesText(35_200_000)).toBe('352000.00')
    expect(paiseToRupeesText(-1500)).toBe('-15.00')
  })
})
