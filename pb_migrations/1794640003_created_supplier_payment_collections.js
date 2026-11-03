/// <reference path="../pb_data/types.d.ts" />
// Phase 1 — supplier payments, manual allocation pins, audit log.
// Payment kinds: payment | paid_on_behalf | settle_off | refund_received | bardan_advance.
//   payment         = money we pay the supplier (reduces what we owe)
//   paid_on_behalf  = labour/transport paid on the supplier's behalf (reduces outstanding)
//   settle_off      = manual write-off of a tiny leftover (reduces outstanding)
//   refund_received = supplier money returned to us (receives, INCREASES what we owe)
//   bardan_advance  = credit created by a bardan "advance" settlement; unallocated,
//                     consumed like a payment by FIFO within the bill's pool
// refund_received is stored as a positive amount and acts like a new payable amount.
// bardan_advance is stored as a positive amount and acts like a payment.
// allocations are MANUAL pins only; FIFO matching is computed on read.
migrate((app) => {
  const payments = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "f7id_id0000001", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "cascadeDelete": false, "collectionId": "pbc_1794640001", "hidden": false, "id": "f7supplier01", "maxSelect": 1, "minSelect": 1, "name": "supplier", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "relation" },
      { "autogeneratePattern": "", "help": "YYYY-MM-DD business date", "hidden": false, "id": "f7date000001", "max": 0, "min": 0, "name": "date", "pattern": "", "presentable": true, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "hidden": false, "id": "f7pool000001", "maxSelect": 1, "name": "pool", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "select", "values": ["kacha", "gst"] },
      { "hidden": false, "id": "f7kind000001", "maxSelect": 1, "name": "kind", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "select", "values": ["payment", "paid_on_behalf", "settle_off", "refund_received", "bardan_advance"] },
      { "help": "always stored positive; direction comes from kind", "hidden": false, "id": "f7amountp01", "max": null, "min": null, "name": "amount_paise", "onlyInt": true, "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "number" },
      { "hidden": false, "id": "f7mode000001", "maxSelect": 1, "name": "mode", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "select", "values": ["cash", "upi", "rtgs", "neft", "cheque", "other"] },
      { "autogeneratePattern": "", "hidden": false, "id": "f7reference01", "max": 0, "min": 0, "name": "reference", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "help": "paid_on_behalf: who received the money (labour, transporter)", "hidden": false, "id": "f7payee00001", "max": 0, "min": 0, "name": "payee_name", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "help": "never printed", "hidden": false, "id": "f7privnote01", "max": 0, "min": 0, "name": "private_note", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "f7photos0001", "maxSelect": 10, "maxSize": 52428800, "name": "photos", "presentable": false, "primaryKey": false, "required": false, "system": false, "thumbs": [], "type": "file" },
      { "hidden": false, "id": "f7cancelled1", "name": "cancelled", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "bool" },
      { "autogeneratePattern": "", "hidden": false, "id": "f7cancelrs01", "max": 0, "min": 0, "name": "cancel_reason", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "f7created0001", "name": "created", "onCreate": true, "onUpdate": false, "presentable": false, "system": false, "type": "autodate" },
      { "hidden": false, "id": "f7updated0001", "name": "updated", "onCreate": true, "onUpdate": true, "presentable": false, "system": false, "type": "autodate" }
    ],
    "id": "pbc_1794640607",
    "indexes": [
      "CREATE INDEX `idx_supplier_payments_supplier` ON `supplier_payments` (`supplier`)",
      "CREATE INDEX `idx_supplier_payments_date` ON `supplier_payments` (`date`)",
      "CREATE INDEX `idx_supplier_payments_pool` ON `supplier_payments` (`pool`)"
    ],
    "listRule": "",
    "name": "supplier_payments",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });
  app.save(payments);

  const allocations = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "f8id_id0000001", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "cascadeDelete": true, "collectionId": "pbc_1794640607", "hidden": false, "id": "f8payment01", "maxSelect": 1, "minSelect": 1, "name": "payment", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "relation" },
      { "cascadeDelete": true, "collectionId": "pbc_1794640203", "hidden": false, "id": "f8bill000001", "maxSelect": 1, "minSelect": 1, "name": "bill", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "relation" },
      { "help": "manual pin amount in paise; FIFO handles the un-pinned remainder", "hidden": false, "id": "f8amountp01", "max": null, "min": null, "name": "amount_paise", "onlyInt": true, "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "number" },
      { "hidden": false, "id": "f8created0001", "name": "created", "onCreate": true, "onUpdate": false, "presentable": false, "system": false, "type": "autodate" },
      { "hidden": false, "id": "f8updated0001", "name": "updated", "onCreate": true, "onUpdate": true, "presentable": false, "system": false, "type": "autodate" }
    ],
    "id": "pbc_1794640708",
    "indexes": [
      "CREATE INDEX `idx_spalloc_payment` ON `supplier_payment_allocations` (`payment`)",
      "CREATE INDEX `idx_spalloc_bill` ON `supplier_payment_allocations` (`bill`)"
    ],
    "listRule": "",
    "name": "supplier_payment_allocations",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });
  app.save(allocations);

  const audit = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "f9id_id0000001", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "help": "collection name of the changed record", "hidden": false, "id": "f9collection1", "max": 0, "min": 0, "name": "collection", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f9recordid01", "max": 15, "min": 1, "name": "record_id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "help": "create | update | cancel | uncancel", "hidden": false, "id": "f9action0001", "max": 0, "min": 0, "name": "action", "pattern": "", "presentable": true, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f9beforej01", "max": 0, "min": 0, "name": "before_json", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f9afterj001", "max": 0, "min": 0, "name": "after_json", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "f9actor0001", "max": 0, "min": 0, "name": "actor", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "f9created0001", "name": "created", "onCreate": true, "onUpdate": false, "presentable": false, "system": false, "type": "autodate" }
    ],
    "id": "pbc_1794640809",
    "indexes": [
      "CREATE INDEX `idx_purchase_audit_record` ON `purchase_audit_log` (`record_id`)",
      "CREATE INDEX `idx_purchase_audit_created` ON `purchase_audit_log` (`created`)"
    ],
    "listRule": "",
    "name": "purchase_audit_log",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });
  app.save(audit);
}, (app) => {
  ["purchase_audit_log", "supplier_payment_allocations", "supplier_payments"].forEach((name) => {
    const collection = app.findCollectionByNameOrId(name);
    app.delete(collection);
  });
})
