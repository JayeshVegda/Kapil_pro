/// <reference path="../pb_data/types.d.ts" />
routerAdd('POST', '/api/kapil/muse/approve-opening-balance', (e) => {
  const actor = e.auth
  if (!actor || actor.collection().name !== 'users' || actor.getString('role') === 'muse' ||
      actor.getString('email') === 'muse@kapil.cosearch.me') throw new ForbiddenError('Only a Kapil operator can approve an opening balance.')
  const body = e.requestInfo().body
  const id = body.draftId
  const name = body.supplierName
  const values = body.values
  const validAmount = (n) => Number.isSafeInteger(n) && Math.abs(n) <= 1000000000000
  const validValues = (v) => {
    if (!v || typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
        !validAmount(v.kachaPaise) || !validAmount(v.gstPaise) || (!v.kachaPaise && !v.gstPaise)) return false
    const d = new Date(v.date + 'T00:00:00.000Z')
    const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10)
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v.date && v.date <= today
  }
  if (typeof id !== 'string' || !/^[a-z0-9]{15}$/.test(id) || typeof name !== 'string' || !validValues(values))
    throw new BadRequestError('Send a valid draft, date and signed Kacha/GST opening balances.')

  let supplierId
  e.app.runInTransaction((tx) => {
    const draft = tx.findRecordById('muse_purchase_action_drafts', id)
    const proposal = JSON.parse(draft.getString('payload'))
    if (proposal.kind !== 'opening_balance' || !validValues(proposal) ||
        typeof proposal.supplierId !== 'string' || !/^[a-z0-9]{15}$/.test(proposal.supplierId))
      throw new BadRequestError('Not a valid opening balance draft.')
    supplierId = proposal.supplierId
    if (draft.getString('status') !== 'pending_review')
      throw new BadRequestError('This draft was already processed.')
    const setting = tx.findRecordsByFilter('app_settings', 'id = "globalsettings1"', '', 1, 0)[0]
    if (setting && !setting.getBool('purchase_enabled')) throw new ForbiddenError('Purchase is disabled.')
    const supplier = tx.findRecordById('suppliers', supplierId)
    if (!supplier.getBool('active') || supplier.getString('company_name') !== name)
      throw new BadRequestError('Supplier is inactive or changed. Refresh the preview.')
    const before = {
      opening_kacha_paise: supplier.getInt('opening_kacha_paise'),
      opening_gst_paise: supplier.getInt('opening_gst_paise'),
      opening_balance_date: supplier.getString('opening_balance_date'),
    }
    const history = ['purchase_bills', 'supplier_payments'].some((table) =>
      tx.findRecordsByFilter(table, 'supplier = {:supplierId}', '', 1, 0, { supplierId }).length > 0)
    if (before.opening_balance_date || before.opening_kacha_paise || before.opening_gst_paise || history)
      throw new BadRequestError('Supplier already has an opening balance or activity. Review it manually in Kapil.')
    const fields = {
      opening_kacha_paise: values.kachaPaise, opening_gst_paise: values.gstPaise, opening_balance_date: values.date,
    }
    for (const key of Object.keys(fields)) supplier.set(key, fields[key])
    tx.save(supplier)
    const audit = new Record(tx.findCollectionByNameOrId('purchase_audit_log'))
    audit.set('collection', 'suppliers')
    audit.set('record_id', supplierId)
    audit.set('action', 'update')
    audit.set('before_json', JSON.stringify(before))
    audit.set('after_json', JSON.stringify({ ...fields, museDraftId: id }))
    audit.set('actor', actor.id)
    tx.save(audit)
    draft.set('status', 'approved')
    draft.set('converted_record', supplierId)
    tx.save(draft)
  })
  return e.json(200, { supplierId, status: 'approved' })
}, $apis.requireAuth('users'))

