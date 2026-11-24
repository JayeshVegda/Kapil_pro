/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const signedIn = '@request.auth.id != ""'
  const muse = '(@request.auth.role = "muse" || @request.auth.email = "muse@kapil.cosearch.me")'
  const operator = '(@request.auth.role != "muse" && @request.auth.email != "muse@kapil.cosearch.me")'
  const own = `(${muse} && created_by = @request.auth.id)`
  app.save(new Collection({
    name: 'muse_purchase_action_drafts', type: 'base',
    listRule: `${signedIn} && (${operator} || ${own})`,
    viewRule: `${signedIn} && (${operator} || ${own})`,
    createRule: `${signedIn} && ${muse} && @request.body.created_by = @request.auth.id && @request.body.status = "pending_review" && @request.body.converted_record:isset = false`,
    updateRule: `${signedIn} && ${operator} && status = "pending_review" && @request.body.created_by:changed = false && @request.body.payload:changed = false && @request.body.source_message_id:changed = false && @request.body.raw_text:changed = false && ((@request.body.status = "approved" && @request.body.converted_record != "") || (@request.body.status = "rejected" && @request.body.converted_record:isset = false))`,
    deleteRule: null,
    fields: [
      { name: 'created_by', type: 'relation', collectionId: users.id, required: true, maxSelect: 1 },
      { name: 'source_message_id', type: 'text', required: true, max: 200 },
      { name: 'raw_text', type: 'text', max: 4000 },
      { name: 'payload', type: 'json', required: true, maxSize: 40000 },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending_review', 'approved', 'rejected'] },
      { name: 'converted_record', type: 'text', max: 15 },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_muse_purchase_action_source ON muse_purchase_action_drafts (created_by, source_message_id)'],
  }))
}, (app) => app.delete(app.findCollectionByNameOrId('muse_purchase_action_drafts')))
