/// <reference path="../pb_data/types.d.ts" />
// The Muse permissions migration (1787393500) locked brass_rates and the stock
// collections behind @request.auth.id, but the web app talks to PocketBase
// unauthenticated, so those pages silently returned zero rows. This restores the
// pre-Muse public rules. Casting collections are intentionally left locked —
// the module is unused for now.
migrate((app) => {
  const names = ['brass_rates', 'stock_in', 'stock_adjustments', 'stock_openings']
  for (const name of names) {
    const collection = app.findCollectionByNameOrId(name)
    collection.listRule = ''
    collection.viewRule = ''
    collection.createRule = ''
    collection.updateRule = ''
    collection.deleteRule = ''
    app.save(collection)
  }
}, (app) => {
  const locked = '@request.auth.id != "" && @request.auth.role != "muse"'
  const names = ['brass_rates', 'stock_in', 'stock_adjustments', 'stock_openings']
  for (const name of names) {
    const collection = app.findCollectionByNameOrId(name)
    collection.listRule = locked
    collection.viewRule = locked
    collection.createRule = locked
    collection.updateRule = locked
    collection.deleteRule = locked
    app.save(collection)
  }
})
