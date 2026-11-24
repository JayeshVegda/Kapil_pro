/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  for (const [name, index] of [['bill_drafts', 'idx_muse_sales_bill_source'], ['payment_drafts', 'idx_muse_sales_payment_source']]) {
    const collection = app.findCollectionByNameOrId(name)
    collection.fields.add(new Field({ name: 'muse_source_id', type: 'text', max: 160 }))
    collection.fields.add(new Field({ name: 'muse_request_hash', type: 'text', max: 64 }))
    collection.indexes = [...collection.indexes, `CREATE UNIQUE INDEX ${index} ON ${name} (created_by, muse_source_id) WHERE muse_source_id != ''`]
    app.save(collection)
  }
}, (app) => {
  for (const [name, index] of [['bill_drafts', 'idx_muse_sales_bill_source'], ['payment_drafts', 'idx_muse_sales_payment_source']]) {
    const collection = app.findCollectionByNameOrId(name)
    collection.indexes = collection.indexes.filter((sql) => !sql.includes(index))
    collection.fields.removeByName('muse_source_id')
    collection.fields.removeByName('muse_request_hash')
    app.save(collection)
  }
})
