import { describe, expect, it } from 'vitest'
import { dedupeBillPreviewCredits, getAttachedPaymentBillRef, isPaymentAttachedToPriorBill, partitionPaymentsForNextBill } from './bill-preview'

describe('new bill preview credits', () => {
  it('shows each payment once by payment id', () => {
    expect(dedupeBillPreviewCredits([
      { id: 'p-old', date: '2026-07-01', amount: 500 },
      { id: 'p-new', date: '2026-08-03', amount: 300 },
      { id: 'p-old', date: '2026-07-01', amount: 500 },
    ])).toEqual([
      { id: 'p-old', date: '2026-07-01', amount: 500 },
      { id: 'p-new', date: '2026-08-03', amount: 300 },
    ])
  })
})

describe('bill-attached payment cutoff', () => {
  it('folds Aryan bill 101/126 quick payment into the previous balance', () => {
    const note = 'Quick payment with bill 101/126'

    expect(getAttachedPaymentBillRef(note)).toBe('101/126')
    expect(isPaymentAttachedToPriorBill(note, new Set(['101/125', '101/126']))).toBe(true)
  })

  it('does not classify independent or malformed notes as attached payments', () => {
    const priorBillRefs = new Set(['101/126'])

    expect(isPaymentAttachedToPriorBill('', priorBillRefs)).toBe(false)
    expect(isPaymentAttachedToPriorBill('Cash received after delivery', priorBillRefs)).toBe(false)
    expect(isPaymentAttachedToPriorBill('Quick payment with bill unknown', priorBillRefs)).toBe(false)
    expect(isPaymentAttachedToPriorBill('Quick payment with bill 101/127', priorBillRefs)).toBe(false)
  })

  it('keeps an attached after-save payment in balance while showing an independent after-save payment as credit', () => {
    const result = partitionPaymentsForNextBill(
      [
        { id: 'attached', date: '2026-07-30', amount: 240000, createdTs: 200, note: 'Quick payment with bill 101/126' },
        { id: 'independent', date: '2026-07-30', amount: 50000, createdTs: 300, note: 'Separate receipt' },
      ],
      {
        cutoffDate: '2026-07-30',
        cutoffCreatedTs: 100,
        currentBillDate: '2026-08-03',
        priorBillRefs: new Set(['101/126']),
      },
    )

    expect(result).toEqual({
      previousBalancePayments: [{ id: 'attached', date: '2026-07-30', amount: 240000, createdTs: 200, note: 'Quick payment with bill 101/126' }],
      periodCredits: [{ id: 'independent', date: '2026-07-30', amount: 50000, createdTs: 300, note: 'Separate receipt' }],
    })
  })
})
