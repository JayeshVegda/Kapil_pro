/// <reference path="../pb_data/types.d.ts" />
// Existing rows have no value and remain on the original 7.5%-of-metal rule.
// New sessions explicitly save version 2 for 7%-of-chitty-Brass ready cost.
migrate((app) => {
  const collection = app.findCollectionByNameOrId('casting_sessions')
  collection.fields.add(new Field({ name: 'cost_formula_version', type: 'number', onlyInt: true, min: 0, max: 2, required: false }))
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('casting_sessions')
  collection.fields.removeByName('cost_formula_version')
  app.save(collection)
})
