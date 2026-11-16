/// <reference path="../pb_data/types.d.ts" />
// Operational redesign Phase 2 — saved list views (Purchase Bills page filters).
// Owner-only, filter configuration only (never data): one row per saved view,
// `config` holds a JSON string of URL filter params. Append-only workflow:
// views are created, renamed, and deleted by the owner; no shared scope.
migrate((app) => {
  const nonMuse = '@request.auth.id != "" && @request.auth.role != "muse" && @request.auth.email != "muse@kapil.cosearch.me"'
  const signedIn = '@request.auth.id != ""'
  const ownRow = (base) => `${base} && owner = @request.auth.id`
  const collection = new Collection({
    name: 'saved_views', type: 'base', system: false,
    listRule: ownRow(signedIn), viewRule: ownRow(signedIn), createRule: nonMuse, updateRule: ownRow(nonMuse), deleteRule: ownRow(nonMuse),
    fields: [
      { name: 'id', type: 'text', id: 'savedviewsid001', system: true, primaryKey: true, required: true, min: 15, max: 15, pattern: '^[a-z0-9]+$', autogeneratePattern: '[a-z0-9]{15}' },
      { name: 'name', type: 'text', id: 'savedviewsname1', required: true, min: 1, max: 60 },
      { name: 'scope', type: 'text', id: 'savedviewsscope', required: true, min: 1, max: 40 },
      { name: 'config', type: 'text', id: 'savedviewsconf1', required: true, min: 1, max: 2000 },
      { name: 'owner', type: 'text', id: 'savedviewsowner', required: true, min: 15, max: 15, pattern: '^[a-z0-9]+$' },
      { name: 'created', type: 'autodate', id: 'savedviewscreat', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', id: 'savedviewsupdt', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_saved_views_owner_scope_name ON saved_views (owner, scope, name)'],
  })
  app.save(collection)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('saved_views'))
})
