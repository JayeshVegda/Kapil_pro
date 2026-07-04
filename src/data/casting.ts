/**
 * Casting sessions + line items (PocketBase).
 * Run once per environment: `node scripts/ensure-casting-collections.mjs` (admin auth via env vars).
 */
import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { calculateCastingCost, type CastingBatchCostInput, type CastingInputRow } from '@/domain/casting-calculations'
import type { CastingBatchRecord, CastingInputRecord, CastingMaterialRecord, CastingSessionRecord, CastingSessionWithInputs } from '@/domain/casting-types'

type PBRecord = Record<string, unknown> & { id: string }
const PAGE_SIZE = 200
const XLS_STANDARD_MATERIALS = ['Brass', 'Chol', 'Plate', 'Zinc', 'Lead'] as const

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function mapSession(row: PBRecord): CastingSessionRecord {
  const totalWireOut = num(row.total_wire_out) || num(row.wire_out)
  const totalMel = num(row.total_mel) || num(row.wastage)
  const costPerKg = num(row.cost_per_kg)
  const metalCostPerKg = num(row.metal_cost_per_kg) || costPerKg
  const coalCostPerKg = num(row.coal_cost_per_kg)
  const workerCostPerKg = num(row.worker_cost_per_kg)
  return {
    id: row.id,
    date: String(row.date ?? '').slice(0, 10),
    coalKg: num(row.coal_kg),
    coalRate: num(row.coal_rate),
    workerSalary: num(row.worker_salary),
    unit: num(row.unit),
    wireOut: totalWireOut,
    wastage: totalMel,
    cholIn: num(row.chol_in),
    costPerKg,
    metalCostPerKg,
    coalCostPerKg,
    workerCostPerKg,
    finalProductCostPerKg: num(row.final_product_cost_per_kg),
    totalWireOut,
    totalMel,
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
    batchId: row.batch ? String(row.batch) : undefined,
    materialId: row.material ? String(row.material) : undefined,
    materialName: String(row.material_name ?? ''),
    qty: num(row.qty),
    rate: num(row.rate),
    amount: num(row.amount),
  }
}

function mapBatch(row: PBRecord): CastingBatchRecord {
  return {
    id: row.id,
    sessionId: String(row.session ?? ''),
    batchNumber: num(row.batch_number),
    wireOut: num(row.wire_out),
    mel: num(row.mel),
    inputs: [],
  }
}

function mapMaterial(row: PBRecord): CastingMaterialRecord {
  return {
    id: row.id,
    name: String(row.name ?? ''),
    code: String(row.code ?? ''),
    category: String(row.category ?? ''),
    isActive: Boolean(row.is_active ?? true),
  }
}

function withRecalculatedSessionCosts(session: CastingSessionRecord, batches: CastingBatchRecord[]): CastingSessionRecord {
  if (batches.length === 0) return session
  const cost = calculateCastingCost({
    batches: batches.map((batch) => ({
      batchNumber: batch.batchNumber,
      wireOut: batch.wireOut,
      mel: batch.mel,
      inputs: batch.inputs.map((input) => ({
        materialName: input.materialName,
        qty: input.qty,
        rate: input.rate,
      })),
    })),
    coalKg: session.coalKg,
    coalRate: session.coalRate,
    workerSalary: session.workerSalary,
  })
  return {
    ...session,
    unit: batches.length,
    wireOut: cost.totalWireOut,
    wastage: cost.totalMel,
    totalWireOut: cost.totalWireOut,
    totalMel: cost.totalMel,
    costPerKg: cost.finalCastingCostPerKg,
    metalCostPerKg: cost.metalCostPerKg,
    coalCostPerKg: cost.coalCostPerKg,
    workerCostPerKg: cost.workerCostPerKg,
    finalProductCostPerKg: cost.finalProductCostPerKg,
    totalInputCost: cost.totalInputCost,
    totalInputKg: cost.totalInputKg,
  }
}

