import { describe, expect, it } from 'vitest'
import { computeBardanPremium, makeVilaityLookup } from './supplier-market-premium'

const history = [
  { date: '2026-04-01', vilaityMilli: 860_000 },
  { date: '2026-04-04', vilaityMilli: 870_000 },
  { date: '2026-04-10', vilaityMilli: 880_000 },
]

describe('makeVilaityLookup', () => {
  it('exact day wins', () => {
    expect(makeVilaityLookup(history)('2026-04-04')).toBe(870_000)
  })
  it('nearest earlier day when the exact day is missing', () => {
    expect(makeVilaityLookup(history)('2026-04-03')).toBe(860_000)
    expect(makeVilaityLookup(history)('2026-04-09')).toBe(870_000)
  })
  it('unsorted history still works; nothing earlier returns null', () => {
    const shuffled = [{ date: '2026-04-04', vilaityMilli: 870_000 }, { date: '2026-04-01', vilaityMilli: 860_000 }]
    expect(makeVilaityLookup(shuffled)('2026-04-02')).toBe(860_000)
    expect(makeVilaityLookup(history)('2026-03-31')).toBeNull()
  })
})

describe('computeBardanPremium', () => {
  it('premium = (rate - vilaity) x kg, half-up in paise', () => {
    const result = computeBardanPremium(
      [{ bardanId: 'bd1', date: '2026-04-10', rateMilli: 890_000, weightG: 400_000 }],
      history,
    )
    // 400kg x (890-880 = 10 rupees/kg delta = 10_000 milli) = 4000 rupees = 400_000 paise
    expect(result.rows[0]).toMatchObject({ bardanId: 'bd1', vilaityMilli: 880_000, rateDeltaMilli: 10_000, premiumPaise: 400_000 })
    expect(result.totalPremiumPaise).toBe(400_000)
  })
  it('negative delta (supplier rate below market) gives negative premium', () => {
    const result = computeBardanPremium(
      [{ bardanId: 'bd2', date: '2026-04-04', rateMilli: 850_000, weightG: 100_000 }],
      history,
    )
    // 100kg x (850-870 = -20/kg) = -2000 rupees = -200_000 paise
    expect(result.rows[0].premiumPaise).toBe(-200_000)
    expect(result.totalPremiumPaise).toBe(-200_000)
  })
  it('no earlier vilaity row -> null rate and zero contribution to total', () => {
    const result = computeBardanPremium(
      [
        { bardanId: 'bd3', date: '2026-03-20', rateMilli: 900_000, weightG: 500_000 },
        { bardanId: 'bd4', date: '2026-04-01', rateMilli: 885_000, weightG: 200_000 },
      ],
      history,
    )
    expect(result.rows[0].vilaityMilli).toBeNull()
    expect(result.rows[0].premiumPaise).toBeNull()
    // bd4: 200kg x (885-860 = 25/kg) = 5000 rupees
    expect(result.rows[1].premiumPaise).toBe(500_000)
    expect(result.totalPremiumPaise).toBe(500_000)
  })
})
