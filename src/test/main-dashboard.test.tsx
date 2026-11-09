import { describe, expect, it } from 'vitest'
import {
  buildPeriodRange,
  previousPeriod,
} from '@/domain/period-helpers'
import {
  buildAttentionItems,
} from '@/domain/attention-rules'

describe('Main Dashboard (Step 2 Contracts)', () => {
  describe('Fair Comparison Note & Period Rules', () => {
    it('compares partial month with the exact same number of days of previous month', () => {
      // e.g. Day 9 of November vs Day 9 of October
      const range = buildPeriodRange('month', '2026-11', '2026-11-09')
      expect(range.daysElapsed).toBe(9)
      expect(range.isPartial).toBe(true)

      const prev = previousPeriod(range)
      expect(prev.from).toBe('2026-10-01')
      expect(prev.to).toBe('2026-10-09')
      expect(prev.daysElapsed).toBe(9)
      expect(prev.comparisonNote).toBe('vs same 9 days of October')
    })

    it('compares full Last Month with full month prior', () => {
      const range = buildPeriodRange('last_month', undefined, '2026-11-09')
      expect(range.from).toBe('2026-10-01')
      expect(range.to).toBe('2026-10-31')

      const prev = previousPeriod(range)
      expect(prev.from).toBe('2026-09-01')
      expect(prev.to).toBe('2026-09-30')
      expect(prev.comparisonNote).toBe('vs September 2026')
    })

    it('compares Last 30 Days with the previous 30 days window', () => {
      const range = buildPeriodRange('last_30_days', undefined, '2026-11-09')
      expect(range.daysElapsed).toBe(30)

      const prev = previousPeriod(range)
      expect(prev.daysElapsed).toBe(30)
      expect(prev.comparisonNote).toBe('vs previous 30 days')
    })

    it('compares FY to Date with the same period of previous FY', () => {
      const range = buildPeriodRange('fy', undefined, '2026-11-09')
      const prev = previousPeriod(range)
      expect(prev.from).toBe('2025-04-01')
      expect(prev.comparisonNote).toBe('vs same period last FY')
    })
  })

  describe('Needs Attention Rules & Fixtures', () => {
    const today = '2026-11-09'

    it('emits allClear when no items breach urgency thresholds', () => {
      const summary = buildAttentionItems({
        asOfDate: today,
        customers: [
          { id: 'c1', name: 'Prompt Buyer', dueDays: 15, dueAmount: 50_000 },
          { id: 'c2', name: 'Fresh Buyer', dueDays: 30, dueAmount: 120_000 },
        ],
        suppliers: [
          { id: 's1', name: 'Current Supplier', oldestDueDays: 10, duePaise: 400_000 },
        ],
        bardanPendingBills: [
          { id: 'b1', inNo: 'IN-01', supplierName: 'S1', daysOld: 5 },
        ],
        pendingDraftsCount: 0,
        latestBrassRateDate: '2026-11-08',
      })

      expect(summary.allClear).toBe(true)
      expect(summary.items).toHaveLength(0)
    })

    it('surfaces overdue customers (>45d), due suppliers (>30d), and bardan pending (>10d)', () => {
      const summary = buildAttentionItems({
        asOfDate: today,
        customers: [
          { id: 'c1', name: 'Old Debtor', dueDays: 46, dueAmount: 150_000 },
          { id: 'c2', name: 'Recent Debtor', dueDays: 20, dueAmount: 80_000 },
        ],
        suppliers: [
          { id: 's1', name: 'Patient Supplier', oldestDueDays: 31, duePaise: 250_000 },
          { id: 's2', name: 'Fresh Supplier', oldestDueDays: 12, duePaise: 100_000 },
        ],
        bardanPendingBills: [
          { id: 'b1', inNo: 'IN-05', supplierName: 'S1', daysOld: 18 },
          { id: 'b2', inNo: 'IN-06', supplierName: 'S2', daysOld: 12 },
        ],
        pendingDraftsCount: 2,
        oldestDraftDays: 4,
        latestBrassRateDate: '2026-11-04', // 5 days old (>3d stale)
      })

      expect(summary.allClear).toBe(false)
      expect(summary.items.map((i) => i.id)).toEqual([
        'customer_overdue',
        'supplier_due',
        'bardan_pending',
        'drafts_waiting',
        'brass_rate_stale',
      ])

      const custItem = summary.items.find((i) => i.id === 'customer_overdue')
      expect(custItem?.count).toBe(1)
      expect(custItem?.tone).toBe('rose')

      const suppItem = summary.items.find((i) => i.id === 'supplier_due')
      expect(suppItem?.count).toBe(1)
      expect(suppItem?.tone).toBe('amber')

      const bardanItem = summary.items.find((i) => i.id === 'bardan_pending')
      expect(bardanItem?.count).toBe(2)
      expect(bardanItem?.label).toContain('18d oldest')

      const draftItem = summary.items.find((i) => i.id === 'drafts_waiting')
      expect(draftItem?.count).toBe(2)
      expect(draftItem?.tone).toBe('rose') // >3d is rose

      const rateItem = summary.items.find((i) => i.id === 'brass_rate_stale')
      expect(rateItem?.tone).toBe('rose')
      expect(rateItem?.count).toBe(5)
    })
  })

  describe('Module Visibility & Grid Reflow', () => {
    it('determines grid column layout correctly based on module flags', () => {
      const getGridCols = (purchase: boolean, casting: boolean) =>
        purchase && casting ? 'lg:grid-cols-3' : purchase || casting ? 'lg:grid-cols-2' : 'max-w-xl'

      expect(getGridCols(true, true)).toBe('lg:grid-cols-3')
      expect(getGridCols(true, false)).toBe('lg:grid-cols-2')
      expect(getGridCols(false, true)).toBe('lg:grid-cols-2')
      expect(getGridCols(false, false)).toBe('max-w-xl')
    })
  })
})
