/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4052062603");

  return app.delete(collection);
}, (app) => {
  const collection = new Collection({
    "createRule": "@request.auth.id != \"\"",
    "deleteRule": "@request.auth.id != \"\"",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_1972890530",
        "help": "",
        "hidden": false,
        "id": "relation3964530706",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "supplier_payment",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_3512183661",
        "help": "",
        "hidden": false,
        "id": "relation177394048",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "purchase_bill",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "help": "",
        "hidden": false,
        "id": "number2392944706",
        "max": null,
        "min": null,
        "name": "amount",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      }
    ],
    "id": "pbc_4052062603",
    "indexes": [
      "CREATE INDEX idx_supplier_alloc_payment ON supplier_payment_allocations (supplier_payment)",
      "CREATE INDEX idx_supplier_alloc_bill ON supplier_payment_allocations (purchase_bill)"
    ],
    "listRule": "@request.auth.id != \"\"",
    "name": "supplier_payment_allocations",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  });

  return app.save(collection);
})
