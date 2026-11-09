import { describe, expect, it } from 'vitest'
import {
  aggregatePurchasedItems,
  buildItemRateVsMarketTimeline,
} from './purchase-dashboard-calculations'
import {
  computeBardanPendingSummary,
  type VilaityEntry,
} from './supplier-market-premium'
import { computeSupplierPositions } from './supplier-settlement'

describe('Purchase Dashboard Domain Calculations (Step 4 Contracts)', () => {
  describe('We Owe per pool never nets advance', () => {
    it('isolates Kacha and GST payables from supplier advance held', () => {
      const summaries = [
        {
          supplier: { id: 's1', companyName: 'Supplier 1' },
          kachaDuePaise: 500_000,
          gstDuePaise: 200_000,
          advancePaise: 0,
          outstandingPaise: 700_000,
          lastActivityDate: '2026-10-01',
          bardanPendingCount: 0,
          oldestDueDays: 15,
        },
        {
          supplier: { id: 's2', companyName: 'Supplier 2' },
          kachaDuePaise: 0,
          gstDuePaise: 0,
          advancePaise: 300_000,
          outstandingPaise: -300_000,
          lastActivityDate: '2026-10-05',
          bardanPendingCount: 0,
          oldestDueDays: null,
        },
      ]

      const positions = computeSupplierPositions(summaries)
      // Payables must NEVER be reduced by the 300_000 advance!
      expect(positions.kachaPayablePaise).toBe(500_000)
      expect(positions.gstPayablePaise).toBe(200_000)
      expect(positions.totalPayablePaise).toBe(700_000)
      expect(positions.totalAdvancePaise).toBe(300_000)
    })
  })

  describe('Bardan pending age and amber threshold (>10d)', () => {
    it('flags bardan pending over 10 days old as amber/warning', () => {
      const today = '2026-11-09'
      const bills = [
        {
          id: 'b1',
          inNo: 'IN-01',
          supplierName: 'Sup 1',
          date: '2026-11-05', // 4 days old
          bardanPending: true,
        },
        {
          id: 'b2',
          inNo: 'IN-02',
          supplierName: 'Sup 2',
          date: '2026-10-25', // 15 days old (>10d threshold!)
          bardanPending: true,
        },
        {
          id: 'b3',
          inNo: 'IN-03',
          supplierName: 'Sup 3',
          date: '2026-10-20',
          bardanPending: false, // not pending
        },
      ]

      const summary = computeBardanPendingSummary(bills, today)
      expect(summary.count).toBe(2)
      expect(summary.oldestDays).toBe(15)
      expect(summary.bills[0].id).toBe('b2')
      expect(summary.bills[0].daysOld).toBe(15)
      expect(summary.bills[1].id).toBe('b1')
      expect(summary.bills[1].daysOld).toBe(4)
    })
  })

  describe('Rate vs Market timeline with exact-day and fallback rates', () => {
    const vilaityHistory: VilaityEntry[] = [
      { date: '2026-10-01', vilaityMilli: 480_000 }, // ₹480/kg
      { date: '2026-10-15', vilaityMilli: 490_000 }, // ₹490/kg
    ]

    const bills = [
      {
        date: '2026-10-01', // exact day match -> ₹480
        lines: [
          { itemName: 'Honey Brass', weightG: 100_000, rateMilli: 485_000, amountPaise: 48_500_00 },
        ],
      },
      {
        date: '2026-10-05', // fallback to earlier day (2026-10-01) -> ₹480
        lines: [
          { itemName: 'Honey Brass', weightG: 200_000, rateMilli: 488_000, amountPaise: 97_600_00 },
        ],
      },
      {
        date: '2026-10-15', // exact day match -> ₹490
        lines: [
          { itemName: 'Honey Brass', weightG: 150_000, rateMilli: 492_000, amountPaise: 73_800_00 },
        ],
      },
    ]

    it('computes our average rate and premium vs vilaity', () => {
      const timeline = buildItemRateVsMarketTimeline(bills, 'Honey Brass', vilaityHistory)
      expect(timeline).toHaveLength(3)

      expect(timeline[0]).toEqual({
        date: '2026-10-01',
        ourRate: 485,
        marketRate: 480,
        premiumRupees: 5,
      })

      expect(timeline[1]).toEqual({
        date: '2026-10-05',
        ourRate: 488,
        marketRate: 480, // fallback
        premiumRupees: 8,
      })

      expect(timeline[2]).toEqual({
        date: '2026-10-15',
        ourRate: 492,
        marketRate: 490,
        premiumRupees: 2,
      })
    })
  })

  describe('What We Buy item aggregation', () => {
    it('aggregates total kg and average rate across purchase bills', () => {
      const bills = [
        {
          lines: [
            { itemName: 'Honey Brass', weightG: 200_000, amountPaise: 96_000_00 },
            { itemName: 'Utensil Scrap', weightG: 100_000, amountPaise: 45_000_00 },
          ],
        },
        {
          lines: [
            { itemName: 'Honey Brass', weightG: 300_000, amountPaise: 147_000_00 },
          ],
        },
      ]

      const items = aggregatePurchasedItems(bills)
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({
        itemName: 'Honey Brass',
        kg: 500,
        amountPaise: 243_000_00,
        avgRateRupees: 486,
      })
      expect(items[1]).toEqual({
        itemName: 'Utensil Scrap',
        kg: 100,
        amountPaise: 45_000_00,
        avgRateRupees: 450,
      })
    })
  })
})
