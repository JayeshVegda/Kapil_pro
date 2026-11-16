import { z } from 'zod'
import { matchPurchaseMaster, parsePurchaseDecimal } from './purchase-bill-draft'
import type { CastingBatchCostInput } from './casting-calculations'

const id = z.string().regex(/^[a-z0-9]{15}$/)
const decimal = z.string().min(1)
// Generous operating ceilings prevent implausible drafts and floating cost loss.
const MAX_KG = 100_000
const MAX_RATE_RS = 1_000_000
const MAX_WAGES_RS = 10_000_000
export const castingSessionDraftPayloadV1 = z.strictObject({
  date: z.iso.date(), note: z.string().optional(),
  coal_kg: decimal, coal_rate_rs: decimal, worker_salary_rs: decimal,
  batches: z.array(z.strictObject({
    inputs: z.array(z.strictObject({
      material_name: z.string().trim().min(1), material_id: id.optional(),
      qty_kg: decimal, rate_rs_per_kg: decimal,
    })),
    wire_out_kg: decimal, mel_kg: decimal,
  })).min(1),
})

export type CastingSessionDraftPayloadV1 = z.infer<typeof castingSessionDraftPayloadV1>
export type ParsedCastingSessionDraft =
  | { kind: 'valid'; value: CastingSessionDraftPayloadV1; coalKg: number; coalRate: number; workerSalary: number; batches: CastingBatchCostInput[] }
  | { kind: 'invalid'; issues: string[] }

export function parseCastingSessionDraft(version: unknown, payload: unknown): ParsedCastingSessionDraft {
  if (version !== 1) return { kind: 'invalid', issues: ['Unsupported draft schema version'] }
  const parsed = castingSessionDraftPayloadV1.safeParse(payload)
  if (!parsed.success) return { kind: 'invalid', issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`) }
  try {
    const p = parsed.data
    const coalKg = parsePurchaseDecimal(p.coal_kg, 3, 'Coal kg') / 1000
    const coalRate = parsePurchaseDecimal(p.coal_rate_rs, 3, 'Coal rate') / 1000
    const workerSalary = parsePurchaseDecimal(p.worker_salary_rs, 2, 'Worker salary') / 100
    if (coalKg < 0 || coalRate < 0 || workerSalary < 0) throw new Error('Coal and wages cannot be negative')
    if (coalKg > MAX_KG || coalRate > MAX_RATE_RS || workerSalary > MAX_WAGES_RS) throw new Error('Coal or wages exceed the draft limit')
    const batches = p.batches.map((batch, index) => ({
      batchNumber: index + 1,
      wireOut: parsePurchaseDecimal(batch.wire_out_kg, 3, `Batch ${index + 1} wire out`) / 1000,
      mel: parsePurchaseDecimal(batch.mel_kg, 3, `Batch ${index + 1} mel`) / 1000,
      inputs: batch.inputs.map((input, inputIndex) => ({
        materialId: input.material_id,
        materialName: input.material_name,
        qty: parsePurchaseDecimal(input.qty_kg, 3, `Batch ${index + 1} input ${inputIndex + 1} kg`) / 1000,
        rate: parsePurchaseDecimal(input.rate_rs_per_kg, 3, `Batch ${index + 1} input ${inputIndex + 1} rate`) / 1000,
      })),
    }))
    if (batches.some((batch) => batch.wireOut < 0 || batch.mel < 0 || batch.inputs.some((input) => input.qty < 0 || input.rate < 0))) throw new Error('Batch numbers cannot be negative')
    for (const [index, batch] of batches.entries()) {
      if (!batch.inputs.length) throw new Error(`Batch ${index + 1} needs at least one material input`)
      if (batch.wireOut <= 0) throw new Error(`Batch ${index + 1} wire out must be greater than zero`)
      if (batch.wireOut > MAX_KG || batch.mel > MAX_KG) throw new Error(`Batch ${index + 1} weight exceeds the draft limit`)
      let inputMilliKg = 0
      for (const input of batch.inputs) {
        if (input.qty <= 0) throw new Error(`Batch ${index + 1} input quantity must be greater than zero`)
        if (input.qty > MAX_KG || input.rate > MAX_RATE_RS) throw new Error(`Batch ${index + 1} input exceeds the draft limit`)
        inputMilliKg += Math.round(input.qty * 1000)
      }
      if (Math.round(batch.wireOut * 1000) > inputMilliKg) throw new Error(`Batch ${index + 1} wire out cannot exceed total material input`)
    }
    return { kind: 'valid', value: p, coalKg, coalRate, workerSalary, batches }
  } catch (error) {
    return { kind: 'invalid', issues: [error instanceof Error ? error.message : 'Invalid Casting number'] }
  }
}

export function matchCastingMaterial<T extends { id: string; name: string; aliases?: string; isActive?: boolean }>(name: string, idValue: string | undefined, materials: T[]): T | null {
  return matchPurchaseMaster(name, idValue, materials.map((material) => ({ ...material, active: material.isActive !== false }))) as T | null
}
