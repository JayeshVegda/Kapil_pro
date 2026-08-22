import { describe, expect, it } from 'vitest'
import { parseSmartDate } from '@/lib/date'

const TODAY = '2026-07-26'

describe('parseSmartDate', () => {
  it('takes a bare day as this month', () => {
    expect(parseSmartDate('13', TODAY)).toBe('2026-07-13')
    expect(parseSmartDate('1', TODAY)).toBe('2026-07-01')
    expect(parseSmartDate('31', TODAY)).toBe('2026-07-31')
  })

  it('takes day-month as this year', () => {
    expect(parseSmartDate('13-6', TODAY)).toBe('2026-06-13')
    expect(parseSmartDate('5/2', TODAY)).toBe('2026-02-05')
    expect(parseSmartDate('05.02', TODAY)).toBe('2026-02-05')
  })

  it('swaps day and month when the month slot is impossible', () => {
    expect(parseSmartDate('1-31', TODAY)).toBe('2026-01-31')
    expect(parseSmartDate('2-25', TODAY)).toBe('2026-02-25')
  })

  it('expands two-digit years', () => {
    expect(parseSmartDate('13-6-25', TODAY)).toBe('2025-06-13')
    expect(parseSmartDate('1-1-24', TODAY)).toBe('2024-01-01')
  })

  it('accepts full dates as written', () => {
    expect(parseSmartDate('13-06-2026', TODAY)).toBe('2026-06-13')
    expect(parseSmartDate('31/12/2025', TODAY)).toBe('2025-12-31')
  })

  it('rejects impossible dates', () => {
    expect(parseSmartDate('32', TODAY)).toBe('')
    expect(parseSmartDate('31-2', TODAY)).toBe('')
    expect(parseSmartDate('0-5', TODAY)).toBe('')
    expect(parseSmartDate('abc', TODAY)).toBe('')
    expect(parseSmartDate('', TODAY)).toBe('')
  })

  it('respects month length for bare days', () => {
    expect(parseSmartDate('31', '2026-06-15')).toBe('')
    expect(parseSmartDate('30', '2026-06-15')).toBe('2026-06-30')
    expect(parseSmartDate('29-2-24', TODAY)).toBe('2024-02-29')
    expect(parseSmartDate('29-2-25', TODAY)).toBe('')
  })
})
