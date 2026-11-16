import { expect, it } from 'vitest'
import { calculateCastingCost } from './casting-calculations'

it('uses the chitty Brass rate for new ready cost and keeps the historical formula', () => {
  const input = {
    batches: [{ batchNumber: 1, wireOut: 100, mel: 0, inputs: [
      { materialName: 'Brass', qty: 50, rate: 400 },
      { materialName: 'Brass', qty: 50, rate: 600 },
      { materialName: 'Lead', qty: 100, rate: 200 },
    ] }], coalKg: 10, coalRate: 10, workerSalary: 200,
  }
  const current = calculateCastingCost({ ...input, formulaVersion: 2 })
  expect(current.metalCostPerKg).toBe(350)
  expect(current.brassRatePerKg).toBe(500) // same weighted rate as the chitty's Brass line
  expect(current.baravoCostPerKg).toBe(35)
  expect(current.coalCostPerKg).toBe(1)
  expect(current.workerCostPerKg).toBe(2)
  expect(current.finalProductCostPerKg).toBe(426) // 350 + 2×35 + 2×1 + 2×2

  const historical = calculateCastingCost({ ...input, formulaVersion: 1 })
  expect(historical.baravoCostPerKg).toBe(26.25) // old 7.5% of averaged metal cost
  expect(historical.finalProductCostPerKg).toBe(408.5)
  expect(historical.finalCastingCostPerKg).toBe(current.finalCastingCostPerKg)
  const noBrass = calculateCastingCost({ ...input, formulaVersion: 2, batches: [{ ...input.batches[0], inputs: [{ materialName: 'Lead', qty: 100, rate: 200 }] }] })
  expect(noBrass.brassRatePerKg).toBe(0)
  expect(noBrass.baravoCostPerKg).toBe(0)
})
