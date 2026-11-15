/// <reference path="../pb_data/types.d.ts" />
// NOT ACTIVE. Move this file into pb_migrations/ only AFTER Muse authenticates
// successfully and the disposable API-rule tests pass. PocketBase automatically
// applies every pending file in pb_migrations/ on restart.
migrate((app) => {
  const signedIn = '@request.auth.id != ""'
  const operator = `${signedIn} && @request.auth.role != "muse" && @request.auth.email != "muse@kapil.cosearch.me"`
  const muse = `${signedIn} && @request.auth.role = "muse"`
  const pending = 'status = "pending_review"'

  // Preserve authenticated Muse's live Sales reads for current-state checks,
  // while closing every direct write path to live Sales records.
  for (const name of ['bills', 'bill_items', 'payments', 'customers', 'items', 'brass_rates']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.listRule = signedIn
    collection.viewRule = signedIn
    collection.createRule = operator
    collection.updateRule = operator
    collection.deleteRule = operator
    app.save(collection)
  }

  for (const [name, converted] of [['bill_drafts', 'converted_bill'], ['payment_drafts', 'converted_payment'], ['purchase_bill_drafts', 'converted_bill']]) {
    const collection = app.findCollectionByNameOrId(name)
    collection.listRule = `(${operator}) || (${muse} && created_by = @request.auth.id)`
    collection.viewRule = collection.listRule
    // The create hook derives created_by from the real request auth. Status and
    // converted relation cannot be supplied as already completed by Muse.
    collection.createRule = `${signedIn} && @request.body.status = "pending_review" && @request.body.${converted}:isset = false`
    // The rule tests the CURRENT row status. A second batch update after the
    // first approval fails, rolling back that second batch's live record create.
    // Approval must carry the converted link; rejection leaves it empty.
    collection.updateRule = `(${operator} && ${pending} && @request.body.created_by:changed = false && (` +
      `@request.body.status:isset = false || @request.body.status = "rejected" || ` +
      `(@request.body.status = "approved" && @request.body.${converted} != ""))) || ` +
      `(${muse} && created_by = @request.auth.id && ${pending} && ` +
      `@request.body.status:changed = false && @request.body.${converted}:changed = false && ` +
      `@request.body.created_by:changed = false)`
    collection.deleteRule = `(${operator} && ${pending}) || (${muse} && created_by = @request.auth.id && ${pending})`
    app.save(collection)
  }

  for (const name of ['bill_draft_items', 'bill_draft_payments']) {
    const collection = app.findCollectionByNameOrId(name)
    const parentOwned = `${muse} && draft.created_by = @request.auth.id && draft.status = "pending_review"`
    collection.listRule = `(${operator}) || (${muse} && draft.created_by = @request.auth.id)`
    collection.viewRule = collection.listRule
    collection.createRule = `(${operator}) || (${parentOwned})`
    collection.updateRule = `(${operator} && draft.status = "pending_review") || (${parentOwned} && @request.body.draft:changed = false)`
    collection.deleteRule = `(${operator} && draft.status = "pending_review") || (${parentOwned})`
    app.save(collection)
  }
}, (app) => {
  // Rollback is deliberately NOT a return to anonymous financial writes.
  // If a rule proves too strict, deploy a new corrective migration instead.
})
