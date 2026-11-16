/// <reference path="../pb_data/types.d.ts" />
// Casting drafts are owner-reviewed proposals. direct_save is data only.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const sessions = app.findCollectionByNameOrId('casting_sessions')
  const materials = app.findCollectionByNameOrId('casting_materials')
  materials.fields.add(new Field({ name: 'aliases', type: 'text', max: 2000 }))
  materials.listRule = '@request.auth.id != ""'
  materials.viewRule = '@request.auth.id != ""'
  app.save(materials)

  const signedIn = '@request.auth.id != ""'
  const muse = `${signedIn} && @request.auth.role = "muse"`
  const operator = `${signedIn} && @request.auth.role != "muse" && @request.auth.email != "muse@kapil.cosearch.me"`
  const ownPending = `${muse} && created_by = @request.auth.id && status = "pending_review"`
  app.save(new Collection({
    name: 'casting_session_drafts', type: 'base',
    listRule: `(${operator}) || (${muse} && created_by = @request.auth.id)`,
    viewRule: `(${operator}) || (${muse} && created_by = @request.auth.id)`,
    createRule: `${signedIn} && @request.body.status = "pending_review" && @request.body.converted_session:isset = false`,
    updateRule: `(${operator} && status = "pending_review" && @request.body.created_by:changed = false && (` +
      `@request.body.status:isset = false || @request.body.status = "rejected" || ` +
      `(@request.body.status = "approved" && @request.body.converted_session != ""))) || ` +
      `(${ownPending} && @request.body.status:changed = false && @request.body.converted_session:changed = false && @request.body.created_by:changed = false)`,
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
      { name: 'converted_session', type: 'relation', collectionId: sessions.id, maxSelect: 1, minSelect: 0, cascadeDelete: false },
      { name: 'direct_save', type: 'bool' },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_casting_session_drafts_source ON casting_session_drafts (created_by, source_message_id)'],
  }))
}, (app) => {
  app.delete(app.findCollectionByNameOrId('casting_session_drafts'))
  const materials = app.findCollectionByNameOrId('casting_materials')
  materials.fields.removeByName('aliases')
  const operator = '@request.auth.id != "" && @request.auth.role != "muse"'
  materials.listRule = operator
  materials.viewRule = operator
  app.save(materials)
})
