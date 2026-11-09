import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data/pocketbase', () => ({ pb: { collection: vi.fn() } }))

import { pb } from '@/data/pocketbase'
import { formatPurchaseLineMemos } from '@/domain/purchase-receipt-memos'
import { loadAllPurchaseBills, loadAllSupplierPayments, loadSupplierBundle, loadSuppliersSummary, loadPurchaseReadModel } from './suppliers'

type Row = Record<string, unknown> & { id: string }
type ReadOptions = { sort?: string; filter?: string }

const note = formatPurchaseLineMemos('[bags_at_receipt:2.500]\nKeep dry', { line1: 'Received 25 bags' })

function records(): Record<string, Row[]> {
  return {
    suppliers: [
      { id: 'supplier1', company_name: 'Zinc Metals', opening_kacha_paise: 10_000, opening_gst_paise: -20_000, active: true },
      { id: 'supplier2', company_name: 'Alfa Metals', opening_kacha_paise: -5_000, active: false },
    ],
    purchase_bills: [
      { id: 'bill1', supplier: 'supplier1', in_no: 'IN-001', date: '2026-10-01', pool: 'kacha', private_note: note, created: '2026-10-01 10:00:00Z' },
      { id: 'gstbill', supplier: 'supplier1', in_no: 'IN-002', date: '2026-11-02', pool: 'gst', tax_mode: 'gst', gst_rate_bp: 1800, created: '2026-11-02 10:00:00Z' },
      { id: 'cancelled', supplier: 'supplier1', in_no: 'IN-003', date: '2026-11-06', pool: 'kacha', cancelled: true, created: '2026-11-06 10:00:00Z' },
      { id: 'orphan', supplier: 'missing', in_no: 'IN-004', date: '2026-11-06', pool: 'kacha', created: '2026-11-06 10:00:00Z' },
    ],
    purchase_bill_lines: [
      { id: 'line1', bill: 'bill1', item_name: 'Scrap', weight_g: 100_000, amount_paise: 100_000 },
      { id: 'gstline', bill: 'gstbill', item_name: 'Copper', weight_g: 50_000, amount_paise: 100_000 },
      { id: 'cancelledline', bill: 'cancelled', amount_paise: 999_900 },
      { id: 'orphanline', bill: 'orphan', amount_paise: 9_900 },
    ],
    purchase_bill_adjustments: [],
    purchase_bardan: [{ id: 'bardan1', bill: 'gstbill', method: 'deduct', credit_paise: 10_000, date: '2026-11-07' }],
    supplier_payments: [
      { id: 'payment1', supplier: 'supplier1', date: '2026-10-03', pool: 'kacha', kind: 'payment', amount_paise: 60_000, created: '2026-10-03 10:00:00Z' },
      { id: 'refund', supplier: 'supplier1', date: '2026-10-04', pool: 'kacha', kind: 'refund_received', amount_paise: 15_000, created: '2026-10-04 10:00:00Z' },
      { id: 'gstpayment', supplier: 'supplier1', date: '2026-11-03', pool: 'gst', kind: 'payment', amount_paise: 10_000, created: '2026-11-03 10:00:00Z' },
      { id: 'cancelledpayment', supplier: 'supplier1', date: '2026-11-08', pool: 'kacha', kind: 'payment', amount_paise: 30_000, cancelled: true, created: '2026-11-08 10:00:00Z' },
      { id: 'orphanpayment', supplier: 'missing', date: '2026-11-08', pool: 'gst', kind: 'payment', amount_paise: 5_000, created: '2026-11-08 10:00:00Z' },
    ],
    supplier_payment_allocations: [
      { id: 'pin1', payment: 'cancelledpayment', bill: 'bill1', amount_paise: 5_000 },
      { id: 'crosssupplier', payment: 'payment1', bill: 'orphan', amount_paise: 100 },
      { id: 'foreignpayment', payment: 'orphanpayment', bill: 'bill1', amount_paise: 100 },
    ],
  }
}

