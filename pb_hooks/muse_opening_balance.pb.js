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
