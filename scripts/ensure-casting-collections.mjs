/**
 * One-time / CI PocketBase admin migration: casting sessions + batches + batch inputs.
 * Usage: PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/ensure-casting-collections.mjs
 */
import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
    console.error('Missing PocketBase admin credentials. Run with Doppler or set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD.')
    process.exit(1)
  }

  console.log(`Connecting to PocketBase: ${PB_URL}`)
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
  console.log(`Authenticated as ${PB_ADMIN_EMAIL}`)

  await ensureCastingSessions()
  const sessionsCol = await pb.collections.getOne('casting_sessions')
  await ensureCastingMaterials()
  const materialsCol = await pb.collections.getOne('casting_materials')
  await ensureCastingBatches(sessionsCol.id)
  const batchesCol = await pb.collections.getOne('casting_batches')
  await ensureCastingBatchInputs(batchesCol.id, materialsCol.id)
  console.log('Casting collections are ready.')
}

function mergeCustomFields(existingFields, desiredFields) {
  const systemFields = (existingFields ?? []).filter((field) => field?.system)
  return [...systemFields, ...desiredFields]
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

async function ensureCastingSessions() {
  const existing = await pb.collections.getOne('casting_sessions').catch(() => null)
  const fields = [
    textField('date', true),
    numberField('unit', false),
    numberField('coal_kg', false),
    numberField('coal_rate', false),
    numberField('worker_salary', false),
    numberField('wire_out', false),
    numberField('wastage', false),
    numberField('chol_in', false),
    numberField('total_wire_out', false),
    numberField('total_mel', false),
    numberField('cost_per_kg', false),
    numberField('metal_cost_per_kg', false),
    numberField('coal_cost_per_kg', false),
    numberField('worker_cost_per_kg', false),
    numberField('final_product_cost_per_kg', false),
    numberField('total_input_cost', false),
    numberField('total_input_kg', false),
    textField('note', false),
  ]
  const indexes = ['CREATE INDEX idx_casting_sessions_date ON casting_sessions (date)']
  const apiRule = '@request.auth.id != ""'

  if (!existing) {
    await pb.collections.create({
      name: 'casting_sessions',
      type: 'base',
      fields,
      indexes,
      listRule: apiRule,
      viewRule: apiRule,
      createRule: apiRule,
      updateRule: apiRule,
      deleteRule: apiRule,
    })
    console.log('Created casting_sessions')
    return
  }

  await pb.collections.update(existing.id, {
    ...existing,
    fields: mergeCustomFields(existing.fields ?? [], fields),
    indexes,
    listRule: apiRule,
    viewRule: apiRule,
    createRule: apiRule,
    updateRule: apiRule,
    deleteRule: apiRule,
  })
  console.log('Updated casting_sessions schema')
}

async function ensureCastingMaterials() {
  const existing = await pb.collections.getOne('casting_materials').catch(() => null)
  const fields = [
    textField('name', true),
    textField('code', false),
    textField('category', false),
    {
      name: 'is_active',
      type: 'bool',
      required: false,
    },
  ]
  const indexes = [
    'CREATE UNIQUE INDEX idx_casting_materials_name ON casting_materials (name)',
    'CREATE INDEX idx_casting_materials_active ON casting_materials (is_active)',
  ]
  const apiRule = '@request.auth.id != ""'

  if (!existing) {
    await pb.collections.create({
      name: 'casting_materials',
      type: 'base',
      fields,
      indexes,
      listRule: apiRule,
      viewRule: apiRule,
      createRule: apiRule,
      updateRule: apiRule,
      deleteRule: apiRule,
    })
    console.log('Created casting_materials')
    return
  }

  await pb.collections.update(existing.id, {
    ...existing,
    fields: mergeCustomFields(existing.fields ?? [], fields),
    indexes,
    listRule: apiRule,
    viewRule: apiRule,
    createRule: apiRule,
    updateRule: apiRule,
    deleteRule: apiRule,
  })
  console.log('Updated casting_materials schema')
}

async function ensureCastingBatches(sessionsCollectionId) {
  const existing = await pb.collections.getOne('casting_batches').catch(() => null)
  const fields = [
    {
      name: 'session',
      type: 'relation',
      required: true,
      maxSelect: 1,
      collectionId: sessionsCollectionId,
      cascadeDelete: true,
    },
    numberField('batch_number', true),
    numberField('wire_out', false),
    numberField('mel', false),
  ]
  const indexes = [
    'CREATE INDEX idx_casting_batches_session ON casting_batches (session)',
    'CREATE INDEX idx_casting_batches_session_number ON casting_batches (session, batch_number)',
  ]
  const apiRule = '@request.auth.id != ""'

  if (!existing) {
    await pb.collections.create({
      name: 'casting_batches',
      type: 'base',
      fields,
      indexes,
      listRule: apiRule,
      viewRule: apiRule,
      createRule: apiRule,
      updateRule: apiRule,
      deleteRule: apiRule,
    })
    console.log('Created casting_batches')
    return
  }

  await pb.collections.update(existing.id, {
    ...existing,
    fields: mergeCustomFields(existing.fields ?? [], fields),
    indexes,
    listRule: apiRule,
    viewRule: apiRule,
    createRule: apiRule,
    updateRule: apiRule,
    deleteRule: apiRule,
  })
  console.log('Updated casting_batches schema')
}

async function ensureCastingBatchInputs(batchesCollectionId, materialsCollectionId) {
  const existing = await pb.collections.getOne('casting_batch_inputs').catch(() => null)
  const fields = [
    {
      name: 'batch',
      type: 'relation',
      required: true,
      maxSelect: 1,
      collectionId: batchesCollectionId,
      cascadeDelete: true,
    },
    {
      name: 'material',
      type: 'relation',
      required: false,
      maxSelect: 1,
      collectionId: materialsCollectionId,
      cascadeDelete: false,
    },
    textField('material_name', true),
    numberField('qty', false),
    numberField('rate', false),
    numberField('amount', false),
  ]
  const indexes = [
    'CREATE INDEX idx_casting_batch_inputs_batch ON casting_batch_inputs (batch)',
    'CREATE INDEX idx_casting_batch_inputs_material ON casting_batch_inputs (material)',
    'CREATE INDEX idx_casting_batch_inputs_material_name ON casting_batch_inputs (material_name)',
  ]
  const apiRule = '@request.auth.id != ""'

  if (!existing) {
    await pb.collections.create({
      name: 'casting_batch_inputs',
      type: 'base',
      fields,
      indexes,
      listRule: apiRule,
      viewRule: apiRule,
      createRule: apiRule,
      updateRule: apiRule,
      deleteRule: apiRule,
    })
    console.log('Created casting_batch_inputs')
    return
  }

  await pb.collections.update(existing.id, {
    ...existing,
    fields: mergeCustomFields(existing.fields ?? [], fields),
    indexes,
    listRule: apiRule,
    viewRule: apiRule,
    createRule: apiRule,
    updateRule: apiRule,
    deleteRule: apiRule,
  })
  console.log('Updated casting_batch_inputs schema')
}
