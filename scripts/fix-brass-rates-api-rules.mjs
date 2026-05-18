#!/usr/bin/env node
/**
 * One-time fix: brass_rates was created with null API rules (superuser-only reads).
 * Bills/payments use authenticated users; Calendar and market-rate persistence need
 * brass_rates visible and writable for the same app user.
 *
 * Run against your PocketBase admin (superuser):
 *   PB_URL=https://kapil.cosearch.me/pb node scripts/fix-brass-rates-api-rules.mjs
 */
import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
  console.error('Missing PocketBase admin credentials. Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD.')
  process.exit(1)
}

const RULE = '@request.auth.id != ""'

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

async function main() {
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
  const existing = await pb.collections.getOne('brass_rates')
  await pb.collections.update(existing.id, {
    ...existing,
    listRule: RULE,
    viewRule: RULE,
    createRule: RULE,
    updateRule: RULE,
    deleteRule: RULE,
  })
  console.log('Updated brass_rates API rules so authenticated users can list/view/write like bills/payments.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