// Use the request's transactional app, including in PocketBase batch writes.
// Rejecting the opening draft also clears the dependency.
onRecordCreateRequest((e) => {
  const supplier = e.record.getString('supplier')
  if (supplier) {
    const row = new DynamicModel({ matches: 0 })
    e.app.db().newQuery(`SELECT COUNT(*) AS matches FROM muse_purchase_action_drafts
      WHERE status = 'pending_review' AND json_extract(payload, '$.kind') = 'opening_balance'
        AND json_extract(payload, '$.supplierId') = {:supplier}`).bind({ supplier }).one(row)
    if (row.matches > 0) throw new BadRequestError('Review the pending supplier opening balance in AI Drafts before posting this bill or payment.')
  }
  e.next()
}, 'purchase_bills', 'supplier_payments')

onRecordUpdateRequest((e) => {
  const before = e.app.findRecordById('suppliers', e.record.id)
  const kacha = before.getInt('opening_kacha_paise')
  const gst = before.getInt('opening_gst_paise')
  const date = before.getString('opening_balance_date')
  if ((kacha || gst || date) && (kacha !== e.record.getInt('opening_kacha_paise') ||
      gst !== e.record.getInt('opening_gst_paise') || date !== e.record.getString('opening_balance_date'))) {
    throw new BadRequestError('Use Correct opening balance in the supplier ledger to record a reason.')
  }
  e.next()
}, 'suppliers')

routerAdd('POST', '/api/kapil/purchase/correct-opening-balance', (e) => {
  const actor = e.auth
  if (!actor || actor.collection().name !== 'users' || actor.getString('role') === 'muse' ||
      actor.getString('email') === 'muse@kapil.cosearch.me') throw new ForbiddenError('Only a Kapil operator can correct an opening balance.')
  const body = e.requestInfo().body
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const next = body.values
  const expected = body.expected
  const validAmount = (n) => Number.isSafeInteger(n) && Math.abs(n) <= 1000000000000
  const valid = (v) => v && validAmount(v.kachaPaise) && validAmount(v.gstPaise) && typeof v.date === 'string'
  if (!/^[a-z0-9]{15}$/.test(String(body.supplierId || '')) || !reason || reason.length > 1000 || !valid(next) || !valid(expected))
    throw new BadRequestError('Supply both balances, the effective date and a correction reason.')
  if (next.kachaPaise || next.gstPaise) {
    const day = new Date(next.date + 'T00:00:00.000Z')
    const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next.date) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== next.date || next.date > today)
      throw new BadRequestError('Choose a valid effective date that is not in the future.')
  } else if (next.date) throw new BadRequestError('Clear the effective date when clearing both balances.')
  e.app.runInTransaction((tx) => {
    const setting = tx.findRecordsByFilter('app_settings', 'id = "globalsettings1"', '', 1, 0)[0]
    if (setting && !setting.getBool('purchase_enabled')) throw new ForbiddenError('Purchase is disabled.')
    const row = tx.findRecordById('suppliers', body.supplierId)
    const before = {
      opening_kacha_paise: row.getInt('opening_kacha_paise'),
      opening_gst_paise: row.getInt('opening_gst_paise'),
      opening_balance_date: row.getString('opening_balance_date'),
    }
    if (before.opening_kacha_paise !== expected.kachaPaise || before.opening_gst_paise !== expected.gstPaise || before.opening_balance_date !== expected.date)
      throw new BadRequestError('The opening balance changed. Reopen the correction and review it again.')
    if (!expected.kachaPaise && !expected.gstPaise && !expected.date) throw new BadRequestError('There is no opening balance to correct.')
    if (expected.date === next.date && expected.kachaPaise === next.kachaPaise && expected.gstPaise === next.gstPaise)
      throw new BadRequestError('Enter a change to the amount or date.')
    const after = { opening_kacha_paise: next.kachaPaise, opening_gst_paise: next.gstPaise, opening_balance_date: next.date }
    for (const key of Object.keys(after)) row.set(key, after[key])
    tx.save(row)
    const audit = new Record(tx.findCollectionByNameOrId('purchase_audit_log'))
    audit.set('collection', 'suppliers')
    audit.set('record_id', row.id)
    audit.set('action', 'update')
    audit.set('before_json', JSON.stringify(before))
    audit.set('after_json', JSON.stringify({ ...after, correctionReason: reason }))
    audit.set('actor', actor.id)
    tx.save(audit)
  })
  return e.json(200, { supplierId: body.supplierId })
}, $apis.requireAuth('users'))
