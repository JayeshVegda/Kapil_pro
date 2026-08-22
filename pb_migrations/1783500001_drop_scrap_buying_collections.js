/// <reference path="../pb_data/types.d.ts" />

// The scrap-buying module was retired before it shipped. These collections were
// created by the 1783414524_* migrations and never held any records, so they are
// dropped here to stop a fresh deploy from recreating an unused schema.
// Down is intentionally a no-op: the original create migrations still exist and
// remain the way to bring the schema back.
const RETIRED_COLLECTIONS = [
  'supplier_payment_allocations',
  'purchase_deductions',
  'purchase_items',
  'supplier_payments',
  'purchase_bills',
  'suppliers',
]

migrate((app) => {
  for (const name of RETIRED_COLLECTIONS) {
    try {
      app.delete(app.findCollectionByNameOrId(name))
    } catch {
      // Already absent — nothing to drop.
    }
  }
}, () => {
  // No-op: see note above.
})
