/// <reference path="../pb_data/types.d.ts" />
// Phase 1 Supplier Purchase module — supplier master + purchase item master.
// Money is stored as integer paise (opening balances signed: + = we owe).
// Public API rules ("") match the app's unauthenticated localhost posture.
// Works on any PocketBase >= 0.23 (fresh "fields" Collection API, like 1793620187).
migrate((app) => {
  const suppliers = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "f1id_id0000001", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f1company_name1", "max": 0, "min": 1, "name": "company_name", "pattern": "", "presentable": true, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f1contact_name1", "max": 0, "min": 0, "name": "contact_name", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f1phone0000001", "max": 0, "min": 0, "name": "phone", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f1gstno000001", "max": 0, "min": 0, "name": "gst_no", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f1city0000001", "max": 0, "min": 0, "name": "city", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f1notes000001", "max": 0, "min": 0, "name": "notes", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "help": "signed paise: + = we owe supplier", "hidden": false, "id": "f1openkac00001", "max": null, "min": null, "name": "opening_kacha_paise", "onlyInt": true, "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "number" },
      { "help": "signed paise: + = we owe supplier", "hidden": false, "id": "f1opengst00001", "max": null, "min": null, "name": "opening_gst_paise", "onlyInt": true, "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "number" },
      { "autogeneratePattern": "", "help": "YYYY-MM-DD", "hidden": false, "id": "f1opendate001", "max": 0, "min": 0, "name": "opening_balance_date", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "f1active00001", "name": "active", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "bool" },
      { "hidden": false, "id": "f1created00001", "name": "created", "onCreate": true, "onUpdate": false, "presentable": false, "system": false, "type": "autodate" },
      { "hidden": false, "id": "f1updated00001", "name": "updated", "onCreate": true, "onUpdate": true, "presentable": false, "system": false, "type": "autodate" }
    ],
    "id": "pbc_1794640001",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_suppliers_company_name_unique` ON `suppliers` (`company_name`)"
    ],
    "listRule": "",
    "name": "suppliers",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });
  app.save(suppliers);

  const purchaseItems = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "f2id_id0000001", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f2name0000001", "max": 0, "min": 1, "name": "name", "pattern": "", "presentable": true, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "hidden": false, "id": "f2active00001", "name": "active", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "bool" },
      { "hidden": false, "id": "f2created00001", "name": "created", "onCreate": true, "onUpdate": false, "presentable": false, "system": false, "type": "autodate" },
      { "hidden": false, "id": "f2updated00001", "name": "updated", "onCreate": true, "onUpdate": true, "presentable": false, "system": false, "type": "autodate" }
    ],
    "id": "pbc_1794640102",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_purchase_items_name_unique` ON `purchase_items` (`name`)"
    ],
    "listRule": "",
    "name": "purchase_items",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });
  app.save(purchaseItems);

  const brassScrap = new Record("purchase_items");
  brassScrap.set("name", "brass scrap");
  brassScrap.set("active", true);
  app.save(brassScrap);
  for (const seedName of ["chol", "pata", "marobol", "sisu", "coal"]) {
    const seed = new Record("purchase_items");
    seed.set("name", seedName);
    seed.set("active", true);
    app.save(seed);
  }
}, (app) => {
  ["chol", "pata", "marobol", "sisu", "coal"].forEach((name) => {
    const found = app.findRecordsByFilter("purchase_items", `name = '${name}'`, "", 1, 0);
    found.forEach((row) => {
      app.delete(row);
    });
  });
  const brass = app.findRecordsByFilter("purchase_items", "name = 'brass scrap'", "", 1, 0);
  brass.forEach((row) => {
    app.delete(row);
  });
  const items = app.findCollectionByNameOrId("purchase_items");
  app.delete(items);
  const suppliers = app.findCollectionByNameOrId("suppliers");
  app.delete(suppliers);
})
