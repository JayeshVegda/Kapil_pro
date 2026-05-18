import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const PB_SUPERUSER_EMAIL = process.env.PB_SUPERUSER_EMAIL || ''
const PB_SUPERUSER_PASSWORD = process.env.PB_SUPERUSER_PASSWORD || ''

if (!PB_SUPERUSER_EMAIL || !PB_SUPERUSER_PASSWORD) {
  console.error('Missing PocketBase superuser credentials. Set PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD.')
  process.exit(1)
}

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

main().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})

async function main() {
  console.log(`Connecting to PocketBase: ${PB_URL}`)
  await pb.collection('_superusers').authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD)
  console.log(`Authenticated as ${PB_SUPERUSER_EMAIL}`)

  await ensureCustomersIndex()
  await dropMiscExpensesCollection()

  console.log('Done: customers index ensured, misc_expenses dropped.')
}

async function ensureCustomersIndex() {
  const customers = await pb.collections.getOne('customers')
  const desiredIndex = 'CREATE INDEX idx_customers_company_name_name ON customers (company_name, name)'
  const existingIndexes = Array.isArray(customers.indexes) ? customers.indexes : []
  const hasIndex = existingIndexes.some((idx) => normalizeSql(idx).includes(normalizeSql(desiredIndex)))

  if (hasIndex) {
    console.log('customers index already exists')
    return
  }

  await pb.collections.update(customers.id, {
    ...customers,
    indexes: [...existingIndexes, desiredIndex],
  })
  console.log('Added index on customers(company_name, name)')
}

async function dropMiscExpensesCollection() {
  const misc = await pb.collections.getOne('misc_expenses').catch(() => null)
  if (!misc) {
    console.log('misc_expenses collection not found (already removed)')
    return
  }

  const records = await pb.collection('misc_expenses').getFullList({ sort: '-created' }).catch(() => [])
  console.log(`misc_expenses records before drop: ${records.length}`)
  if (records.length > 0) {
    const preview = records.slice(0, 5).map((row) => row.id)
    console.log(`misc_expenses sample record ids: ${preview.join(', ')}`)
  }

  await pb.collections.delete(misc.id)
  console.log('Dropped misc_expenses collection')
}

function normalizeSql(sql) {
  return String(sql ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
