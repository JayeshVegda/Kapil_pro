import { describe, expect, it } from 'vitest'
import { normalizeBrassRateHistory, summarizeBrassSeries } from './brass-rate-report'

describe('Brass Rate report', () => {
  it('normalizes business dates and keeps missing or zero quotes out of period calculations', () => {
    const days = normalizeBrassRateHistory([
      { date: '2026-11-18 00:00:00.000Z', vilaity: 825, honey_gulf: 0 },
      { date: '2026-11-14', vilaity: '800', honey_gulf: 810 },
      { date: '2026-11-17', vilaity: 805, honey_gulf: 0 },
      { date: '2026-11-18', honey_gulf: '815' },
      { date: '2026-02-30', vilaity: 999 },
    ])
    expect(days.map(({ date }) => date)).toEqual(['2026-11-14', '2026-11-17', '2026-11-18'])
    expect(summarizeBrassSeries(days, 'vilaity')).toMatchObject({ average: 810, low: 800, high: 825, change: 25 })
    const gulf = summarizeBrassSeries(days, 'honey_gulf')
    expect(gulf.points.map(({ date, rate }) => [date, rate])).toEqual([['2026-11-14', 810], ['2026-11-18', 815]])
    expect(gulf.points[1].time - gulf.points[0].time).toBe(4 * 86_400_000)
  })

  it('does not invent a change for a single quote or an unavailable series', () => {
    const days = normalizeBrassRateHistory([{ date: '2026-11-18', vilaity: 825 }])
    expect(summarizeBrassSeries(days, 'vilaity').change).toBeNull()
    expect(summarizeBrassSeries(days, 'mcx_copper')).toMatchObject({ points: [], average: null, change: null })
  })
})
