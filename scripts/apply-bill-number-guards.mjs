/**
 * Applies the bill-numbering guards to a PocketBase instance:
 *   1. a unique index on bills(book_no, bill_no) so duplicate bill numbers are impossible
 *   2. optional removal of the retired scrap-buying collections
 *
 * Runs read-only by default. Pass --apply to write.
 *
 *   doppler run -- node scripts/apply-bill-number-guards.mjs
 *   doppler run -- node scripts/apply-bill-number-guards.mjs --apply
 *   doppler run -- node scripts/apply-bill-number-guards.mjs --apply --drop-buying
 */
import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const EMAIL = process.env.PB_SUPERUSER_EMAIL || process.env.PB_ADMIN_EMAIL || ''
const PASSWORD = process.env.PB_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD || ''

const APPLY = process.argv.includes('--apply')
const DROP_BUYING = process.argv.includes('--drop-buying')

const UNIQUE_INDEX = 'CREATE UNIQUE INDEX `idx_bills_book_bill_unique` ON `bills` (`book_no`, `bill_no`)'
const BUYING_COLLECTIONS = [
  'supplier_payment_allocations',
  'purchase_deductions',
  'purchase_items',
  'supplier_payments',
  'purchase_bills',
  'suppliers',
]

if (!EMAIL || !PASSWORD) {
  console.error('Missing PocketBase superuser credentials. Run through Doppler or set PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD.')
  process.exit(1)
}

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

main().catch((error) => {
  console.error('Failed:', error?.message ?? error)
  const data = error?.response?.data ?? error?.data
  if (data) console.error('Details:', JSON.stringify(data, null, 2))
  process.exit(1)
})

async function main() {
  console.log(`PocketBase: ${PB_URL}`)
  console.log(APPLY ? 'Mode: APPLY (writes changes)' : 'Mode: DRY RUN (no changes; pass --apply to write)')
  await pb.collection('_superusers').authWithPassword(EMAIL, PASSWORD)
  console.log(`Authenticated as ${EMAIL}\n`)

  await ensureUniqueBillNumberIndex()
  if (DROP_BUYING) await dropBuyingCollections()

  console.log(APPLY ? '\nDone.' : '\nDry run complete. Re-run with --apply to make these changes.')
}

async function ensureUniqueBillNumberIndex() {
  console.log('— Unique bill number index —')
  const collection = await pb.collections.getOne('bills')
  const existing = Array.isArray(collection.indexes) ? collection.indexes : []
  // Match on what the index does, not what it is called — the guard may already
  // exist under a different name, and PocketBase rejects duplicate definitions.
  const covers = existing.find((index) => {
    const sql = index.toLowerCase().replace(/[`\s]+/g, ' ')
    return sql.includes('unique') && /\(\s*book_no\s*,\s*bill_no\s*\)/.test(sql)
  })
  if (covers) {
    console.log(`  Already guarded by: ${covers.replace(/\s+/g, ' ')}`)
    return
  }

  // A unique index cannot be created while duplicates exist, so check first
  // and report them rather than letting PocketBase fail mid-migration.
  const bills = await pb.collection('bills').getFullList({ fields: 'id,book_no,bill_no', sort: 'bill_no' })
  const seen = new Map()
  const duplicates = []
  for (const bill of bills) {
    const ref = `${bill.book_no}/${bill.bill_no}`
    if (seen.has(ref)) duplicates.push(ref)
    else seen.set(ref, bill.id)
  }
  console.log(`  Scanned ${bills.length} bills; ${duplicates.length} duplicate book/bill pair(s).`)
  if (duplicates.length > 0) {
    console.error(`  ABORT: fix these duplicates before adding the index: ${[...new Set(duplicates)].join(', ')}`)
    process.exit(1)
  }

  if (!APPLY) {
    console.log('  Would add: unique index on bills(book_no, bill_no)')
    return
  }
  await pb.collections.update(collection.id, { ...collection, indexes: [...existing, UNIQUE_INDEX] })
  console.log('  Added unique index on bills(book_no, bill_no).')
}

async function dropBuyingCollections() {
  console.log('\n— Retired scrap-buying collections —')
  for (const name of BUYING_COLLECTIONS) {
    const collection = await pb.collections.getOne(name).catch(() => null)
    if (!collection) {
      console.log(`  ${name}: not present`)
      continue
    }
    const records = await pb.collection(name).getFullList({ fields: 'id' }).catch(() => [])
    if (records.length > 0) {
      console.error(`  ABORT: ${name} holds ${records.length} record(s). Refusing to drop a non-empty collection.`)
      process.exit(1)
    }
    if (!APPLY) {
      console.log(`  ${name}: empty — would drop`)
      continue
    }
    await pb.collections.delete(collection.id)
    console.log(`  ${name}: dropped`)
  }
}
