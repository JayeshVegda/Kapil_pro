import { describe, expect, it } from 'vitest'
import {
  dedupeBillPreviewCredits,
  getAttachedPaymentBillRef,
  isPaymentAttachedToBill,
  isPaymentAttachedToPriorBill,
  partitionPaymentsForNextBill,
} from './bill-preview'

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

  it('matches notes with custom operator details or prefixes/suffixes', () => {
    const noteWithSuffix = 'Quick payment with bill 10/101 - Cheque #55442'
    expect(getAttachedPaymentBillRef(noteWithSuffix)).toBe('10/101')
    expect(isPaymentAttachedToBill(noteWithSuffix, '10/101')).toBe(true)
    expect(isPaymentAttachedToBill(noteWithSuffix, '10/102')).toBe(false)
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

  it('folds a future-dated attached payment (e.g. 18th attached to 15th) into prior balance on subsequent bills (16th, 18th, 19th) and never leaks as period credit', () => {
    const futureAttachedPayment = {
      id: 'attached-future',
      date: '2026-07-18',
      amount: 40000,
      createdTs: 150,
      note: 'Quick payment with bill 10/101 - PDC',
    }
    const independentPayment = {
      id: 'indep-1',
      date: '2026-07-17',
      amount: 15000,
      createdTs: 250,
      note: 'Normal cash receipt',
    }

    // Next bill on 2026-07-16 (before the 18th payment date)
    const result16 = partitionPaymentsForNextBill(
      [futureAttachedPayment, independentPayment],
      {
        cutoffDate: '2026-07-15',
        cutoffCreatedTs: 100,
        currentBillDate: '2026-07-16',
        priorBillRefs: new Set(['10/101']),
      },
    )
    expect(result16.previousBalancePayments).toEqual([futureAttachedPayment])
    expect(result16.periodCredits).toEqual([]) // independent payment is on 17th, after 16th

    // Next bill on 2026-07-18
    const result18 = partitionPaymentsForNextBill(
      [futureAttachedPayment, independentPayment],
      {
        cutoffDate: '2026-07-15',
        cutoffCreatedTs: 100,
        currentBillDate: '2026-07-18',
        priorBillRefs: new Set(['10/101']),
      },
    )
    expect(result18.previousBalancePayments).toEqual([futureAttachedPayment])
    expect(result18.periodCredits).toEqual([independentPayment])

    // Next bill on 2026-07-19
    const result19 = partitionPaymentsForNextBill(
      [futureAttachedPayment, independentPayment],
      {
        cutoffDate: '2026-07-15',
        cutoffCreatedTs: 100,
        currentBillDate: '2026-07-19',
        priorBillRefs: new Set(['10/101']),
      },
    )
    expect(result19.previousBalancePayments).toEqual([futureAttachedPayment])
    expect(result19.periodCredits).toEqual([independentPayment])
  })
})
