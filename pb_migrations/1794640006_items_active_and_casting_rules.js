/// <reference path="../pb_data/types.d.ts" />
// Sale item active state and consistent operator access to casting materials.
migrate((app) => {
  const items = app.findCollectionByNameOrId('items')
  if (!items.fields.getByName('active')) {
    items.fields.addAt(items.fields.length, new Field({ name: 'active', type: 'bool', id: 'itemsactive0001' }))
    app.save(items)
    app.db().newQuery('UPDATE items SET active = 1').execute()
  }
  const casting = app.findCollectionByNameOrId('casting_materials')
  const owner = '@request.auth.id != "" && @request.auth.role != "muse"'
  casting.listRule = owner
  casting.viewRule = owner
  casting.createRule = owner
  casting.updateRule = owner
  casting.deleteRule = owner
  app.save(casting)
}, (app) => {
  const items = app.findCollectionByNameOrId('items')
  if (items.fields.getByName('active')) items.fields.removeByName('active')
  app.save(items)
})
