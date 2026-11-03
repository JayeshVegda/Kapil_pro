import { describe, expect, it } from 'vitest'
import {
  newGroupId,
  planMerge,
  planSplit,
  type MergeContextInput,
  type MergeBillInput,
} from './supplier-merge-split'

const created = '2026-01-01 10:00:00.000Z'

function bill(id: string, partial: Partial<MergeBillInput> = {}): MergeBillInput {
  return {
    id,
    supplierId: 'sup1',
    date: '2026-04-01',
    created,
    pool: 'kacha',
    taxMode: 'none',
    gstRateBp: 0,
    ...partial,
  }
}

function context(partial: Partial<MergeContextInput> = {}): MergeContextInput {
  return {
    bills: [bill('b1'), bill('b2'), bill('b3', { date: '2026-04-05' })],
    lines: [
      { billId: 'b1', lineId: 'l1', amountPaise: 10_00_000 },
      { billId: 'b2', lineId: 'l2', amountPaise: 20_00_000 },
      { billId: 'b3', lineId: 'l3', amountPaise: 5_00_000 },
    ],
    ...partial,
  }
}

describe('planMerge', () => {
  it('happy path: chronological lines, shared group id, sources queued for cancel', () => {
    const plan = planMerge(context(), ['b2', 'b1'])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.group_id).toMatch(/^[a-z0-9]{15}$/)
    expect(plan.merged.fromBillIds).toEqual(['b1', 'b2']) // date/created order
    expect(plan.merged.lines.map((l) => l.lineId)).toEqual(['l1', 'l2'])
    expect(plan.merged.netPaise).toBe(30_00_000)
    expect(plan.merged.group_id).toBe(plan.group_id)
    expect(plan.cancelledSourceIds).toEqual(['b1', 'b2'])
  })

  it('refuses one source, cancelled source, mismatches, and pinned bills', () => {
    expect(planMerge(context(), ['b1'])).toEqual({ ok: false, refusals: [`need_two_or_more`] })
    const cancelled = context({ bills: [bill('b1'), bill('b2', { cancelled: true })] })
    expect(planMerge(cancelled, ['b1', 'b2'])).toMatchObject({ ok: false, refusals: [`cancelled_source`] })
    const poolMix = context({ bills: [bill('b1'), bill('b2', { pool: 'gst' })] })
    expect(planMerge(poolMix, ['b1', 'b2'])).toMatchObject({ refusals: [`pool_mismatch`] })
    const taxMix = context({ bills: [bill('b1'), bill('b2', { taxMode: 'gst', gstRateBp: 1_800 })] })
    expect(planMerge(taxMix, ['b1', 'b2'])).toMatchObject({ refusals: [`tax_mode_mismatch`] })
    const supMix = context({ bills: [bill('b1'), bill('b2', { supplierId: 'other' })] })
    expect(planMerge(supMix, ['b1', 'b2'])).toMatchObject({ refusals: [`supplier_mismatch`] })
    const pinned = context({ allocations: [{ paymentId: 'pl', billId: 'b2', amountPaise: 10_00_000 }] })
    expect(planMerge(pinned, ['b1', 'b2'])).toMatchObject({ refusals: [`allocation_referenced`] })
  })

  it('carries bardan deduct credits over: net = lines - credits', () => {
    const plan = planMerge(
      context({
        bardan: [
          { billId: 'b1', method: 'deduct', creditPaise: 2_00_000 },
          { billId: 'b3', method: 'in_kind', creditPaise: 0, note: 'x' },
        ],
      }),
      ['b1', 'b2'],
    )
    if (!plan.ok) throw new Error('unreachable')
    expect(plan.merged.netPaise).toBe(28_00_000)
    expect(plan.merged.bardan).toHaveLength(1)
    expect(plan.merged.bardan[0].billId).toBe('b1')
  })
})

describe('planSplit', () => {
  it('splits distinct line subsets under one shared group id', () => {
    const plan = planSplit(
      {
        bill: bill('b1'),
        lines: [
          { billId: 'b1', lineId: 'l1', amountPaise: 10_00_000 },
          { billId: 'b1', lineId: 'l2', amountPaise: 20_00_000 },
        ],
      },
      [['l1'], ['l2']],
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.group_id).toMatch(/^[a-z0-9]{15}$/)
    expect(plan.targets.map((t) => t.netPaise)).toEqual([10_00_000, 20_00_000])
    expect(plan.targets[0].group_id).toBe(plan.group_id)
    expect(plan.targets[0].adjustments).toEqual([])
    expect(plan.targets[0].bardan).toEqual([])
  })

  it('refuses cancelled source, one target, reused or unknown lines', () => {
    const lines = [{ billId: 'b1', lineId: 'l1', amountPaise: 10_00_000 }]
    expect(planSplit({ bill: bill('b1', { cancelled: true }), lines }, [['l1'], ['l1']])).toMatchObject({
      ok: false,
      refusals: [`cancelled_source`, `line_reused`],
    })
    expect(planSplit({ bill: bill('b1'), lines }, [['l1'], ['l1']])).toMatchObject({ refusals: [`line_reused`] })
    expect(planSplit({ bill: bill('b1'), lines }, [['l1'], ['zz']])).toMatchObject({ refusals: [`line_unknown`] })
  })

  it('newGroupId generates unique 15-char ids', () => {
    const a = newGroupId()
    const b = newGroupId()
    expect(a).toMatch(/^[a-z0-9]{15}$/)
    expect(a).not.toBe(b)
  })
})
