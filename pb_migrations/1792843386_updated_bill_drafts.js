/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_190482850")

  // remove field
  collection.fields.removeById("json3776899405")

  // remove field
  collection.fields.removeById("json1708301106")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_190482850")

  // add field
  collection.fields.addAt(15, new Field({
    "help": "",
    "hidden": false,
    "id": "json3776899405",
    "maxSize": 0,
    "name": "items",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(16, new Field({
    "help": "",
    "hidden": false,
    "id": "json1708301106",
    "maxSize": 0,
    "name": "payments",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
})
