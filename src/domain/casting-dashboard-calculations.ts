import type { CastingSessionWithInputs } from '@/domain/casting-types'
import type { CastingSessionsSummary } from '@/domain/casting-calculations'

export type SafeFurnaceYield = {
  recoveryPct: number | null
  wastagePct: number | null
  effectiveBaseKg: number
}

/**
 * Computes safe furnace recovery % and wastage % bounded to 0-100%.
 * Prevents impossible percentages (>100%) when demo/legacy inputs are incomplete.
 */
export function computeSafeRecoveryAndWastage(
  wireOut: number,
  wastageMel: number,
  inputKg: number,
): SafeFurnaceYield {
  const safeWire = Math.max(0, Number(wireOut) || 0)
  const safeLoss = Math.max(0, Number(wastageMel) || 0)
  const safeInput = Math.max(0, Number(inputKg) || 0)

  if (safeWire === 0 && safeLoss === 0 && safeInput === 0) {
    return { recoveryPct: null, wastagePct: null, effectiveBaseKg: 0 }
  }

  // If input matches or exceeds total mass out, use inputKg as base
  if (safeInput >= safeWire + safeLoss && safeInput > 0) {
    const recoveryPct = Math.min(100, Math.max(0, (safeWire / safeInput) * 100))
    const wastagePct = Math.min(100, Math.max(0, (safeLoss / safeInput) * 100))
    return {
      recoveryPct: Number(recoveryPct.toFixed(1)),
      wastagePct: Number(wastagePct.toFixed(1)),
      effectiveBaseKg: safeInput,
    }
  }

  // Otherwise, use total mass accounted for (wire + loss) to guarantee valid physics
  const totalAccounted = safeWire + safeLoss
  if (totalAccounted <= 0) {
    return { recoveryPct: null, wastagePct: null, effectiveBaseKg: 0 }
  }

  const recoveryPct = (safeWire / totalAccounted) * 100
  const wastagePct = (safeLoss / totalAccounted) * 100
  return {
    recoveryPct: Number(recoveryPct.toFixed(1)),
    wastagePct: Number(wastagePct.toFixed(1)),
    effectiveBaseKg: totalAccounted,
  }
}

export type CastingMaterialUsage = {
  name: string
  qty: number
  amount: number
  avgRate: number
  pct: number
}

/**
 * Aggregates all input materials charged into the furnace across sessions.
 */
export function aggregateCastingMaterials(
  sessions: readonly CastingSessionWithInputs[],
): CastingMaterialUsage[] {
  const map = new Map<string, { qty: number; amount: number }>()

  for (const s of sessions) {
    for (const input of s.inputs ?? []) {
      const name = (input.materialName ?? '').trim() || 'Unknown'
      const qty = Math.max(0, Number(input.qty) || 0)
      const amount = Math.max(0, Number(input.amount) || qty * (Number(input.rate) || 0))
      const curr = map.get(name) ?? { qty: 0, amount: 0 }
      curr.qty += qty
      curr.amount += amount
      map.set(name, curr)
    }
  }

  const totalQty = Array.from(map.values()).reduce((sum, v) => sum + v.qty, 0)

  return Array.from(map.entries())
    .map(([name, data]) => {
      const avgRate = data.qty > 0 ? data.amount / data.qty : 0
      const pct = totalQty > 0 ? (data.qty / totalQty) * 100 : 0
      return {
        name,
        qty: data.qty,
        amount: data.amount,
        avgRate: Number(avgRate.toFixed(2)),
        pct: Number(pct.toFixed(1)),
      }
    })
    .sort((a, b) => b.qty - a.qty)
}

export type CastingMonthlyTrendPoint = {
  month: string
  wireOutKg: number
  metalInKg: number
  wastageKg: number
  loadedCostKg: number
  marketRate: number | null
  batches: number
  daysRunning: number
}

/**
 * Builds aligned 6-month casting trend with wire out, metal in, loaded cost, and market benchmark.
 */
export function buildCastingMonthlyTrendPoints(
  sessions: readonly CastingSessionWithInputs[],
  months: readonly string[],
  marketRatesMap: Record<string, number | null>,
): CastingMonthlyTrendPoint[] {
  const grouped = new Map<string, CastingSessionWithInputs[]>()
  for (const s of sessions) {
    if (!s.date) continue
    const m = s.date.slice(0, 7)
    const list = grouped.get(m) ?? []
    list.push(s)
    grouped.set(m, list)
  }

  return months.map((month) => {
    const rows = grouped.get(month) ?? []
    const days = new Set<string>()
    let batches = 0
    let metalInKg = 0
    let wireOutKg = 0
    let wastageKg = 0
    let loadedCostSum = 0

    for (const r of rows) {
      if (r.date) days.add(r.date)
      batches += Number(r.unit) || (r.batches?.length ?? 0)
      metalInKg += Number(r.totalInputKg) || 0
      wireOutKg += Number(r.totalWireOut) || Number(r.wireOut) || 0
      wastageKg += Number(r.totalMel) || Number(r.wastage) || 0
      const cost = Number(r.costPerKg) || 0
      const wire = Number(r.totalWireOut) || Number(r.wireOut) || 0
      loadedCostSum += cost * wire
    }

    const loadedCostKg = wireOutKg > 0 ? loadedCostSum / wireOutKg : 0
    const marketRate = marketRatesMap[month] ?? null

    return {
      month,
      wireOutKg: Math.round(wireOutKg),
      metalInKg: Math.round(metalInKg),
      wastageKg: Math.round(wastageKg),
      loadedCostKg: Number(loadedCostKg.toFixed(2)),
      marketRate: marketRate != null ? Number(marketRate.toFixed(2)) : null,
      batches,
      daysRunning: days.size,
    }
  })
}

export type OperationalBatchAverages = {
  avgWirePerBatch: number
  avgLossPerBatch: number
  avgCoalPerBatch: number
  avgWagePerBatch: number
}

/**
 * Computes per-batch efficiency ratios for foundry operations.
 */
export function computeOperationalAverages(
  summary: CastingSessionsSummary,
): OperationalBatchAverages {
  const b = summary.batches > 0 ? summary.batches : 0
  if (b === 0) {
    return {
      avgWirePerBatch: 0,
      avgLossPerBatch: 0,
      avgCoalPerBatch: 0,
      avgWagePerBatch: 0,
    }
  }

  return {
    avgWirePerBatch: Number((summary.wire / b).toFixed(1)),
    avgLossPerBatch: Number((summary.wastage / b).toFixed(1)),
    avgCoalPerBatch: Number((summary.totalCoalKg / b).toFixed(1)),
    avgWagePerBatch: Math.round(summary.totalWorkerSalary / b),
  }
}
