import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDraftWriter, createMusePurchaseServer } from '../../scripts/muse-purchase-api'
import { parseSalesRequest, prepareSalesProposal, type MuseSalesLedger } from '../../scripts/muse-sales'
import type { MusePurchaseLedger } from '../../scripts/muse-purchase-ledger'

const customerId = 'customer0000001'
const itemId = 'spindle00000001'
const old = '2026-11-20'
const today = '2026-11-24'
const ledger: MuseSalesLedger = {
  customers: [{ id: customerId, name: 'Sambhu', company_name: 'Aaryan Enterprises', aliases: 'sambhu', opening_balance: 1000, active: 1 }],
  items: [{ id: itemId, name: 'Spindle', aliases: 'sp', type: 'gas', bag_weight: 50, default_rate: 100, active: 1 }],
  bills: [{ id: 'old', customer: customerId, date: old, bill_ref: '351/351', mkt: 900 }],
  billItems: [{ id: 'line', bill: 'old', item: itemId, item_name: 'Spindle', qty: 50, rate: 1010, amount: 50_500 }],
  payments: [{ id: 'paid', customer: customerId, date: '2026-11-23', amount: 2500 }],
  rates: [{ id: 'newrate', date: today, vilaity: 930 }, { id: 'olderate', date: old, vilaity: 900 }],
}
const key = 'disposable-shared-key'
const payload = { customer: 'sambhu', date: today, items: [{ item: 'sp', qty: 1, unit: 'bags' }] }
const envelope = (p: Record<string, unknown> = payload) => ({ sourceId: 'sale:1', originalMessage: 'One bag Spindle for Sambhu', payload: p })
const commit = vi.fn()

const server = createMusePurchaseServer({
  keyDigest: createHash('sha256').update(key).digest(),
  loadLedger: () => ({ suppliers: [], summaries: [], bills: [], payments: [], supplierContexts: new Map(), items: [], asOf: today }) as MusePurchaseLedger,
  loadSales: () => ledger,
  writeDraft: Object.assign(vi.fn(), {
    status: vi.fn(),
    sales: { status: vi.fn(), write: vi.fn(async (_request, build: () => unknown) => {
      const result = build()
      commit(result)
      return { draftId: 'disposable', status: 'pending_review', reused: false }
    }) },
  }),
})
let base = ''
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
})
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

const get = (route: string) => fetch(base + route, { headers: { 'X-API-Key': key } })
const post = (route: string, body: unknown) => fetch(base + route, {
  method: 'POST', headers: { 'X-API-Key': key, 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('Muse shared gateway — Sales', () => {
  it('uses the same key for modules, Sales dues and Purchase dues; leaves Casting off', async () => {
    expect(await (await get('/v1/modules')).json()).toMatchObject({ sales: true, purchase: true, casting: false })
    expect((await get('/v1/purchase/dues')).status).toBe(200)
    expect((await get('/v1/casting/dues')).status).toBe(404)
    expect(await (await get('/v1/sales/dues?customer=sambhu')).json()).toMatchObject({
      totalDueRs: 49_000,
      billPreviewBalance: { previousBalanceAmount: 51_500, credits: [{ amount: 2500 }] },
    })
  })

  it('prices Sales with the saved customer/item differential and the app bill cutoff', async () => {
    const response = await post('/v1/sales/preview/bill', envelope())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'preview_only', previewToken: expect.stringMatching(/^[a-f0-9]{64}$/),
      preview: { mkt: 930, marketDate: today, previousBalance: 51_500, currentBillTotal: 52_000, finalTotal: 101_000,
        itemRows: [{ qty: 50, bags: 1, rate: 1040, differential: 110, history: { billRef: '351/351', mkt: 900 } }] },
    })
  })

  it('can preview a new customer and first bill without changing the customer master', async () => {
    const response = await post('/v1/sales/preview/new-customer-bill', envelope({ ...payload, customer: 'Demo One' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ preview: { newCustomer: true, previousBalance: 0, itemRows: [{ rate: 1030, rateSource: 'item_default' }] } })
    expect((await post('/v1/sales/preview/new-customer-bill', envelope())).status).toBe(422)
    expect(await (await get('/v1/sales/customers?q=sambhu')).json()).toMatchObject({ total: 1, records: [{ id: customerId }] })
  })

  it.each([['mkt_rate', 900, 'Use mkt'], ['converted_bill', '', 'Omit converted_bill'], ['confidence', 95, '0.95, not 95']])(
    'shows an actionable error for %s', async (field, value, expected) => {
      const response = await post('/v1/sales/preview/bill', envelope({ ...payload, [field]: value }))
      expect(response.status).toBe(422)
      expect((await response.json()).message).toContain(expected)
    },
  )

  it('blocks staging a stale Sales preview before it reaches the writer', async () => {
    const response = await post('/v1/sales/drafts/bill', { ...envelope(), previewToken: '0'.repeat(64) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'PREVIEW_CHANGED', details: { preview: { finalTotal: 101_000 } } })
    expect(commit).not.toHaveBeenCalled()
  })

  it('stages header, item lines and deposit in one batch, recovering the same draft after a lost response', async () => {
    const originalFetch = globalThis.fetch
    let saved: Record<string, unknown> | undefined
    let sent = 0
    try {
      globalThis.fetch = vi.fn(async (url, init) => {
        if (String(url).endsWith('auth-with-password')) return Response.json({ token: 'disposable', record: { id: 'muse00000000001', role: 'muse' } })
        if (String(url).endsWith('/api/batch')) {
          sent++
          const { requests } = JSON.parse(String(init?.body))
          expect(requests.map((row: { url: string }) => row.url)).toEqual([
            '/api/collections/bill_drafts/records', '/api/collections/bill_draft_items/records', '/api/collections/bill_draft_payments/records',
          ])
          expect(requests[1].body).toMatchObject({ draft: requests[0].body.id, rate: 1040 })
          saved = requests[0].body
          throw new Error('Response lost after commit')
        }
        return Response.json({ items: saved ? [saved] : [] })
      })
      const writer = createDraftWriter('disposable@example.invalid', 'non-secret-fixture').sales
      const parsed = parseSalesRequest('bill', envelope({ ...payload, payments: [{ amount: 5000, mode: 'Cash' }] }))
      const build = vi.fn(() => prepareSalesProposal(parsed, ledger))
      const staged = await writer.write(parsed, build)
      await expect(writer.write(parsed, build)).resolves.toMatchObject({ draftId: staged.draftId, reused: true })
      await expect(writer.write({ ...parsed, originalMessage: 'Changed request' }, build)).rejects.toMatchObject({ status: 409 })
      expect(sent).toBe(1)
      expect(build).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
