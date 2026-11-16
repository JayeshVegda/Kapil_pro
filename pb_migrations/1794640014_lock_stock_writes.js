/// <reference path="../pb_data/types.d.ts" />
// Stock is a separate ledger. Muse may inspect it, but only the operator may mutate it.
migrate((app) => {
  const signedIn = '@request.auth.id != ""'
  const operator = `${signedIn} && @request.auth.role != "muse" && @request.auth.email != "muse@kapil.cosearch.me"`
  for (const name of ['stock_in', 'stock_adjustments', 'stock_openings']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.listRule = signedIn
    collection.viewRule = signedIn
    collection.createRule = operator
    collection.updateRule = operator
    collection.deleteRule = operator
    app.save(collection)
  }
}, () => {
  // Roll back with a new corrective migration; never reopen anonymous stock writes.
})
