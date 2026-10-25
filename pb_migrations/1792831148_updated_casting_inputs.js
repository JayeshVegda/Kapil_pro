/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3437597585")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @request.auth.role != \"muse\"",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.role != \"muse\"",
    "listRule": "@request.auth.id != \"\" && @request.auth.role != \"muse\"",
    "updateRule": "@request.auth.id != \"\" && @request.auth.role != \"muse\"",
    "viewRule": "@request.auth.id != \"\" && @request.auth.role != \"muse\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3437597585")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @request.auth.email != \"muse@kapil.cosearch.me\"",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.email != \"muse@kapil.cosearch.me\"",
    "listRule": "@request.auth.id != \"\" && @request.auth.email != \"muse@kapil.cosearch.me\"",
    "updateRule": "@request.auth.id != \"\" && @request.auth.email != \"muse@kapil.cosearch.me\"",
    "viewRule": "@request.auth.id != \"\" && @request.auth.email != \"muse@kapil.cosearch.me\""
  }, collection)

  return app.save(collection)
})
