/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId('purchase_payment_drafts')
  const signedIn = '@request.auth.id != ""'
  const isMuse = '(@request.auth.role = "muse" || @request.auth.email = "muse@kapil.cosearch.me")'
  const isOperator = '@request.auth.role != "muse" && @request.auth.email != "muse@kapil.cosearch.me"'
  const rule = `${signedIn} && ((${isOperator}) || (${isMuse} && created_by = @request.auth.id))`
  collection.listRule = rule
  collection.viewRule = rule
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('purchase_payment_drafts')
  collection.listRule = '@request.auth.id != ""'
  collection.viewRule = collection.listRule
  app.save(collection)
})
