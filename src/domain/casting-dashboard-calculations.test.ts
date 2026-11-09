import { describe, expect, it } from 'vitest'
import {
  computeSafeRecoveryAndWastage,
  aggregateCastingMaterials,
  buildCastingMonthlyTrendPoints,
  computeOperationalAverages,
} from './casting-dashboard-calculations'
import type { CastingSessionWithInputs } from './casting-types'

describe('computeSafeRecoveryAndWastage', () => {
  it('returns valid percentages when input exceeds wire and loss', () => {
    const res = computeSafeRecoveryAndWastage(950, 50, 1000)
    expect(res.recoveryPct).toBe(95)
    expect(res.wastagePct).toBe(5)
    expect(res.effectiveBaseKg).toBe(1000)
  })

  it('bounds percentages safely when input is smaller than wire out', () => {
    // e.g. wireOut = 1329.25, wastage = 63, recorded input was 820
    const res = computeSafeRecoveryAndWastage(1329.25, 63, 820)
    expect(res.recoveryPct).toBeLessThanOrEqual(100)
    expect(res.wastagePct).toBeLessThanOrEqual(100)
    expect((res.recoveryPct ?? 0) + (res.wastagePct ?? 0)).toBeCloseTo(100, 1)
  })

  it('handles zero values cleanly without NaN or division by zero', () => {
    const res = computeSafeRecoveryAndWastage(0, 0, 0)
    expect(res.recoveryPct).toBeNull()
    expect(res.wastagePct).toBeNull()
  })
})

describe('aggregateCastingMaterials', () => {
  it('aggregates materials correctly across batches and calculates percentages', () => {
    const sessions = [
      {
        id: 's1',
        inputs: [
          { id: 'i1', sessionId: 's1', materialName: 'Brass Scrap', qty: 100, rate: 800, amount: 80000 },
          { id: 'i2', sessionId: 's1', materialName: 'Zinc', qty: 20, rate: 300, amount: 6000 },
        ],
      },
      {
        id: 's2',
        inputs: [
          { id: 'i3', sessionId: 's2', materialName: 'Brass Scrap', qty: 200, rate: 820, amount: 164000 },
          { id: 'i4', sessionId: 's2', materialName: 'Lead', qty: 10, rate: 250, amount: 2500 },
        ],
      },
    ] as unknown as CastingSessionWithInputs[]

    const res = aggregateCastingMaterials(sessions)
    expect(res).toHaveLength(3)
    expect(res[0].name).toBe('Brass Scrap')
    expect(res[0].qty).toBe(300)
    expect(res[0].amount).toBe(244000)
    expect(res[0].avgRate).toBeCloseTo(813.33, 1)
    expect(res[0].pct).toBeCloseTo(90.9, 1) // 300 / 330
  })
})

describe('buildCastingMonthlyTrendPoints', () => {
  it('builds aligned 6-month points with correct weighted loaded cost', () => {
    const sessions = [
      {
        id: 's1',
        date: '2026-06-10',
        unit: 2,
        totalInputKg: 500,
        totalWireOut: 600,
        totalMel: 20,
        costPerKg: 780,
      },
      {
        id: 's2',
        date: '2026-06-20',
        unit: 2,
        totalInputKg: 500,
        totalWireOut: 400,
        totalMel: 15,
        costPerKg: 800,
      },
    ] as unknown as CastingSessionWithInputs[]

    const points = buildCastingMonthlyTrendPoints(sessions, ['2026-05', '2026-06'], {
      '2026-06': 850,
    })

    expect(points).toHaveLength(2)
    const june = points[1]
    expect(june.month).toBe('2026-06')
    expect(june.wireOutKg).toBe(1000)
    expect(june.metalInKg).toBe(1000)
    expect(june.wastageKg).toBe(35)
    // weighted cost: (780*600 + 800*400) / 1000 = (468000 + 320000) / 1000 = 788
    expect(june.loadedCostKg).toBe(788)
    expect(june.marketRate).toBe(850)
  })
})

describe('computeOperationalAverages', () => {
  it('calculates averages per batch safely', () => {
    const summary = {
      batches: 4,
      wire: 1200,
      wastage: 40,
      totalCoalKg: 800,
      totalWorkerSalary: 24000,
    } as any

    const res = computeOperationalAverages(summary)
    expect(res.avgWirePerBatch).toBe(300)
    expect(res.avgLossPerBatch).toBe(10)
    expect(res.avgCoalPerBatch).toBe(200)
    expect(res.avgWagePerBatch).toBe(6000)
  })
})
