import { describe, expect, it } from 'vitest'
import { computeAgeingBuckets } from './records'
import { computeSupplierPositions } from './supplier-settlement'
import {
  buildPeriodRange,
  deltaPct,
  getFiscalYearStart,
  previousPeriod,
} from './period-helpers'
import {
  buildAttentionItems,
  BARDAN_PENDING_OVERDUE_DAYS,
  BRASS_RATE_STALE_DAYS,
  CUSTOMER_UNPAID_OVERDUE_DAYS,
  SUPPLIER_DUE_OVERDUE_DAYS,
} from './attention-rules'
import { formatCompactInr, formatCompactKg } from '@/lib/inr-format'

describe('Dashboard Foundation Domain Logic', () => {
  describe('Ageing helper boundaries (0-30, 31-60, 60+)', () => {
    it('places dueDays=30 in bucket 0-30 and dueDays=31 in bucket 31-60', () => {
      const rows = [
        { amount: 1000, dueDays: 30 },
        { amount: 2000, dueDays: 31 },
      ]
      const result = computeAgeingBuckets(rows)
      expect(result.bucket0to30).toBe(1000)
      expect(result.count0to30).toBe(1)
      expect(result.bucket31to60).toBe(2000)
      expect(result.count31to60).toBe(1)
      expect(result.bucket60plus).toBe(0)
    })

    it('places dueDays=60 in bucket 31-60 and dueDays=61 in bucket 60+', () => {
      const rows = [
        { amount: 3000, dueDays: 60 },
        { amount: 4000, dueDays: 61 },
      ]
      const result = computeAgeingBuckets(rows)
      expect(result.bucket0to30).toBe(0)
      expect(result.bucket31to60).toBe(3000)
      expect(result.count31to60).toBe(1)
      expect(result.bucket60plus).toBe(4000)
      expect(result.count60plus).toBe(1)
    })

    it('ignores non-positive amounts', () => {
      const rows = [
        { amount: 0, dueDays: 10 },
        { amount: -500, dueDays: 80 },
        { amount: 1500, dueDays: 5 },
      ]
      const result = computeAgeingBuckets(rows)
      expect(result.totalAmount).toBe(1500)
      expect(result.bucket0to30).toBe(1500)
      expect(result.count0to30).toBe(1)
    })
  })

  describe('Supplier positions (Pool isolation & Advance preservation)', () => {
    it('never cross-nets Kacha advance with GST payable', () => {
      // Supplier A: Kacha 50k advance, GST 80k payable
      // Supplier B: Kacha 20k payable, 0 advance
      const summaries = [
        { kachaDuePaise: 0, kachaAdvancePaise: 50_000, gstDuePaise: 80_000, advancePaise: 50_000 },
        { kachaDuePaise: 20_000, gstDuePaise: 0, advancePaise: 0 },
      ]
      const positions = computeSupplierPositions(summaries)

      expect(positions.kachaPayablePaise).toBe(20_000)
      expect(positions.kachaAdvancePaise).toBe(50_000)
      expect(positions.gstPayablePaise).toBe(80_000)
      expect(positions.gstAdvancePaise).toBe(0)

      // Total payable is 20k + 80k = 100k; advance of 50k is NEVER subtracted!
      expect(positions.totalPayablePaise).toBe(100_000)
      expect(positions.totalAdvancePaise).toBe(50_000)
      expect(positions.suppliersCountWithDue).toBe(2)
      expect(positions.suppliersCountWithAdvance).toBe(1)
    })

    it('handles zero and negative dues cleanly', () => {
      const summaries = [
        { kachaDuePaise: -10_000, gstDuePaise: 0, advancePaise: 10_000 },
        { kachaDuePaise: 0, gstDuePaise: 0, advancePaise: 0 },
      ]
      const positions = computeSupplierPositions(summaries)
      expect(positions.totalPayablePaise).toBe(0)
      expect(positions.totalAdvancePaise).toBe(10_000)
      expect(positions.suppliersCountWithDue).toBe(0)
    })
  })

  describe('Period helpers & Fair Comparison (Same-days rule)', () => {
    it('compares partial month day-for-day (day 9 vs day 9)', () => {
      const range = buildPeriodRange('month', '2026-11', '2026-11-09')
      expect(range.from).toBe('2026-11-01')
      expect(range.to).toBe('2026-11-09')
      expect(range.daysElapsed).toBe(9)
      expect(range.isPartial).toBe(true)

      const prev = previousPeriod(range)
      expect(prev.from).toBe('2026-10-01')
      expect(prev.to).toBe('2026-10-09')
      expect(prev.daysElapsed).toBe(9)
      expect(prev.comparisonNote).toBe('vs same 9 days of October')
    })

    it('clamps 31-day month to 30 days for previous month comparison', () => {
      // Browsing March 31 on non-leap year (e.g. 2026-03-31)
      const range = buildPeriodRange('month', '2026-03', '2026-03-31')
      expect(range.daysElapsed).toBe(31)

      const prev = previousPeriod(range)
      expect(prev.from).toBe('2026-02-01')
      expect(prev.to).toBe('2026-02-28') // Clamped to 28
      expect(prev.daysElapsed).toBe(28)
    })

    it('determines correct fiscal year start (April 1)', () => {
      expect(getFiscalYearStart('2026-11-09')).toBe('2026-04-01')
      expect(getFiscalYearStart('2027-01-15')).toBe('2026-04-01')
      expect(getFiscalYearStart('2026-04-01')).toBe('2026-04-01')
      expect(getFiscalYearStart('2026-03-31')).toBe('2025-04-01')
    })

    it('handles leap day (Feb 29) when comparing FY previous period', () => {
      const leapRange = {
        mode: 'fy' as const,
        from: '2028-04-01',
        to: '2028-02-29',
        asOfDate: '2028-02-29',
        daysElapsed: 335,
        totalDaysInPeriod: 365,
        isPartial: true,
        label: 'FY 2028–29',
      }
      const prev = previousPeriod(leapRange)
      expect(prev.to).toBe('2027-02-28') // Clamped from Feb 29 to Feb 28
      expect(prev.comparisonNote).toBe('vs same period last FY')
    })

    it('returns null for deltaPct when previous is 0, negative, or missing', () => {
      expect(deltaPct(500, 0)).toBeNull()
      expect(deltaPct(500, null)).toBeNull()
      expect(deltaPct(500, undefined)).toBeNull()
      expect(deltaPct(500, -100)).toBeNull()
      expect(deltaPct(120, 100)).toBe(20)
      expect(deltaPct(80, 100)).toBe(-20)
    })
  })

  describe('Attention thresholds & rules', () => {
    it('triggers overdue customers only strictly above 45 days', () => {
      const boundaryRows = [
        { id: '1', name: 'Safe', dueDays: CUSTOMER_UNPAID_OVERDUE_DAYS, dueAmount: 5000 },
        { id: '2', name: 'Overdue', dueDays: CUSTOMER_UNPAID_OVERDUE_DAYS + 1, dueAmount: 5000 },
      ]
      const summary = buildAttentionItems({
        customers: boundaryRows,
        asOfDate: '2026-11-09',
      })
      expect(summary.items.some((i) => i.id === 'customer_overdue')).toBe(true)
      const item = summary.items.find((i) => i.id === 'customer_overdue')!
      expect(item.count).toBe(1)
      expect(item.tone).toBe('rose')
    })

    it('triggers supplier due only strictly above 30 days', () => {
      const summary = buildAttentionItems({
        suppliers: [
          { id: '1', name: 'Safe', oldestDueDays: SUPPLIER_DUE_OVERDUE_DAYS, duePaise: 5000 },
          { id: '2', name: 'Due', oldestDueDays: SUPPLIER_DUE_OVERDUE_DAYS + 1, duePaise: 5000 },
        ],
        asOfDate: '2026-11-09',
      })
      const item = summary.items.find((i) => i.id === 'supplier_due')!
      expect(item.count).toBe(1)
      expect(item.tone).toBe('amber')
    })

    it('triggers bardan pending only strictly above 10 days', () => {
      const summary = buildAttentionItems({
        bardanPendingBills: [
          { id: 'b1', inNo: 'IN-1', supplierName: 'S1', daysOld: BARDAN_PENDING_OVERDUE_DAYS },
          { id: 'b2', inNo: 'IN-2', supplierName: 'S2', daysOld: BARDAN_PENDING_OVERDUE_DAYS + 2 },
        ],
        asOfDate: '2026-11-09',
      })
      const item = summary.items.find((i) => i.id === 'bardan_pending')!
      expect(item.count).toBe(1)
      expect(item.label).toContain('12d oldest')
    })

    it('triggers brass rate warning when older than 3 days', () => {
      const summary = buildAttentionItems({
        latestBrassRateDate: '2026-11-04',
        asOfDate: '2026-11-09', // 5 days difference > BRASS_RATE_STALE_DAYS (3)
      })
      expect(BRASS_RATE_STALE_DAYS).toBe(3)
      const item = summary.items.find((i) => i.id === 'brass_rate_stale')!
      expect(item.count).toBe(5)
      expect(item.tone).toBe('rose')
    })

    it('reports allClear=true when no items breach thresholds', () => {
      const summary = buildAttentionItems({
        customers: [{ id: '1', name: 'OK', dueDays: 10, dueAmount: 1000 }],
        suppliers: [{ id: '1', name: 'OK', oldestDueDays: 5, duePaise: 1000 }],
        bardanPendingBills: [{ id: '1', inNo: '1', supplierName: 'S', daysOld: 3 }],
        pendingDraftsCount: 0,
        latestBrassRateDate: '2026-11-08',
        asOfDate: '2026-11-09',
      })
      expect(summary.allClear).toBe(true)
      expect(summary.items).toHaveLength(0)
    })
  })

  describe('Compact formatters', () => {
    it('formats Indian currency compactly with exact units', () => {
      expect(formatCompactInr(18_000_000)).toBe('₹1.8Cr')
      expect(formatCompactInr(1_620_000)).toBe('₹16.2L')
      expect(formatCompactInr(45_000)).toBe('₹45k')
      expect(formatCompactInr(850)).toBe('₹850')
      expect(formatCompactInr(-1_620_000)).toBe('-₹16.2L')
      expect(formatCompactInr(0)).toBe('₹0')
    })

    it('formats weights compactly in kg and tonnes', () => {
      expect(formatCompactKg(350)).toBe('350 kg')
      expect(formatCompactKg(1_400)).toBe('1.4 t')
      expect(formatCompactKg(12_500)).toBe('12.5 t')
      expect(formatCompactKg(0)).toBe('0 kg')
    })
  })
})
