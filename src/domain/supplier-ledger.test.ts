import { describe, expect, it } from 'vitest'
import { buildSupplierLedger, type SupplierLedgerInput } from './supplier-ledger'

const ba = { created: '2026-01-01 10:00:00.000Z' }
const bb = { created: '2026-01-01 11:00:00.000Z' }
const bc = { created: '2026-01-01 12:00:00.000Z' }

function baseInput(overrides: Partial<SupplierLedgerInput>): SupplierLedgerInput {
  return {
    bills: [],
    lines: [],
    payments: [],
    openingKachaPaise: 0,
    openingGstPaise: 0,
    ...overrides,
  }
}

describe('buildSupplierLedger', () => {
  it('bill increases what we owe; payment reduces it; running balances are chronological', () => {
    const result = buildSupplierLedger(
      baseInput({
        bills: [{ id: 'b1', date: '2026-04-10', ...ba, pool: 'kacha', taxMode: 'none', gstRateBp: 0 }],
        lines: [{ billId: 'b1', amountPaise: 50_00_000 }],
        payments: [{ id: 'p1', date: '2026-04-12', ...bb, pool: 'kacha', kind: 'payment', amountPaise: 20_00_000 }],
      }),
    )
    expect(result.entries.map((e) => e.kind)).toEqual(['bill', 'payment'])
    expect(result.entries[0].amountPaise).toBe(50_00_000)
    expect(result.entries[0].balancePaise).toBe(50_00_000)
    expect(result.entries[1].amountPaise).toBe(-20_00_000)
    expect(result.entries[1].balancePaise).toBe(30_00_000)
    expect(result.closingPaise).toBe(30_00_000)
    expect(result.isNil).toBe(false)
  })

  it('pools stay separate; pool filter scopes both rows and balance', () => {
    const result = buildSupplierLedger(
      baseInput({
        bills: [
          { id: 'k1', date: '2026-04-01', ...ba, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
          { id: 'g1', date: '2026-04-02', ...bb, pool: 'gst', taxMode: 'gst', gstRateBp: 1_800 },
        ],
        lines: [
          { billId: 'k1', amountPaise: 10_00_000 },
          { billId: 'g1', amountPaise: 20_00_000 },
        ],
        filter: { pool: 'kacha' },
      }),
    )
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].id).toBe('k1')
    expect(result.closingPaise).toBe(10_00_000)
  })

  it('date window carries the pre-window balance forward as opening', () => {
    const result = buildSupplierLedger(
      baseInput({
        bills: [{ id: 'b1', date: '2026-04-01', ...ba, pool: 'kacha', taxMode: 'none', gstRateBp: 0 }],
        lines: [{ billId: 'b1', amountPaise: 30_00_000 }],
        payments: [{ id: 'p1', date: '2026-05-01', ...bb, pool: 'kacha', kind: 'payment', amountPaise: 10_00_000 }],
        filter: { from: '2026-05-01', to: '2026-05-31' },
      }),
    )
    // the bill is outside the window but its 3L is inside the opening balance
    expect(result.openingPaise).toBe(30_00_000)
    expect(result.entries.map((e) => e.id)).toEqual(['p1'])
    expect(result.entries[0].balancePaise).toBe(20_00_000)
    expect(result.closingPaise).toBe(20_00_000)
  })

  it('fiscal year filter maps to Apr 1 - Mar 31', () => {
    const input = baseInput({
      bills: [
        { id: 'inFy', date: '2026-02-10', ...ba, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
        { id: 'outFy', date: '2026-04-02', ...bb, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
      ],
      lines: [
        { billId: 'inFy', amountPaise: 5_00_000 },
        { billId: 'outFy', amountPaise: 7_00_000 },
      ],
      filter: { fiscalYear: '2526' },
    })
    const result = buildSupplierLedger(input)
    expect(result.entries.map((e) => e.id)).toEqual(['inFy'])
    expect(result.closingPaise).toBe(5_00_000)
  })

  it('refund_received raises what we owe; cancelled rows vanish', () => {
    const result = buildSupplierLedger(
      baseInput({
        payments: [
          { id: 'r1', date: '2026-04-05', ...ba, pool: 'kacha', kind: 'refund_received', amountPaise: 15_00_000 },
          { id: 'c1', date: '2026-04-06', ...bb, pool: 'kacha', kind: 'payment', amountPaise: 5_00_000, cancelled: true },
        ],
      }),
    )
    expect(result.entries.map((e) => e.id)).toEqual(['r1'])
    expect(result.closingPaise).toBe(15_00_000)
  })

  it('bardan deduct reduces balance; in_kind and cash_back are zero-effect rows', () => {
    const result = buildSupplierLedger(
      baseInput({
        bills: [{ id: 'b1', date: '2026-04-01', ...ba, pool: 'gst', taxMode: 'none', gstRateBp: 0 }],
        lines: [{ billId: 'b1', amountPaise: 20_00_000 }],
        bardan: [
          { id: 'bd1', billId: 'b1', date: '2026-04-03', ...bb, method: 'deduct', creditPaise: 4_00_000 },
          { id: 'bd2', billId: 'b1', date: '2026-04-04', ...bc, method: 'in_kind', creditPaise: 0, note: 'settled in kind' },
          { id: 'bd3', billId: 'b1', date: '2026-04-05', ...ba, method: 'cash_back', creditPaise: 0, cashAmountPaise: 2_00_000 },
        ],
        filter: { pool: 'gst' },
      }),
    )
    expect(result.entries.map((e) => [e.kind, e.amountPaise])).toEqual([
      ['bill', 20_00_000],
      ['bardan_deduct', -4_00_000],
      ['in_kind', 0],
      ['cash_back', 0],
    ])
    expect(result.entries[2].label).toBe('settled in kind')
    expect(result.closingPaise).toBe(16_00_000)
  })

  it('negative closing balance flags the NIL badge', () => {
    const result = buildSupplierLedger(
      baseInput({
        openingKachaPaise: 0,
        payments: [{ id: 'p1', date: '2026-04-01', ...ba, pool: 'kacha', kind: 'settle_off', amountPaise: 5_00_000 }],
        filter: { pool: 'kacha' },
      }),
    )
    expect(result.closingPaise).toBe(-5_00_000)
    expect(result.isNil).toBe(true)
  })
})
