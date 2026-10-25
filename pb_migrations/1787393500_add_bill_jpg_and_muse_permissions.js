/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // 1. Add bill_jpg to bills collection
  const bills = app.findCollectionByNameOrId("bills")
  if (!bills.fields.getByName("bill_jpg")) {
    bills.fields.addAt(bills.fields.length, new Field({
      "hidden": false,
      "id": "file_bill_jpg",
      "maxSelect": 1,
      "maxSize": 5242880,
      "mimeTypes": ["image/jpeg"],
      "name": "bill_jpg",
      "presentable": false,
      "protected": false,
      "required": false,
      "system": false,
      "thumbs": null,
      "type": "file"
    }))
    app.save(bills)
  }

  // 2. Add role to users collection
  const users = app.findCollectionByNameOrId("users")
  if (!users.fields.getByName("role")) {
    users.fields.addAt(users.fields.length, new Field({
      "hidden": false,
      "id": "select_role",
      "maxSelect": 1,
      "name": "role",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "select",
      "values": ["operator", "muse"]
    }))
    app.save(users)
  }

  // 3. Restrict non-billing collections for muse
  const nonBilling = [
    'brass_rates', 'casting_sessions', 'casting_inputs', 'casting_materials',
    'casting2_sessions', 'casting2_materials', 'casting2_inputs',
    'stock_in', 'stock_adjustments', 'stock_openings', 'casting_batches', 'casting_batch_inputs'
  ]
  const restrictedRule = '@request.auth.id != "" && @request.auth.role != "muse"'
  for (const name of nonBilling) {
    try {
      const col = app.findCollectionByNameOrId(name)
      col.listRule = restrictedRule
      col.viewRule = restrictedRule
      col.createRule = restrictedRule
      col.updateRule = restrictedRule
      col.deleteRule = restrictedRule
      app.save(col)
    } catch {
      // ignore missing collection
    }
  }
}, (app) => {
  // Down migration
  try {
    const bills = app.findCollectionByNameOrId("bills")
    bills.fields.removeById("file_bill_jpg")
    app.save(bills)
  } catch {}

  try {
    const users = app.findCollectionByNameOrId("users")
    users.fields.removeById("select_role")
    app.save(users)
  } catch {}
})
