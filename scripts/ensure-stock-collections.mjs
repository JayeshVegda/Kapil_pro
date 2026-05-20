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
  const customersCol = await pb.collections.getOne('customers')
  const generalCustomer = await ensureGeneralCustomer()
  await ensureBillItemsItemRelation(itemsCol.id)
  await ensureStockOpenings(itemsCol.id, customersCol.id)
  await ensureStockIn(itemsCol.id, customersCol.id)
  await ensureStockAdjustments(itemsCol.id, customersCol.id)
  await backfillBillItemsItemRelation()
  await migrateLegacyStockToGeneral(generalCustomer)
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

function relationField(name, collectionId, required) {
  return {
    name,
    type: 'relation',
    required: Boolean(required),
    maxSelect: 1,
    collectionId,
    cascadeDelete: false,
  }
}

async function ensureGeneralCustomer() {
  const existing = await pb
    .collection('customers')
    .getFirstListItem('name = "General" || company_name = "General"')
    .catch(() => null)
  const payload = {
    company_name: 'General',
    name: 'General',
    active: true,
    opening_balance: 0,
    opening_balance_date: '',
    phone: '',
    gstin: '',
    address: '',
    credit_limit: 0,
    note: 'Regular Stock',
  }
  if (existing) {
    await pb.collection('customers').update(existing.id, payload)
    console.log('Updated General customer')
    return { ...existing, ...payload }
  }
  const created = await pb.collection('customers').create(payload)
  console.log('Created General customer')
  return created
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

async function ensureStockOpenings(itemsCollectionId, customersCollectionId) {
  const existing = await pb.collections.getOne('stock_openings').catch(() => null)
  const fields = [
    relationField('item', itemsCollectionId, true),
    textField('item_name', true),
    relationField('customer', customersCollectionId, true),
    textField('customer_name', true),
    textField('date', true),
    numberField('qty', true),
    textField('note', false),
  ]
  const indexes = [
    'CREATE UNIQUE INDEX idx_stock_openings_item_customer ON stock_openings (item, customer)',
    'CREATE INDEX idx_stock_openings_customer ON stock_openings (customer)',
    'CREATE INDEX idx_stock_openings_date ON stock_openings (date)',
  ]
  const apiRule = '@request.auth.id != ""'

  if (!existing) {
    await pb.collections.create({
      name: 'stock_openings',
      type: 'base',
      fields,
      indexes,
      listRule: apiRule,
      viewRule: apiRule,
      createRule: apiRule,
      updateRule: apiRule,
      deleteRule: apiRule,
    })
    console.log('Created stock_openings')
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
  console.log('Updated stock_openings schema')
}

async function ensureStockIn(itemsCollectionId, customersCollectionId) {
  const existing = await pb.collections.getOne('stock_in').catch(() => null)
  const fields = [
    relationField('item', itemsCollectionId, true),
    textField('item_name', true),
    relationField('customer', customersCollectionId, false),
    textField('customer_name', false),
    textField('date', true),
    numberField('qty', true),
    textField('note', false),
  ]
  const indexes = [
    'CREATE INDEX idx_stock_in_item ON stock_in (item)',
    'CREATE INDEX idx_stock_in_item_customer ON stock_in (item, customer)',
    'CREATE INDEX idx_stock_in_customer ON stock_in (customer)',
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

async function ensureStockAdjustments(itemsCollectionId, customersCollectionId) {
  const existing = await pb.collections.getOne('stock_adjustments').catch(() => null)
  const fields = [
    relationField('item', itemsCollectionId, true),
    textField('item_name', true),
    relationField('customer', customersCollectionId, false),
    textField('customer_name', false),
    textField('date', true),
    numberField('qty', true),
    textField('note', false),
  ]
  const indexes = [
    'CREATE INDEX idx_stock_adjustments_item ON stock_adjustments (item)',
    'CREATE INDEX idx_stock_adjustments_item_customer ON stock_adjustments (item, customer)',
    'CREATE INDEX idx_stock_adjustments_customer ON stock_adjustments (customer)',
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

async function migrateLegacyStockToGeneral(generalCustomer) {
  const [items, stockIn, adjustments, openings] = await Promise.all([
    pb.collection('items').getFullList({ sort: 'name' }),
    pb.collection('stock_in').getFullList(),
    pb.collection('stock_adjustments').getFullList(),
    pb.collection('stock_openings').getFullList(),
  ])
  const openingKeys = new Set(openings.map((row) => `${row.item}|${row.customer}`))
  let openingCreated = 0
  for (const item of items) {
    const qty = Number(item.opening_stock ?? 0)
    if (!Number.isFinite(qty) || qty === 0) continue
    const key = `${item.id}|${generalCustomer.id}`
    if (openingKeys.has(key)) continue
    await pb.collection('stock_openings').create({
      item: item.id,
      item_name: String(item.name ?? ''),
      customer: generalCustomer.id,
      customer_name: 'General',
      date: String(item.opening_stock_date ?? '').slice(0, 10) || '',
      qty,
      note: 'Migrated from item opening stock',
    })
    openingCreated += 1
  }

  let stockInUpdated = 0
  for (const row of stockIn) {
    if (row.customer) continue
    await pb.collection('stock_in').update(row.id, {
      customer: generalCustomer.id,
      customer_name: 'General',
    })
    stockInUpdated += 1
  }

  let adjustmentUpdated = 0
  for (const row of adjustments) {
    if (row.customer) continue
    await pb.collection('stock_adjustments').update(row.id, {
      customer: generalCustomer.id,
      customer_name: 'General',
    })
    adjustmentUpdated += 1
  }

  console.log(`Migrated legacy stock to General: openings=${openingCreated}, stock_in=${stockInUpdated}, adjustments=${adjustmentUpdated}`)
}
