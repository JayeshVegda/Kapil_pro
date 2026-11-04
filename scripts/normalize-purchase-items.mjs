/**
 * Normalise purchase_items names to Title Case (Phase 5, B4).
 *
 *   node scripts/normalize-purchase-items.mjs            # dry run — prints planned renames
 *   node scripts/normalize-purchase-items.mjs --apply    # write changes via superuser API
 *   node scripts/normalize-purchase-items.mjs --url http://127.0.0.1:8090
 *
 * Rules: trim, collapse whitespace, Title Case, keep acronyms (GST, RCM).
 * Refuses to run (exit 1) if any normalised name collides — it never merges or
 * deletes rows. On --apply it writes an audit row per rename.
 */
import PocketBase from 'pocketbase'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const baseUrl = args.url || 'http://127.0.0.1:8090'
const apply = Boolean(args.apply)
const ACTOR = 'normalize-script'
const ACRONYMS = new Set(['GST', 'RCM'])

function normalizeItemName(raw) {
  const collapsed = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!collapsed) return ''
  return collapsed
    .split(' ')
    .map((word) => {
      if (!word) return word
      const upper = word.toUpperCase()
      if (ACRONYMS.has(upper)) return upper
      return upper.charAt(0) + upper.slice(1).toLowerCase()
    })
    .join(' ')
}
const keyOf = (name) => normalizeItemName(name).toLowerCase()

const pb = new PocketBase(baseUrl)
pb.autoCancellation(false)

main().catch((error) => {
  const detail = error?.response?.data ? JSON.stringify(error.response.data) : ''
  console.error('[normalize-purchase-items] failed:', error?.message ?? error, detail)
  process.exit(1)
})

async function main() {
  const credPath = path.join(repoRoot, 'runtime', 'state', 'pb-admin-credentials.json')
  if (!fs.existsSync(credPath)) throw new Error(`Superuser credentials not found at ${credPath}.`)
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'))
  await pb.collection('_superusers').authWithPassword(cred.email, cred.password)

  const items = await pb.collection('purchase_items').getFullList({ fields: 'id,name,active', sort: 'name' })
  console.log(`[normalize-purchase-items] ${items.length} items loaded from ${baseUrl}${apply ? ' (APPLY MODE)' : ' (dry run — no writes)'}`)

  // ---- collision detection (across the whole collection, case-insensitive)
  const byKey = new Map()
  for (const item of items) {
    const key = keyOf(item.name)
    const bucket = byKey.get(key) ?? []
    bucket.push(item)
    byKey.set(key, bucket)
  }
  const collisions = [...byKey.values()].filter((bucket) => bucket.length > 1)
  if (collisions.length > 0) {
    console.error('[normalize-purchase-items] REFUSING to run — normalised-name collisions detected:')
    for (const bucket of collisions) {
      console.error(`  -> ${bucket.map((i) => `${i.name} (id ${i.id})`).join('  vs  ')}`)
    }
    process.exit(1)
  }

  // ---- planned renames
  const planned = items
    .map((item) => ({ item, next: normalizeItemName(item.name) }))
    .filter((entry) => entry.next !== entry.item.name)

  if (planned.length === 0) {
    console.log('[normalize-purchase-items] all names already normalised — nothing to do.')
    return
  }

  console.log(`[normalize-purchase-items] ${planned.length} rename(s) planned:`)
  for (const { item, next } of planned) {
    console.log(`  ${item.name}  ->  ${next}${item.active ? '' : '  [inactive]'}`)
  }

  if (!apply) {
    console.log('\nDry run only — re-run with --apply to write these renames (audit rows included).')
    return
  }

  for (const { item, next } of planned) {
    await pb.collection('purchase_items').update(item.id, { name: next })
    await pb.collection('purchase_audit_log').create({
      collection: 'purchase_items',
      record_id: item.id,
      action: 'normalize',
      before_json: JSON.stringify({ name: item.name }),
      after_json: JSON.stringify({ name: next }),
      actor: ACTOR,
    })
    console.log(`[normalize-purchase-items] renamed ${item.name} -> ${next}`)
  }
  console.log('[normalize-purchase-items] done.')
}

function parseArgs(argv) {
  const args = {}
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=')
      args[key] = value ?? true
    }
  }
  return args
}
