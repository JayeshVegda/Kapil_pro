import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data/pocketbase', () => {
  const collectionMock = vi.fn()
  const createBatchMock = vi.fn()
  return {
    pb: {
      authStore: { record: { get: (field: string) => (field === 'email' ? 'admin@kapil.local' : '') } },
      collection: collectionMock,
      createBatch: createBatchMock,
    },
  }
})

import { pb } from '@/data/pocketbase'
import { loadAllSupplierPayments, updatePurchaseBill } from './suppliers'

type BatchOp = { collection: string; op: 'create' | 'update' | 'delete'; id?: string; payload?: unknown }

type TableMock = {
  getOne: ReturnType<typeof vi.fn>
  getFullList: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  getList: ReturnType<typeof vi.fn>
}

function makeTables(names: string[]) {
  const tables: Record<string, TableMock> = {}
  const getTable = (name: string): TableMock => {
    if (!tables[name]) {
      tables[name] = {
        getOne: vi.fn(),
        getFullList: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        getList: vi.fn().mockResolvedValue({ totalItems: 0, items: [] }),
      }
    }
    return tables[name]
  }
  for (const name of names) getTable(name)
  ;(pb.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation(getTable)

  const ops: BatchOp[] = []
  ;(pb.createBatch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    collection: (name: string) => ({
      create: (payload: unknown) => {
        ops.push({ collection: name, op: 'create', payload })
      },
      update: (id: string, payload?: unknown) => {
        ops.push({ collection: name, op: 'update', id, payload })
      },
      delete: (id: string) => {
        ops.push({ collection: name, op: 'delete', id })
      },
    }),
    send: vi.fn().mockResolvedValue(undefined),
  }))
  return { tables, ops }
}

describe('updatePurchaseBill line preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates kept lines in place, unlinks bardan from removed lines, and deletes only removed lines', async () => {
    const { tables, ops } = makeTables(['purchase_bills', 'purchase_bill_lines', 'purchase_bill_adjustments', 'purchase_bardan', 'purchase_audit_log'])
    tables.purchase_bills.getOne.mockResolvedValue({
      id: 'b1',
      supplier: 's1',
      in_no: 'IN-1',
      date: '2026-04-01',
      pool: 'kacha',
      tax_mode: 'none',
    })
    tables.purchase_bill_lines.getFullList.mockResolvedValue([
      { id: 'L1', bill: 'b1', item_name: 'A', weight_g: 1000, rate_milli: 500000, amount_paise: 50000 },
      { id: 'L2', bill: 'b1', item_name: 'B', weight_g: 2000, rate_milli: 600000, amount_paise: 120000 },
    ])
    tables.purchase_bill_adjustments.getFullList.mockResolvedValue([{ id: 'A1', bill: 'b1', type: 'labour' }])
    tables.purchase_bardan.getFullList.mockImplementation(async (opts?: { filter?: string }) => {
      if (opts?.filter?.includes('"L2"')) return [{ id: 'BD1', bill: 'b1', rate_line: 'L2' }]
      return []
    })

    const saved = await updatePurchaseBill('b1', {
      supplierId: 's1',
      date: '2026-04-01',
      pool: 'kacha',
      taxMode: 'none',
      lines: [
        { id: 'L1', itemName: 'A', weightG: 1500, rateMilli: 500000, amountPaise: 75000 },
        { itemName: 'C', weightG: 3000, rateMilli: 700000, amountPaise: 210000 },
      ],
    })

    expect(saved.id).toBe('b1')

    // L1 kept: updated in place with its original id (bardan refs survive).
    const l1Update = ops.find((o) => o.collection === 'purchase_bill_lines' && o.op === 'update')
    expect(l1Update).toMatchObject({ id: 'L1', payload: { weight_g: 1500 } })

    // New line C created with a generated id.
    const created = ops.find((o) => o.collection === 'purchase_bill_lines' && o.op === 'create')
    expect(created).toBeDefined()
    expect(String((created?.payload as { id: string }).id)).toHaveLength(15)

    // L2 removed: its bardan entry is unlinked (not cascade-deleted), then the line deleted.
    const unlink = ops.find((o) => o.collection === 'purchase_bardan' && o.op === 'update')
    expect(unlink).toMatchObject({ id: 'BD1', payload: { rate_line: '' } })
    expect(ops).toContainEqual({ collection: 'purchase_bill_lines', op: 'delete', id: 'L2' })
    expect(ops).not.toContainEqual({ collection: 'purchase_bill_lines', op: 'delete', id: 'L1' })

    // Adjustments are replaced wholesale (nothing references them).
    expect(ops).toContainEqual({ collection: 'purchase_bill_adjustments', op: 'delete', id: 'A1' })

    // Unlink is audited alongside the bill update.
    const auditOps = ops.filter((o) => o.collection === 'purchase_audit_log' && o.op === 'create')
    expect(auditOps.some((o) => (o.payload as { action: string }).action === 'unlink_rate_line')).toBe(true)
    expect(auditOps.some((o) => (o.payload as { action: string }).action === 'update')).toBe(true)
  })

  it('ignores line ids that do not belong to the bill (treats them as new lines)', async () => {
    const { tables, ops } = makeTables(['purchase_bills', 'purchase_bill_lines', 'purchase_bill_adjustments', 'purchase_bardan', 'purchase_audit_log'])
    tables.purchase_bills.getOne.mockResolvedValue({
      id: 'b1',
      supplier: 's1',
      in_no: 'IN-1',
      date: '2026-04-01',
      pool: 'kacha',
      tax_mode: 'none',
    })
    tables.purchase_bill_lines.getFullList.mockResolvedValue([
      { id: 'L1', bill: 'b1', item_name: 'A', weight_g: 1000, rate_milli: 500000, amount_paise: 50000 },
    ])

    await updatePurchaseBill('b1', {
      supplierId: 's1',
      date: '2026-04-01',
      pool: 'kacha',
      taxMode: 'none',
      lines: [
        { id: 'L1', itemName: 'A', weightG: 1000, rateMilli: 500000, amountPaise: 50000 },
        { id: 'line-formfake', itemName: 'B', weightG: 1000, rateMilli: 500000, amountPaise: 50000 },
      ],
    })

    const updates = ops.filter((o) => o.collection === 'purchase_bill_lines' && o.op === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe('L1')
    const creates = ops.filter((o) => o.collection === 'purchase_bill_lines' && o.op === 'create')
    expect(creates).toHaveLength(1)
    expect(ops.filter((o) => o.collection === 'purchase_bardan' && o.op === 'update')).toHaveLength(0)
  })
})

