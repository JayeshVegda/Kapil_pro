import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8090'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@kapil.cosearch.me'
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'Kapil@2026!PB'

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

const num = (value) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const bagsFromQtyKg = (qtyKg) => {
  if (!(qtyKg > 0)) return 0
  return Math.round(qtyKg / 50)
}

async function main() {
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
  const items = await pb.collection('bill_items').getFullList({ sort: 'id' })
  let updated = 0
  for (const item of items) {
    const next = bagsFromQtyKg(num(item.qty))
    if (num(item.bags) === next) continue
    await pb.collection('bill_items').update(item.id, { bags: next })
    updated += 1
  }
  console.log(JSON.stringify({ total: items.length, updated }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

