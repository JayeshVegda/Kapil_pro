// Stamping happens on the server, including requests inside /api/batch.
// During the staged rollout anonymous Muse requests remain accepted. A missing
// auth record deliberately leaves created_by blank instead of rejecting them.
onRecordCreateRequest((e) => {
  const user = e.auth && e.auth.collection().name === 'users' ? e.auth : null
  e.record.set('created_by', user ? user.id : '')
  e.next()
}, 'purchase_bill_drafts', 'purchase_payment_drafts', 'bill_drafts', 'payment_drafts')

onRecordCreateRequest((e) => {
  if (e.record.get('status') !== 'pending_review' || e.record.get('converted_bill')) {
    throw new BadRequestError('New purchase drafts must be pending review')
  }
  e.next()
}, 'purchase_bill_drafts')

onRecordCreateRequest((e) => {
  if (e.record.get('status') !== 'pending_review' || e.record.get('converted_payment')) {
    throw new BadRequestError('New purchase payment drafts must be pending review')
  }
  e.next()
}, 'purchase_payment_drafts')

// The separate rules migration has intentionally NOT been installed yet. Keep
// Purchase conversion safe during that rollout: the original status is read
// from the batch's transactional app, so a stale second save cannot approve it.
onRecordUpdateRequest((e) => {
  const previous = e.app.findRecordById('purchase_bill_drafts', e.record.id)
  if (previous.get('status') !== 'pending_review') throw new BadRequestError('Draft already processed')
  e.record.set('created_by', previous.get('created_by'))
  const nextStatus = e.record.get('status')
  const nextBill = e.record.get('converted_bill')
  if (nextStatus === 'approved' || nextStatus === 'rejected') {
    const operator = e.auth && e.auth.collection().name === 'users' && e.auth.get('role') !== 'muse' && e.auth.get('email') !== 'muse@kapil.cosearch.me'
    if (!operator) throw new ForbiddenError('Only the operator can process a draft')
    if (nextStatus === 'approved' && !nextBill) throw new BadRequestError('Approved draft needs its saved bill')
    if (nextStatus === 'rejected' && nextBill) throw new BadRequestError('Rejected draft cannot link a bill')
  } else if (nextStatus !== 'pending_review' || nextBill) {
    throw new BadRequestError('Invalid draft transition')
  }
  e.next()
}, 'purchase_bill_drafts')

onRecordUpdateRequest((e) => {
  const previous = e.app.findRecordById('purchase_payment_drafts', e.record.id)
  if (previous.get('status') !== 'pending_review') throw new BadRequestError('Draft already processed')
  e.record.set('created_by', previous.get('created_by'))
  const nextStatus = e.record.get('status')
  const nextPayment = e.record.get('converted_payment')
  if (nextStatus === 'approved' || nextStatus === 'rejected') {
    const operator = e.auth && e.auth.collection().name === 'users' && e.auth.get('role') !== 'muse' && e.auth.get('email') !== 'muse@kapil.cosearch.me'
    if (!operator) throw new ForbiddenError('Only the operator can process a draft')
    if (nextStatus === 'approved' && !nextPayment) throw new BadRequestError('Approved draft needs its saved payment')
    if (nextStatus === 'rejected' && nextPayment) throw new BadRequestError('Rejected draft cannot link a payment')
  } else if (nextStatus !== 'pending_review' || nextPayment) {
    throw new BadRequestError('Invalid draft transition')
  }
  e.next()
}, 'purchase_payment_drafts')
