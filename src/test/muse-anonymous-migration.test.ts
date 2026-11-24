import { afterAll, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const binary = join(root, process.platform === 'win32' ? 'runtime/bin/pocketbase.exe' : 'runtime/bin/pocketbase')
const schemaMigration = join(root, 'pb_migrations/1794640008_created_purchase_bill_drafts.js')
const stagedRules = join(root, 'pb_migrations/1794640009_tighten_sales_and_purchase_draft_rules.js')
const paymentSchemaMigration = join(root, 'pb_migrations/1794640012_created_purchase_payment_drafts.js')
const castingSchemaMigration = join(root, 'pb_migrations/1794640013_created_casting_session_drafts.js')
const paymentReadRules = join(root, 'pb_migrations/1794640016_scope_purchase_payment_draft_reads.js')
const purchaseActionSchema = join(root, 'pb_migrations/1794640017_create_muse_purchase_action_drafts.js')
const salesIdempotencySchema = join(root, 'pb_migrations/1794640018_muse_sales_draft_idempotency.js')
const linkedDraftSchema = join(root, 'pb_migrations/1794640019_link_muse_party_drafts.js')
const reviewSchema = join(root, 'pb_migrations/1794640020_muse_review_and_party_creation.js')
const temp = mkdtempSync(join(root, 'node_modules', '.kapil-muse-rules-'))
const migrationsDir = join(temp, 'migrations')
const dataDir = join(temp, 'data')
mkdirSync(migrationsDir)
mkdirSync(dataDir)

let pocketbase: ChildProcess | undefined

afterAll(async () => {
  if (pocketbase && pocketbase.exitCode === null) {
    pocketbase.kill('SIGTERM')
    await new Promise<void>((done) => pocketbase?.once('exit', () => done()))
  }
  rmSync(temp, { recursive: true, force: true })
})

function minimalCollection(name: string) {
  return `app.save(new Collection({name: '${name}', type: 'base', listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: ''}))`
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No disposable port')
  const port = address.port
  await new Promise<void>((ok) => server.close(() => ok()))
  return port
}

async function startPocketBase(port: number) {
  let output = ''
  pocketbase = spawn(binary, ['serve', '--dir', dataDir, '--http', `127.0.0.1:${port}`, '--migrationsDir', migrationsDir, '--hooksDir', join(root, 'pb_hooks')], { stdio: ['ignore', 'pipe', 'pipe'] })
  pocketbase.stdout?.on('data', (chunk: Buffer) => { output += String(chunk).slice(-1000) })
  pocketbase.stderr?.on('data', (chunk: Buffer) => { output += String(chunk).slice(-1000) })
  const url = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 80; attempt++) {
    if (pocketbase.exitCode !== null) throw new Error(`Disposable PocketBase exited: ${output}`)
    try {
      if ((await fetch(`${url}/api/health`)).ok) return url
    } catch { /* wait for startup */ }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error(`Disposable PocketBase did not start: ${output}`)
}

async function stopPocketBase() {
  if (!pocketbase) return
  const process = pocketbase
  process.kill('SIGTERM')
  await new Promise<void>((done) => process.once('exit', () => done()))
  pocketbase = undefined
}

it.skipIf(!existsSync(binary))('accepts anonymous Muse draft before staged rules, rejects it after rules', async () => {
  const baseline = `migrate((app) => {
    const settings = app.settings()
    settings.batch.enabled = true
    app.save(settings)
    const users = app.findCollectionByNameOrId('users')
    users.fields.add(new Field({name: 'role', type: 'select', values: ['operator', 'muse']}))
    app.save(users)
    for (const role of ['operator', 'muse']) {
      const account = new Record(users)
      account.set('email', role + '@disposable.invalid')
      account.set('password', 'disposable-only-12345')
      account.set('role', role)
      app.save(account)
    }
    ${['purchase_bills', 'supplier_payments', 'bills', 'bill_items', 'payments', 'items', 'brass_rates', 'casting_sessions', 'casting_batches', 'casting_batch_inputs', 'casting_materials'].map(minimalCollection).join('\n    ')}
    for (const name of ['customers', 'suppliers']) {
      app.save(new Collection({ name, type: 'base', listRule: '', viewRule: '', fields: [
        { name: 'company_name', type: 'text', required: true },
        { name: 'name', type: 'text' }, { name: 'aliases', type: 'text' },
        { name: 'active', type: 'bool' }, { name: 'opening_balance', type: 'number' },
        { name: 'opening_kacha_paise', type: 'number' }, { name: 'opening_gst_paise', type: 'number' },
      ] }))
    }
    for (const [name, converted] of [['bill_drafts', 'converted_bill'], ['payment_drafts', 'converted_payment']]) {
      app.save(new Collection({name, type: 'base', listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '', fields: [
        {name: 'created_by', type: 'relation', collectionId: app.findCollectionByNameOrId('users').id, maxSelect: 1},
        {name: 'status', type: 'select', values: ['pending_review', 'approved', 'rejected'], maxSelect: 1},
        {name: converted, type: 'text'},
      ]}))
    }
    for (const name of ['bill_draft_items', 'bill_draft_payments']) {
      app.save(new Collection({name, type: 'base', listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '', fields: [
        {name: 'draft', type: 'relation', collectionId: app.findCollectionByNameOrId('bill_drafts').id, maxSelect: 1},
      ]}))
    }
  }, (app) => {})`
  writeFileSync(join(migrationsDir, '1794640000_test_baseline.js'), baseline)
  copyFileSync(schemaMigration, join(migrationsDir, '1794640008_created_purchase_bill_drafts.js'))
  const port = await freePort()
  let url = await startPocketBase(port)
  const stage = (source: string) => fetch(`${url}/api/collections/purchase_bill_drafts/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: { date: '2026-11-15', lines: [{ weight_g: 1000, rate_milli: 450000, amount_paise: 45000 }] }, schema_version: 1, status: 'pending_review', source_message_id: source }),
  })
  const before = await stage('anonymous-before')
  expect(before.status).toBe(200)
  const beforeBody = await before.json() as { created_by?: string }
  expect(beforeBody.created_by ?? '').toBe('')
  expect((await stage('anonymous-before')).status).toBe(400) // unique source ID
  const anonymousApproved = await fetch(`${url}/api/collections/purchase_bill_drafts/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: {}, schema_version: 2, status: 'approved', source_message_id: 'anonymous-approved' }),
  })
  expect(anonymousApproved.status).toBe(400)

  await stopPocketBase()
  copyFileSync(stagedRules, join(migrationsDir, '1794640009_tighten_sales_and_purchase_draft_rules.js'))
  copyFileSync(paymentSchemaMigration, join(migrationsDir, '1794640012_created_purchase_payment_drafts.js'))
  copyFileSync(paymentReadRules, join(migrationsDir, '1794640016_scope_purchase_payment_draft_reads.js'))
  copyFileSync(purchaseActionSchema, join(migrationsDir, '1794640017_create_muse_purchase_action_drafts.js'))
  copyFileSync(salesIdempotencySchema, join(migrationsDir, '1794640018_muse_sales_draft_idempotency.js'))
  copyFileSync(linkedDraftSchema, join(migrationsDir, '1794640019_link_muse_party_drafts.js'))
  copyFileSync(reviewSchema, join(migrationsDir, '1794640020_muse_review_and_party_creation.js'))
  copyFileSync(castingSchemaMigration, join(migrationsDir, '1794640013_created_casting_session_drafts.js'))
  url = await startPocketBase(port)
  const after = await stage('anonymous-after')
  expect(after.status).toBe(400)

  const auth = async (role: string) => {
    const response = await fetch(`${url}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: `${role}@disposable.invalid`, password: 'disposable-only-12345' }),
    })
    expect(response.status).toBe(200)
    return response.json() as Promise<{ token: string; record: { id: string } }>
  }
  const muse = await auth('muse')
  const operator = await auth('operator')
  const createParty = (body: object, token = muse.token) => fetch(url + '/api/kapil/muse/create-party', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token }, body: JSON.stringify(body),
  })
  for (const module of ['purchase', 'sales']) {
    const proposal = { module, name: 'Demo One', sourceId: 'create-demo-one' }
    expect((await createParty(proposal, operator.token)).status).toBe(403)
    expect((await createParty({ ...proposal, opening_balance: 1234 })).status).toBe(422)
    const created = await createParty(proposal)
    expect(created.status).toBe(201)
    const party = await created.json() as { id: string }
    expect(await (await createParty(proposal)).json()).toMatchObject({ id: party.id, name: 'Demo One', reused: true })
    expect((await createParty({ ...proposal, name: 'Demo Two' })).status).toBe(409)
    const list = await fetch(url + '/api/collections/' + (module === 'sales' ? 'customers' : 'suppliers') + '/records', { headers: { Authorization: operator.token } })
    expect(await list.json()).toMatchObject({ totalItems: 1, items: [{ id: party.id, company_name: 'Demo One', active: true, opening_balance: 0, opening_kacha_paise: 0 }] })
  }
  const salesDraftPath = '/api/collections/bill_drafts/records'
  const stageSalesDraft = (id: string, source?: string) => fetch(url + '/api/batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ requests: [
      { method: 'POST', url: salesDraftPath, body: { id, status: 'pending_review', ...(source ? { muse_source_id: source, muse_request_hash: 'a'.repeat(64) } : {}) } },
      { method: 'POST', url: '/api/collections/bill_draft_items/records', body: { draft: id } },
    ] }),
  })
  expect((await stageSalesDraft('aaaaaaaasales01', 'one-sales-source')).status).toBe(200)
  expect((await stageSalesDraft('aaaaaaaasales02', 'one-sales-source')).status).toBe(400)
  expect((await stageSalesDraft('aaaaaaaasales03')).status).toBe(200)
  expect((await stageSalesDraft('aaaaaaaasales04')).status).toBe(200)
  const withoutReason = await fetch(url + salesDraftPath + '/aaaaaaaasales04', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: operator.token },
    body: JSON.stringify({ status: 'rejected', rejection_reason: '   ' }),
  })
  expect(withoutReason.status).toBe(400)
  const rejectedSale = await fetch(url + salesDraftPath + '/aaaaaaaasales04', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: operator.token },
    body: JSON.stringify({ status: 'rejected', rejection_reason: 'Test draft only' }),
  })
  expect(await rejectedSale.json()).toMatchObject({ status: 'rejected', rejection_reason: 'Test draft only', converted_bill: '' })
  const setMarker = await fetch(url + salesDraftPath + '/aaaaaaaasales01', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ muse_new_customer: true }),
  })
  expect(setMarker.status).toBe(404)
  const museDraft = await fetch(`${url}/api/collections/purchase_bill_drafts/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ payload: { date: '2026-11-15', lines: [{ weight_g: 1000, rate_milli: 450000, amount_paise: 45000 }] }, schema_version: 1, status: 'pending_review', source_message_id: 'muse-after', created_by: operator.record.id }),
  })
  expect(museDraft.status).toBe(200)
  const createdDraft = await museDraft.json() as { id: string; created_by: string }
  expect(createdDraft.created_by).toBe(muse.record.id)
  const museCreatedApproved = await fetch(`${url}/api/collections/purchase_bill_drafts/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ payload: {}, schema_version: 2, status: 'approved', source_message_id: 'muse-approved' }),
  })
  expect(museCreatedApproved.status).toBe(400)
  const editPending = await fetch(`${url}/api/collections/purchase_bill_drafts/records/${createdDraft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ notes: 'Muse corrected a pending proposal' }),
  })
  expect(editPending.status).toBe(200)
  const museApprove = await fetch(`${url}/api/collections/purchase_bill_drafts/records/${createdDraft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ status: 'approved', converted_bill: 'aaaaaaaaaaaaaaa' }),
  })
  expect(museApprove.status).toBe(404) // PocketBase masks rule-denied updates
  const createChild = (authorization?: string) => fetch(`${url}/api/collections/bill_draft_items/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ draft: createdDraft.id }),
  })
  // Purchase drafts are JSON-only; legacy Sales child rows must still reject
  // anonymous requests once the staged rules are applied.
  expect((await createChild()).status).toBe(400)
  const forbiddenLiveWrite = await fetch(`${url}/api/collections/bills/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: muse.token }, body: '{}',
  })
  expect(forbiddenLiveWrite.status).toBe(400)

  const draftId = createdDraft.id
  const approve = (billId: string) => fetch(`${url}/api/batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: operator.token },
    body: JSON.stringify({ requests: [
      { method: 'POST', url: '/api/collections/purchase_bills/records', body: { id: billId } },
      { method: 'PATCH', url: `/api/collections/purchase_bill_drafts/records/${draftId}`, body: { status: 'approved', converted_bill: billId } },
    ] }),
  })
  expect((await approve('aaaaaaaaaaaaaaa')).status).toBe(200)
  expect((await approve('bbbbbbbbbbbbbbb')).status).toBe(400) // entire stale batch rolls back
  const editApproved = await fetch(`${url}/api/collections/purchase_bill_drafts/records/${createdDraft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ notes: 'late Muse edit' }),
  })
  expect(editApproved.status).toBe(404)
  const bills = await fetch(`${url}/api/collections/purchase_bills/records`, { headers: { Authorization: operator.token } }).then((response) => response.json()) as { totalItems: number }
  expect(bills.totalItems).toBe(1)
  const rejectedResponse = await fetch(`${url}/api/collections/purchase_bill_drafts/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ payload: { date: '2026-11-15' }, schema_version: 2, status: 'pending_review', source_message_id: 'reject-then-save' }),
  })
  expect(rejectedResponse.status).toBe(200)
  const rejected = await rejectedResponse.json() as { id: string }
  expect((await fetch(`${url}/api/collections/purchase_bill_drafts/records/${rejected.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: operator.token },
    body: JSON.stringify({ status: 'rejected', rejection_reason: 'Declined test proposal' }),
  })).status).toBe(200)
  expect((await fetch(`${url}/api/batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: operator.token },
    body: JSON.stringify({ requests: [
      { method: 'POST', url: '/api/collections/purchase_bills/records', body: { id: 'ccccccccccccccc' } },
      { method: 'PATCH', url: `/api/collections/purchase_bill_drafts/records/${rejected.id}`, body: { status: 'approved', converted_bill: 'ccccccccccccccc' } },
    ] }),
  })).status).toBe(400)
  const afterRejected = await fetch(`${url}/api/collections/purchase_bills/records`, { headers: { Authorization: operator.token } }).then((response) => response.json()) as { totalItems: number }
  expect(afterRejected.totalItems).toBe(1)

  const paymentDraftResponse = await fetch(`${url}/api/collections/purchase_payment_drafts/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ payload: { supplier_name: 'Test Supplier', date: '2026-11-15', kind: 'payment', amount_rs: '90.50' }, schema_version: 1, status: 'pending_review', direct_save: true, source_message_id: 'payment-once', created_by: operator.record.id }),
  })
  expect(paymentDraftResponse.status).toBe(200)
  const paymentDraft = await paymentDraftResponse.json() as { id: string; created_by: string; status: string; direct_save: boolean }
  expect(paymentDraft.created_by).toBe(muse.record.id)
  expect(paymentDraft).toMatchObject({ status: 'pending_review', direct_save: true })
  const operatorDraftResponse = await fetch(`${url}/api/collections/purchase_payment_drafts/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: operator.token },
    body: JSON.stringify({ payload: { supplier_name: 'Other Supplier' }, schema_version: 1, status: 'pending_review', source_message_id: 'operator-only' }),
  })
  expect(operatorDraftResponse.status).toBe(200)
  const operatorDraft = await operatorDraftResponse.json() as { id: string }
  const draftUrl = (id: string) => `${url}/api/collections/purchase_payment_drafts/records/${id}`
  expect((await fetch(draftUrl(operatorDraft.id), { headers: { Authorization: muse.token } })).status).toBe(404)
  expect((await fetch(draftUrl(paymentDraft.id), { headers: { Authorization: muse.token } })).status).toBe(200)
  expect((await fetch(draftUrl(paymentDraft.id), { headers: { Authorization: operator.token } })).status).toBe(200)
  expect((await fetch(`${url}/api/collections/purchase_payment_drafts/records/${paymentDraft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: muse.token }, body: JSON.stringify({ notes: 'Muse correction' }),
  })).status).toBe(200)
  expect((await fetch(`${url}/api/collections/purchase_payment_drafts/records/${paymentDraft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: muse.token }, body: JSON.stringify({ status: 'approved', converted_payment: 'aaaaaaaaaaaaaaa' }),
  })).status).toBe(404)
  const savePayment = (paymentId: string) => fetch(`${url}/api/batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: operator.token },
    body: JSON.stringify({ requests: [
      { method: 'POST', url: '/api/collections/supplier_payments/records', body: { id: paymentId } },
      { method: 'PATCH', url: `/api/collections/purchase_payment_drafts/records/${paymentDraft.id}`, body: { status: 'approved', converted_payment: paymentId } },
    ] }),
  })
  expect((await savePayment('ddddddddddddddd')).status).toBe(200)
  expect((await savePayment('eeeeeeeeeeeeeee')).status).toBe(400)
  const supplierPayments = await fetch(`${url}/api/collections/supplier_payments/records`, { headers: { Authorization: operator.token } }).then((response) => response.json()) as { totalItems: number }
  expect(supplierPayments.totalItems).toBe(1)

  const actionPath = '/api/collections/muse_purchase_action_drafts/records'
  const actionBody = {
    status: 'pending_review', created_by: muse.record.id, source_message_id: 'bardan-proposal',
    payload: { kind: 'bardan', billId: 'aaaaaaaaaaaaaaa', lineId: 'bbbbbbbbbbbbbbb', bagCount: 16, weightG: 3080 },
  }
  const stageAction = (body: object) => fetch(url + actionPath, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: muse.token }, body: JSON.stringify(body),
  })
  expect((await stageAction({ ...actionBody, created_by: operator.record.id })).status).toBe(400)
  const actionResponse = await stageAction(actionBody)
  expect(actionResponse.status).toBe(200)
  const action = await actionResponse.json() as { id: string }
  const linkedPaymentResponse = await fetch(url + '/api/collections/purchase_payment_drafts/records', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ schema_version: 1, source_message_id: 'linked-payment', status: 'pending_review', payload: { date: '2026-11-24' }, supplier_draft: action.id }),
  })
  expect(linkedPaymentResponse.status).toBe(200)
  const linkedPayment = await linkedPaymentResponse.json() as { id: string; supplier_draft: string }
  expect(linkedPayment.supplier_draft).toBe(action.id)
  expect((await fetch(url + '/api/collections/purchase_payment_drafts/records/' + linkedPayment.id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ supplier_draft: 'aaaaaaaaaaaaaaa' }),
  })).status).toBe(404)
  expect((await stageAction(actionBody)).status).toBe(400)
  const updateAction = (token: string, body: object) => fetch(url + actionPath + '/' + action.id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: token }, body: JSON.stringify(body),
  })
  expect((await updateAction(muse.token, { status: 'approved', converted_record: 'aaaaaaaaaaaaaaa' })).status).toBe(404)
  expect((await updateAction(operator.token, { payload: { kind: 'changed' }, status: 'approved', converted_record: 'aaaaaaaaaaaaaaa' })).status).toBe(404)
  expect((await updateAction(operator.token, { status: 'approved', converted_record: 'aaaaaaaaaaaaaaa' })).status).toBe(200)
  expect((await updateAction(operator.token, { status: 'rejected' })).status).toBe(404)

  expect((await fetch(`${url}/api/collections/casting_materials/records`, { headers: { Authorization: muse.token } })).status).toBe(200)
  const castingDraftResponse = await fetch(`${url}/api/collections/casting_session_drafts/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: muse.token },
    body: JSON.stringify({ schema_version: 1, status: 'pending_review', direct_save: true, source_message_id: 'casting-once', payload: { date: '2026-11-15', coal_kg: '1', coal_rate_rs: '10', worker_salary_rs: '100', batches: [{ inputs: [{ material_name: 'Brass', qty_kg: '10', rate_rs_per_kg: '400' }], wire_out_kg: '9', mel_kg: '1' }] } }),
  })
  expect(castingDraftResponse.status).toBe(200)
  const castingDraft = await castingDraftResponse.json() as { id: string; created_by: string; status: string; direct_save: boolean }
  expect(castingDraft).toMatchObject({ created_by: muse.record.id, status: 'pending_review', direct_save: true })
  expect((await fetch(`${url}/api/collections/casting_session_drafts/records/${castingDraft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: muse.token }, body: JSON.stringify({ notes: 'Muse correction' }),
  })).status).toBe(200)
  expect((await fetch(`${url}/api/collections/casting_session_drafts/records/${castingDraft.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: muse.token }, body: JSON.stringify({ status: 'approved', converted_session: 'fffffffffffffff' }),
  })).status).toBe(404)
  const castingBatch = (sessionId: string, inputId: string) => fetch(`${url}/api/batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: operator.token },
    body: JSON.stringify({ requests: [
      { method: 'POST', url: '/api/collections/casting_sessions/records', body: { id: sessionId } },
      { method: 'POST', url: '/api/collections/casting_batches/records', body: { id: 'ggggggggggggggg', session: sessionId } },
      { method: 'POST', url: '/api/collections/casting_batch_inputs/records', body: { id: inputId, batch: 'ggggggggggggggg' } },
      { method: 'PATCH', url: `/api/collections/casting_session_drafts/records/${castingDraft.id}`, body: { status: 'approved', converted_session: sessionId } },
    ] }),
  })
  expect((await castingBatch('fffffffffffffff', 'invalid!')).status).toBe(400)
  const sessionsAfterFailure = await fetch(`${url}/api/collections/casting_sessions/records`, { headers: { Authorization: operator.token } }).then((response) => response.json()) as { totalItems: number }
  expect(sessionsAfterFailure.totalItems).toBe(0)
  expect((await castingBatch('fffffffffffffff', 'hhhhhhhhhhhhhhh')).status).toBe(200)
  expect((await castingBatch('iiiiiiiiiiiiiii', 'jjjjjjjjjjjjjjj')).status).toBe(400)
  const sessionsAfterRetry = await fetch(`${url}/api/collections/casting_sessions/records`, { headers: { Authorization: operator.token } }).then((response) => response.json()) as { totalItems: number }
  expect(sessionsAfterRetry.totalItems).toBe(1)
}, 30_000)
