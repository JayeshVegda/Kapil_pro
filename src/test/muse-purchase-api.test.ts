import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { buildPurchaseReadModel } from '@/domain/purchase-read-model'
import { mapBill, mapLine, mapPayment, mapSupplier } from '@/data/purchase-record-mappers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDraftWriter, createMusePurchaseServer } from '../../scripts/muse-purchase-api'

const supplierId = 'supplier0000001'
const newSupplierId = 'supplier0000002'
const itemId = 'pata00000000001'
const billId = 'oldbill00000001'
const lineId = 'oldline00000001'
const key = 'disposable-test-key'
const testDate = '2026-11-24'
const model = buildPurchaseReadModel([
  mapSupplier({ id: supplierId, company_name: 'Vashram (Pata)', aliases: 'Vashram bhai', active: 1 }),
  mapSupplier({ id: newSupplierId, company_name: 'Demo One', active: 1 }),
], {
  bills: [mapBill({ id: billId, in_no: 'IN-2627-0001', supplier: supplierId, date: testDate, pool: 'kacha' })],
  lines: [mapLine({ id: lineId, bill: billId, item_name: 'Pata', weight_g: 10_000, rate_milli: 990_000, amount_paise: 990_000 })],
  adjustments: [], bardan: [], allocations: [],
  payments: [mapPayment({ id: 'payment00000001', supplier: supplierId, date: testDate, kind: 'payment', pool: 'kacha', mode: 'cash', amount_paise: 90_000 })],
}, testDate)
const ledger = { ...model, asOf: testDate, items: [{ id: itemId, name: 'Pata', active: true, aliases: '', created: '' }] }
const write = vi.fn(async () => ({ draftId: 'sample', status: 'pending_review', reused: false }))
const status = vi.fn(async (_type: string, source: string) => {
  if (source === 'source:opening') return null
  if (source === 'source:approved') return { draftId: 'sample', status: 'approved', recordId: billId }
  if (source === 'source:rejected') return { draftId: 'sample', status: 'rejected', rejectionReason: 'Wrong pool' }
  return { draftId: 'sample', status: 'pending_review' }
})
const server = createMusePurchaseServer({
  keyDigest: createHash('sha256').update(key).digest(),
  loadLedger: () => ledger,
  loadCasting: () => ({ enabled: true, materials: [{ id: itemId, name: 'Pata', aliases: 'raw pata', code: '', category: '', isActive: true }] }),
  writeDraft: Object.assign(write, {
    status,
    supplierDependency: vi.fn(async (id: string) => ({ id, name: 'Pending Supplier', approved: false })),
    listDrafts: vi.fn(async () => ({ entries: [], nextCursor: null })),
  }),
})
let base = ''
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
})
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

const send = (route: string, payload?: unknown) => fetch(base + route, {
  headers: { 'X-API-Key': key, 'content-type': 'application/json' },
  method: payload === undefined ? 'GET' : 'POST',
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
})
const draft = (payload: Record<string, unknown>) => ({ sourceId: 'source:one', originalMessage: 'Test Purchase proposal', payload })
const sale = { supplier_name: 'Vashram bhai', date: testDate, pool: 'kacha', lines: [{ item_name: 'Pata', weight_kg: '380', rate_rs_per_kg: '990' }] }

