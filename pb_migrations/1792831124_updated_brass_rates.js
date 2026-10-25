/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2853947365")

  // update collection data
  unmarshal({
    "listRule": "@request.auth.id != \"\" && @request.auth.email != \"muse@kapil.cosearch.me\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2853947365")

  // update collection data
  unmarshal({
    "listRule": "@request.auth.id != \"\" && @request.auth.id != \"ctfyi6ji1gvboks\""
  }, collection)

  return app.save(collection)
})
