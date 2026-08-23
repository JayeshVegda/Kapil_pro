import { describe, expect, it } from 'vitest'
import { bestSalesDay, dayDotState, premiumTint } from './calendar-visuals'

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
