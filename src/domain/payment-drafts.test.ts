import { describe, expect, it } from 'vitest'
import { composeReceiptNote, isDuplicateReceipt } from '@/domain/payment-drafts'

describe('composeReceiptNote (rule 6: prefix + muse note + operator edit)', () => {
  it('prefixes "Receipt via Muse" plus the draft date and keeps the muse note after it', () => {
    expect(composeReceiptNote('2026-11-02', 'RTGS')).toBe('Receipt via Muse 2026-11-02 - RTGS')
  })

  it('falls back to unknown-date wording when no date survived the dictation', () => {
    expect(composeReceiptNote('', 'cash')).toBe('Receipt via Muse unknown-date - cash')
  })

  it('operator edit replaces the muse note (never both)', () => {
    expect(composeReceiptNote('2026-11-02', 'RTGS', 'biased Captain entry per Jay')).toBe(
      'Receipt via Muse 2026-11-02 - biased Captain entry per Jay',
    )
  })

  it('an empty operator edit falls back to the muse note; cleared note drops the tail entirely', () => {
    expect(composeReceiptNote('2026-11-02', 'RTGS', '')).toBe('Receipt via Muse 2026-11-02 - RTGS')
    expect(composeReceiptNote('2026-11-02', '')).toBe('Receipt via Muse 2026-11-02')
  })
})

describe('isDuplicateReceipt', () => {
  const recent = [
    { customer: 'cust000000000', date: '2026-11-02', amount: 25000 },
    { customerId: 'other000000000', date: '2026-11-02', amount: 9000 },
  ]

  it('detects same party + date + amount as a duplicate', () => {
    expect(
      isDuplicateReceipt({ customerId: 'cust000000000', date: '2026-11-02', amount: 25000 }, recent),
    ).toBe(true)
  })

  it('a different amount or date or party is not a duplicate', () => {
    expect(
      isDuplicateReceipt({ customerId: 'cust000000000', date: '2026-11-02', amount: 30000 }, recent),
    ).toBe(false)
    expect(
      isDuplicateReceipt({ customerId: 'cust000000000', date: '2026-11-01', amount: 25000 }, recent),
    ).toBe(false)
    expect(
      isDuplicateReceipt({ customerId: 'third000000000', date: '2026-11-02', amount: 25000 }, recent),
    ).toBe(false)
  })
})