describe('Purchase-only Muse gateway', () => {
  it('links the approved Purchase slip and returns the rejection reason', async () => {
    expect(await (await send('/v1/purchase/drafts/status?type=bill&sourceId=source:approved')).json()).toMatchObject({
      status: 'approved', recordId: billId, kapilPath: '/purchase-bills/IN-2627-0001',
    })
    expect(await (await send('/v1/purchase/drafts/status?type=bill&sourceId=source:rejected')).json()).toEqual({
      draftId: 'sample', status: 'rejected', rejectionReason: 'Wrong pool',
    })
  })
  it('previews signed opening balances and stages them only for a clean supplier', async () => {
    write.mockClear()
    const payload = { supplier: newSupplierId, date: '2026-01-01', kacha_rs: '1,50,000.50', gst_rs: '-20000.00' }
    const request = { ...draft(payload), sourceId: 'source:opening' }
    const preview = await send('/v1/purchase/preview/opening-balance', request)
    expect(await preview.json()).toMatchObject({ status: 'preview_only', preview: { supplier: 'Demo One', canApprove: true, kachaPaise: 15000050, gstPaise: -2000000 } })
    expect(write).not.toHaveBeenCalled()
    const blocked = await send('/v1/purchase/drafts/opening-balance', { ...request, payload: { ...payload, supplier: supplierId } })
    expect(blocked.status).toBe(409)
    expect(write).not.toHaveBeenCalled()
    const invalid = await send('/v1/purchase/drafts/opening-balance', { ...request, payload: { ...payload, date: '2099-01-01' } })
    expect(invalid.status).toBe(422)
    const staged = await send('/v1/purchase/drafts/opening-balance', request)
    expect(staged.status).toBe(201)
    expect(await staged.json()).toMatchObject({ status: 'pending_review', posted: false })
    expect(write).toHaveBeenCalledWith('action', request.sourceId, request.originalMessage,
      { kind: 'opening_balance', supplierId: newSupplierId, supplierName: 'Demo One', date: '2026-01-01', kachaPaise: 15000050, gstPaise: -2000000 })
  })
  it('previews Casting without writing and stages only a canonical draft', async () => {
    write.mockClear()
    const input = draft({
      date: testDate, coal_kg: '5', coal_rate_rs: '24', worker_salary_rs: '200',
      batches: [{ wire_out_kg: '98', mel_kg: '2', inputs: [{ material_name: 'raw pata', qty_kg: '100', rate_rs_per_kg: '600' }] }],
    })
    expect((await send('/v1/casting/preview/session', input)).status).toBe(200)
    expect(write).not.toHaveBeenCalled()
    const staged = await send('/v1/casting/drafts/session', input)
    expect(staged.status).toBe(201)
    expect(await staged.json()).toMatchObject({ status: 'pending_review', posted: false })
    expect(write).toHaveBeenCalledWith('casting', input.sourceId, input.originalMessage, expect.objectContaining({
      batches: [expect.objectContaining({ inputs: [expect.objectContaining({ material_id: itemId, material_name: 'Pata' })] })],
    }))
  })
  it('requires a key and does not proxy PocketBase or expose Sales routes', async () => {
    expect((await fetch(base + '/v1/dues')).status).toBe(401)
    expect((await send('/pb/api/collections/users/records')).status).toBe(404)
    expect((await send('/v1/sales')).status).toBe(404)
  })

  it('returns ledger-calculated dues, recent payment and pending slip', async () => {
    expect(await (await send('/v1/dues?supplier=Vashram%20bhai')).json()).toMatchObject({ totalPayablePaise: 900_000 })
    expect(await (await send('/v1/recent-payment')).json()).toMatchObject({ payment: { mode: 'cash', amountPaise: 90_000 } })
    expect(await (await send('/v1/slips?supplier=Vashram%20bhai&pending=true')).json()).toMatchObject({ total: 1, slips: [{ inNo: 'IN-2627-0001', duePaise: 900_000 }] })
  })

  it('lists all pending slips and reports supplier breakdown and recent activity with one key', async () => {
    expect(await (await send('/v1/purchase/slips?pending=true')).json()).toMatchObject({
      total: 1, pageSize: 25, suppliers: [{ name: 'Vashram (Pata)', duePaise: 900_000, slipCount: 1 }],
    })
    expect(await (await send('/v1/dues?include=suppliers')).json()).toMatchObject({
      suppliers: [
        { name: 'Vashram (Pata)', kachaPayablePaise: 900_000, gstPayablePaise: 0 },
        { name: 'Demo One', kachaPayablePaise: 0, gstPayablePaise: 0 },
      ],
    })
    expect(await (await send('/v1/activity?days=7')).json()).toMatchObject({
      from: '2026-11-18', total: 2, entries: expect.arrayContaining([expect.objectContaining({ type: 'slip' }), expect.objectContaining({ type: 'payment', direction: 'outgoing' })]),
    })
    expect((await send('/v1/slips')).status).toBe(422)
  })

  it('resolves exact inward numbers and suggests typo matches without selecting one', async () => {
    expect(await (await send('/v1/purchase/slips?inNo=in-2627-0001')).json()).toMatchObject({ total: 1, slips: [{ id: billId }] })
    const typo = await send('/v1/supplier?supplier=Vashrm%20bhai')
    expect(typo.status).toBe(404)
    expect(await typo.json()).toMatchObject({ error: 'NO_EXACT_MATCH', details: [{ id: supplierId }] })
    expect(await (await send('/v1/purchase/suppliers?q=Pata')).json()).toMatchObject({ total: 1, records: [{ id: supplierId }] })
  })

  it('queues a payment against a pending supplier using its proposal ID instead of creating a supplier', async () => {
    const supplierDraftId = 'pending00000001'
    const req = { ...draft({ date: testDate, pool: 'kacha', kind: 'payment', mode: 'cash', amount_rs: '500' }), supplierDraftId }
    const response = await send('/v1/purchase/drafts/payment', req)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ waitingForSupplier: true, supplierDraftId, posted: false, preview: { supplier: 'Pending Supplier' } })
    expect(write).toHaveBeenCalledWith('payment', 'source:one', 'Test Purchase proposal', expect.objectContaining({ supplier_id: supplierDraftId }), supplierDraftId)
  })

  it('provides the pending draft queue independently of source IDs', async () => {
    expect((await send('/v1/purchase/drafts')).status).toBe(200)
    expect((await send('/v1/drafts?cursor=notvalid')).status).toBe(422)
  })

  it('previews then stages a bill, without writing from preview or guessing a pool', async () => {
    write.mockClear()
    expect((await send('/v1/preview/bill', draft({ ...sale, pool: undefined }))).status).toBe(422)
    const preview = await send('/v1/preview/bill', draft(sale))
    expect(await preview.json()).toMatchObject({ status: 'preview_only', preview: { netPaise: 37_620_000 } })
    expect(write).not.toHaveBeenCalled()
    expect((await send('/v1/drafts/bill', draft(sale))).status).toBe(201)
    expect(write).toHaveBeenCalledWith('bill', 'source:one', 'Test Purchase proposal', expect.objectContaining({ supplier_id: supplierId }))
  })

  it('uses total bag weight and the saved rate and checks for duplicate suppliers', async () => {
    const bardan = await send('/v1/preview/bardan', draft({ billId, bagCount: 16, weightG: 3080, date: testDate, method: 'deduct' }))
    expect(await bardan.json()).toMatchObject({ preview: { weightG: 3080, rateMilli: 990_000, creditPaise: 304_920 } })
    expect((await send('/v1/preview/new-supplier-bill', draft(sale))).status).toBe(422)
    const fresh = await send('/v1/preview/new-supplier-bill', draft({ ...sale, supplier_name: 'Vishwas Patel' }))
    expect(await fresh.json()).toMatchObject({ preview: { newSupplier: true } })
  })

  it('uses the same GST default as the editor and rejects mismatched line amounts', async () => {
    const gst = await send('/v1/preview/bill', draft({ ...sale, pool: 'gst', tax_mode: 'gst' }))
    expect(await gst.json()).toMatchObject({ preview: { gstRateBp: 1800, netPaise: 44_391_600 } })
    const invalid = await send('/v1/preview/bill', draft({ ...sale, lines: [{ ...sale.lines[0], amount_rs: '10' }] }))
    expect(invalid.status).toBe(422)
  })

  it('reconciles a lost write response and refuses a changed payload with the same source', async () => {
    const localFetch = globalThis.fetch
    let saved: object | undefined
    let requests = 0
    try {
      globalThis.fetch = vi.fn(async (url, init) => {
        if (String(url).endsWith('auth-with-password')) return Response.json({ token: 'fake-local-token', record: { id: 'muse00000000001', role: 'muse' } })
        if (init?.method === 'POST') {
          requests++
          saved = { id: 'draft1', ...JSON.parse(String(init.body)) }
          throw new Error('Connection dropped after commit')
        }
        return Response.json({ items: saved ? [saved] : [] })
      })
      const writer = createDraftWriter('disposable@example.invalid', 'not-a-real-password')
      await expect(writer('bill', 'sale-1', 'original', { sample: 1 })).resolves.toMatchObject({ draftId: 'draft1', reused: true })
      await expect(writer('bill', 'sale-1', 'original', { sample: 1 })).resolves.toMatchObject({ draftId: 'draft1', reused: true })
      await expect(writer('bill', 'sale-1', 'original', { sample: 2 })).rejects.toMatchObject({ status: 409 })
      expect(requests).toBe(1)
    } finally { globalThis.fetch = localFetch }
  })
})
