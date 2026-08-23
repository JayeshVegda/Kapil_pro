import { describe, expect, it } from 'vitest'
import { buildMonthlyItemComparisons, emptyMonthlyItemComparisons } from './monthly-item-rollup'

type BillRow = Record<string, unknown> & { id: string }
type ItemRow = Record<string, unknown>

function bill(id: string, date: string, customer: string): BillRow {
  return { id, date, customer }
}

function line(bill: string, item_name: string, qty: number, bags: number): ItemRow {
  return { bill, item: `it-${item_name}`, item_name, qty, bags }
}

describe('buildMonthlyItemComparisons', () => {
  it('returns a fully-populated comparison object even with no data', () => {
    const result = buildMonthlyItemComparisons({
      currentBills: [],
      currentItems: [],
      previousBills: [],
      previousItems: [],
      currentMonthKey: '2026-08',
      previousMonthKey: '2026-07',
    })
    expect(Object.keys(result).sort()).toEqual(['spindle', 'spindle75', 'spindle85', 'tapperPlug'])
    for (const metric of Object.values(result)) {
      expect(metric.bags).toBe(0)
      expect(metric.kg).toBe(0)
      expect(metric.partyCount).toBe(0)
    }
  })

  it('emptyMonthlyItemComparisons exposes every key UI fallbacks rely on', () => {
    const empty = emptyMonthlyItemComparisons()
    expect(empty.spindle75.bags).toBe(0)
    expect(empty.spindle85.kg).toBe(0)
    expect(empty.tapperPlug.previousBags).toBe(0)
    expect(empty.spindle.partyCount).toBe(0)
  })

  it('splits Spindle 7.5GM and 8.5GM variants while also totalling the family', () => {
    const result = buildMonthlyItemComparisons({
      currentBills: [bill('b1', '2026-08-03', 'cus1'), bill('b2', '2026-08-09', 'cus2')],
      currentItems: [
        line('b1', 'Spindle (7.5GM)', 500, 10),
        line('b2', 'Spindle (8.5GM)', 200, 4),
        line('b2', 'Tapper Plug', 120, 6),
      ],
      previousBills: [bill('p1', '2026-07-11', 'cus1')],
      previousItems: [line('p1', 'Spindle (7.5GM)', 400, 8)],
      currentMonthKey: '2026-08',
      previousMonthKey: '2026-07',
    })

    expect(result.spindle75.bags).toBe(10)
    expect(result.spindle85.bags).toBe(4)
    expect(result.spindle.bags).toBe(14)
    expect(result.spindle.previousBags).toBe(8)
    expect(result.tapperPlug.bags).toBe(6)
    expect(result.spindle.partyCount).toBe(2)
    expect(result.spindle75.partyCount).toBe(1)
    // Family totals never double-count a party that bought two variants.
    expect(result.spindle75.partyCount + result.spindle85.partyCount).toBeGreaterThanOrEqual(2)
  })
})
