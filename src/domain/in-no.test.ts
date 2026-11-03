import { describe, expect, it } from 'vitest'
import { fiscalYearLabel, nextPurchaseInNo, parseInNo } from './in-no'

const existing = ['IN-2526-0007', 'IN-2526-0012', 'IN-2425-0099', 'junk', 'IN-2526-3']

describe('fiscal year label', () => {
  it('Apr-Dec anchors the FY on the date year', () => {
    expect(fiscalYearLabel('2025-04-01')).toBe('2526')
    expect(fiscalYearLabel('2025-12-31')).toBe('2526')
  })
  it('Jan-Mar anchors on the prior year', () => {
    expect(fiscalYearLabel('2026-01-05')).toBe('2526')
    expect(fiscalYearLabel('2026-03-31')).toBe('2526')
  })
})

describe('parseInNo', () => {
  it('accepts the canonical shape and a padded digit count of 1..6', () => {
    expect(parseInNo('IN-2526-0001')).toEqual({ fiscal: '2526', seq: 1 })
    expect(parseInNo('IN-2526-3')).toEqual({ fiscal: '2526', seq: 3 })
  })
  it('rejects junk and zero/negative sequences', () => {
    expect(parseInNo('junk')).toBeNull()
    expect(parseInNo('AB-2526-0001')).toBeNull()
  })
})

describe('nextPurchaseInNo', () => {
  it('starts at 0001 for a fresh FY', () => {
    expect(nextPurchaseInNo([], '2025-04-10')).toBe('IN-2526-0001')
  })
  it('continues from the max sequence of that FY', () => {
    expect(nextPurchaseInNo(existing, '2026-02-01')).toBe('IN-2526-0013')
  })
  it('FY wrap resets the sequence', () => {
    expect(nextPurchaseInNo(existing, '2026-04-05')).toBe('IN-2627-0001')
  })
  it('cancelled bills still count (gaps never back-filled)', () => {
    // 0012 cancelled: still consumed, next is 0013
    expect(nextPurchaseInNo(['IN-2526-0011', 'IN-2526-0012'], '2025-06-01')).toBe('IN-2526-0013')
  })
  it('ignores foreign-FY numbers when issuing', () => {
    expect(nextPurchaseInNo(['IN-2425-0099'], '2026-07-01')).toBe('IN-2627-0001')
  })
})
