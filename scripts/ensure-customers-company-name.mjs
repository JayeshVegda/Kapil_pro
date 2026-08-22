import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || process.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8090'
const PB_SUPERUSER_EMAIL =
  process.env.PB_SUPERUSER_EMAIL ||
  process.env.PB_ADMIN_EMAIL
const PB_SUPERUSER_PASSWORD =
  process.env.PB_SUPERUSER_PASSWORD ||
  process.env.PB_ADMIN_PASSWORD

if (!PB_SUPERUSER_EMAIL || !PB_SUPERUSER_PASSWORD) {
  console.error('Missing PocketBase admin credentials. Set PB_SUPERUSER_EMAIL/PB_SUPERUSER_PASSWORD.')
  process.exit(1)
}

const pb = new PocketBase(PB_URL)

function hasCompanyNameField(collection) {
  return (collection.fields || []).some((f) => f.name === 'company_name')
}

async function ensureCompanyNameField() {
  const customersCollection = await pb.collections.getOne('customers')
  if (hasCompanyNameField(customersCollection)) {
    console.log('company_name field already exists on customers')
    return
  }

  const fields = [
    ...(customersCollection.fields || []),
    {
      system: false,
      id: `f_${Math.random().toString(36).slice(2, 10)}`,
      name: 'company_name',
      type: 'text',
      required: false,
      presentable: false,
      unique: false,
      options: { min: null, max: null, pattern: '' },
    },
  ]

  await pb.collections.update(customersCollection.id, {
    ...customersCollection,
    fields,
  })
  console.log('Added company_name field to customers collection')
}

async function backfillCompanyNames() {
  const records = await pb.collection('customers').getFullList({ sort: 'name' })
  let updated = 0
  for (const row of records) {
    const name = String(row.name || '').trim()
    const companyName = String(row.company_name || '').trim()
    if (!name || companyName) continue
    await pb.collection('customers').update(row.id, {
      company_name: name,
    })
    updated += 1
  }
  console.log(`Backfilled company_name for ${updated} customers`)
}

async function main() {
  try {
    await pb.collection('_superusers').authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD)
  } catch {
    // Backward-compatible path for older PocketBase deployments.
    await pb.admins.authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD)
  }
  await ensureCompanyNameField()
  await backfillCompanyNames()
  console.log('Customer company-name migration complete')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
