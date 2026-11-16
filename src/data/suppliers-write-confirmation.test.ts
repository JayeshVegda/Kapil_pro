import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ collection: vi.fn(), createBatch: vi.fn() }))
vi.mock('@/data/pocketbase', () => ({
  pb: { collection: mocks.collection, createBatch: mocks.createBatch, baseUrl: 'http://test.invalid', authStore: { record: { id: 'test-user' } } },
}))

import { addPurchaseBardanEntry, createPurchaseBill, createSupplierPayment, loadPurchaseBill, updatePurchaseBill } from './suppliers'
import { computeSupplierSettlement } from '@/domain/supplier-settlement'

type Row = Record<string, unknown> & { id: string }
type Operation = { collection: string; action: 'create' | 'update' | 'delete'; row: Row }
let records: Map<string, Map<string, Row>>
let readFailure: boolean
let responseLost: boolean
let rollbackFailure: boolean
let readCalls: number
let sendCalls: number
let auditSequence: number
let auditReadFailure: boolean

function table(name: string) {
  if (!records.has(name)) records.set(name, new Map())
  return records.get(name)!
}

const paymentInput = { supplierId: 'supplier1', date: '2026-04-12', pool: 'kacha' as const, kind: 'payment', amountPaise: 100_000, mode: 'cash' }
const billInput = { supplierId: 'supplier1', inNo: 'IN-001', date: '2026-04-12', pool: 'kacha' as const, taxMode: 'none', lines: [{ itemName: 'Scrap', weightG: 1000, rateMilli: 800000, amountPaise: 80000 }] }

