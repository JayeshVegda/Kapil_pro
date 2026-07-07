/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_588311121")

  // remove field
  collection.fields.removeById("autodate2990389176")

  // remove field
  collection.fields.removeById("autodate3332085495")

  // add field
  collection.fields.addAt(12, new Field({
    "help": "",
    "hidden": false,
    "id": "number3631400553",
    "max": null,
    "min": null,
    "name": "metal_cost_per_kg",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "help": "",
    "hidden": false,
    "id": "number1434114248",
    "max": null,
    "min": null,
    "name": "coal_cost_per_kg",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(14, new Field({
    "help": "",
    "hidden": false,
    "id": "number3599059258",
    "max": null,
    "min": null,
    "name": "worker_cost_per_kg",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(15, new Field({
    "help": "",
    "hidden": false,
    "id": "number691603217",
    "max": null,
    "min": null,
    "name": "final_product_cost_per_kg",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_588311121")

  // add field
  collection.fields.addAt(15, new Field({
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
  collection.fields.addAt(16, new Field({
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
  collection.fields.removeById("number3631400553")

  // remove field
  collection.fields.removeById("number1434114248")

  // remove field
  collection.fields.removeById("number3599059258")

  // remove field
  collection.fields.removeById("number691603217")

  return app.save(collection)
})
