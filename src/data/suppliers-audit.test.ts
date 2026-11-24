import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import {
  cancelPurchaseBill,
  cancelSupplierPayment,
  createPurchaseBill,
  createPurchaseItem,
  createSupplier,
  createSupplierPayment,
  deactivateSupplier,
  renamePurchaseItem,
  updateSupplier,
} from './suppliers'

describe('Purchase Audit Log Integration', () => {
  const mockTable = {
    getOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getFullList: vi.fn(),
  }
  const auditTable = {
    create: vi.fn(),
  }
  const batchCreateMock = vi.fn()
  const batchUpdateMock = vi.fn()
  const batchSendMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })

    ;(pb.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation((col: string) => {
      if (col === 'purchase_audit_log') return auditTable
      return mockTable
    })

    ;(pb.createBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      collection: (col: string) => ({
        create: (payload: unknown) => batchCreateMock(col, payload),
        update: (id: string, payload: Record<string, unknown>) => batchUpdateMock(col, id, payload),
      }),
      send: batchSendMock.mockImplementation(async () => [
        ...batchUpdateMock.mock.calls.map(([, id, payload]) => ({ status: 200, body: { id, ...payload } })),
        ...batchCreateMock.mock.calls.map(([, payload]) => ({ status: 200, body: payload })),
      ]),
    })

    mockTable.create.mockImplementation(async (payload) => ({ id: 'rec_created', ...payload }))
    mockTable.update.mockImplementation(async (id, payload) => ({ id, ...payload }))
    mockTable.getOne.mockImplementation(async (id) => ({ id, company_name: 'Old Co', name: 'Old Name', active: true }))
    mockTable.getFullList.mockResolvedValue([])
    auditTable.create.mockResolvedValue({ id: 'audit_rec_1' })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('records an audit entry when creating a supplier', async () => {
    await createSupplier({
      companyName: 'New Metals',
      city: 'Jamnagar',
      openingKachaPaise: 50_000,
    })

    expect(auditTable.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'suppliers',
        action: 'create',
        actor: 'admin@kapil.local',
        after_json: expect.stringContaining('New Metals'),
      }),
    )
  })

  it('records an audit entry with before/after when updating a supplier', async () => {
    await updateSupplier('sup_123', {
      companyName: 'Updated Metals',
      city: 'Rajkot',
    })

    expect(auditTable.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'suppliers',
        record_id: 'sup_123',
        action: 'update',
        actor: 'admin@kapil.local',
        after_json: expect.stringContaining('Updated Metals'),
      }),
    )
  })

  it('records an audit entry when deactivating a supplier', async () => {
    await deactivateSupplier('sup_123')

    expect(auditTable.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'suppliers',
        record_id: 'sup_123',
        action: 'deactivate',
        after_json: JSON.stringify({ active: false }),
      }),
    )
  })

  it('records audit rows when creating and renaming purchase items', async () => {
    await createPurchaseItem('Brass Sisu')
    expect(auditTable.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'purchase_items',
        action: 'create',
        after_json: JSON.stringify({ name: 'Brass Sisu' }),
      }),
    )

    await renamePurchaseItem('item_1', 'Brass Sisu Refined')
    expect(auditTable.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'purchase_items',
        record_id: 'item_1',
        action: 'rename',
        after_json: JSON.stringify({ name: 'Brass Sisu Refined', aliases: 'Old Name' }),
      }),
    )
  })

  it('batches an audit row when creating a purchase bill', async () => {
    await createPurchaseBill({
      supplierId: 'sup_1',
      inNo: 'IN-099',
      date: '2026-04-10',
      pool: 'kacha',
      taxMode: 'none',
      lines: [{ itemName: 'Scrap', weightG: 10_000, rateMilli: 800_000, amountPaise: 8_000_000 }],
    })

    expect(batchCreateMock).toHaveBeenCalledWith(
      'purchase_audit_log',
      expect.objectContaining({
        collection: 'purchase_bills',
        action: 'create',
        actor: 'admin@kapil.local',
      }),
    )
    expect(batchSendMock).toHaveBeenCalled()
  })

  it('saves a bill-day payment and its bill allocation in the bill batch', async () => {
    await createPurchaseBill({
      supplierId: 'sup_1', inNo: 'IN-101', date: '2026-04-10', pool: 'kacha', taxMode: 'none',
      lines: [{ itemName: 'Scrap', weightG: 1000, rateMilli: 800000, amountPaise: 80000 }],
      payment: { amountPaise: 50000, mode: 'cash' },
    })

    const payment = batchCreateMock.mock.calls.find(([collection]) => collection === 'supplier_payments')?.[1] as { id: string; amount_paise: number }
    const allocation = batchCreateMock.mock.calls.find(([collection]) => collection === 'supplier_payment_allocations')?.[1] as { payment: string; amount_paise: number }
    expect(payment.amount_paise).toBe(50000)
    expect(allocation).toMatchObject({ payment: payment.id, amount_paise: 50000 })
    expect(batchSendMock).toHaveBeenCalledTimes(1)
  })

  it('does not create another bill if the save response is uncertain', async () => {
    batchSendMock.mockRejectedValueOnce(new Error('connection lost'))
    mockTable.getOne.mockRejectedValueOnce(new Error('connection lost'))
    await expect(createPurchaseBill({
      supplierId: 'sup_1', inNo: 'IN-099', date: '2026-04-10', pool: 'kacha', taxMode: 'none',
      lines: [{ itemName: 'Scrap', weightG: 1000, rateMilli: 800000, amountPaise: 80000 }],
    })).rejects.toThrow('Check the purchase bill list or supplier payment history before saving again')
    expect(batchSendMock).toHaveBeenCalledTimes(1)
    expect(batchCreateMock.mock.calls.filter(([collection]) => collection === 'purchase_bills')).toHaveLength(1)
  })

  it('does not perform a second read after a successful bill save', async () => {
    mockTable.getOne.mockRejectedValue(new Error('connection lost'))
    const bill = await createPurchaseBill({
      supplierId: 'sup_1', inNo: 'IN-099', date: '2026-04-10', pool: 'kacha', taxMode: 'none',
      lines: [{ itemName: 'Scrap', weightG: 1000, rateMilli: 800000, amountPaise: 80000 }],
    })
    expect(bill.inNo).toBe('IN-099')
    expect(batchSendMock).toHaveBeenCalledTimes(1)
    expect(mockTable.getOne).not.toHaveBeenCalled()
  })

  it('rejects an invalid purchase line before sending a batch', async () => {
    await expect(createPurchaseBill({
      supplierId: 'sup_1', inNo: 'IN-100', date: '2026-04-10', pool: 'kacha', taxMode: 'none',
      lines: [{ itemName: 'Scrap', weightG: 0, rateMilli: 800000, amountPaise: 0 }],
    })).rejects.toThrow('Weight on line 1')
    expect(batchSendMock).not.toHaveBeenCalled()
  })

  it('rejects payment pins that exceed the payment before sending a batch', async () => {
    await expect(createSupplierPayment({
      supplierId: 'sup_1', date: '2026-04-12', pool: 'kacha', kind: 'payment', amountPaise: 100,
      allocations: [{ billId: 'bill_1', amountPaise: 101 }],
    })).rejects.toThrow('Allocations exceed the payment amount')
    expect(batchSendMock).not.toHaveBeenCalled()
  })

  it('records an audit row when cancelling a purchase bill', async () => {
    await cancelPurchaseBill('bill_1', 'Duplicate invoice entered')

    expect(batchUpdateMock).toHaveBeenCalledWith('purchase_bills', 'bill_1', { cancelled: true, cancel_reason: 'Duplicate invoice entered' })
    expect(batchCreateMock).toHaveBeenCalledWith('purchase_audit_log',
      expect.objectContaining({
        collection: 'purchase_bills',
        record_id: 'bill_1',
        action: 'cancel',
        after_json: JSON.stringify({ cancelled: true, cancel_reason: 'Duplicate invoice entered' }),
      }),
    )
  })

  it('voids a supplier payment and records its audit entry in the same batch', async () => {
    await cancelSupplierPayment('pay_1', 'Duplicate transfer')
    expect(batchUpdateMock).toHaveBeenCalledWith('supplier_payments', 'pay_1', { cancelled: true, cancel_reason: 'Duplicate transfer' })
    expect(batchCreateMock).toHaveBeenCalledWith('purchase_audit_log', expect.objectContaining({ collection: 'supplier_payments', record_id: 'pay_1', action: 'cancel' }))
    expect(batchSendMock).toHaveBeenCalledTimes(1)
  })

  it('does not post a follow-up purchase payment while the parent supplier draft is still pending', async () => {
    mockTable.getOne.mockImplementation(async (id) => id === 'supplier1234567'
      ? { id, status: 'pending_review' }
      : { id, status: 'pending_review', supplier_draft: 'supplier1234567' })
    await expect(createSupplierPayment({
      draftId: 'childdraft00001', supplierId: 'supplier1234567', date: '2026-11-24',
      pool: 'kacha', kind: 'payment', amountPaise: 50_000, mode: 'cash',
    })).rejects.toThrow('Approve the linked new supplier')
    expect(batchSendMock).not.toHaveBeenCalled()
  })

  it('batches an audit row when creating a supplier payment', async () => {
    await createSupplierPayment({
      supplierId: 'sup_1',
      date: '2026-04-12',
      pool: 'kacha',
      kind: 'payment',
      amountPaise: 5_000_000,
      mode: 'rtgs',
      reference: 'RTGS-TEST-1',
    })

    expect(batchCreateMock).toHaveBeenCalledWith(
      'purchase_audit_log',
      expect.objectContaining({
        collection: 'supplier_payments',
        action: 'create',
        actor: 'admin@kapil.local',
      }),
    )
    expect(batchSendMock).toHaveBeenCalled()
  })
})
