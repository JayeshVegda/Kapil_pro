/**
 * Casting sessions + line items (PocketBase).
 * Run once per environment: `node scripts/ensure-casting-collections.mjs` (admin auth via env vars).
 */
import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { calculateCastingCost, type CastingInputRow } from '@/domain/casting-calculations'
import type { CastingInputRecord, CastingSessionRecord, CastingSessionWithInputs } from '@/domain/casting-types'

type PBRecord = Record<string, unknown> & { id: string }

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function mapSession(row: PBRecord): CastingSessionRecord {
  return {
    id: row.id,
    date: String(row.date ?? '').slice(0, 10),
    unit: num(row.unit),
    wireOut: num(row.wire_out),
    wastage: num(row.wastage),
    cholIn: num(row.chol_in),
    costPerKg: num(row.cost_per_kg),
    totalInputCost: num(row.total_input_cost),
    totalInputKg: num(row.total_input_kg),
    note: String(row.note ?? ''),
    createdAt: String(row.created ?? ''),
    updatedAt: String(row.updated ?? ''),
  }
}

function mapInput(row: PBRecord): CastingInputRecord {
  return {
    id: row.id,
    sessionId: String(row.session ?? ''),
    materialName: String(row.material_name ?? ''),
    qty: num(row.qty),
    rate: num(row.rate),
    amount: num(row.amount),
  }
}

export async function loadCastingSessions(): Promise<CastingSessionWithInputs[]> {
  const [sessionsRaw, inputsRaw] = await Promise.all([
    pb.collection('casting_sessions').getFullList({ sort: '-date' }),
    pb.collection('casting_inputs').getFullList(),
  ])

  const sessions = (sessionsRaw as PBRecord[]).map(mapSession)
  const inputs = (inputsRaw as PBRecord[]).map(mapInput)
  const bySession = new Map<string, CastingInputRecord[]>()
  for (const line of inputs) {
    if (!line.sessionId) continue
    const list = bySession.get(line.sessionId) ?? []
    list.push(line)
    bySession.set(line.sessionId, list)
  }

  return sessions.map((s) => ({
    ...s,
    inputs: bySession.get(s.id) ?? [],
  }))
}

export async function loadCastingSession(id: string): Promise<CastingSessionWithInputs | null> {
  try {
    const session = await pb.collection('casting_sessions').getOne(id)
    const inputsRaw = await pb.collection('casting_inputs').getFullList({
      filter: `session = "${id}"`,
    })
    const base = mapSession(session as PBRecord)
    return {
      ...base,
      inputs: (inputsRaw as PBRecord[]).map(mapInput),
    }
  } catch {
    return null
  }
}

export type SaveCastingSessionPayload = {
  date: string
  unit: number
  wireOut: number
  wastage: number
  cholIn: number
  note: string
  inputs: CastingInputRow[]
}

function normalizeInputsForSave(rows: CastingInputRow[]): CastingInputRow[] {
  return rows
    .map((r) => ({
      materialName: String(r.materialName ?? '').trim(),
      qty: num(r.qty),
      rate: num(r.rate),
    }))
    .filter((r) => r.materialName.length > 0 && r.qty > 0 && r.rate > 0)
}

export async function saveCastingSession(payload: SaveCastingSessionPayload): Promise<{ id: string }> {
  const inputs = normalizeInputsForSave(payload.inputs)
  const { totalInputKg, totalInputCost, costPerKg } = calculateCastingCost(inputs)

  return await runDataOperation('save-casting-session', async () => {
    const session = await pb.collection('casting_sessions').create({
      date: payload.date.slice(0, 10),
      unit: num(payload.unit),
      wire_out: num(payload.wireOut),
      wastage: num(payload.wastage),
      chol_in: num(payload.cholIn),
      cost_per_kg: costPerKg,
      total_input_cost: totalInputCost,
      total_input_kg: totalInputKg,
      note: String(payload.note ?? ''),
    })

    const createdInputIds: string[] = []
    try {
      for (const row of inputs) {
        const created = await pb.collection('casting_inputs').create({
          session: session.id,
          material_name: row.materialName,
          qty: row.qty,
          rate: row.rate,
          amount: row.qty * row.rate,
        })
        createdInputIds.push(created.id)
      }
    } catch (error) {
      await Promise.allSettled(createdInputIds.map((id) => pb.collection('casting_inputs').delete(id)))
      await pb.collection('casting_sessions').delete(session.id).catch(() => undefined)
      throw new Error(error instanceof Error ? error.message : 'Failed to save casting inputs')
    }

    return { id: session.id }
  })
}

