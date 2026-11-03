import { describe, expect, it } from 'vitest'
import { computeSupplierSettlement, type SupplierSettlementInput } from './supplier-settlement'

const CREATED = {
  a: '2026-04-05T09:00:00.000Z',
  b: '2026-04-05T10:00:00.000Z',
  c: '2026-04-05T11:00:00.000Z',
  d: '2026-04-05T12:00:00.000Z',
}

function baseInput(overrides: Partial<SupplierSettlementInput> = {}): SupplierSettlementInput {
  return {
    supplier: { openingKachaPaise: 0, openingGstPaise: 0 },
    bills: [],
    lines: [],
    adjustments: [],
    bardan: [],
    payments: [],
    allocations: [],
    ...overrides,
  }
}

/**
 * Spec test 1: bill 101 = ₹3,52,000 (400 kg x 880), paid ₹4,00,000 same day;
 * bill 102 = ₹2,67,000 (300 kg x 890), paid ₹5,00,000.
 * -> 101 nil; ₹48,000 carry into 102; final: all nil, ₹2,81,000 advance.
 */
describe('settlement: FIFO carries money across bills', () => {
  it('spec scenario: 400x880 paid in full same day, leftover flows to next bill', () => {
    const input = baseInput({
      bills: [
        { id: 'b101', date: '2026-04-05', created: CREATED.a, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
        { id: 'b102', date: '2026-04-10', created: CREATED.b, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
      ],
      lines: [
        // 400.000 kg x 880.000 = 35,200,000 paise (₹3,52,000)
        { billId: 'b101', amountPaise: 35_200_000 },
        // 300.000 kg x 890.000 = 26,700,000 paise (₹2,67,000)
        { billId: 'b102', amountPaise: 26_700_000 },
      ],
      payments: [
        { id: 'p1', date: '2026-04-05', created: CREATED.c, pool: 'kacha', kind: 'payment', amountPaise: 40_000_000 },
        { id: 'p2', date: '2026-04-12', created: CREATED.d, pool: 'kacha', kind: 'payment', amountPaise: 50_000_000 },
      ],
    })
    const result = computeSupplierSettlement(input)
    const kacha = result.pools.kacha
    const bill101 = kacha.bills.find((row) => row.billId === 'b101')!
    const bill102 = kacha.bills.find((row) => row.billId === 'b102')!
    expect(bill101.status).toBe('nil')
    expect(bill101.paidPaise).toBe(35_200_000)
    expect(bill101.duePaise).toBe(0)
    expect(bill102.status).toBe('nil')
    expect(bill102.paidPaise).toBe(26_700_000) // 4.8L carry + rest of p2
    expect(result.combined.outstandingPaise).toBe(0)
    // ₹5,00,000 - ₹2,19,000 used on 102 = ₹2,81,000 advance
    expect(result.combined.advancePaise).toBe(28_100_000)
  })
})

/** Spec test 2: a manual pin keeps the money on its bill, FIFO loses a bill its share */
describe('settlement: manual pins override FIFO', () => {
  it('paying 2L, 4L then pinning 2L to bill 102 leaves 101 partial', () => {
    const input = baseInput({
      bills: [
        { id: 'b101', date: '2026-04-01', created: CREATED.a, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
        { id: 'b102', date: '2026-04-02', created: CREATED.b, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
      ],
      lines: [
        { billId: 'b101', amountPaise: 80_000_000 }, // ₹8,00,000
        { billId: 'b102', amountPaise: 80_000_000 },
      ],
      payments: [
        { id: 'p1', date: '2026-04-03', created: CREATED.c, pool: 'kacha', kind: 'payment', amountPaise: 20_000_000 }, // 2L
        { id: 'p2', date: '2026-04-04', created: CREATED.d, pool: 'kacha', kind: 'payment', amountPaise: 40_000_000 }, // 4L
        { id: 'p3', date: '2026-04-06', created: '2026-04-06T09:00:00.000Z', pool: 'kacha', kind: 'payment', amountPaise: 20_000_000 }, // 2L
      ],
      allocations: [{ paymentId: 'p3', billId: 'b102', amountPaise: 20_000_000 }],
    })
    const result = computeSupplierSettlement(input)
    const bill101 = result.pools.kacha.bills.find((row) => row.billId === 'b101')!
    const bill102 = result.pools.kacha.bills.find((row) => row.billId === 'b102')!
    expect(bill101.status).toBe('partial')
    expect(bill101.paidPaise).toBe(60_000_000)
    expect(bill102.status).toBe('partial')
    expect(bill102.paidPaise).toBe(20_000_000)
    expect(result.pools.kacha.outstandingPaise).toBe(80_000_000)
    // counterfactual sanity: same test without the pin drains 101 to nil first
    const noPinResult = computeSupplierSettlement({ ...input, allocations: [] })
    expect(noPinResult.pools.kacha.bills.find((row) => row.billId === 'b101')!.status).toBe('nil')
  })
})

/** Spec test 3: pools never cross */
describe('settlement: kacha and gst pools stay separate', () => {
  it('kacha pins over kacha bills, gst pin on the gst bill, nothing crosses', () => {
    const input = baseInput({
      bills: [
        { id: 'k1', date: '2026-04-01', created: CREATED.a, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
        { id: 'k2', date: '2026-04-02', created: CREATED.b, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
        { id: 'k3', date: '2026-04-03', created: CREATED.c, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
        { id: 'g1', date: '2026-04-05', created: CREATED.d, pool: 'gst', taxMode: 'gst', gstRateBp: 0 },
      ],
      lines: [
        { billId: 'k1', amountPaise: 10_000_000 }, // 1L
        { billId: 'k2', amountPaise: 10_000_000 },
        { billId: 'k3', amountPaise: 10_000_000 },
        { billId: 'g1', amountPaise: 90_000_000 }, // 9L
      ],
      payments: [
        { id: 'pk', date: '2026-04-04', created: '2026-04-04T09:00:00.000Z', pool: 'kacha', kind: 'payment', amountPaise: 20_000_000 },
        { id: 'pg', date: '2026-04-06', created: '2026-04-06T09:00:00.000Z', pool: 'gst', kind: 'payment', amountPaise: 100_000_000 },
      ],
      allocations: [
        { paymentId: 'pk', billId: 'k1', amountPaise: 10_000_000 },
        { paymentId: 'pk', billId: 'k2', amountPaise: 10_000_000 },
        { paymentId: 'pg', billId: 'g1', amountPaise: 90_000_000 },
        // cross-pool pin: a kacha payment pinned to a gst bill must be IGNORED
        { paymentId: 'pk', billId: 'g1', amountPaise: 5_000_000 },
      ],
    })
    const result = computeSupplierSettlement(input)
    expect(result.pools.kacha.bills.map((row) => row.status)).toEqual(['nil', 'nil', 'open'])
    expect(result.pools.kacha.outstandingPaise).toBe(10_000_000)
    expect(result.pools.kacha.advancePaise).toBe(0)
    expect(result.pools.gst.bills.map((row) => row.status)).toEqual(['nil'])
    expect(result.pools.gst.outstandingPaise).toBe(0)
    expect(result.pools.gst.advancePaise).toBe(10_000_000) // extra 1L stays in gst pool
  })
})

/** Spec test 4: opening balance is the pool's oldest payable, extinguished first */
describe('settlement: opening balance', () => {
  it('kacha opening 4L consumed by first kacha payments before any bill', () => {
    const input = baseInput({
      supplier: { openingKachaPaise: 40_000_000, openingGstPaise: 0 },
      bills: [{ id: 'k1', date: '2026-04-10', created: CREATED.b, pool: 'kacha', taxMode: 'none', gstRateBp: 0 }],
      lines: [{ billId: 'k1', amountPaise: 30_000_000 }], // 3L
      payments: [
        { id: 'p1', date: '2026-04-01', created: CREATED.a, pool: 'kacha', kind: 'payment', amountPaise: 10_000_000 }, // 1L
        { id: 'p2', date: '2026-04-02', created: CREATED.c, pool: 'kacha', kind: 'payment', amountPaise: 30_000_000 }, // 3L
        { id: 'p3', date: '2026-04-11', created: CREATED.d, pool: 'kacha', kind: 'payment', amountPaise: 30_000_000 }, // 3L
      ],
    })
    const result = computeSupplierSettlement(input)
    const k1 = result.pools.kacha.bills.find((row) => row.billId === 'k1')!
    // opening 4L: p1 + p2 absorb it; p3 (next payment) then pays the bill
    expect(k1.status).toBe('nil')
    expect(k1.paidPaise).toBe(30_000_000)
    expect(k1.duePaise).toBe(0)
    expect(result.pools.kacha.outstandingPaise).toBe(0)
    expect(result.pools.kacha.advancePaise).toBe(0)

    // same history with p3 removed: bill untouched, opening fully extinguished first
    const withoutP3 = computeSupplierSettlement({
      ...input,
      payments: input.payments.slice(0, 2),
    })
    const k1Early = withoutP3.pools.kacha.bills.find((row) => row.billId === 'k1')!
    expect(k1Early.status).toBe('open')
    expect(k1Early.paidPaise).toBe(0)
    expect(k1Early.duePaise).toBe(30_000_000)
    expect(withoutP3.pools.kacha.outstandingPaise).toBe(30_000_000)
    expect(withoutP3.pools.kacha.advancePaise).toBe(0)
  })
})

/** Spec test 5: bardan methods */
describe('settlement: bardan', () => {
  it('deduct lowers taxable and tax on a GST bill; in_kind settles with a note; none rows = pending', () => {
    const input = baseInput({
      bills: [
        { id: 'ded', date: '2026-04-01', created: CREATED.a, pool: 'gst', taxMode: 'gst', gstRateBp: 1_800 },
        { id: 'ink', date: '2026-04-02', created: CREATED.b, pool: 'gst', taxMode: 'none', gstRateBp: 0 },
        { id: 'pnd', date: '2026-04-03', created: CREATED.c, pool: 'gst', taxMode: 'none', gstRateBp: 0 },
      ],
      lines: [
        { billId: 'ded', amountPaise: 10_000_000 },
        { billId: 'ink', amountPaise: 10_000_000 },
        { billId: 'pnd', amountPaise: 10_000_000 },
      ],
      bardan: [
        { billId: 'ded', method: 'deduct', creditPaise: 1_000_000 },
        { billId: 'ink', method: 'in_kind', creditPaise: 0, note: 'emptied 14 bags, brass returned' },
      ],
      payments: [],
    })
    const result = computeSupplierSettlement(input)
    const ded = result.pools.gst.bills.find((row) => row.billId === 'ded')!
    expect(ded.duePaise).toBe(10_620_000) // taxable 9M + 1.62M tax
    expect(ded.bardanPending).toBe(false)
    expect(ded.bardanEntryCount).toBe(1)
    const ink = result.pools.gst.bills.find((row) => row.billId === 'ink')!
    expect(ink.duePaise).toBe(10_000_000) // credit 0, payable unchanged
    expect(ink.bardanPending).toBe(false)
    expect(ink.bardanNotes).toEqual(['emptied 14 bags, brass returned'])
    const pnd = result.pools.gst.bills.find((row) => row.billId === 'pnd')!
    expect(pnd.bardanPending).toBe(true)
  })

  it('cash_back only records the refund memo and never moves the payable', () => {
    const input = baseInput({
      bills: [{ id: 'cb', date: '2026-04-01', created: CREATED.a, pool: 'kacha', taxMode: 'none', gstRateBp: 0 }],
      lines: [{ billId: 'cb', amountPaise: 10_000_000 }],
      bardan: [{ billId: 'cb', method: 'cash_back', creditPaise: 0, cashAmountPaise: 250_000, note: 'supplier sent back ₹2,500' }],
      payments: [],
    })
    const result = computeSupplierSettlement(input)
    expect(result.pools.kacha.bills.find((row) => row.billId === 'cb')!.duePaise).toBe(10_000_000)
    expect(result.pools.kacha.payments).toHaveLength(0) // no refund row is invented here
    expect(result.pools.kacha.advancePaise).toBe(0)
  })

  it('multiple partial bardan entries sum up; a bardan advance is consumed FIFO by a later bill', () => {
    const input = baseInput({
      bills: [
        { id: 'b1', date: '2026-04-01', created: CREATED.a, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
        { id: 'b2', date: '2026-04-10', created: CREATED.b, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
      ],
      lines: [
        { billId: 'b1', amountPaise: 20_000_000 },
        { billId: 'b2', amountPaise: 10_000_000 },
      ],
      bardan: [
        { billId: 'b1', method: 'deduct', creditPaise: 1_000_000 },
        { billId: 'b1', method: 'deduct', creditPaise: 500_000 }, // second entry, partial
      ],
      payments: [
        { id: 'p1', date: '2026-04-11', created: CREATED.b, pool: 'kacha', kind: 'payment', amountPaise: 18_500_000 },
        { id: 'ba', date: '2026-04-12', created: CREATED.c, pool: 'kacha', kind: 'bardan_advance', amountPaise: 3_000_000 },
      ],
    })
    const result = computeSupplierSettlement(input)
    const b1 = result.pools.kacha.bills.find((row) => row.billId === 'b1')!
    expect(b1.bardanEntryCount).toBe(2)
    expect(b1.bardanPending).toBe(false)
    expect(b1.netPaise).toBe(18_500_000) // 20M - 1.5M of deduct credits
    expect(b1.duePaise).toBe(0)
    expect(b1.status).toBe('nil') // p1 (₹1,85,000) clears the 18.5M net
    // bardan advance (₹30,000) flows like a payment to the later bill
    const b2 = result.pools.kacha.bills.find((row) => row.billId === 'b2')!
    expect(b2.status).toBe('partial')
    expect(b2.paidPaise).toBe(3_000_000)
    expect(b2.duePaise).toBe(7_000_000)
    expect(result.pools.kacha.outstandingPaise).toBe(7_000_000)
  })
})

/** Spec test 6/7: rounding + tax positioning, viewed through settlement */
describe('settlement: rounding and tax modes', () => {
  it('nets are whole rupees and 3-decimal inputs round half up', () => {
    const input = baseInput({
      bills: [{ id: 'rb', date: '2026-04-01', created: CREATED.a, pool: 'kacha', taxMode: 'none', gstRateBp: 0 }],
      lines: [{ billId: 'rb', amountPaise: 12_345_678 }], // ₹1,23,456.78
      payments: [],
    })
    const result = computeSupplierSettlement(input)
    const rb = result.pools.kacha.bills.find((row) => row.billId === 'rb')!
    expect(rb.duePaise).toBe(12_345_700) // 12_345_678 rounds to the NEAREST rupee (+22)
    expect(rb.duePaise % 100).toBe(0)
  })

  it('RCM nets exclude tax at settlement level while GST nets include it', () => {
    const input = baseInput({
      bills: [
        { id: 'g1', date: '2026-04-01', created: CREATED.a, pool: 'gst', taxMode: 'gst', gstRateBp: 1_800 },
        { id: 'r1', date: '2026-04-02', created: CREATED.b, pool: 'gst', taxMode: 'rcm', gstRateBp: 1_800 },
      ],
      lines: [
        { billId: 'g1', amountPaise: 10_000_000 },
        { billId: 'r1', amountPaise: 10_000_000 },
      ],
      payments: [],
    })
    const result = computeSupplierSettlement(input)
    expect(result.pools.gst.bills.find((row) => row.billId === 'g1')!.duePaise).toBe(11_800_000)
    expect(result.pools.gst.bills.find((row) => row.billId === 'r1')!.duePaise).toBe(10_000_000)
  })
})

/** Spec test 8: on-behalf, settle-off, signed adjustments */
describe('settlement: paid_on_behalf and settle_off', () => {
  it('paid_on_behalf reduces outstanding; settle_off closes a ₹15 leftover', () => {
    const input = baseInput({
      bills: [{ id: 'b1', date: '2026-04-01', created: CREATED.a, pool: 'kacha', taxMode: 'none', gstRateBp: 0 }],
      lines: [{ billId: 'b1', amountPaise: 5_001_500 }], // ₹50,015 not whole — covered by settle off
      adjustments: [{ billId: 'b1', type: 'transport', amountPaise: -1_500 }], // signed ₹-15
      payments: [
        { id: 'ob', date: '2026-04-02', created: CREATED.b, pool: 'kacha', kind: 'paid_on_behalf', amountPaise: 2_000_000 },
        { id: 'so', date: '2026-04-03', created: CREATED.c, pool: 'kacha', kind: 'settle_off', amountPaise: 1_500 },
      ],
    })
    const result = computeSupplierSettlement(input)
    const b1 = result.pools.kacha.bills.find((row) => row.billId === 'b1')!
    // bill: 5_001_500 - signed transport 1_500 = ₹50,000 -> 5_000_000 net
    expect(b1.netPaise).toBe(5_000_000)
    expect(result.pools.kacha.payments.find((row) => row.paymentId === 'ob')!.appliedPaise).toBe(2_000_000)
    expect(result.pools.kacha.payments.find((row) => row.paymentId === 'so')!.appliedPaise).toBe(1_500)
    // 5_000_000 - 2_000_000 (on behalf) - 1_500 (settle off) = ₹29,985 still due
    expect(b1.duePaise).toBe(2_998_500)
    expect(b1.status).toBe('partial')
    expect(result.pools.kacha.outstandingPaise).toBe(2_998_500)
  })

  it('a settle_off closes the exact remaining 1,500 paise to nil', () => {
    const input = baseInput({
      bills: [{ id: 'b1', date: '2026-04-01', created: CREATED.a, pool: 'kacha', taxMode: 'none', gstRateBp: 0 }],
      lines: [{ billId: 'b1', amountPaise: 2_000_000 }], // ₹20,000
      payments: [
        { id: 'p1', date: '2026-04-02', created: CREATED.b, pool: 'kacha', kind: 'payment', amountPaise: 1_998_500 }, // ₹19,985
        { id: 'so', date: '2026-04-03', created: CREATED.c, pool: 'kacha', kind: 'settle_off', amountPaise: 1_500 }, // ₹15
      ],
    })
    const result = computeSupplierSettlement(input)
    const b1 = result.pools.kacha.bills.find((row) => row.billId === 'b1')!
    expect(b1.status).toBe('nil')
    expect(b1.duePaise).toBe(0)
    expect(result.pools.kacha.outstandingPaise).toBe(0)
  })
})

/** Spec test 9: cancelled records have no math effect but stay visible */
describe('settlement: cancellations', () => {
  it('cancelled bills and payments are displayed but change nothing', () => {
    const input = baseInput({
      bills: [
        { id: 'live', date: '2026-04-01', created: CREATED.a, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
        { id: 'dead', date: '2026-04-02', created: CREATED.b, pool: 'kacha', taxMode: 'none', gstRateBp: 0, cancelled: true },
      ],
      lines: [
        { billId: 'live', amountPaise: 10_000_000 },
        { billId: 'dead', amountPaise: 99_000_000 },
      ],
      payments: [
        { id: 'live', date: '2026-04-03', created: CREATED.c, pool: 'kacha', kind: 'payment', amountPaise: 4_000_000 },
        { id: 'dead', date: '2026-04-04', created: CREATED.d, pool: 'kacha', kind: 'payment', amountPaise: 5_000_000, cancelled: true },
      ],
    })
    const result = computeSupplierSettlement(input)
    const live = result.pools.kacha.bills.find((row) => row.billId === 'live')!
    const dead = result.pools.kacha.bills.find((row) => row.billId === 'dead')!
    expect(live.status).toBe('partial')
    expect(dead.status).toBe('cancelled')
    expect(dead.netPaise).toBe(0)
    expect(dead.paidPaise).toBe(0)
    expect(result.pools.kacha.outstandingPaise).toBe(6_000_000)
    const cancelledPayment = result.pools.kacha.payments.find((row) => row.paymentId === 'dead')!
    expect(cancelledPayment.cancelled).toBe(true)
    expect(cancelledPayment.appliedPaise).toBe(0)
  })
})

/** Spec test 10: backdated payments re-ripple deterministically */
describe('settlement: deterministic re-ripple', () => {
  it('input order does not matter; business order is date, created, id', () => {
    const bills = [
      { id: 'b1', date: '2026-04-03', created: CREATED.a, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
      { id: 'b2', date: '2026-04-05', created: CREATED.b, pool: 'kacha', taxMode: 'none', gstRateBp: 0 },
    ] as const
    const lines = [
      { billId: 'b1', amountPaise: 10_000_000 },
      { billId: 'b2', amountPaise: 10_000_000 },
    ] as const
    const paymentsA = [
      { id: 'zzz_late', date: '2026-04-02', created: '2026-04-02T10:00:00.000Z', pool: 'kacha', kind: 'payment', amountPaise: 6_000_000 },
      { id: 'aaa_early', date: '2026-04-04', created: '2026-04-04T09:00:00.000Z', pool: 'kacha', kind: 'payment', amountPaise: 6_000_000 },
    ] as const
    const forward = computeSupplierSettlement(baseInput({ bills: [...bills], lines: [...lines], payments: [...paymentsA] }))
    const reversed = computeSupplierSettlement({
      ...baseInput({ bills: [...bills], lines: [...lines] }),
      payments: [...paymentsA].reverse(),
    })
    expect(forward.combined).toEqual(reversed.combined)
    expect(forward.pools.kacha.bills).toEqual(reversed.pools.kacha.bills)
    expect(forward.pools.kacha.payments).toEqual(reversed.pools.kacha.payments)
    // the Apr-2 payment hits b1 first even though the Apr-4 one sorts later alphabetically
    const statuses = forward.pools.kacha.bills.map((row) => row.status)
    expect(statuses).toEqual(['nil', 'partial'])
  })
})

/** un-pinned extra payment becomes pool advance */
describe('settlement: advance stays in its pool', () => {
  it('a payment bigger than all dues becomes the pool advance', () => {
    const input = baseInput({
      bills: [{ id: 'g1', date: '2026-04-01', created: CREATED.a, pool: 'gst', taxMode: 'none', gstRateBp: 0 }],
      lines: [{ billId: 'g1', amountPaise: 20_000_000 }],
      payments: [
        { id: 'p1', date: '2026-04-02', created: CREATED.b, pool: 'gst', kind: 'payment', amountPaise: 25_000_000 },
        { id: 'pk', date: '2026-04-02', created: CREATED.b, pool: 'kacha', kind: 'payment', amountPaise: 50_000_000 },
      ],
    })
    const result = computeSupplierSettlement(input)
    expect(result.pools.gst.advancePaise).toBe(5_000_000)
    expect(result.pools.kacha.advancePaise).toBe(50_000_000) // never leaked into gst
    expect(result.combined.advancePaise).toBe(55_000_000)
  })
})
