/// <reference path="../pb_data/types.d.ts" />
// purchase_bardan.rate_line must NOT cascade-delete. Bill edits legitimately
// remove or replace rate lines, and every bardan entry keeps its own
// rate_milli snapshot, so an emptied reference is safe while losing the
// settlement entry (and its payable credit) is not.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("purchase_bardan")
  collection.fields.getByName("rate_line").cascadeDelete = false
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("purchase_bardan")
  collection.fields.getByName("rate_line").cascadeDelete = true
  app.save(collection)
})
