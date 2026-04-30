import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recalculateAndPersistBillStatusesForCustomer } from '@/data/bill-statuses'

type MockRecord = Record<string, unknown> & { id: string }

const updates: Array<{ id: string; payload: Record<string, unknown> }> = []

const mockData = {
  customer: { id: 'c1', opening_balance: 0 },
  bills: [] as MockRecord[],
  billItems: [] as MockRecord[],
  payments: [] as MockRecord[],
}

vi.mock('@/data/pocketbase', () => {
  const pb = {
    collection: (name: string) => ({
      getOne: async () => {
        if (name === 'customers') return mockData.customer
        throw new Error(`Unexpected getOne collection: ${name}`)
      },
      getFullList: async () => {
        if (name === 'bills') return mockData.bills
        if (name === 'bill_items') return mockData.billItems
        if (name === 'payments') return mockData.payments
        throw new Error(`Unexpected getFullList collection: ${name}`)
      },
      update: async (id: string, payload: Record<string, unknown>) => {
        if (name !== 'bills') throw new Error(`Unexpected update collection: ${name}`)
        updates.push({ id, payload })
        return { id, ...payload }
      },
    }),
  }
  return { pb }
})

describe('recalculateAndPersistBillStatusesForCustomer', () => {
  beforeEach(() => {
    updates.length = 0
    mockData.customer = { id: 'c1', opening_balance: 0 }
    mockData.bills = [
      {
        id: 'b1',
        date: '2026-04-01',
        created: '2026-04-01T10:00:00Z',
        transport: 0,
        gst_rate: 0,
        status: 'paid',
      },
      {
        id: 'b2',
        date: '2026-04-02',
        created: '2026-04-02T10:00:00Z',
        transport: 0,
        gst_rate: 0,
        status: 'pending',
      },
    ]
    mockData.billItems = [
      { id: 'i1', bill: 'b1', amount: 100 },
      { id: 'i2', bill: 'b2', amount: 100 },
    ]
    mockData.payments = [{ id: 'p1', date: '2026-04-03', created: '2026-04-03T10:00:00Z', amount: 150 }]
  })

  it('updates only bills whose computed status changed', async () => {
    await recalculateAndPersistBillStatusesForCustomer('c1')

    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({ id: 'b2', payload: { status: 'partial' } })
  })
})
