/**
 * One-time PocketBase admin script: create/repair payment_drafts collection
 * used by the Muse payment-draft lane. Idempotent — safe to re-run.
 * Usage: node scripts/ensure-payment-drafts-collection.mjs
 * Credentials: runtime/state/pb-admin-credentials.json (same pattern as create-backup.mjs)
 */
import PocketBase from 'pocketbase'
import fs from 'node:fs'
import path from 'node:path'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const root = 'C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a'

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

const COLLECTION_ID = 'pbc_2011173352'
const COLLECTION_NAME = 'payment_drafts'

const SPEC = {
  id: COLLECTION_ID,
  name: COLLECTION_NAME,
  fields: [
    { id: 'text3208210256', name: 'id', type: 'text', system: true, required: true, primaryKey: true, min: 15, max: 15, pattern: '^[a-z0-9]+$', autogeneratePattern: '[a-z0-9]{15}', presentable: false },
    { id: 'text272438125', name: 'raw_text', type: 'text', required: false, min: 0, max: 0, pattern: '', autogeneratePattern: '', presentable: false },
    { id: 'relation2168032777', name: 'customer', type: 'relation', required: false, minSelect: 0, maxSelect: 1, cascadeDelete: false, collectionId: 'pbc_108570809', presentable: false },
    { id: 'text179493489', name: 'customer_name', type: 'text', required: false, min: 0, max: 0, pattern: '', autogeneratePattern: '', presentable: false },
    { id: 'text2862495610', name: 'date', type: 'text', required: false, min: 0, max: 0, pattern: '', autogeneratePattern: '', presentable: false },
    { id: 'number1722491182', name: 'amount', type: 'number', required: false, onlyInt: false, min: null, max: null, presentable: false },
    { id: 'select2063623451', name: 'mode', type: 'select', required: false, maxSelect: 1, values: ['Cash', 'Bank'], presentable: false },
    { id: 'text440751659', name: 'note', type: 'text', required: false, min: 0, max: 0, pattern: '', autogeneratePattern: '', presentable: false },
    { id: 'number1931838964', name: 'confidence', type: 'number', required: false, onlyInt: false, min: null, max: null, presentable: false },
    { id: 'select2063623453', name: 'status', type: 'select', required: false, maxSelect: 1, values: ['pending_review', 'approved', 'rejected'], presentable: false },
    { id: 'relation3725765462', name: 'created_by', type: 'relation', required: false, minSelect: 0, maxSelect: 1, cascadeDelete: false, collectionId: '_pb_users_auth_', presentable: false },
    { id: 'relation3040669726', name: 'converted_payment', type: 'relation', required: false, minSelect: 0, maxSelect: 1, cascadeDelete: false, collectionId: 'pbc_631030571', presentable: false },
    { id: 'autodate2990389176', name: 'created', type: 'autodate', onCreate: true, onUpdate: false, presentable: false },
    { id: 'autodate3332085495', name: 'updated', type: 'autodate', onCreate: true, onUpdate: true, presentable: false },
  ],
  indexes: [],
  listRule: '',
  viewRule: '',
  createRule: '',
  updateRule: '',
  deleteRule: '',
}

function normalizeFields(raw) {
  return SPEC.fields.map((field) => {
    const source = raw.find((entry) => entry.id === field.id)
    return {
      ...field,
      ...(source?.type === field.type ? { id: field.id } : {}),
    }
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  const credPath = path.join(root, 'runtime/state/pb-admin-credentials.json')
  if (!fs.existsSync(credPath)) {
    console.error(`Missing ${credPath} — create it with {"email": "...", "password": "..."}`)
    process.exit(1)
  }
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'))

  console.log(`Connecting to PocketBase: ${PB_URL}`)
  await pb.collection('_superusers').authWithPassword(creds.email, creds.password)
  console.log('Authenticated as superuser')

  const existing = await pb.collections.getOne(COLLECTION_NAME).catch(() => null)
  if (existing) {
    await pb.collections.update(COLLECTION_NAME, {
      id: existing.id,
      name: COLLECTION_NAME,
      fields: normalizeFields(existing.fields),
      indexes: SPEC.indexes,
      listRule: SPEC.listRule,
      viewRule: SPEC.viewRule,
      createRule: SPEC.createRule,
      updateRule: SPEC.updateRule,
      deleteRule: SPEC.deleteRule,
    })
    console.log('payment_drafts collection updated to desired spec.')
  } else {
    await pb.collections.create(SPEC)
    console.log('payment_drafts collection created.')
  }

  const final = await pb.collections.getOne(COLLECTION_NAME)
  console.log(`Confirmed: ${final.name} (${final.id}) fields=${final.fields.length} rulesPublic=${final.listRule === ''}`)
}
