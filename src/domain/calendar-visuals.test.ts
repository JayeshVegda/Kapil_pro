import { describe, expect, it } from 'vitest'
import type { GasSalesMetrics } from './gas-sales-reporting'
import type { MonthlyItemComparisons } from './monthly-item-rollup'
import { bestSalesDay, buildRateSeries, dayDotState, premiumTint, topMover } from './calendar-visuals'

function gasMetrics(overrides: Partial<GasSalesMetrics> = {}): GasSalesMetrics {
  return {
    sales: 0,
    kg: 0,
    bags: 0,
    billCount: 0,
    weightedSellingRate: null,
    weightedMarketRate: null,
    premiumPerKg: null,
    premiumPct: null,
    ...overrides,
  }
}

function comparisons(spindle75 = 0, spindle85 = 0, tapperPlug = 0): MonthlyItemComparisons {
  const metric = (bags: number) => ({ bags, kg: 0, partyCount: 0, previousBags: Math.max(bags - 5, 0), previousKg: 0, previousPartyCount: 0 })
  return { spindle: metric(spindle75 + spindle85), spindle75: metric(spindle75), spindle85: metric(spindle85), tapperPlug: metric(tapperPlug) }
}

describe('dayDotState', () => {
  it('is null when there were no sales', () => {
    expect(dayDotState(0, 500)).toBeNull()
    expect(dayDotState(0, 0)).toBeNull()
  })
  it('marks fully covered days and partial shortfalls', () => {
    expect(dayDotState(10_000, 10_000)).toBe('covered')
    expect(dayDotState(10_000, 12_000)).toBe('covered')
    expect(dayDotState(10_000, 4_000)).toBe('partial')
  })
})

describe('premiumTint', () => {
  it('returns no tint for unknown or zero premium', () => {
    expect(premiumTint(null)).toBe('')
    expect(premiumTint(undefined)).toBe('')
    expect(premiumTint(0)).toBe('')
  })
  it('scales green above market and rose below, capped at strongest step', () => {
    expect(premiumTint(20)).toBe('bg-emerald-50/70')
    expect(premiumTint(80)).toBe('bg-emerald-100/70')
    expect(premiumTint(140)).toBe('bg-emerald-200/70')
    expect(premiumTint(999)).toBe('bg-emerald-200/70')
    expect(premiumTint(-20)).toBe('bg-rose-50/70')
    expect(premiumTint(-140)).toBe('bg-rose-200/70')
    expect(premiumTint(-999)).toBe('bg-rose-200/70')
  })
})

describe('buildRateSeries', () => {
  it('produces one point per calendar day, never faking market rate', () => {
    const dailyGasByDate = new Map([
      ['2026-02-03', gasMetrics({ weightedSellingRate: 1000, weightedMarketRate: 900, premiumPerKg: 100 })],
      ['2026-02-04', gasMetrics({ weightedSellingRate: 1010, weightedMarketRate: null, premiumPerKg: null })],
    ])
    const rateByDate = new Map([['2026-02-06', 875]])
    const series = buildRateSeries(dailyGasByDate, rateByDate, '2026-02')

    expect(series).toHaveLength(28)
    expect(series[2]).toEqual({ day: 3, selling: 1000, market: 900, premium: 100 })
    // Selling known but market unknown -> both stay honest.
    expect(series[3]).toEqual({ day: 4, selling: 1010, market: null, premium: null })
    // Gas metrics absent entirely -> recorded rate stands in as the selling level only.
    expect(series[5]).toEqual({ day: 6, selling: 875, market: null, premium: null })
    expect(series[0].selling).toBeNull()
  })
})

describe('topMover', () => {
  it('picks the family with the most bags and reports its delta', () => {
    const mover = topMover(comparisons(18, 134, 28))
    expect(mover).toEqual({ label: 'Spindle 8.5GM', bags: 134, deltaBags: 5 })
  })
  it('is null with no activity', () => {
    expect(topMover(comparisons())).toBeNull()
  })
})

describe('bestSalesDay', () => {
  it('finds the peak day inside the month only', () => {
    const dailySales = new Map([
      ['2026-08-05', 50_000],
      ['2026-08-20', 90_000],
      ['2026-08-11', 70_000],
      ['2026-07-30', 500_000],
    ])
    expect(bestSalesDay(dailySales, '2026-08')).toEqual({ day: 20, sales: 90_000 })
  })
  it('is null with no sales', () => {
    expect(bestSalesDay(new Map(), '2026-08')).toBeNull()
  })
})
