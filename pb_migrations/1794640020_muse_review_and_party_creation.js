/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const names = ['bill_drafts', 'payment_drafts', 'purchase_bill_drafts', 'purchase_payment_drafts', 'muse_purchase_action_drafts', 'casting_session_drafts']
  for (const name of names) {
    const c = app.findCollectionByNameOrId(name)
    c.fields.add(new Field({ name: 'rejection_reason', type: 'text', max: 1000 }))
    app.save(c)
  }
  app.save(new Collection({
    name: 'muse_party_creations', type: 'base',
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'actor_id', type: 'text', required: true, max: 15 },
      { name: 'module', type: 'select', required: true, maxSelect: 1, values: ['purchase', 'sales'] },
      { name: 'source_id', type: 'text', required: true, max: 160 },
      { name: 'name_key', type: 'text', required: true, max: 150 },
      { name: 'party_id', type: 'text', required: true, max: 15 },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_muse_party_source ON muse_party_creations (actor_id,module,source_id)'],
  }))
}, (app) => {
  for (const name of ['bill_drafts', 'payment_drafts', 'purchase_bill_drafts', 'purchase_payment_drafts', 'muse_purchase_action_drafts', 'casting_session_drafts']) {
    const c = app.findCollectionByNameOrId(name)
    c.fields.removeByName('rejection_reason')
    app.save(c)
  }
  app.delete(app.findCollectionByNameOrId('muse_party_creations'))
})
