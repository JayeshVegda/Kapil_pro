/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const sales = app.findCollectionByNameOrId('bill_drafts')
  sales.fields.add(new Field({ name: 'muse_new_customer', type: 'bool' }))
  sales.updateRule = `(${sales.updateRule}) && @request.body.muse_new_customer:changed = false`
  app.save(sales)
  for (const name of ['purchase_bill_drafts', 'purchase_payment_drafts']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.fields.add(new Field({ name: 'supplier_draft', type: 'text', max: 15, pattern: '^[a-z0-9]{15}$' }))
    collection.updateRule = `(${collection.updateRule}) && @request.body.supplier_draft:changed = false`
    app.save(collection)
  }
}, (app) => {
  for (const [name, field] of [['bill_drafts', 'muse_new_customer'], ['purchase_bill_drafts', 'supplier_draft'], ['purchase_payment_drafts', 'supplier_draft']]) {
    const collection = app.findCollectionByNameOrId(name)
    const ending = ') && @request.body.' + field + ':changed = false'
    if (collection.updateRule?.endsWith(ending)) collection.updateRule = collection.updateRule.slice(1, -ending.length)
    collection.fields.removeByName(field)
    app.save(collection)
  }
})
