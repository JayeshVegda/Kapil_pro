export type CastingInputRow = {
  materialName: string
  qty: number
  rate: number
}

export type CastingBatchInputRow = CastingInputRow

export type CastingBatchCostInput = {
  batchNumber: number
  wireOut: number
  mel: number
  inputs: CastingBatchInputRow[]
}

export type CastingPerMaterialBreakdown = {
  materialName: string
  qty: number
  rate: number
  amount: number
}

export type CastingCostResult = {
  totalInputKg: number
  totalInputCost: number
  totalWireOut: number
  totalMel: number
  coalTotal: number
  workerSalary: number
  /** totalInputCost / totalInputKg, or 0 when totalInputKg is 0 */
  metalCostPerKg: number
  coalCostPerKg: number
  workerCostPerKg: number
  finalCastingCostPerKg: number
  baravoCostPerKg: number
  overhead1Kg: number
  overhead2Kg: number
  finalProductCostPerKg: number
  /** Backward-compatible alias for finalCastingCostPerKg. */
  costPerKg: number
  perMaterial: CastingPerMaterialBreakdown[]
}

type CastingCostParams = {
  batches: CastingBatchCostInput[]
  coalKg?: number
  coalRate?: number
  workerSalary?: number
}

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function flattenInputs(input: CastingInputRow[] | CastingCostParams): CastingInputRow[] {
  if (Array.isArray(input)) return input
  return input.batches.flatMap((batch) => batch.inputs)
}

export function calculateCastingCost(input: CastingInputRow[] | CastingCostParams): CastingCostResult {
  const inputs = flattenInputs(input)
  const totalWireOut = Array.isArray(input) ? 0 : input.batches.reduce((sum, batch) => sum + safeNumber(batch.wireOut), 0)
  const totalMel = Array.isArray(input) ? 0 : input.batches.reduce((sum, batch) => sum + safeNumber(batch.mel), 0)
  const coalKg = Array.isArray(input) ? 0 : safeNumber(input.coalKg)
  const coalRate = Array.isArray(input) ? 0 : safeNumber(input.coalRate)
  const workerSalary = Array.isArray(input) ? 0 : safeNumber(input.workerSalary)

  const perMaterial: CastingPerMaterialBreakdown[] = inputs.map((row) => {
    const qty = safeNumber(row.qty)
    const rate = safeNumber(row.rate)
    const amount = qty * rate
    return {
      materialName: String(row.materialName ?? '').trim(),
      qty,
      rate,
      amount,
    }
  })

  const totalInputKg = perMaterial.reduce((a, r) => a + r.qty, 0)
  const totalInputCost = perMaterial.reduce((a, r) => a + r.amount, 0)
  const metalCostPerKg = totalInputKg > 0 ? totalInputCost / totalInputKg : 0
  const coalTotal = coalKg * coalRate
  const coalCostPerKg = totalWireOut > 0 ? coalTotal / totalWireOut : 0
  const workerCostPerKg = totalWireOut > 0 ? workerSalary / totalWireOut : 0
  const finalCastingCostPerKg = metalCostPerKg + coalCostPerKg + workerCostPerKg
  const baravoCostPerKg = metalCostPerKg * 0.075
  const overhead1Kg = baravoCostPerKg + coalCostPerKg + workerCostPerKg
  const overhead2Kg = overhead1Kg * 2
  const finalProductCostPerKg = metalCostPerKg + overhead2Kg

  return {
    totalInputKg,
    totalInputCost,
    totalWireOut,
    totalMel,
    coalTotal,
    workerSalary,
    metalCostPerKg,
    coalCostPerKg,
    workerCostPerKg,
    finalCastingCostPerKg,
    baravoCostPerKg,
    overhead1Kg,
    overhead2Kg,
    finalProductCostPerKg,
    costPerKg: finalCastingCostPerKg || metalCostPerKg,
    perMaterial,
  }
}

export type CastingSessionSummaryRow = {
  id?: string
  date: string
  unit: number
  totalInputKg: number
  totalInputCost: number
  wireOut: number
  wastage: number
  cholIn: number
  costPerKg: number
  coalKg: number
  coalRate: number
  workerSalary: number
}

export type CastingSessionsSummary = {
  daysRunning: number
  batches: number
  count: number
  kg: number
  wire: number
  wastage: number
  cholIn: number
  totalCost: number
  totalCoalKg: number
  totalCoalCost: number
  totalWorkerSalary: number
  avgCostKg: number
  avgLoadedCostKg: number
}

export function summarizeCastingSessions(sessions: readonly CastingSessionSummaryRow[]): CastingSessionsSummary {
  const runningDays = new Set<string>()
  let batches = 0
  let kg = 0
  let wire = 0
  let wastage = 0
  let cholIn = 0
  let totalCost = 0
  let totalCoalKg = 0
  let totalCoalCost = 0
  let totalWorkerSalary = 0
  let loadedCostSum = 0

  for (const s of sessions) {
    if (s.date) runningDays.add(s.date)
    batches += safeNumber(s.unit)
    kg += safeNumber(s.totalInputKg)
    wire += safeNumber(s.wireOut)
    wastage += safeNumber(s.wastage)
    cholIn += safeNumber(s.cholIn)
    totalCost += safeNumber(s.totalInputCost)
    totalCoalKg += safeNumber(s.coalKg)
    totalCoalCost += safeNumber(s.coalKg) * safeNumber(s.coalRate)
    totalWorkerSalary += safeNumber(s.workerSalary)
    loadedCostSum += safeNumber(s.costPerKg) * safeNumber(s.wireOut)
  }

  const avgCostKg = kg > 0 ? totalCost / kg : 0
  const avgLoadedCostKg = wire > 0 ? loadedCostSum / wire : 0

  return {
    daysRunning: runningDays.size,
    batches,
    count: sessions.length,
    kg,
    wire,
    wastage,
    cholIn,
    totalCost,
    totalCoalKg,
    totalCoalCost,
    totalWorkerSalary,
    avgCostKg,
    avgLoadedCostKg,
  }
}

export function buildMonthlyCastingTrend(
  sessions: readonly CastingSessionSummaryRow[],
  monthsCount = 6,
): Array<{ month: string } & CastingSessionsSummary> {
  const grouped = new Map<string, CastingSessionSummaryRow[]>()
  for (const s of sessions) {
    if (!s.date) continue
    const m = s.date.slice(0, 7)
    const list = grouped.get(m) ?? []
    list.push(s)
    grouped.set(m, list)
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-monthsCount)
    .map(([month, rows]) => ({
      month,
      ...summarizeCastingSessions(rows),
    }))
}

export function findBestWorstCastingSessions<T extends { costPerKg: number }>(
  sessions: readonly T[],
): { best: T | null; worst: T | null } {
  const usable = sessions.filter((s) => s.costPerKg > 0).sort((a, b) => a.costPerKg - b.costPerKg)
  return {
    best: usable[0] ?? null,
    worst: usable[usable.length - 1] ?? null,
  }
}

