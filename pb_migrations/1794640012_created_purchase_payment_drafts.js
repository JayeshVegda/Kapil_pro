/// <reference path="../pb_data/types.d.ts" />
// Drafts are proposals only. No direct-save behavior is attached to this flag.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const payments = app.findCollectionByNameOrId('supplier_payments')
  const signedIn = '@request.auth.id != ""'
  const muse = `${signedIn} && @request.auth.role = "muse"`
  const operator = `${signedIn} && @request.auth.role != "muse" && @request.auth.email != "muse@kapil.cosearch.me"`
  const ownPending = `${muse} && created_by = @request.auth.id && status = "pending_review"`
  app.save(new Collection({
    name: 'purchase_payment_drafts', type: 'base',
    listRule: signedIn, viewRule: signedIn,
    createRule: `${signedIn} && @request.body.status = "pending_review" && @request.body.converted_payment:isset = false`,
    updateRule: `(${operator} && status = "pending_review" && @request.body.created_by:changed = false && (` +
      `@request.body.status:isset = false || @request.body.status = "rejected" || ` +
      `(@request.body.status = "approved" && @request.body.converted_payment != ""))) || ` +
      `(${ownPending} && @request.body.status:changed = false && @request.body.converted_payment:changed = false && @request.body.created_by:changed = false)`,
    deleteRule: `(${operator} && status = "pending_review") || (${ownPending})`,
    fields: [
      { name: 'payload', type: 'json', required: true, maxSize: 131072 },
      { name: 'schema_version', type: 'number', required: true, onlyInt: true, min: 1 },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending_review', 'approved', 'rejected'] },
      { name: 'created_by', type: 'relation', collectionId: users.id, maxSelect: 1, minSelect: 0, cascadeDelete: false },
      { name: 'source_message_id', type: 'text', required: true, min: 1, max: 200 },
      { name: 'raw_text', type: 'text', max: 0 },
      { name: 'confidence', type: 'number', min: 0, max: 1 },
      { name: 'notes', type: 'text', max: 0 },
      { name: 'converted_payment', type: 'relation', collectionId: payments.id, maxSelect: 1, minSelect: 0, cascadeDelete: false },
      { name: 'direct_save', type: 'bool' },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_purchase_payment_drafts_source ON purchase_payment_drafts (created_by, source_message_id)'],
  }))
}, (app) => { app.delete(app.findCollectionByNameOrId('purchase_payment_drafts')) })
