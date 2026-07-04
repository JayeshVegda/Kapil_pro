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
