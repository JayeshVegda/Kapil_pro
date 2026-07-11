import { describe, expect, it } from 'vitest'
import {
  calculateBillingLineBags,
  calculateGasDefaultRateFromFinal,
  calculateGasFinalRate,
  getBillingUnit,
  suggestBillingRate,
} from '@/domain/billing-modes'

describe('billing modes', () => {
  it('treats gas items as kg with market-margin rates and bags', () => {
    const item = { type: 'gas', unit: 'kg', bagWeight: 50, defaultRate: 135 }

    expect(getBillingUnit(item)).toBe('kg')
    expect(calculateBillingLineBags({ qty: 250, item })).toBe(5)
    expect(calculateGasFinalRate(135, 802, 'none')).toBe(937)
    expect(calculateGasDefaultRateFromFinal(937, 802, 0)).toBe(135)
  })

  it('uses last gas bill margin against the current market rate', () => {
    const suggested = suggestBillingRate({
      item: { type: 'gas', unit: 'kg', bagWeight: 50, defaultRate: 110 },
      mktRate: 801,
      gstMode: 'none',
      lastRate: { rate: 937, mktRate: 802, gstRate: 0 },
    })

    expect(suggested).toEqual({
      defaultRate: 135,
      rate: 936,
      rateBasis: 'market_margin',
    })
  })

  it('treats electronic items as pieces with direct unit price and no bags', () => {
    const item = { type: 'electronic', unit: 'piece', defaultRate: 0 }
    const suggested = suggestBillingRate({
      item,
      mktRate: 801,
      gstMode: 'none',
      lastRate: { rate: 4.35, mktRate: 801, gstRate: 0 },
    })

    expect(getBillingUnit(item)).toBe('piece')
    expect(calculateBillingLineBags({ qty: 40_000, item })).toBe(0)
    expect(suggested).toEqual({
      defaultRate: 4.35,
      rate: 4.35,
      rateBasis: 'unit_price',
    })
  })
})

