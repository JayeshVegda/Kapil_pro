/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_588311121")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.role != \"muse\"",
    "deleteRule": "@request.auth.role != \"muse\"",
    "listRule": "@request.auth.role != \"muse\"",
    "updateRule": "@request.auth.role != \"muse\"",
    "viewRule": "@request.auth.role != \"muse\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_588311121")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @request.auth.role != \"muse\"",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.role != \"muse\"",
    "listRule": "@request.auth.id != \"\" && @request.auth.role != \"muse\"",
    "updateRule": "@request.auth.id != \"\" && @request.auth.role != \"muse\"",
    "viewRule": "@request.auth.id != \"\" && @request.auth.role != \"muse\""
  }, collection)

  return app.save(collection)
})
