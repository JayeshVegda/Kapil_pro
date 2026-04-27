import { describe, expect, it } from 'vitest'
import { buildPaymentPreview } from '@/domain/payment-ledger'

describe('payment ledger', () => {
  it('allocates new payment to oldest dues first', () => {
    const preview = buildPaymentPreview({
      openingBalance: 0,
      asOfDate: '2026-04-20',
      paymentAmount: 900,
      bills: [
        { id: 'b1', date: '2026-04-01', bookNo: 1, billNo: 1, total: 500 },
        { id: 'b2', date: '2026-04-05', bookNo: 1, billNo: 2, total: 700 },
      ],
      payments: [],
    })

    expect(preview.outstandingBeforePayment).toBe(1200)
    expect(preview.paymentApplied).toBe(900)
    expect(preview.outstandingAfterPayment).toBe(300)
    expect(preview.lines[0]).toMatchObject({ dueRef: '1/1', paidAmount: 500, remainingAmount: 0 })
    expect(preview.lines[1]).toMatchObject({ dueRef: '1/2', paidAmount: 400, remainingAmount: 300 })
  })

  it('uses opening balance as first due when no bills exist', () => {
    const preview = buildPaymentPreview({
      openingBalance: 1000,
      asOfDate: '2026-04-20',
      paymentAmount: 300,
      bills: [],
      payments: [],
    })

    expect(preview.outstandingBeforePayment).toBe(1000)
    expect(preview.lines[0]).toMatchObject({
      dueRef: 'Opening Balance',
      dueDate: 'Opening',
      dueAmount: 1000,
      paidAmount: 300,
      remainingAmount: 700,
    })
    expect(preview.outstandingAfterPayment).toBe(700)
  })

  it('applies historical payments before simulating new payment', () => {
    const preview = buildPaymentPreview({
      openingBalance: 200,
      asOfDate: '2026-04-20',
      paymentAmount: 200,
      bills: [{ id: 'b1', date: '2026-04-10', bookNo: 2, billNo: 4, total: 500 }],
      payments: [{ id: 'p1', date: '2026-04-11', amount: 300 }],
    })

    expect(preview.outstandingBeforePayment).toBe(400)
    expect(preview.lines[0]).toMatchObject({ dueRef: '2/4', dueAmount: 400, paidAmount: 200, remainingAmount: 200 })
    expect(preview.outstandingAfterPayment).toBe(200)
  })

  it('keeps overpayment visible as advance (negative outstanding)', () => {
    const preview = buildPaymentPreview({
      openingBalance: 0,
      asOfDate: '2026-04-20',
      paymentAmount: 500,
      bills: [{ id: 'b1', date: '2026-04-10', bookNo: 2, billNo: 9, total: 300 }],
      payments: [],
    })

    expect(preview.outstandingBeforePayment).toBe(300)
    expect(preview.paymentApplied).toBe(300)
    expect(preview.outstandingAfterPayment).toBe(-200)
    expect(preview.advanceAfterPayment).toBe(200)
  })
})

