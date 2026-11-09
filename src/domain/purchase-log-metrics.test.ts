import { describe, expect, it } from 'vitest'
import { computePurchaseLogMetrics, supplierPaymentActivity } from './purchase-log-metrics'

describe('purchase log financial metrics', () => {
  it('separates cash paid out, incoming refunds and non-cash credits', () => {
    const payments = [
      { kind: 'payment', amountPaise: 100_000, cancelled: false },
      { kind: 'paid_on_behalf', amountPaise: 20_000, cancelled: false },
      { kind: 'refund_received', amountPaise: 10_000, cancelled: false },
      { kind: 'settle_off', amountPaise: 500, cancelled: false },
      { kind: 'bardan_advance', amountPaise: 2_000, cancelled: false },
      { kind: 'payment', amountPaise: 999_999, cancelled: true },
    ]

    const result = computePurchaseLogMetrics([], payments, [])

    expect(result.totalPaymentsPaise).toBe(120_000)
    expect(result.refundsReceivedPaise).toBe(10_000)
    expect(result.nonCashCreditsPaise).toBe(2_500)
    expect(result.activeCount).toBe(5)
    expect(supplierPaymentActivity('refund_received')).toMatchObject({ label: 'Refund received', direction: 'incoming' })
    expect(supplierPaymentActivity('settle_off')).toMatchObject({ direction: 'non-cash' })
  })

  it('includes opening/refund payables and separately shows pool-bound advances', () => {
    const summaries = [
      { outstandingPaise: 500_000, advancePaise: 0, kachaDuePaise: 500_000, gstDuePaise: 0 },
      { outstandingPaise: 100_000, advancePaise: 200_000, kachaDuePaise: 100_000, gstDuePaise: 0 },
    ]

    const result = computePurchaseLogMetrics([], [], summaries)

    expect(result.totalDuePaise).toBe(600_000)
    expect(result.availableAdvancePaise).toBe(200_000)
    expect(result.netPositionPaise).toBe(400_000)
  })

  it('cancelled bills do not inflate totals or bardan count', () => {
    const result = computePurchaseLogMetrics([
      { netPaise: 100_000, cancelled: false, bardanPending: true },
      { netPaise: 900_000, cancelled: true, bardanPending: true },
    ], [], [])

    expect(result.totalBillsPaise).toBe(100_000)
    expect(result.bardanCount).toBe(1)
    expect(result.activeCount).toBe(1)
  })
})
