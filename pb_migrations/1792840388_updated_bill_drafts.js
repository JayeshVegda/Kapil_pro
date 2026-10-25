/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_190482850")

  // add field
  collection.fields.addAt(13, new Field({
    "help": "",
    "hidden": false,
    "id": "number3459382478",
    "max": null,
    "min": null,
    "name": "book_no",
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
    "id": "number3256835514",
    "max": null,
    "min": null,
    "name": "bill_no",
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
    "id": "number1848608296",
    "max": null,
    "min": null,
    "name": "mkt",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(16, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text4277285639",
    "max": 0,
    "min": 0,
    "name": "gst_mode",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(17, new Field({
    "help": "",
    "hidden": false,
    "id": "number3682295738",
    "max": null,
    "min": null,
    "name": "gst_amount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(18, new Field({
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

  // add field
  collection.fields.addAt(19, new Field({
    "help": "",
    "hidden": false,
    "id": "number4108301504",
    "max": null,
    "min": null,
    "name": "bill_total",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_190482850")

  // remove field
  collection.fields.removeById("number3459382478")

  // remove field
  collection.fields.removeById("number3256835514")

  // remove field
  collection.fields.removeById("number1848608296")

  // remove field
  collection.fields.removeById("text4277285639")

  // remove field
  collection.fields.removeById("number3682295738")

  // remove field
  collection.fields.removeById("json1708301106")

  // remove field
  collection.fields.removeById("number4108301504")

  return app.save(collection)
})
