import { describe, expect, it } from 'vitest'
import { buildPartyEvents, buildPartyKpis, buildPartyRows } from '@/domain/ledger'

describe('ledger domain', () => {
  it('computes party statuses with 30-day overdue threshold', () => {
    const rows = buildPartyRows({
      asOfDate: '2026-04-30',
      overdueDaysThreshold: 30,
      customers: [
        { id: 'c1', name: 'A', active: true, openingBalance: 0 },
        { id: 'c2', name: 'B', active: true, openingBalance: 0 },
      ],
      bills: [
        { id: 'b1', customerId: 'c1', date: '2026-03-01', bookNo: 1, billNo: 1, transport: 0, gstRate: 0 },
        { id: 'b2', customerId: 'c2', date: '2026-04-20', bookNo: 1, billNo: 2, transport: 0, gstRate: 0 },
      ],
      billItems: [
        { billId: 'b1', amount: 500, qty: 100, bags: 2 },
        { billId: 'b2', amount: 300, qty: 50, bags: 1 },
      ],
      payments: [{ id: 'p1', customerId: 'c2', date: '2026-04-21', amount: 350, mode: 'Cash' }],
    })

    const rowA = rows.find((row) => row.customerId === 'c1')
    const rowB = rows.find((row) => row.customerId === 'c2')
    expect(rowA?.status).toBe('Overdue')
    expect(rowB?.status).toBe('Advance')
    expect(buildPartyKpis(rows)).toMatchObject({ overdueParties: 1, pendingParties: 1 })
  })

  it('builds chronological running-balance events', () => {
    const events = buildPartyEvents({
      openingBalance: 100,
      bills: [{ id: 'b1', date: '2026-04-10', bookNo: 2, billNo: 4, total: 500 }],
      payments: [{ id: 'p1', date: '2026-04-11', amount: 300, mode: 'Bank' }],
    })

    expect(events.map((event) => event.balance)).toEqual([100, 600, 300])
  })
})

