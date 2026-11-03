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
import {
  cancelPurchaseBill,
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
  const batchSendMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    ;(pb.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation((col: string) => {
      if (col === 'purchase_audit_log') return auditTable
      return mockTable
    })

    ;(pb.createBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      collection: (col: string) => ({
        create: (payload: unknown) => batchCreateMock(col, payload),
        update: vi.fn(),
      }),
      send: batchSendMock.mockResolvedValue(undefined),
    })

    mockTable.create.mockImplementation(async (payload) => ({ id: 'rec_created', ...payload }))
    mockTable.update.mockImplementation(async (id, payload) => ({ id, ...payload }))
    mockTable.getOne.mockImplementation(async (id) => ({ id, company_name: 'Old Co', name: 'Old Name', active: true }))
    auditTable.create.mockResolvedValue({ id: 'audit_rec_1' })
  })

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
        after_json: JSON.stringify({ name: 'Brass Sisu Refined' }),
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

  it('records an audit row when cancelling a purchase bill', async () => {
    await cancelPurchaseBill('bill_1', 'Duplicate invoice entered')

    expect(auditTable.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'purchase_bills',
        record_id: 'bill_1',
        action: 'cancel',
        after_json: JSON.stringify({ cancelled: true, cancel_reason: 'Duplicate invoice entered' }),
      }),
    )
  })

  it('batches an audit row when creating a supplier payment', async () => {
    await createSupplierPayment({
      supplierId: 'sup_1',
      date: '2026-04-12',
      pool: 'kacha',
      kind: 'payment',
      amountPaise: 5_000_000,
      mode: 'Bank',
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
