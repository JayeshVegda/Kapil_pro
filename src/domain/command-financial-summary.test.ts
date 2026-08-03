import { describe, expect, it } from 'vitest'
import { buildCommandBillSummary, buildCommandPaymentSummary } from './command-financial-summary'

describe('Control-K financial summary', () => {
  it('shows a compact bill total and amount due', () => {
    expect(buildCommandBillSummary({
      items: [{ qty: 100, rate: 955 }, { qty: 20, rate: 50 }],
      transport: 500,
      gstRate: 0,
      gstAmount: 0,
      previousBalance: 10_000,
    })).toEqual({ itemsTotal: 96_500, gstAmount: 0, grandTotal: 97_000, amountDue: 107_000 })
  })

  it('shows the customer balance after a payment', () => {
    expect(buildCommandPaymentSummary({ currentBalance: 50_000, paymentAmount: 12_000 })).toEqual({ currentBalance: 50_000, balanceAfterPayment: 38_000 })
  })
})
