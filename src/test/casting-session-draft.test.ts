import { expect, it } from 'vitest'
import { parseCastingSessionDraft } from '@/domain/casting-session-draft'

it('validates each Casting batch and bounds weights, rates and wages', () => {
  const input = { material_name: 'Brass', qty_kg: '100', rate_rs_per_kg: '500' }
  const batch = { inputs: [input], wire_out_kg: '90', mel_kg: '1' }
  const base = { date: '2026-11-15', coal_kg: '10', coal_rate_rs: '20', worker_salary_rs: '1000', batches: [batch] }
  expect(parseCastingSessionDraft(1, base).kind).toBe('valid')
  for (const change of [
    { batches: [{ ...batch, inputs: [] }] },
    { batches: [{ ...batch, wire_out_kg: '0' }] },
    { batches: [{ ...batch, wire_out_kg: '100.001' }] },
    { batches: [{ ...batch, inputs: [{ ...input, qty_kg: '0' }] }] },
    { batches: [{ ...batch, inputs: [{ ...input, rate_rs_per_kg: '1000000.001' }] }] },
    { coal_kg: '100000.001' }, { coal_rate_rs: '1000000.001' },
    { worker_salary_rs: '10000000.01' },
  ]) expect(parseCastingSessionDraft(1, { ...base, ...change }).kind).toBe('invalid')
})