function installReads(data = records()) {
  const tables = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, {
    getFullList: vi.fn(async (options: ReadOptions = {}) => {
      const filtered = options.filter === 'active = true' ? rows.filter((row) => row.active === true) : rows
      const fields = (options.sort ?? '').split(',').filter(Boolean)
      return [...filtered].sort((a, b) => {
        for (const field of fields) {
          const descending = field.startsWith('-')
          const key = descending ? field.slice(1) : field
          const left = String(a[key] ?? '')
          const right = String(b[key] ?? '')
          if (left !== right) return (left < right ? -1 : 1) * (descending ? -1 : 1)
        }
        return 0
      })
    }),
    getOne: vi.fn(async (id: string) => {
      const row = rows.find((record) => record.id === id)
      if (!row) throw { status: 404, message: 'Record not found' }
      return row
    }),
  }]))
  vi.mocked(pb.collection).mockImplementation((name) => tables[name] as unknown as ReturnType<typeof pb.collection>)
  return tables
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('purchase loader characterization', () => {
  it('filters supplier bundles by bill/payment ownership and retains cancelled rows and receipt memos', async () => {
    installReads()
    const bundle = await loadSupplierBundle('supplier1')
    expect(bundle.bills.map((bill) => bill.id)).toEqual(['bill1', 'gstbill', 'cancelled'])
    expect(bundle.lines.find((line) => line.id === 'line1')?.receiptMemo).toBe('Received 25 bags')
    expect(bundle.lines.some((line) => line.id === 'orphanline')).toBe(false)
    expect(bundle.allocations.map((pin) => pin.id)).toEqual(['crosssupplier', 'pin1'])
    expect(bundle.payments.some((payment) => payment.cancelled)).toBe(true)
  })

  it('keeps supplier net position separate from pool payables and includes inactive suppliers', async () => {
    installReads()
    const summaries = await loadSuppliersSummary()
    expect(summaries.map((row) => row.supplier.id)).toEqual(['supplier2', 'supplier1'])
    expect(summaries[0]).toMatchObject({ outstandingPaise: -5_000, advancePaise: 5_000, oldestDueDays: null })
    expect(summaries[1]).toMatchObject({
      kachaDuePaise: 65_000, gstDuePaise: 76_200, outstandingPaise: 141_200, advancePaise: 0,
      lastActivityDate: '2026-11-08', bardanPendingCount: 1, oldestDueDays: 38,
    })
  })

  it('returns newest bills first with full tax/bardan settlement, private metadata and unknown-supplier fallback', async () => {
    installReads()
    const bills = await loadAllPurchaseBills()
    expect(bills.map((bill) => bill.id)).toEqual(['orphan', 'cancelled', 'gstbill', 'bill1'])
    expect(bills.find((bill) => bill.id === 'bill1')).toMatchObject({
      netPaise: 100_000, paidPaise: 50_000, duePaise: 50_000, status: 'partial', totalKg: 100,
      userNote: 'Keep dry', bagsAtReceiptKg: 2.5, privateNote: note,
    })
    expect(bills.find((bill) => bill.id === 'gstbill')).toMatchObject({ netPaise: 106_200, duePaise: 76_200, bardanPending: false })
    expect(bills.find((bill) => bill.id === 'cancelled')).toMatchObject({ netPaise: 0, duePaise: 0, status: 'cancelled' })
    expect(bills[0]).toMatchObject({ supplierName: 'Unknown Supplier', netPaise: 0, status: 'open' })
  })

  it('enriches real applied amounts, excludes refunds/cancellations from advance, and preserves stored manual pins', async () => {
    installReads()
    const payments = await loadAllSupplierPayments()
    expect(payments.map((payment) => payment.id)).toEqual(['orphanpayment', 'cancelledpayment', 'gstpayment', 'refund', 'payment1'])
    expect(payments.find((payment) => payment.id === 'payment1')).toMatchObject({ appliedPaise: 60_000, advancePaise: 0 })
    expect(payments.find((payment) => payment.id === 'refund')).toMatchObject({ appliedPaise: 0, advancePaise: 0 })
    expect(payments.find((payment) => payment.id === 'cancelledpayment')).toMatchObject({
      appliedPaise: 0, advancePaise: 0, allocations: [{ billId: 'bill1', inNo: 'IN-001', amountPaise: 5_000, isManual: true }],
    })
    expect(payments[0]).toMatchObject({ supplierName: 'Unknown Supplier', appliedPaise: 0, advancePaise: 5_000 })
  })

  it.each([
    [loadAllPurchaseBills, 'load-all-purchase-bills'],
    [loadAllSupplierPayments, 'load-all-supplier-payments'],
    [loadSuppliersSummary, 'load-suppliers-summary'],
  ] as const)('propagates collection failures through the existing operation label %s', async (loader, operation) => {
    const tables = installReads()
    tables.purchase_bill_lines.getFullList.mockRejectedValueOnce({ status: 403, message: 'Forbidden' })
    await expect(loader()).rejects.toMatchObject({ code: 'FORBIDDEN', operation })
  })

  it('rejects missing suppliers before reading their collections', async () => {
    const tables = installReads()
    await expect(loadSupplierBundle('missing')).rejects.toMatchObject({ code: 'NOT_FOUND', operation: 'get-supplier' })
    expect(tables.purchase_bills.getFullList).not.toHaveBeenCalled()
  })
})

describe('shared purchase snapshot', () => {
  it('reads each collection once and exposes consistent legacy projections and supplier contexts', async () => {
    const tables = installReads()
    const model = await loadPurchaseReadModel()
    for (const table of Object.values(tables)) expect(table.getFullList).toHaveBeenCalledTimes(1)
    expect(model.bills).toEqual(await loadAllPurchaseBills())
    expect(model.payments).toEqual(await loadAllSupplierPayments())
    expect(model.summaries).toEqual(await loadSuppliersSummary())
    expect(model.supplierContexts.get('supplier1')?.bundle).toEqual(await loadSupplierBundle('supplier1'))
    expect(model.supplierContexts.get('supplier1')?.settlement.combined.netPositionPaise).toBe(141_200)
    expect(model.supplierContexts.has('missing')).toBe(false)
  })
})
