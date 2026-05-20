/**
 * PocketBase admin migration: items stock fields + stock_in.
 *
 * Usage:
 *   PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... \
 *   node scripts/ensure-stock-collections.mjs
 */
import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || process.env.PB_SUPERUSER_EMAIL || 'admin@kapil.cosearch.me'
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.PB_SUPERUSER_PASSWORD || ''

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  if (!PB_ADMIN_PASSWORD) {
    console.error('Missing PB_ADMIN_PASSWORD (set in environment).')
    process.exit(1)
  }

  console.log(`Connecting to PocketBase: ${PB_URL}`)
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
  console.log(`Authenticated as ${PB_ADMIN_EMAIL}`)

  const itemsCol = await ensureItemsStockFields()
  await ensureBillItemsItemRelation(itemsCol.id)
  await ensureStockIn(itemsCol.id)
  await ensureStockAdjustments(itemsCol.id)
  await backfillBillItemsItemRelation()
  console.log('Stock collections are ready.')
}

function mergeFields(existingFields, desiredFields) {
  const byName = new Map()
  for (const field of existingFields ?? []) byName.set(field.name, field)
  for (const field of desiredFields) byName.set(field.name, { ...(byName.get(field.name) ?? {}), ...field })
  return Array.from(byName.values())
}

function mergeIndexes(existingIndexes, desiredIndexes) {
  const out = [...(existingIndexes ?? [])]
  for (const index of desiredIndexes) {
    if (!out.some((existing) => normalizeSql(existing) === normalizeSql(index))) out.push(index)
  }
  return out
}

function normalizeSql(sql) {
  return String(sql ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function textField(name, required) {
  return {
    name,
    type: 'text',
    required: Boolean(required),
    min: 0,
    max: 0,
    pattern: '',
    autogeneratePattern: '',
  }
}

function numberField(name, required) {
  return {
    name,
    type: 'number',
    required: Boolean(required),
    onlyInt: false,
    min: null,
    max: null,
  }
}

async function ensureItemsStockFields() {
  const existing = await pb.collections.getOne('items')
  const fields = [
    textField('type', false),
    textField('unit', false),
    numberField('bag_weight', false),
    numberField('opening_stock', false),
    textField('opening_stock_date', false),
  ]

  await pb.collections.update(existing.id, {
    ...existing,
    fields: mergeFields(existing.fields ?? [], fields),
  })
  console.log('Updated items stock fields')
  await backfillItemsStockDefaults()
  return pb.collections.getOne('items')
}

async function backfillItemsStockDefaults() {
  const records = await pb.collection('items').getFullList({ sort: 'name' })
  let updated = 0
  for (const item of records) {
    const patch = {}
    if (item.type == null) patch.type = ''
    if (item.unit == null) patch.unit = ''
    if (!Number.isFinite(Number(item.bag_weight)) || Number(item.bag_weight) <= 0) patch.bag_weight = 50
    if (!Number.isFinite(Number(item.opening_stock))) patch.opening_stock = 0
    if (item.opening_stock_date == null) patch.opening_stock_date = ''
    if (Object.keys(patch).length === 0) continue
    await pb.collection('items').update(item.id, patch)
    updated += 1
  }
  console.log(`Backfilled item stock defaults: ${updated}`)
}

async function ensureStockIn(itemsCollectionId) {
  const existing = await pb.collections.getOne('stock_in').catch(() => null)
  const fields = [
    {
      name: 'item',
      type: 'relation',
      required: true,
      maxSelect: 1,
      collectionId: itemsCollectionId,
      cascadeDelete: false,
    },
    textField('item_name', true),
    textField('date', true),
    numberField('qty', true),
    textField('note', false),
  ]
  const indexes = [
    'CREATE INDEX idx_stock_in_item ON stock_in (item)',
    'CREATE INDEX idx_stock_in_date ON stock_in (date)',
  ]
  const apiRule = '@request.auth.id != ""'

  if (!existing) {
    await pb.collections.create({
      name: 'stock_in',
      type: 'base',
      fields,
      indexes,
      listRule: apiRule,
      viewRule: apiRule,
      createRule: apiRule,
      updateRule: apiRule,
      deleteRule: apiRule,
    })
    console.log('Created stock_in')
    return
  }

  await pb.collections.update(existing.id, {
    ...existing,
    fields: mergeFields(existing.fields ?? [], fields),
    indexes: mergeIndexes(existing.indexes ?? [], indexes),
    listRule: apiRule,
    viewRule: apiRule,
    createRule: apiRule,
    updateRule: apiRule,
    deleteRule: apiRule,
  })
  console.log('Updated stock_in schema')
}

async function ensureStockAdjustments(itemsCollectionId) {
  const existing = await pb.collections.getOne('stock_adjustments').catch(() => null)
  const fields = [
    {
      name: 'item',
      type: 'relation',
      required: true,
      maxSelect: 1,
      collectionId: itemsCollectionId,
      cascadeDelete: false,
    },
    textField('item_name', true),
    textField('date', true),
    numberField('qty', true),
    textField('note', false),
  ]
  const indexes = [
    'CREATE INDEX idx_stock_adjustments_item ON stock_adjustments (item)',
    'CREATE INDEX idx_stock_adjustments_date ON stock_adjustments (date)',
  ]
  const apiRule = '@request.auth.id != ""'

  if (!existing) {
    await pb.collections.create({
      name: 'stock_adjustments',
      type: 'base',
      fields,
      indexes,
      listRule: apiRule,
      viewRule: apiRule,
      createRule: apiRule,
      updateRule: apiRule,
      deleteRule: apiRule,
    })
    console.log('Created stock_adjustments')
    return
  }

  await pb.collections.update(existing.id, {
    ...existing,
    fields: mergeFields(existing.fields ?? [], fields),
    indexes: mergeIndexes(existing.indexes ?? [], indexes),
    listRule: apiRule,
    viewRule: apiRule,
    createRule: apiRule,
    updateRule: apiRule,
    deleteRule: apiRule,
  })
  console.log('Updated stock_adjustments schema')
}

async function ensureBillItemsItemRelation(itemsCollectionId) {
  const existing = await pb.collections.getOne('bill_items')
  const fields = [
    {
      name: 'item',
      type: 'relation',
      required: false,
      maxSelect: 1,
      collectionId: itemsCollectionId,
      cascadeDelete: false,
    },
  ]
  const indexes = ['CREATE INDEX IF NOT EXISTS idx_bill_items_item ON bill_items (item)']

  await pb.collections.update(existing.id, {
    ...existing,
    fields: mergeFields(existing.fields ?? [], fields),
    indexes: mergeIndexes(existing.indexes ?? [], indexes),
  })
  console.log('Updated bill_items item relation')
}

async function backfillBillItemsItemRelation() {
  const [items, billItems] = await Promise.all([
    pb.collection('items').getFullList({ sort: 'name' }),
    pb.collection('bill_items').getFullList(),
  ])
  const itemByName = new Map(items.map((item) => [String(item.name ?? '').trim().toLowerCase(), item.id]))
  let updated = 0
  for (const row of billItems) {
    if (row.item) continue
    const itemId = itemByName.get(String(row.item_name ?? '').trim().toLowerCase())
    if (!itemId) continue
    await pb.collection('bill_items').update(row.id, { item: itemId })
    updated += 1
  }
  console.log(`Backfilled bill_items item relation: ${updated}`)
}
