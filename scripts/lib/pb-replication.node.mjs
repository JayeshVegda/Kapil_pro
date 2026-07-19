import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReconciliationPlan,
  isReplicaStatusHealthy,
  runReplicationCycle,
  sortCollectionsByDependencies,
} from './pb-replication.mjs'

test('plans deterministic creates, business-field updates, and deletes', () => {
  const source = [
    { id: 'a', name: 'Alpha', amount: 10, created: 'cloud-created' },
    { id: 'b', name: 'Beta', amount: 25, created: 'cloud-created' },
  ]
  const target = [
    { id: 'a', name: 'Alpha', amount: 8, created: 'local-created' },
    { id: 'c', name: 'Old', amount: 1, created: 'local-created' },
  ]

  const plan = buildReconciliationPlan({
    sourceRecords: source,
    targetRecords: target,
    ignoredFields: new Set(['created']),
    maxDeleteRatio: 1,
  })

  assert.deepEqual(plan.creates.map((record) => record.id), ['b'])
  assert.deepEqual(plan.updates.map((record) => record.id), ['a'])
  assert.deepEqual(plan.deletes, ['c'])
})

test('returns a no-op plan when only managed fields differ', () => {
  const plan = buildReconciliationPlan({
    sourceRecords: [{ id: 'a', value: 4, updated: 'cloud', attachment: 'cloud.pdf' }],
    targetRecords: [{ id: 'a', value: 4, updated: 'local', attachment: 'local.pdf' }],
    ignoredFields: new Set(['updated', 'attachment']),
  })

  assert.deepEqual(plan, { creates: [], updates: [], deletes: [] })
})

test('refuses an unexpectedly large deletion plan', () => {
  assert.throws(
    () =>
      buildReconciliationPlan({
        sourceRecords: [{ id: 'keep' }],
        targetRecords: [
          { id: 'keep' },
          { id: 'delete-1' },
          { id: 'delete-2' },
          { id: 'delete-3' },
          { id: 'delete-4' },
          { id: 'delete-5' },
        ],
        maxDeletes: 50,
        maxDeleteRatio: 0.2,
      }),
    /deletion guard/i,
  )
})

test('allows a single legitimate deletion from a small collection', () => {
  const plan = buildReconciliationPlan({
    sourceRecords: [{ id: 'keep-1' }, { id: 'keep-2' }],
    targetRecords: [{ id: 'keep-1' }, { id: 'keep-2' }, { id: 'delete-1' }],
    maxDeletes: 50,
    maxDeleteRatio: 0.2,
  })

  assert.deepEqual(plan.deletes, ['delete-1'])
})

test('orders parent collections before relations and reverses safely for deletion', () => {
  const collections = [
    { id: 'items-id', name: 'items', relationCollectionIds: [] },
    { id: 'lines-id', name: 'bill_items', relationCollectionIds: ['bills-id', 'items-id'] },
    { id: 'bills-id', name: 'bills', relationCollectionIds: ['customers-id'] },
    { id: 'customers-id', name: 'customers', relationCollectionIds: [] },
  ]

  const ordered = sortCollectionsByDependencies(collections)
  const names = ordered.map((collection) => collection.name)

  assert.ok(names.indexOf('customers') < names.indexOf('bills'))
  assert.ok(names.indexOf('bills') < names.indexOf('bill_items'))
  assert.ok(names.indexOf('items') < names.indexOf('bill_items'))
})

test('marks replica status unhealthy after two replication intervals', () => {
  const now = Date.parse('2026-07-19T08:00:00Z')

  assert.equal(
    isReplicaStatusHealthy(
      { ok: true, completedAt: '2026-07-19T07:59:10Z', mismatches: 0 },
      now,
      120_000,
    ),
    true,
  )
  assert.equal(
    isReplicaStatusHealthy(
      { ok: true, completedAt: '2026-07-19T07:57:59Z', mismatches: 0 },
      now,
      120_000,
    ),
    false,
  )
  assert.equal(
    isReplicaStatusHealthy(
      { ok: false, completedAt: '2026-07-19T07:59:50Z', mismatches: 1 },
      now,
      120_000,
    ),
    false,
  )
})

test('replicates related base collections through the PocketBase client seam', async () => {
  const schemas = [
    {
      id: 'customers-id',
      name: 'customers',
      type: 'base',
      system: false,
      fields: [{ id: 'name-field', name: 'name', type: 'text', required: true }],
      indexes: [],
    },
    {
      id: 'bills-id',
      name: 'bills',
      type: 'base',
      system: false,
      fields: [
        {
          id: 'customer-field',
          name: 'customer',
          type: 'relation',
          collectionId: 'customers-id',
          required: true,
        },
      ],
      indexes: [],
    },
  ]

  const source = new FakePocketBase(schemas, {
    customers: [
      { id: 'customer-a', name: 'Updated customer' },
      { id: 'customer-b', name: 'New customer' },
    ],
    bills: [{ id: 'bill-a', customer: 'customer-b', amount: 50 }],
  })
  const target = new FakePocketBase(schemas, {
    customers: [
      { id: 'customer-a', name: 'Old customer' },
      { id: 'customer-z', name: 'Delete me' },
    ],
    bills: [],
  })

  const result = await runReplicationCycle(source, target, {
    maxDeleteRatio: 1,
  })

  assert.equal(result.ok, true)
  assert.equal(result.mismatches, 0)
  assert.deepEqual(await target.listRecords('customers'), await source.listRecords('customers'))
  assert.deepEqual(await target.listRecords('bills'), await source.listRecords('bills'))
  assert.deepEqual(
    target.operations.map((operation) => `${operation.action}:${operation.collection}:${operation.id}`),
    [
      'create:customers:customer-b',
      'update:customers:customer-a',
      'create:bills:bill-a',
      'delete:customers:customer-z',
    ],
  )
})

class FakePocketBase {
  constructor(collections, records) {
    this.collections = structuredClone(collections)
    this.records = structuredClone(records)
    this.operations = []
  }

  async listCollections() {
    return structuredClone(this.collections)
  }

  async listRecords(collection) {
    return structuredClone(this.records[collection] ?? []).sort((left, right) =>
      left.id.localeCompare(right.id),
    )
  }

  async createRecord(collection, payload) {
    this.operations.push({ action: 'create', collection, id: payload.id })
    this.records[collection] ??= []
    this.records[collection].push(structuredClone(payload))
  }

  async updateRecord(collection, id, payload) {
    this.operations.push({ action: 'update', collection, id })
    const index = this.records[collection].findIndex((record) => record.id === id)
    this.records[collection][index] = { ...this.records[collection][index], ...structuredClone(payload), id }
  }

  async deleteRecord(collection, id) {
    this.operations.push({ action: 'delete', collection, id })
    this.records[collection] = this.records[collection].filter((record) => record.id !== id)
  }
}
