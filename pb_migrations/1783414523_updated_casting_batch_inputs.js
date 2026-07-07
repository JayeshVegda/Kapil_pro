/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_767253123")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX idx_casting_batch_inputs_batch ON casting_batch_inputs (batch)",
      "CREATE INDEX idx_casting_batch_inputs_material ON casting_batch_inputs (material)",
      "CREATE INDEX idx_casting_batch_inputs_material_name ON casting_batch_inputs (material_name)"
    ]
  }, collection)

  // remove field
  collection.fields.removeById("autodate2990389176")

  // remove field
  collection.fields.removeById("autodate3332085495")

  // add field
  collection.fields.addAt(2, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_58476158",
    "help": "",
    "hidden": false,
    "id": "relation2092856725",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "material",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_767253123")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX idx_casting_batch_inputs_batch ON casting_batch_inputs (batch)",
      "CREATE INDEX idx_casting_batch_inputs_material_name ON casting_batch_inputs (material_name)"
    ]
  }, collection)

  // add field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "autodate2990389176",
    "name": "created",
    "onCreate": true,
    "onUpdate": false,
    "presentable": true,
    "system": false,
    "type": "autodate"
  }))

  // add field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "autodate3332085495",
    "name": "updated",
    "onCreate": true,
    "onUpdate": true,
    "presentable": true,
    "system": false,
    "type": "autodate"
  }))

  // remove field
  collection.fields.removeById("relation2092856725")

  return app.save(collection)
})