describe('loadAllSupplierPayments applied amounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies payments FIFO against real bill dues and never reports refunds as advance', async () => {
    const { tables } = makeTables(['suppliers', 'purchase_bills', 'purchase_bill_lines', 'purchase_bill_adjustments', 'purchase_bardan', 'supplier_payments', 'supplier_payment_allocations'])
    tables.suppliers.getFullList.mockResolvedValue([
      { id: 's1', company_name: 'ACME', opening_kacha_paise: 0, opening_gst_paise: 0 },
    ])
    tables.purchase_bills.getFullList.mockResolvedValue([
      { id: 'b1', supplier: 's1', date: '2026-04-01', pool: 'kacha', tax_mode: 'none', cancelled: false, created: '2026-04-01 10:00:00.000Z' },
    ])
    tables.purchase_bill_lines.getFullList.mockResolvedValue([
      { id: 'l1', bill: 'b1', item_name: 'A', weight_g: 100000, rate_milli: 500000, amount_paise: 100000 },
    ])
    tables.supplier_payments.getFullList.mockResolvedValue([
      { id: 'p1', supplier: 's1', date: '2026-04-04', pool: 'kacha', kind: 'payment', amount_paise: 60000, cancelled: false, created: '2026-04-04 10:00:00.000Z' },
      { id: 'p2', supplier: 's1', date: '2026-04-05', pool: 'kacha', kind: 'refund_received', amount_paise: 15000, cancelled: false, created: '2026-04-05 10:00:00.000Z' },
    ])

    const rows = await loadAllSupplierPayments()
    const p1 = rows.find((r) => r.id === 'p1')
    const p2 = rows.find((r) => r.id === 'p2')

    // With the full bill inputs, the ₹600 payment applies against the ₹1000 bill.
    expect(p1).toMatchObject({ supplierName: 'ACME', amountPaise: 60000, appliedPaise: 60000, advancePaise: 0 })
    // A refund_received is a payable, not a prepayment — advance must be 0.
    expect(p2).toMatchObject({ amountPaise: 15000, appliedPaise: 0, advancePaise: 0 })
  })
})
