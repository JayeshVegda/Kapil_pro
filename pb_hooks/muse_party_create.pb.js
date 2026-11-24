/// <reference path="../pb_data/types.d.ts" />
// Narrow authenticated exception to draft-only writes. The regular CRUD API
// still does not allow Muse to mutate accounts, money, or ledger records.
routerAdd('POST', '/api/kapil/muse/create-party', (e) => {
  if (!e.auth || e.auth.collection().name !== 'users' || e.auth.getString('role') !== 'muse') {
    return e.json(403, { error: 'MUSE_ACCOUNT_REQUIRED' })
  }
  const body = e.requestInfo().body
  const module = body.module
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  const source = typeof body.sourceId === 'string' ? body.sourceId : ''
  const key = name.toLowerCase()
  if ((module !== 'purchase' && module !== 'sales') || name.length < 2 || name.length > 140 ||
      !/^[A-Za-z0-9:_./-]{1,160}$/.test(source) || Object.keys(body).some((field) => !['module', 'name', 'sourceId'].includes(field))) {
    return e.json(422, { error: 'INVALID_PARTY', message: 'Send only module, a full party name, and a stable source ID.' })
  }
  const table = module === 'purchase' ? 'suppliers' : 'customers'
  let result
  e.app.runInTransaction((tx) => {
    const actor = e.auth.id
    const receipt = tx.findRecordsByFilter('muse_party_creations', 'actor_id = {:actor} && module = {:module} && source_id = {:source}', '', 1, 0, { actor, module, source })[0]
    if (receipt) {
      if (receipt.getString('name_key') !== key) { result = { status: 409, body: { error: 'SOURCE_ALREADY_USED' } }; return }
      let party
      try { party = tx.findRecordById(table, receipt.getString('party_id')) } catch (_) {
        result = { status: 409, body: { error: 'PARTY_NO_LONGER_AVAILABLE' } }; return
      }
      if (!party.getBool('active')) { result = { status: 409, body: { error: 'PARTY_INACTIVE', id: party.id } }; return }
      result = { status: 200, body: { id: party.id, name: party.getString('company_name') || party.getString('name'), reused: true } }
      return
    }
    const parties = tx.findAllRecords(table)
    const norm = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase()
    const existing = parties.filter((party) => {
      const aliases = party.getString('aliases')
      return [party.getString('company_name'), ...(module === 'sales' ? [party.getString('name'), ...aliases.split(/[\s,]+/)] : []), ...aliases.split(/[,\n]/)]
        .some((value) => norm(value) === key)
    })
    if (existing.length > 1) { result = { status: 409, body: { error: 'AMBIGUOUS_NAME' } }; return }
    if (existing.length === 1 && !existing[0].getBool('active')) {
      result = { status: 409, body: { error: 'PARTY_INACTIVE', id: existing[0].id } }; return
    }
    const party = existing[0] || new Record(tx.findCollectionByNameOrId(table))
    if (!existing.length) {
      party.set('company_name', name)
      party.set('active', true)
      if (module === 'sales') {
        party.set('name', name)
        party.set('opening_balance', 0)
      } else {
        party.set('opening_kacha_paise', 0)
        party.set('opening_gst_paise', 0)
      }
      tx.save(party)
    }
    const log = new Record(tx.findCollectionByNameOrId('muse_party_creations'))
    log.set('actor_id', actor)
    log.set('module', module)
    log.set('source_id', source)
    log.set('name_key', key)
    log.set('party_id', party.id)
    tx.save(log)
    result = { status: existing.length ? 200 : 201, body: { id: party.id, name: party.getString('company_name') || party.getString('name'), reused: Boolean(existing.length) } }
  })
  return e.json(result.status, result.body)
}, $apis.requireAuth('users'))

// Keep a reason on every newly rejected draft, including requests sent
// outside the UI. Existing rejections and pre-migration schemas are untouched.
onRecordUpdateRequest((e) => {
  if (e.record.collection().fields.getByName('rejection_reason')) {
    const reason = e.record.getString('rejection_reason').trim()
    if (e.record.getString('status') === 'rejected') {
      if (!reason) throw new BadRequestError('A rejection reason is required.')
      e.record.set('rejection_reason', reason)
    } else if (reason) {
      throw new BadRequestError('Only rejected drafts may have a rejection reason.')
    }
  }
  e.next()
}, 'bill_drafts', 'payment_drafts', 'purchase_bill_drafts', 'purchase_payment_drafts', 'muse_purchase_action_drafts', 'casting_session_drafts')
