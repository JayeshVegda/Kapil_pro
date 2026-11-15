/// <reference path="../pb_data/types.d.ts" />
// Muse needs read-only Purchase master lookup to propose drafts. Live writes
// remain operator-only and all other Purchase collections keep their rules.
migrate((app) => {
  const signedIn = '@request.auth.id != ""'
  for (const name of ['suppliers', 'purchase_items']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.listRule = signedIn
    collection.viewRule = signedIn
    app.save(collection)
  }
}, (app) => {
  const operator = '@request.auth.id != "" && @request.auth.role != "muse"'
  for (const name of ['suppliers', 'purchase_items']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.listRule = operator
    collection.viewRule = operator
    app.save(collection)
  }
})