beforeEach(() => {
  records = new Map()
  readFailure = false
  responseLost = false
  rollbackFailure = false
  readCalls = 0
  sendCalls = 0
  auditSequence = 0
  auditReadFailure = false
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })

  mocks.collection.mockImplementation((name: string) => ({
    getOne: async (id: string) => {
      readCalls++
      if (readFailure || (name === 'purchase_audit_log' && auditReadFailure)) throw Object.assign(new Error('connection lost'), { status: 0 })
      const row = table(name).get(id)
      if (!row) throw Object.assign(new Error('Not found'), { status: 404 })
      return row
    },
    getFullList: async () => [...table(name).values()],
    update: async (id: string, payload: Record<string, unknown>) => {
      const row = { ...table(name).get(id), ...payload, id }
      table(name).set(id, row)
      return row
    },
  }))
  mocks.createBatch.mockImplementation(() => {
    const operations: Operation[] = []
    return {
      collection: (name: string) => ({
        create: (row: Row) => operations.push({ collection: name, action: 'create', row }),
        update: (id: string, row: Record<string, unknown>) => operations.push({ collection: name, action: 'update', row: { ...row, id } }),
        delete: (id: string) => operations.push({ collection: name, action: 'delete', row: { id } }),
      }),
      send: async () => {
        sendCalls++
        if (rollbackFailure) throw Object.assign(new Error('Invalid payment mode'), { status: 400 })
        const results = operations.map(({ collection, action, row }) => {
          const id = row.id || `audit${String(++auditSequence).padStart(10, '0')}`
          if (action === 'create' && table(collection).has(id)) throw Object.assign(new Error('Duplicate id'), { status: 400 })
          const saved = { ...table(collection).get(id), ...row, id, created: '2026-04-12 10:00:00Z' }
          if (action === 'delete') table(collection).delete(id)
          else table(collection).set(id, saved)
          return { status: action === 'delete' ? 204 : 200, body: saved }
        })
        if (responseLost) throw Object.assign(new Error('response lost'), { status: 0 })
        return results
      },
    }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('supplier write confirmation', () => {
  it('returns a committed payment without depending on a second read', async () => {
    readFailure = true

    const saved = await createSupplierPayment(paymentInput)

    expect(saved.amountPaise).toBe(100_000)
    expect(saved.created).toBe('2026-04-12 10:00:00Z')
    expect(readCalls).toBe(0)
    expect(table('supplier_payments').size).toBe(1)
  })

  it('confirms a lost payment response by reading the original id', async () => {
    responseLost = true

    const saved = await createSupplierPayment(paymentInput)

    expect(saved.amountPaise).toBe(100_000)
    expect(table('supplier_payments').size).toBe(1)
    expect(sendCalls).toBe(1)
  })

  it('an uncertain retry confirms the original payment instead of minting another id', async () => {
    responseLost = true
    readFailure = true
    const input = { ...paymentInput, requestId: 'operation000001' }
    await expect(createSupplierPayment(input)).rejects.toThrow(/could not be confirmed/)
    readFailure = false
    responseLost = false

    const saved = await createSupplierPayment(input)

    expect(saved.amountPaise).toBe(100_000)
    expect(sendCalls).toBe(1)
    expect(table('supplier_payments').size).toBe(1)
  })

  it('blocks a new send while the original payment still cannot be checked', async () => {
    responseLost = true
    readFailure = true
    const input = { ...paymentInput, requestId: 'operation000002' }
    await expect(createSupplierPayment(input)).rejects.toThrow(/could not be confirmed/)

    await expect(createSupplierPayment(input)).rejects.toThrow(/could not be confirmed/)

    expect(sendCalls).toBe(1)
    expect(table('supplier_payments').size).toBe(1)
  })

  it('a confirmed identical later payment remains a separate legitimate transaction', async () => {
    const first = await createSupplierPayment(paymentInput)
    const second = await createSupplierPayment(paymentInput)

    expect(first.id).not.toBe(second.id)
    expect(table('supplier_payments').size).toBe(2)
  })

  it('preserves a definitive validation error and allows a corrected retry', async () => {
    rollbackFailure = true
    const input = { ...paymentInput, requestId: 'operation000003' }
    await expect(createSupplierPayment(input)).rejects.toThrow('Invalid payment mode')
    rollbackFailure = false

    await createSupplierPayment(input)

    expect(table('supplier_payments').size).toBe(1)
    expect(sendCalls).toBe(2)
  })

  it('returns committed bill timestamps without a post-save read', async () => {
    readFailure = true

    const saved = await createPurchaseBill(billInput)

    expect(saved.created).toBe('2026-04-12 10:00:00Z')
    expect(readCalls).toBe(0)
  })

  it('bill and bill-day payment are not duplicated after an uncertain bill response', async () => {
    responseLost = true
    readFailure = true
    const input = { ...billInput, requestId: 'operation000004', payment: { amountPaise: 50_000, mode: 'cash' as const } }
    await expect(createPurchaseBill(input)).rejects.toThrow(/could not be confirmed/)
    readFailure = false

    await createPurchaseBill(input)

    expect(table('purchase_bills').size).toBe(1)
    expect(table('purchase_bill_lines').size).toBe(1)
    expect(table('supplier_payments').size).toBe(1)
    expect(table('supplier_payment_allocations').size).toBe(1)
    expect(sendCalls).toBe(1)
  })

  it('creates the same pool-bound bardan advance as the later-add path, once on retry', async () => {
    for (const pool of ['kacha', 'gst'] as const) {
      const taxMode = pool === 'gst' ? 'gst' : 'none'
      const input = { ...billInput, pool, taxMode, gstRateBp: pool === 'gst' ? 1800 : 0,
        inNo: `IN-${pool}-1`, requestId: `advance-${pool}`,
        bardan: [{ bardanG: 1000, rateMilli: 800000, method: 'advance', creditPaise: 20000 }] }
      responseLost = true
      readFailure = true
      await expect(createPurchaseBill(input)).rejects.toThrow(/could not be confirmed/)
      responseLost = false
      readFailure = false
      const saved = await createPurchaseBill(input)
      expect([...table('supplier_payments').values()].filter((row) => row.kind === 'bardan_advance' && row.pool === pool)).toHaveLength(1)
      const later = await createPurchaseBill({ ...billInput, pool, taxMode, gstRateBp: input.gstRateBp, inNo: `IN-${pool}-2` })
      await addPurchaseBardanEntry({ billId: later.id, bardanG: 1000, rateMilli: 800000, method: 'advance', creditPaise: 20000 })
      const position = (billId: string) => {
        const bill = table('purchase_bills').get(billId)!
        const payments = [...table('supplier_payments').values()].filter((row) => row.pool === pool && row.kind === 'bardan_advance')
        const credit = payments.find((row) => row.reference === `Bardan Advance (Bill ${bill.in_no})`)!
        return computeSupplierSettlement({
          supplier: { openingKachaPaise: 0, openingGstPaise: 0 },
          bills: [{ id: billId, date: String(bill.date), created: String(bill.created), pool, taxMode, gstRateBp: input.gstRateBp }],
          lines: [{ billId, amountPaise: 80000 }], adjustments: [],
          bardan: [{ billId, method: 'advance', creditPaise: 20000 }],
          payments: [{ id: String(credit.id), date: String(credit.date), created: String(credit.created), pool, kind: 'bardan_advance', amountPaise: Number(credit.amount_paise) }],
          allocations: [],
        }).pools[pool].outstandingPaise
      }
      expect(position(saved.id)).toBe(position(later.id))
      expect([...table('purchase_audit_log').values()].filter((row) => row.collection === 'supplier_payments' && row.action === 'create')).toHaveLength(pool === 'kacha' ? 2 : 4)
    }
  })

  it('bardan returns its committed record without a dependent read', async () => {
    table('purchase_bills').set('bill1', { id: 'bill1', supplier: 'supplier1', pool: 'kacha', date: '2026-04-12', in_no: 'IN-001' })

    const saved = await addPurchaseBardanEntry({ billId: 'bill1', bardanG: 1000, rateMilli: 800000, method: 'deduct', creditPaise: 80000 })

    expect(saved.creditPaise).toBe(80000)
    expect(readCalls).toBe(1)
  })

  it('bill updates return the committed record without a second header read', async () => {
    table('purchase_bills').set('bill1', { id: 'bill1', supplier: 'supplier1', pool: 'kacha', date: '2026-04-12', in_no: 'IN-001' })

    const saved = await updatePurchaseBill('bill1', { ...billInput, date: '2026-04-13' })

    expect(saved.date).toBe('2026-04-13')
    expect(readCalls).toBe(1)
  })

  it('keeps receipt memos through save, reload, line edits and line removal', async () => {
    const saved = await createPurchaseBill({
      ...billInput, privateNote: 'Operator note',
      lines: [
        { ...billInput.lines[0], receiptMemo: '12' },
        { ...billInput.lines[0], itemName: 'Copper', receiptMemo: 'Bags returned' },
      ],
    })
    const detail = await loadPurchaseBill(saved.id)
    expect(detail.lines.map((line) => line.receiptMemo)).toEqual(['12', 'Bags returned'])
    const firstLine = detail.lines[0]

    await updatePurchaseBill(saved.id, { ...billInput, privateNote: 'Edited note', lines: [{ ...firstLine, receiptMemo: '14' }] })
    const updated = await loadPurchaseBill(saved.id)

    expect(updated.lines).toHaveLength(1)
    expect(updated.lines[0].id).toBe(firstLine.id)
    expect(updated.lines[0].receiptMemo).toBe('14')
    expect(updated.bill.privateNote).toContain('Edited note')
    expect(updated.bill.privateNote).not.toContain('Bags%20returned')
  })

  it('rejects unsupported bank mode before any transaction is sent', async () => {
    await expect(createSupplierPayment({ ...paymentInput, mode: 'bank' })).rejects.toThrow('supported payment mode')
    expect(sendCalls).toBe(0)
  })

  it('uncertain bardan advance retries do not duplicate the generated payment', async () => {
    table('purchase_bills').set('bill1', { id: 'bill1', supplier: 'supplier1', pool: 'kacha', date: '2026-04-12', in_no: 'IN-001' })
    const input = { billId: 'bill1', bardanG: 1000, rateMilli: 800000, method: 'advance', creditPaise: 80000 }
    responseLost = true

    const saved = await addPurchaseBardanEntry(input)

    expect(saved.creditPaise).toBe(80000)
    expect(table('purchase_bardan').size).toBe(1)
    expect(table('supplier_payments').size).toBe(1)
    expect(sendCalls).toBe(1)
  })

  it('pending confirmation survives a data-module reload', async () => {
    responseLost = true
    readFailure = true
    await expect(createSupplierPayment(paymentInput)).rejects.toThrow(/could not be confirmed/)
    readFailure = false
    responseLost = false
    vi.resetModules()
    const reloaded = await import('./suppliers')

    await reloaded.createSupplierPayment(paymentInput)

    expect(table('supplier_payments').size).toBe(1)
    expect(sendCalls).toBe(1)
  })

  it('an uncertain bill edit restores the committed receipt memo snapshot', async () => {
    const original = await createPurchaseBill(billInput)
    const detail = await loadPurchaseBill(original.id)
    const input = {
      ...billInput, privateNote: 'New receipt',
      lines: [{ ...detail.lines[0], receiptMemo: '12' }, { ...billInput.lines[0], itemName: 'Copper', receiptMemo: '6' }],
    }
    responseLost = true
    auditReadFailure = true
    await expect(updatePurchaseBill(original.id, input)).rejects.toThrow(/could not be confirmed/)
    responseLost = false
    auditReadFailure = false

    const retried = await updatePurchaseBill(original.id, input)

    expect(sendCalls).toBe(2)
    expect(retried.privateNote).toBe(table('purchase_bills').get(original.id)?.private_note)
    expect(table('purchase_bill_lines').size).toBe(2)
  })
})
