/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // add field
  collection.fields.addAt(6, new Field({
    "help": "",
    "hidden": false,
    "id": "select1035821941",
    "maxSelect": 1,
    "name": "cust_type",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "gas",
      "electronic",
      "both"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_108570809")

  // remove field
  collection.fields.removeById("select1035821941")

  return app.save(collection)
})
