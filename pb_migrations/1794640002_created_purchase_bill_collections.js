/// <reference path="../pb_data/types.d.ts" />
// Phase 1 — purchase bills, lines, adjustments, bardan.
// Integer math everywhere: weight_g = integer grams (3-decimal kg), rate_milli =
// integer milli-rupees (3-decimal rupees/kg), amount_paise = integer paise.
// amount_paise = roundHalfUp(weight_g * rate_milli / 10000) computed in the data layer.
// in_no is UNIQUE and never reused (own series IN-<FY>-<0001>, FY Apr-Mar).
// group_id is a plain random id shared by bills created via merge/split.
// Soft delete via cancelled flag + cancel_reason only. No hard deletes.
migrate((app) => {
  const bills = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "f3id_id0000001", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "cascadeDelete": false, "collectionId": "pbc_1794640001", "hidden": false, "id": "f3supplier0001", "maxSelect": 1, "minSelect": 1, "name": "supplier", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "relation" },
      { "autogeneratePattern": "", "help": "own series IN-<FY>-<0001>, never reused", "hidden": false, "id": "f3inno000001", "max": 0, "min": 1, "name": "in_no", "pattern": "", "presentable": true, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f3sino0000001", "max": 0, "min": 0, "name": "supplier_bill_no", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "help": "YYYY-MM-DD business date", "hidden": false, "id": "f3date000001", "max": 0, "min": 0, "name": "date", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "hidden": false, "id": "f3pool000001", "maxSelect": 1, "name": "pool", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "select", "values": ["kacha", "gst"] },
      { "hidden": false, "id": "f3taxmode001", "maxSelect": 1, "name": "tax_mode", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "select", "values": ["none", "gst", "rcm"] },
      { "help": "basis points of taxable value; used by gst and rcm modes", "hidden": false, "id": "f3gstratebp1", "max": null, "min": null, "name": "gst_rate_bp", "onlyInt": true, "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "number" },
      { "autogeneratePattern": "", "help": "shared by bills created via merge/split", "hidden": false, "id": "f3groupid001", "max": 0, "min": 0, "name": "group_id", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f3vehicle0001", "max": 0, "min": 0, "name": "vehicle_no", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "help": "never printed", "hidden": false, "id": "f3privnote01", "max": 0, "min": 0, "name": "private_note", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "f3photos0001", "maxSelect": 10, "maxSize": 52428800, "name": "photos", "presentable": false, "primaryKey": false, "required": false, "system": false, "thumbs": [], "type": "file" },
      { "hidden": false, "id": "f3cancelled1", "name": "cancelled", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "bool" },
      { "autogeneratePattern": "", "hidden": false, "id": "f3cancelrs01", "max": 0, "min": 0, "name": "cancel_reason", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "f3created0001", "name": "created", "onCreate": true, "onUpdate": false, "presentable": false, "system": false, "type": "autodate" },
      { "hidden": false, "id": "f3updated0001", "name": "updated", "onCreate": true, "onUpdate": true, "presentable": false, "system": false, "type": "autodate" }
    ],
    "id": "pbc_1794640203",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_purchase_bills_in_no_unique` ON `purchase_bills` (`in_no`)",
      "CREATE INDEX `idx_purchase_bills_supplier` ON `purchase_bills` (`supplier`)",
      "CREATE INDEX `idx_purchase_bills_date` ON `purchase_bills` (`date`)",
      "CREATE INDEX `idx_purchase_bills_pool` ON `purchase_bills` (`pool`)",
      "CREATE INDEX `idx_purchase_bills_group` ON `purchase_bills` (`group_id`)"
    ],
    "listRule": "",
    "name": "purchase_bills",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });
  app.save(bills);

  const lines = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "f4id_id0000001", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "cascadeDelete": true, "collectionId": "pbc_1794640203", "hidden": false, "id": "f4bill000001", "maxSelect": 1, "minSelect": 1, "name": "bill", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "relation" },
      { "cascadeDelete": false, "collectionId": "pbc_1794640102", "hidden": false, "id": "f4item000001", "maxSelect": 1, "minSelect": 0, "name": "item", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "relation" },
      { "autogeneratePattern": "", "help": "item name copy, kept even if the master item is removed", "hidden": false, "id": "f4itemname01", "max": 0, "min": 0, "name": "item_name", "pattern": "", "presentable": true, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "help": "integer grams (3-decimal kg)", "hidden": false, "id": "f4weightg001", "max": null, "min": null, "name": "weight_g", "onlyInt": true, "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "number" },
      { "help": "integer milli-rupees (3-decimal rupees/kg)", "hidden": false, "id": "f4ratemil001", "max": null, "min": null, "name": "rate_milli", "onlyInt": true, "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "number" },
      { "help": "roundHalfUp(weight_g * rate_milli / 10000)", "hidden": false, "id": "f4amountp01", "max": null, "min": null, "name": "amount_paise", "onlyInt": true, "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "number" },
      { "hidden": false, "id": "f4created0001", "name": "created", "onCreate": true, "onUpdate": false, "presentable": false, "system": false, "type": "autodate" },
      { "hidden": false, "id": "f4updated0001", "name": "updated", "onCreate": true, "onUpdate": true, "presentable": false, "system": false, "type": "autodate" }
    ],
    "id": "pbc_1794640304",
    "indexes": [
      "CREATE INDEX `idx_purchase_bill_lines_bill` ON `purchase_bill_lines` (`bill`)",
      "CREATE INDEX `idx_purchase_bill_lines_item` ON `purchase_bill_lines` (`item`)"
    ],
    "listRule": "",
    "name": "purchase_bill_lines",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });
  app.save(lines);

  const adjustments = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "f5id_id0000001", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "cascadeDelete": true, "collectionId": "pbc_1794640203", "hidden": false, "id": "f5bill000001", "maxSelect": 1, "minSelect": 1, "name": "bill", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "relation" },
      { "hidden": false, "id": "f5type000001", "maxSelect": 1, "name": "type", "presentable": true, "primaryKey": false, "required": true, "system": false, "type": "select", "values": ["labour", "transport", "quality_cut", "other"] },
      { "help": "signed paise; quality_cut entered positive and applied as a reduction", "hidden": false, "id": "f5amountp001", "max": null, "min": null, "name": "amount_paise", "onlyInt": true, "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "number" },
      { "autogeneratePattern": "", "hidden": false, "id": "f5note000001", "max": 0, "min": 0, "name": "note", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "f5created0001", "name": "created", "onCreate": true, "onUpdate": false, "presentable": false, "system": false, "type": "autodate" },
      { "hidden": false, "id": "f5updated0001", "name": "updated", "onCreate": true, "onUpdate": true, "presentable": false, "system": false, "type": "autodate" }
    ],
    "id": "pbc_1794640405",
    "indexes": [
      "CREATE INDEX `idx_pbill_adjustments_bill` ON `purchase_bill_adjustments` (`bill`)"
    ],
    "listRule": "",
    "name": "purchase_bill_adjustments",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });
  app.save(adjustments);

  const bardan = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "f6id_id0000001", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "cascadeDelete": true, "collectionId": "pbc_1794640203", "hidden": false, "id": "f6bill000001", "maxSelect": 1, "minSelect": 1, "name": "bill", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "relation" },
      { "help": "integer grams (3-decimal kg) of empty-bag weight", "hidden": false, "id": "f6barding01", "max": null, "min": null, "name": "bardan_g", "onlyInt": true, "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "number" },
      { "cascadeDelete": true, "help": "which bill line's rate applies; empty = main brass line", "hidden": false, "id": "f6rateline01", "maxSelect": 1, "minSelect": 0, "name": "rate_line", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "relation" },
      { "help": "snapshot of the applied line rate in milli-rupees; kept because line rates can be edited later", "hidden": false, "id": "f6ratedsnp01", "max": null, "min": null, "name": "rate_milli", "onlyInt": true, "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "number" },
      { "hidden": false, "id": "f6method0001", "maxSelect": 1, "name": "method", "presentable": true, "primaryKey": false, "required": true, "system": false, "type": "select", "values": ["deduct", "in_kind", "cash_back", "advance"] },
      { "help": "deduct only: roundHalfUp(bardan_g * rate_milli / 10000)", "hidden": false, "id": "f6creditp01", "max": null, "min": null, "name": "credit_paise", "onlyInt": true, "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "number" },
      { "help": "cash_back only: money the supplier refunds, information only, no payable effect", "hidden": false, "id": "f6cashamt01", "max": null, "min": null, "name": "cash_amount_paise", "onlyInt": true, "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "number" },
      { "autogeneratePattern": "", "hidden": false, "id": "f6date000001", "max": 0, "min": 0, "name": "date", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f6note000001", "max": 0, "min": 0, "name": "note", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "f6created0001", "name": "created", "onCreate": true, "onUpdate": false, "presentable": false, "system": false, "type": "autodate" },
      { "hidden": false, "id": "f6updated0001", "name": "updated", "onCreate": true, "onUpdate": true, "presentable": false, "system": false, "type": "autodate" }
    ],
    "id": "pbc_1794640506",
    "indexes": [
      "CREATE INDEX `idx_purchase_bardan_bill` ON `purchase_bardan` (`bill`)"
    ],
    "listRule": "",
    "name": "purchase_bardan",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });
  app.save(bardan);
}, (app) => {
  ["purchase_bardan", "purchase_bill_adjustments", "purchase_bill_lines", "purchase_bills"].forEach((name) => {
    const collection = app.findCollectionByNameOrId(name);
    app.delete(collection);
  });
})
