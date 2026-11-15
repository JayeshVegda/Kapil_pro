/// <reference path="../pb_data/types.d.ts" />
// Aliases are confined to each Purchase master. They are lookup text only;
// bills retain their existing item and supplier relations and historical names.
migrate((app) => {
  for (const name of ['suppliers', 'purchase_items']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.fields.add(new Field({ name: 'aliases', type: 'text', max: 2000 }))
    app.save(collection)
  }
}, (app) => {
  for (const name of ['suppliers', 'purchase_items']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.fields.removeByName('aliases')
    app.save(collection)
  }
})