export async function updateCastingSession(sessionId: string, payload: SaveCastingSessionPayload): Promise<void> {
  const inputs = normalizeInputsForSave(payload.inputs)
  const { totalInputKg, totalInputCost, costPerKg } = calculateCastingCost(inputs)

  await runDataOperation('update-casting-session', async () => {
    await pb.collection('casting_sessions').update(sessionId, {
      date: payload.date.slice(0, 10),
      unit: num(payload.unit),
      wire_out: num(payload.wireOut),
      wastage: num(payload.wastage),
      chol_in: num(payload.cholIn),
      cost_per_kg: costPerKg,
      total_input_cost: totalInputCost,
      total_input_kg: totalInputKg,
      note: String(payload.note ?? ''),
    })

    const existing = await pb.collection('casting_inputs').getFullList({
      filter: `session = "${sessionId}"`,
    })
    await Promise.all((existing as PBRecord[]).map((row) => pb.collection('casting_inputs').delete(row.id)))

    const createdInputIds: string[] = []
    try {
      for (const row of inputs) {
        const created = await pb.collection('casting_inputs').create({
          session: sessionId,
          material_name: row.materialName,
          qty: row.qty,
          rate: row.rate,
          amount: row.qty * row.rate,
        })
        createdInputIds.push(created.id)
      }
    } catch (error) {
      await Promise.allSettled(createdInputIds.map((id) => pb.collection('casting_inputs').delete(id)))
      throw new Error(error instanceof Error ? error.message : 'Failed to replace casting inputs')
    }
  })
}

export async function deleteCastingSession(sessionId: string): Promise<void> {
  await runDataOperation('delete-casting-session', async () => {
    const existing = await pb.collection('casting_inputs').getFullList({
      filter: `session = "${sessionId}"`,
    })
    await Promise.all((existing as PBRecord[]).map((row) => pb.collection('casting_inputs').delete(row.id)))
    await pb.collection('casting_sessions').delete(sessionId)
  })
}

/**
 * Best-effort latest ₹/kg by material name from Buying module (when collections exist).
 * Returns map keyed by lowercase material name.
 */
export async function loadLatestMaterialRates(): Promise<Record<string, number>> {
  const candidates = ['purchase_lines', 'purchase_items', 'scrap_purchase_lines']
  for (const name of candidates) {
    try {
      const rows = await pb.collection(name).getFullList({ sort: '-created' })
      const best = new Map<string, { t: number; rate: number }>()
      for (const row of rows as PBRecord[]) {
        const material = String(row.material_name ?? row.material ?? row.name ?? '').trim()
        if (!material) continue
        const key = material.toLowerCase()
        const ts = new Date(String(row.created ?? row.updated ?? 0)).getTime()
        const safeTs = Number.isFinite(ts) ? ts : 0
        const rate = num(row.rate ?? row.rate_per_kg ?? row.price_per_kg)
        if (!(rate > 0)) continue
        const prev = best.get(key)
        if (!prev || safeTs >= prev.t) best.set(key, { t: safeTs, rate })
      }
      if (best.size === 0) continue
      const out: Record<string, number> = {}
      for (const [k, v] of best) out[k] = v.rate
      return out
    } catch {
      /* collection missing or wrong shape */
    }
  }
  return {}
}
