/// <reference path="../pb_data/types.d.ts" />
// Phase 1 schema only. Existing API rules are deliberately unchanged here.
// Anonymous staging remains possible until the separately staged rules migration
// is deliberately installed after Muse's authenticated login is verified.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const bills = app.findCollectionByNameOrId('purchase_bills')
  const collection = new Collection({
    name: 'purchase_bill_drafts', type: 'base', system: false,
    listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '',
    fields: [
      { name: 'payload', type: 'json', required: true, maxSize: 131072 },
      { name: 'schema_version', type: 'number', required: true, onlyInt: true, min: 1 },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending_review', 'approved', 'rejected'] },
      { name: 'created_by', type: 'relation', collectionId: users.id, maxSelect: 1, minSelect: 0, cascadeDelete: false },
      { name: 'source_message_id', type: 'text', required: true, min: 1, max: 200 },
      { name: 'raw_text', type: 'text', required: false, max: 0 },
      { name: 'confidence', type: 'number', required: false, min: 0, max: 1 },
      { name: 'notes', type: 'text', required: false, max: 0 },
      { name: 'converted_bill', type: 'relation', collectionId: bills.id, maxSelect: 1, minSelect: 0, cascadeDelete: false },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_purchase_bill_drafts_source ON purchase_bill_drafts (created_by, source_message_id)'],
  })
  app.save(collection)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('purchase_bill_drafts'))
})
