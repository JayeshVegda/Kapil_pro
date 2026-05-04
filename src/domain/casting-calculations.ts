export type CastingInputRow = {
  materialName: string
  qty: number
  rate: number
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
  /** totalInputCost / totalInputKg, or 0 when totalInputKg is 0 */
  costPerKg: number
  perMaterial: CastingPerMaterialBreakdown[]
}

export function calculateCastingCost(inputs: CastingInputRow[]): CastingCostResult {
  const perMaterial: CastingPerMaterialBreakdown[] = inputs.map((row) => {
    const qty = Number.isFinite(row.qty) ? row.qty : 0
    const rate = Number.isFinite(row.rate) ? row.rate : 0
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
  const costPerKg = totalInputKg > 0 ? totalInputCost / totalInputKg : 0

  return { totalInputKg, totalInputCost, costPerKg, perMaterial }
}
