/// <reference path="../pb_data/types.d.ts" />
// Shared optional-module switches. Seeded once; only the owner account may update it.
migrate((app) => {
  const owner = '@request.auth.id != "" && @request.auth.role != "muse" && @request.auth.email != "muse@kapil.cosearch.me"'
  const signedIn = '@request.auth.id != ""'
  const collection = new Collection({
    name: 'app_settings', type: 'base', system: false,
    listRule: signedIn, viewRule: signedIn, createRule: null, updateRule: owner, deleteRule: null,
    fields: [
      { name: 'id', type: 'text', id: 'appsettingsid01', system: true, primaryKey: true, required: true, min: 15, max: 15, pattern: '^[a-z0-9]+$', autogeneratePattern: '[a-z0-9]{15}' },
      { name: 'key', type: 'text', id: 'appsettingskey1', required: true, min: 1, max: 40 },
      { name: 'purchase_enabled', type: 'bool', id: 'apppurchaseflag' },
      { name: 'casting_enabled', type: 'bool', id: 'appcastingflag1' },
      { name: 'created', type: 'autodate', id: 'appcreateddate1', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', id: 'appupdateddate1', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_app_settings_key ON app_settings (key)'],
  })
  app.save(collection)
  const row = new Record(collection)
  row.set('id', 'globalsettings1')
  row.set('key', 'global_settings')
  row.set('purchase_enabled', true)
  row.set('casting_enabled', true)
  app.save(row)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('app_settings'))
})
