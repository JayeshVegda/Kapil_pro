/**
 * One-time / CI PocketBase admin migration: casting_sessions + casting_inputs.
 * Usage: PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/ensure-casting-collections.mjs
 */
import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || 'admin@kapil.cosearch.me'
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || 'Kapil@2026!PB'

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  console.log(`Connecting to PocketBase: ${PB_URL}`)
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
  console.log(`Authenticated as ${PB_ADMIN_EMAIL}`)

  await ensureCastingSessions()
  const sessionsCol = await pb.collections.getOne('casting_sessions')
  await ensureCastingInputs(sessionsCol.id)
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
    numberField('wire_out', false),
    numberField('wastage', false),
    numberField('chol_in', false),
    numberField('cost_per_kg', false),
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

async function ensureCastingInputs(sessionsCollectionId) {
  const existing = await pb.collections.getOne('casting_inputs').catch(() => null)
  const fields = [
    {
      name: 'session',
      type: 'relation',
      required: true,
      maxSelect: 1,
      collectionId: sessionsCollectionId,
      cascadeDelete: true,
    },
    textField('material_name', true),
    numberField('qty', false),
    numberField('rate', false),
    numberField('amount', false),
  ]
  const indexes = ['CREATE INDEX idx_casting_inputs_session ON casting_inputs (session)']
  const apiRule = '@request.auth.id != ""'

  if (!existing) {
    await pb.collections.create({
      name: 'casting_inputs',
      type: 'base',
      fields,
      indexes,
      listRule: apiRule,
      viewRule: apiRule,
      createRule: apiRule,
      updateRule: apiRule,
      deleteRule: apiRule,
    })
    console.log('Created casting_inputs')
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
  console.log('Updated casting_inputs schema')
}