async function listAllPaged(collection: string, options: { sort?: string; filter?: string } = {}) {
  const out: PBRecord[] = []
  let page = 1
  for (;;) {
    const res = await pb.collection(collection).getList(page, PAGE_SIZE, {
      sort: options.sort,
      filter: options.filter,
    })
    out.push(...(res.items as PBRecord[]))
    if (page >= res.totalPages) break
    page += 1
  }
  return out
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function loadCastingSessions(params?: { from?: string; to?: string }): Promise<CastingSessionWithInputs[]> {
  const filters: string[] = []
  if (params?.from) filters.push(`date >= "${params.from}"`)
  if (params?.to) filters.push(`date <= "${params.to}"`)
  const sessionFilter = filters.length > 0 ? filters.join(' && ') : undefined

  const sessionsRaw = await listAllPaged('casting_sessions', { sort: '-date', filter: sessionFilter })
  const sessions = sessionsRaw.map(mapSession)
  if (sessions.length === 0) return []

  const idChunks = chunk(sessions.map((s) => s.id), 30)
  const batchChunkResults = await Promise.all(
    idChunks.map((ids) => {
      const filter = ids.map((id) => `session = "${id}"`).join(' || ')
      return listAllPaged('casting_batches', { filter })
    }),
  )
  const batchesRaw = batchChunkResults.flat()
  const batches = batchesRaw.map(mapBatch)
  const batchChunks = chunk(batches.map((b) => b.id), 30)
  const inputsChunkResults = await Promise.all(
    batchChunks.map((ids) => {
      const filter = ids.map((id) => `batch = "${id}"`).join(' || ')
      return listAllPaged('casting_batch_inputs', { filter })
    }),
  )
  const inputsRaw = inputsChunkResults.flat()

  const inputs = inputsRaw.map((row) => {
    const mapped = mapInput(row)
    return {
      ...mapped,
      sessionId: batches.find((batch) => batch.id === mapped.batchId)?.sessionId ?? '',
    }
  })
  const inputsByBatch = new Map<string, CastingInputRecord[]>()
  for (const line of inputs) {
    if (!line.batchId) continue
    const batch = batches.find((b) => b.id === line.batchId)
    const next = { ...line, sessionId: batch?.sessionId ?? '', batchNumber: batch?.batchNumber }
    const list = inputsByBatch.get(line.batchId) ?? []
    list.push(next)
    inputsByBatch.set(line.batchId, list)
  }
  const batchesBySession = new Map<string, CastingBatchRecord[]>()
  for (const batch of batches) {
    const withInputs = { ...batch, inputs: inputsByBatch.get(batch.id) ?? [] }
    const list = batchesBySession.get(batch.sessionId) ?? []
    list.push(withInputs)
    batchesBySession.set(batch.sessionId, list)
  }
  const bySession = new Map<string, CastingInputRecord[]>()
  for (const batch of batches) {
    for (const line of inputsByBatch.get(batch.id) ?? []) {
      const next = { ...line, sessionId: batch.sessionId, batchNumber: batch.batchNumber }
      const list = bySession.get(batch.sessionId) ?? []
      list.push(next)
      bySession.set(batch.sessionId, list)
    }
  }
  if (inputs.length === 0) {
    const legacyInputsChunkResults = await Promise.all(
      idChunks.map((ids) => {
        const filter = ids.map((id) => `session = "${id}"`).join(' || ')
        return listAllPaged('casting_inputs', { filter }).catch(() => [])
      }),
    )
    for (const line of legacyInputsChunkResults.flat().map(mapInput)) {
    if (!line.sessionId) continue
    const list = bySession.get(line.sessionId) ?? []
    list.push(line)
    bySession.set(line.sessionId, list)
    }
  }

  return sessions.map((s) => ({
    ...withRecalculatedSessionCosts(s, (batchesBySession.get(s.id) ?? []).sort((a, b) => a.batchNumber - b.batchNumber)),
    batches: (batchesBySession.get(s.id) ?? []).sort((a, b) => a.batchNumber - b.batchNumber),
    inputs: bySession.get(s.id) ?? [],
  }))
}

export async function loadCastingSession(id: string): Promise<CastingSessionWithInputs | null> {
  try {
    const session = await pb.collection('casting_sessions').getOne(id)
    const batchesRaw = await listAllPaged('casting_batches', { filter: `session = "${id}"` })
    const batches = batchesRaw.map(mapBatch).sort((a, b) => a.batchNumber - b.batchNumber)
    const inputsRaw = batches.length
      ? (
          await Promise.all(
            chunk(batches.map((batch) => batch.id), 30).map((ids) => listAllPaged('casting_batch_inputs', { filter: ids.map((batchId) => `batch = "${batchId}"`).join(' || ') })),
          )
        ).flat()
      : await listAllPaged('casting_inputs', { filter: `session = "${id}"` }).catch(() => [])
    const base = mapSession(session as PBRecord)
    const inputsByBatch = new Map<string, CastingInputRecord[]>()
    for (const row of inputsRaw) {
      const mapped = mapInput(row)
      const batch = batches.find((b) => b.id === mapped.batchId)
      const next = { ...mapped, sessionId: batch?.sessionId ?? base.id, batchNumber: batch?.batchNumber }
      const key = mapped.batchId ?? 'legacy'
      const list = inputsByBatch.get(key) ?? []
      list.push(next)
      inputsByBatch.set(key, list)
    }
    const withInputs = batches.map((batch) => ({ ...batch, inputs: inputsByBatch.get(batch.id) ?? [] }))
    const recalculated = withRecalculatedSessionCosts(base, withInputs)
    return {
      ...recalculated,
      batches: withInputs,
      inputs: batches.length ? withInputs.flatMap((batch) => batch.inputs) : inputsRaw.map(mapInput),
    }
  } catch {
    return null
  }
}

export async function loadCastingMaterials(): Promise<CastingMaterialRecord[]> {
  try {
    const rows = await listAllPaged('casting_materials', { sort: 'name' })
    return rows.map(mapMaterial)
  } catch {
    return []
  }
}

export async function createCastingMaterial(payload: { name: string; code?: string; category?: string }): Promise<CastingMaterialRecord> {
  return await runDataOperation('create-casting-material', async () => {
    const name = String(payload.name ?? '').trim()
    if (!name) throw new Error('Material name is required')
    const created = await pb.collection('casting_materials').create({
      name,
      code: String(payload.code ?? '').trim(),
      category: String(payload.category ?? '').trim(),
      is_active: true,
    })
    return mapMaterial(created as PBRecord)
  })
}

export async function updateCastingMaterial(
  materialId: string,
  payload: { name: string; code?: string; category?: string; isActive?: boolean },
): Promise<CastingMaterialRecord> {
  return await runDataOperation('update-casting-material', async () => {
    const name = String(payload.name ?? '').trim()
    if (!name) throw new Error('Material name is required')
    const updated = await pb.collection('casting_materials').update(materialId, {
      name,
      code: String(payload.code ?? '').trim(),
      category: String(payload.category ?? '').trim(),
      ...(payload.isActive == null ? {} : { is_active: Boolean(payload.isActive) }),
    })
    return mapMaterial(updated as PBRecord)
  })
}

export async function mergeCastingMaterials(sourceId: string, targetId: string): Promise<void> {
  await runDataOperation('merge-casting-materials', async () => {
    if (!sourceId || !targetId || sourceId === targetId) throw new Error('Select two different materials')
    const [target, source] = await Promise.all([pb.collection('casting_materials').getOne(targetId), pb.collection('casting_materials').getOne(sourceId)])
    const targetName = String((target as PBRecord).name ?? '').trim()
    const sourceName = String((source as PBRecord).name ?? '').trim()
    const allInputRows = await listAllPaged('casting_batch_inputs').catch(() => [])
    const sourceRows = allInputRows.filter((row) => {
      const materialId = row.material ? String(row.material) : ''
      const materialName = String(row.material_name ?? '').trim().toLowerCase()
      return materialId === sourceId || materialName === sourceName.toLowerCase()
    })
    await Promise.all(
      sourceRows.map((row) =>
        pb.collection('casting_batch_inputs').update(row.id, {
          material_name: targetName || String(row.material_name ?? ''),
        }),
      ),
    )
    await pb.collection('casting_materials').delete(sourceId).catch(() => undefined)
  })
}

export async function syncCastingMaterialMaster(): Promise<{ created: number; linkedRows: number; totalMaterials: number }> {
  return await runDataOperation('sync-casting-material-master', async () => {
    const [inputs, materials] = await Promise.all([listAllPaged('casting_batch_inputs').catch(() => []), listAllPaged('casting_materials', { sort: 'name' }).catch(() => [])])
    const byName = new Map<string, string>()
    for (const m of materials) {
      const name = String(m.name ?? '').trim()
      if (name) byName.set(name.toLowerCase(), m.id)
    }

    const requiredNames = new Set<string>(XLS_STANDARD_MATERIALS.map((n) => n.toLowerCase()))
    for (const row of inputs) {
      const name = String(row.material_name ?? '').trim().toLowerCase()
      if (name) requiredNames.add(name)
    }

    let created = 0
    for (const low of requiredNames) {
      if (byName.has(low)) continue
      const pretty = low
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
      const createdRow = await pb.collection('casting_materials').create({
        name: pretty,
        code: '',
        category: '',
        is_active: true,
      })
      byName.set(low, createdRow.id)
      created += 1
    }

    let linkedRows = 0
    for (const row of inputs) {
      const existingMaterialId = row.material ? String(row.material) : ''
      const rowNameRaw = String(row.material_name ?? '').trim()
      const rowNameKey = rowNameRaw.toLowerCase()
      const mappedId = rowNameKey ? byName.get(rowNameKey) : undefined
      if (!mappedId) continue
      if (existingMaterialId === mappedId && rowNameRaw.length > 0) continue
      const canonicalName = [...byName.entries()].find(([, id]) => id === mappedId)?.[0] ?? rowNameKey
      const canonicalPretty = canonicalName
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
      await pb.collection('casting_batch_inputs').update(row.id, {
        material_name: canonicalPretty || rowNameRaw,
      })
      linkedRows += 1
    }

    return {
      created,
      linkedRows,
      totalMaterials: byName.size,
    }
  })
}

export type SaveCastingSessionPayload = {
  date: string
  coalKg?: number
  coalRate?: number
  workerSalary?: number
  unit?: number
  wireOut?: number
  wastage?: number
  cholIn?: number
  note: string
  inputs?: CastingInputRow[]
  batches?: CastingBatchCostInput[]
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

function normalizeBatchesForSave(payload: SaveCastingSessionPayload): CastingBatchCostInput[] {
  if (payload.batches?.length) {
    return payload.batches
      .map((batch, index) => ({
        batchNumber: num(batch.batchNumber) || index + 1,
        wireOut: num(batch.wireOut),
        mel: num(batch.mel),
        inputs: normalizeInputsForSave(batch.inputs),
      }))
      .filter((batch) => batch.inputs.length > 0 || batch.wireOut > 0 || batch.mel > 0)
  }
  const legacyInputs = normalizeInputsForSave(payload.inputs ?? [])
  return [
    {
      batchNumber: 1,
      wireOut: num(payload.wireOut),
      mel: num(payload.wastage),
      inputs: legacyInputs,
    },
  ].filter((batch) => batch.inputs.length > 0 || batch.wireOut > 0 || batch.mel > 0)
}

async function ensureMaterialMap(materialNames: string[]) {
  const normalized = [...new Set(materialNames.map((n) => n.trim()).filter((n) => n.length > 0))]
  if (normalized.length === 0) return new Map<string, string>()

  const byName = new Map<string, string>()
  try {
    const existing = await listAllPaged('casting_materials', { sort: 'name' })
    for (const row of existing) {
      const name = String(row.name ?? '').trim()
      if (name) byName.set(name.toLowerCase(), row.id)
    }
  } catch {
    return byName
  }

  for (const name of normalized) {
    const key = name.toLowerCase()
    if (byName.has(key)) continue
    try {
      const created = await pb.collection('casting_materials').create({
        name,
        code: '',
        category: '',
        is_active: true,
      })
      byName.set(key, created.id)
    } catch {
      // If concurrent create happened, fetch list again once.
      try {
        const existing = await listAllPaged('casting_materials', { sort: 'name' })
        for (const row of existing) {
          const n = String(row.name ?? '').trim()
          if (n) byName.set(n.toLowerCase(), row.id)
        }
      } catch {
        /* keep best effort map */
      }
    }
  }

  return byName
}

export async function saveCastingSession(payload: SaveCastingSessionPayload): Promise<{ id: string }> {
  const batches = normalizeBatchesForSave(payload)
  const inputs = batches.flatMap((batch) => batch.inputs)
  const cost = calculateCastingCost({
    batches,
    coalKg: payload.coalKg,
    coalRate: payload.coalRate,
    workerSalary: payload.workerSalary,
  })

  return await runDataOperation('save-casting-session', async () => {
    await ensureMaterialMap(inputs.map((r) => r.materialName))
    const session = await pb.collection('casting_sessions').create({
      date: payload.date.slice(0, 10),
      unit: batches.length,
      coal_kg: num(payload.coalKg),
      coal_rate: num(payload.coalRate),
      worker_salary: num(payload.workerSalary),
      wire_out: cost.totalWireOut,
      wastage: cost.totalMel,
      chol_in: 0,
      total_wire_out: cost.totalWireOut,
      total_mel: cost.totalMel,
      cost_per_kg: cost.finalCastingCostPerKg,
      total_input_cost: cost.totalInputCost,
      total_input_kg: cost.totalInputKg,
      note: String(payload.note ?? ''),
    })

    const createdBatchIds: string[] = []
    const createdInputIds: string[] = []
    try {
      for (const batch of batches) {
        const createdBatch = await pb.collection('casting_batches').create({
          session: session.id,
          batch_number: batch.batchNumber,
          wire_out: batch.wireOut,
          mel: batch.mel,
        })
        createdBatchIds.push(createdBatch.id)
        for (const row of batch.inputs) {
          const created = await pb.collection('casting_batch_inputs').create({
            batch: createdBatch.id,
            material_name: row.materialName,
            qty: row.qty,
            rate: row.rate,
            amount: row.qty * row.rate,
          })
          createdInputIds.push(created.id)
        }
      }
    } catch (error) {
      await Promise.allSettled(createdInputIds.map((id) => pb.collection('casting_batch_inputs').delete(id)))
      await Promise.allSettled(createdBatchIds.map((id) => pb.collection('casting_batches').delete(id)))
      await pb.collection('casting_sessions').delete(session.id).catch(() => undefined)
      throw new Error(error instanceof Error ? error.message : 'Failed to save casting inputs')
    }

    return { id: session.id }
  })
}

export async function updateCastingSession(sessionId: string, payload: SaveCastingSessionPayload): Promise<void> {
  const batches = normalizeBatchesForSave(payload)
  const inputs = batches.flatMap((batch) => batch.inputs)
  const cost = calculateCastingCost({
    batches,
    coalKg: payload.coalKg,
    coalRate: payload.coalRate,
    workerSalary: payload.workerSalary,
  })

  await runDataOperation('update-casting-session', async () => {
    await ensureMaterialMap(inputs.map((r) => r.materialName))
    const existingBatches = await listAllPaged('casting_batches', { filter: `session = "${sessionId}"` }).catch(() => [])
    const existingBatchIds = existingBatches.map((row) => row.id)
    const existingInputs = existingBatchIds.length
      ? (
          await Promise.all(
            chunk(existingBatchIds, 30).map((ids) => listAllPaged('casting_batch_inputs', { filter: ids.map((id) => `batch = "${id}"`).join(' || ') })),
          )
        ).flat()
      : []

    const createdBatchIds: string[] = []
    const createdInputIds: string[] = []
    try {
      for (const batch of batches) {
        const createdBatch = await pb.collection('casting_batches').create({
          session: sessionId,
          batch_number: batch.batchNumber,
          wire_out: batch.wireOut,
          mel: batch.mel,
        })
        createdBatchIds.push(createdBatch.id)
        for (const row of batch.inputs) {
          const created = await pb.collection('casting_batch_inputs').create({
            batch: createdBatch.id,
            material_name: row.materialName,
            qty: row.qty,
            rate: row.rate,
            amount: row.qty * row.rate,
          })
          createdInputIds.push(created.id)
        }
      }
    } catch (error) {
      await Promise.allSettled(createdInputIds.map((id) => pb.collection('casting_batch_inputs').delete(id)))
      await Promise.allSettled(createdBatchIds.map((id) => pb.collection('casting_batches').delete(id)))
      throw new Error(error instanceof Error ? error.message : 'Failed to replace casting inputs')
    }

    const deleteOldInputResults = await Promise.allSettled(existingInputs.map((row) => pb.collection('casting_batch_inputs').delete(row.id)))
    const deleteOldBatchResults = await Promise.allSettled(existingBatchIds.map((id) => pb.collection('casting_batches').delete(id)))
    const deleteOldResults = [...deleteOldInputResults, ...deleteOldBatchResults]
    const failedOldDeletes = deleteOldResults.filter((r) => r.status === 'rejected')
    if (failedOldDeletes.length > 0) {
      throw new Error('Failed to clean old input rows. Session not finalized; please retry update.')
    }

    await pb.collection('casting_sessions').update(sessionId, {
      date: payload.date.slice(0, 10),
      unit: batches.length,
      coal_kg: num(payload.coalKg),
      coal_rate: num(payload.coalRate),
      worker_salary: num(payload.workerSalary),
      wire_out: cost.totalWireOut,
      wastage: cost.totalMel,
      chol_in: 0,
      total_wire_out: cost.totalWireOut,
      total_mel: cost.totalMel,
      cost_per_kg: cost.finalCastingCostPerKg,
      total_input_cost: cost.totalInputCost,
      total_input_kg: cost.totalInputKg,
      note: String(payload.note ?? ''),
    })
  })
}

export async function deleteCastingSession(sessionId: string): Promise<void> {
  await runDataOperation('delete-casting-session', async () => {
    const existingBatches = await listAllPaged('casting_batches', { filter: `session = "${sessionId}"` }).catch(() => [])
    const batchIds = existingBatches.map((row) => row.id)
    const existingInputs = batchIds.length
      ? (
          await Promise.all(
            chunk(batchIds, 30).map((ids) => listAllPaged('casting_batch_inputs', { filter: ids.map((id) => `batch = "${id}"`).join(' || ') })),
          )
        ).flat()
      : await listAllPaged('casting_inputs', { filter: `session = "${sessionId}"` }).catch(() => [])
    await Promise.all(existingInputs.map((row) => pb.collection(row.batch ? 'casting_batch_inputs' : 'casting_inputs').delete(row.id)))
    await Promise.all(existingBatches.map((row) => pb.collection('casting_batches').delete(row.id)))
    await pb.collection('casting_sessions').delete(sessionId)
  })
}

export async function loadLatestMaterialRates(): Promise<Record<string, number>> {
  try {
    const latestSessionPage = await pb.collection('casting_sessions').getList(1, 1, { sort: '-date,-created' })
    const latestSession = (latestSessionPage.items?.[0] as PBRecord | undefined) ?? undefined
    if (!latestSession?.id) return {}

    const latestBatches = await listAllPaged('casting_batches', { filter: `session = "${latestSession.id}"` }).catch(() => [])
    const latestInputs = latestBatches.length
      ? (
          await Promise.all(
            chunk(latestBatches.map((batch) => batch.id), 30).map((ids) => listAllPaged('casting_batch_inputs', { filter: ids.map((id) => `batch = "${id}"`).join(' || ') })),
          )
        ).flat()
      : await listAllPaged('casting_inputs', { filter: `session = "${latestSession.id}"` }).catch(() => [])
    if (latestInputs.length === 0) return {}

    const out: Record<string, number> = {}
    for (const row of latestInputs) {
      const material = String(row.material_name ?? '').trim().toLowerCase()
      const rate = num(row.rate)
      if (!material || !(rate > 0)) continue
      out[material] = rate
    }
    return out
  } catch {
    return {}
  }
}

export async function loadLatestCastingDefaults(): Promise<{ coalRate: number; materialRates: Record<string, number> }> {
  try {
    const latestSessionPage = await pb.collection('casting_sessions').getList(1, 1, { sort: '-date,-created' })
    const latestSession = (latestSessionPage.items?.[0] as PBRecord | undefined) ?? undefined
    if (!latestSession?.id) return { coalRate: 0, materialRates: {} }
    const materialRates = await loadLatestMaterialRates()
    return { coalRate: num(latestSession.coal_rate), materialRates }
  } catch {
    return { coalRate: 0, materialRates: {} }
  }
}

export async function loadMarketRateForDate(dateIso: string): Promise<{ rate: number; rateDate: string } | null> {
  try {
    const exact = await pb.collection('brass_rates').getFirstListItem(`date = "${dateIso}"`)
    const exactRate = num(exact.vilaity)
    if (exactRate > 0) return { rate: exactRate, rateDate: String(exact.date ?? dateIso) }
  } catch {
    // fallback below
  }
  try {
    const page = await pb.collection('brass_rates').getList(1, 1, {
      filter: `date <= "${dateIso}"`,
      sort: '-date,-updated',
    })
    const row = page.items[0] as PBRecord | undefined
    if (!row) return null
    const rate = num(row.vilaity)
    if (!(rate > 0)) return null
    return { rate, rateDate: String(row.date ?? '') }
  } catch {
    return null
  }
}

export async function loadMonthlyAverageMarketRate(monthPrefix: string): Promise<number | null> {
  try {
    const rows = await listAllPaged('brass_rates', {
      filter: `date ~ "${monthPrefix}"`,
      sort: '-date',
    })
    let sum = 0
    let count = 0
    for (const row of rows) {
      const v = num(row.vilaity)
      if (v > 0) {
        sum += v
        count += 1
      }
    }
    if (count === 0) return null
    return sum / count
  } catch {
    return null
  }
}
