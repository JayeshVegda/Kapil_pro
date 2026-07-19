import { isDeepStrictEqual } from 'node:util'

const TRANSPORT_FIELDS = new Set(['collectionId', 'collectionName', 'expand'])

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeValue(nested)]),
  )
}

export function normalizeRecord(record, ignoredFields = new Set()) {
  return normalizeValue(
    Object.fromEntries(
      Object.entries(record).filter(
        ([key]) => !TRANSPORT_FIELDS.has(key) && !ignoredFields.has(key),
      ),
    ),
  )
}

export function buildReconciliationPlan({
  sourceRecords,
  targetRecords,
  ignoredFields = new Set(),
  maxDeletes = 50,
  maxDeleteRatio = 0.2,
  minDeletesForRatioGuard = 5,
}) {
  const sourceById = new Map(sourceRecords.map((record) => [record.id, record]))
  const targetById = new Map(targetRecords.map((record) => [record.id, record]))

  const creates = [...sourceById.values()]
    .filter((record) => !targetById.has(record.id))
    .sort((left, right) => left.id.localeCompare(right.id))

  const updates = [...sourceById.values()]
    .filter((record) => {
      const target = targetById.get(record.id)
      if (!target) return false
      return !isDeepStrictEqual(
        normalizeRecord(record, ignoredFields),
        normalizeRecord(target, ignoredFields),
      )
    })
    .sort((left, right) => left.id.localeCompare(right.id))

  const deletes = [...targetById.keys()]
    .filter((id) => !sourceById.has(id))
    .sort((left, right) => left.localeCompare(right))

  const deleteRatio = targetRecords.length === 0 ? 0 : deletes.length / targetRecords.length
  if (
    deletes.length > maxDeletes ||
    (deletes.length >= minDeletesForRatioGuard && deleteRatio > maxDeleteRatio)
  ) {
    throw new Error(
      `Deletion guard triggered: ${deletes.length}/${targetRecords.length} records ` +
        `(${(deleteRatio * 100).toFixed(1)}%)`,
    )
  }

  return { creates, updates, deletes }
}

export function sortCollectionsByDependencies(collections) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  const remaining = new Map(
    collections.map((collection) => [
      collection.id,
      new Set(
        collection.relationCollectionIds.filter(
          (dependencyId) => dependencyId !== collection.id && byId.has(dependencyId),
        ),
      ),
    ]),
  )
  const ordered = []

  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) =>
        [...dependencies].every(
          (dependencyId) => !remaining.has(dependencyId),
        ),
      )
      .map(([id]) => byId.get(id))
      .sort((left, right) => left.name.localeCompare(right.name))

    if (ready.length === 0) {
      const names = [...remaining.keys()].map((id) => byId.get(id).name).sort()
      throw new Error(`Collection dependency cycle detected: ${names.join(', ')}`)
    }

    for (const collection of ready) {
      ordered.push(collection)
      remaining.delete(collection.id)
    }
  }

  return ordered
}

export function isReplicaStatusHealthy(status, now = Date.now(), maxAgeMs = 120_000) {
  if (!status?.ok || Number(status.mismatches) !== 0) return false
  const completedAt = Date.parse(status.completedAt)
  return Number.isFinite(completedAt) && now - completedAt <= maxAgeMs
}

function collectionShape(collection) {
  return normalizeValue({
    id: collection.id,
    name: collection.name,
    type: collection.type,
    fields: collection.fields,
    indexes: collection.indexes ?? [],
    listRule: collection.listRule ?? null,
    viewRule: collection.viewRule ?? null,
    createRule: collection.createRule ?? null,
    updateRule: collection.updateRule ?? null,
    deleteRule: collection.deleteRule ?? null,
  })
}

function managedFields(collection) {
  return new Set(
    (collection.fields ?? [])
      .filter((field) => field.type === 'autodate' || field.type === 'file')
      .map((field) => field.name),
  )
}

function writePayload(record, ignoredFields) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !TRANSPORT_FIELDS.has(key) && !ignoredFields.has(key),
    ),
  )
}

export async function runReplicationCycle(sourceClient, targetClient, options = {}) {
  const startedAt = new Date().toISOString()
  const sourceCollections = (await sourceClient.listCollections()).filter(
    (collection) => !collection.system && collection.type === 'base',
  )
  const targetCollections = (await targetClient.listCollections()).filter(
    (collection) => !collection.system && collection.type === 'base',
  )
  const targetByName = new Map(targetCollections.map((collection) => [collection.name, collection]))

  for (const sourceCollection of sourceCollections) {
    const targetCollection = targetByName.get(sourceCollection.name)
    if (!targetCollection) {
      throw new Error(`Schema mismatch: local collection ${sourceCollection.name} is missing`)
    }
    if (!isDeepStrictEqual(collectionShape(sourceCollection), collectionShape(targetCollection))) {
      throw new Error(`Schema mismatch: collection ${sourceCollection.name} differs`)
    }
  }

  const ordered = sortCollectionsByDependencies(
    sourceCollections.map((collection) => ({
      ...collection,
      relationCollectionIds: (collection.fields ?? [])
        .filter((field) => field.type === 'relation' && field.collectionId)
        .map((field) => field.collectionId),
    })),
  )
  const plans = new Map()
  let sourceRecordTotal = 0

  for (const collection of ordered) {
    const sourceRecords = await sourceClient.listRecords(collection.name)
    const targetRecords = await targetClient.listRecords(collection.name)
    sourceRecordTotal += sourceRecords.length
    plans.set(collection.name, {
      ignoredFields: managedFields(collection),
      sourceRecords,
      plan: buildReconciliationPlan({
        sourceRecords,
        targetRecords,
        maxDeletes: options.maxDeletes ?? 50,
        maxDeleteRatio: options.maxDeleteRatio ?? 0.2,
        ignoredFields: managedFields(collection),
      }),
    })
  }

  let creates = 0
  let updates = 0
  let deletes = 0

  for (const collection of ordered) {
    const { ignoredFields, plan } = plans.get(collection.name)
    for (const record of plan.creates) {
      await targetClient.createRecord(
        collection.name,
        writePayload(record, ignoredFields),
      )
      creates += 1
    }
    for (const record of plan.updates) {
      const payload = writePayload(record, ignoredFields)
      delete payload.id
      await targetClient.updateRecord(collection.name, record.id, payload)
      updates += 1
    }
  }

  for (const collection of [...ordered].reverse()) {
    const { plan } = plans.get(collection.name)
    for (const id of plan.deletes) {
      await targetClient.deleteRecord(collection.name, id)
      deletes += 1
    }
  }

  let mismatches = 0
  for (const collection of ordered) {
    const { ignoredFields, sourceRecords } = plans.get(collection.name)
    const targetRecords = await targetClient.listRecords(collection.name)
    const verification = buildReconciliationPlan({
      sourceRecords,
      targetRecords,
      ignoredFields,
      maxDeletes: Number.POSITIVE_INFINITY,
      maxDeleteRatio: 1,
    })
    mismatches +=
      verification.creates.length +
      verification.updates.length +
      verification.deletes.length
  }

  const completedAt = new Date().toISOString()
  return {
    ok: mismatches === 0,
    startedAt,
    completedAt,
    mismatches,
    sourceCollections: ordered.length,
    sourceRecordTotal,
    mutations: { creates, updates, deletes },
  }
}
