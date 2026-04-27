import { describe, expect, it } from 'vitest'
import { buildCustomerLedgerSummaries } from '@/domain/customers'

describe('customers domain', () => {
  it('computes due amount when net balance is positive', () => {
    const summaries = buildCustomerLedgerSummaries({
      customers: [{ id: 'c1', name: 'Alpha', active: true, openingBalance: 200 }],
      bills: [{ id: 'b1', customerId: 'c1', customerName: 'Alpha', date: '2026-04-10', bookNo: 1, billNo: 1, transport: 100, gstRate: 0 }],
      billItems: [{ billId: 'b1', amount: 500 }],
      payments: [{ id: 'p1', customerId: 'c1', customerName: 'Alpha', date: '2026-04-11', amount: 300 }],
    })

    expect(summaries[0]?.netBalance).toBe(500)
    expect(summaries[0]?.dueAmount).toBe(500)
    expect(summaries[0]?.advanceAmount).toBe(0)
    expect(summaries[0]?.balanceLabel).toBe('Due')
  })

  it('computes advance when overpaid', () => {
    const summaries = buildCustomerLedgerSummaries({
      customers: [{ id: 'c1', name: 'Beta', active: true, openingBalance: 0 }],
      bills: [{ id: 'b1', customerId: 'c1', customerName: 'Beta', date: '2026-04-10', bookNo: 1, billNo: 2, transport: 0, gstRate: 0 }],
      billItems: [{ billId: 'b1', amount: 300 }],
      payments: [{ id: 'p1', customerId: 'c1', customerName: 'Beta', date: '2026-04-11', amount: 500 }],
    })

    expect(summaries[0]?.netBalance).toBe(-200)
    expect(summaries[0]?.dueAmount).toBe(0)
    expect(summaries[0]?.advanceAmount).toBe(200)
    expect(summaries[0]?.balanceLabel).toBe('Advance')
  })

  it('returns clear label when perfectly settled', () => {
    const summaries = buildCustomerLedgerSummaries({
      customers: [{ id: 'c1', name: 'Gamma', active: true, openingBalance: 100 }],
      bills: [],
      billItems: [],
      payments: [{ id: 'p1', customerId: 'c1', customerName: 'Gamma', date: '2026-04-11', amount: 100 }],
    })

    expect(summaries[0]?.netBalance).toBe(0)
    expect(summaries[0]?.balanceLabel).toBe('Clear')
  })
})

