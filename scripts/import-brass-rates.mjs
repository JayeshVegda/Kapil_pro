import fs from 'node:fs/promises'
import PocketBase from 'pocketbase'
import { ensureBrassRatesCollection } from './brass-rates-schema.mjs'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD
const CSV_PATH =
  process.env.BRASS_RATES_CSV ||
  'docs/Kapil Product - brass_rate (brass_rate) 2026-04-28_14-57.csv'

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
  console.error('Missing PocketBase admin credentials. Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD.')
  process.exit(1)
}

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

main().catch((error) => {
  console.error('Brass rate import failed:', error)
  process.exit(1)
})

async function main() {
  console.log(`Connecting to PocketBase: ${PB_URL}`)
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
  console.log(`Authenticated as ${PB_ADMIN_EMAIL}`)

  const schemaStatus = await ensureBrassRatesCollection(pb)
  console.log(`${schemaStatus === 'created' ? 'Created' : 'Updated'} brass_rates collection schema`)

  const csvRows = await readCsvRows(CSV_PATH)
  let created = 0
  let updated = 0
  for (const row of csvRows) {
    const result = await upsertBrassRate(row)
    if (result === 'created') created += 1
    if (result === 'updated') updated += 1
  }

  const legacyRows = await pb.collection('misc_expenses').getFullList({
    filter: 'type = "market_rate"',
    sort: 'date',
  })

  let migratedLegacy = 0
  for (const record of legacyRows) {
    const date = String(record.date ?? '').slice(0, 10)
    const vilaity = numberOrZero(record.amount)
    if (!date || !(vilaity > 0)) continue
    const result = await upsertBrassRate({
      date,
      vilaity,
      honeyGulf: 0,
      honeyEurope: 0,
      note: 'Migrated from misc_expenses market_rate',
    })
    if (result !== 'unchanged') migratedLegacy += 1
  }

  console.log(`CSV rows processed: ${csvRows.length}`)
  console.log(`Created: ${created}, Updated: ${updated}`)
  console.log(`Legacy misc_expenses market_rate rows migrated: ${migratedLegacy}`)
}

async function readCsvRows(path) {
  const raw = await fs.readFile(path, 'utf8')
  const lines = raw.split(/\r?\n/).filter(Boolean)
  const [, ...dataLines] = lines
  return dataLines.map((line) => {
    const [vilaity, date, honeyGulf, honeyEurope] = line.split(',')
    return {
      date: String(date ?? '').trim(),
      vilaity: numberOrZero(vilaity),
      honeyGulf: numberOrZero(honeyGulf),
      honeyEurope: numberOrZero(honeyEurope),
      source: 'legacy_csv',
      note: 'Imported from historical brass rate CSV',
    }
  })
}

async function upsertBrassRate(row) {
  const date = String(row.date ?? '').slice(0, 10)
  if (!date) return 'unchanged'
  const payload = {
    date,
    vilaity: numberOrZero(row.vilaity),
    honey_gulf: numberOrZero(row.honeyGulf),
    honey_europe: numberOrZero(row.honeyEurope),
    source: String(row.source ?? ''),
    note: String(row.note ?? ''),
  }
  const existing = await pb.collection('brass_rates').getFirstListItem(`date = "${date}"`).catch(() => null)
  if (!existing) {
    await pb.collection('brass_rates').create(payload)
    return 'created'
  }

  const unchanged =
    String(existing.date ?? '').slice(0, 10) === payload.date &&
    numberOrZero(existing.vilaity) === payload.vilaity &&
    numberOrZero(existing.honey_gulf) === payload.honey_gulf &&
    numberOrZero(existing.honey_europe) === payload.honey_europe &&
    String(existing.source ?? '') === payload.source &&
    String(existing.note ?? '') === payload.note

  if (unchanged) return 'unchanged'
  await pb.collection('brass_rates').update(existing.id, payload)
  return 'updated'
}

function numberOrZero(value) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
