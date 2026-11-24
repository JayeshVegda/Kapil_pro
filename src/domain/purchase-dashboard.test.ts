import { describe, expect, it } from 'vitest'
import type { EnrichedPurchaseBill, EnrichedSupplierPayment, SupplierSummary } from '@/data/suppliers'
import { buildPurchaseReadModel } from './purchase-read-model'
import { buildPurchaseDashboard } from './purchase-dashboard'
import { bundleFixture, lineFixture, paymentFixture, supplierFixture } from '@/test/purchase-fixtures'

const today = '2026-11-08'
const baseModel = buildPurchaseReadModel([supplierFixture()], bundleFixture(), today)

function bill(overrides: Partial<EnrichedPurchaseBill> = {}): EnrichedPurchaseBill {
  return { ...baseModel.bills[0], ...overrides }
}

function payment(overrides: Partial<EnrichedSupplierPayment> = {}): EnrichedSupplierPayment {
  return { ...paymentFixture(), supplierName: 'Test Metals', appliedPaise: 0, advancePaise: 0, allocations: [], ...overrides }
}

function summary(overrides: Partial<SupplierSummary> = {}): SupplierSummary {
  return { ...baseModel.summaries[0], ...overrides }
}

const emptyInput = { bills: [], payments: [], summaries: [], today }

describe('purchase dashboard contracts', () => {
  it('uses positive supplier positions for payable tiles, separating advance', () => {
    const summaries = [
      summary({ kachaDuePaise: 110_000, gstDuePaise: 0, advancePaise: 60_000, outstandingPaise: 50_000 }),
      summary({ supplier: supplierFixture({ id: 'advance' }), kachaDuePaise: 0, advancePaise: 30_000, outstandingPaise: -30_000 }),
      summary({ supplier: supplierFixture({ id: 'inactive', active: false }), kachaDuePaise: 70_000, outstandingPaise: 70_000 }),
    ]
    const before = structuredClone(summaries)
    const result = buildPurchaseDashboard({ ...emptyInput, summaries })

    expect(result.snapshot).toMatchObject({ totalWeOwePaise: 180_000, totalAdvancePaise: 90_000, suppliersDueCount: 2 })
    expect(result.payNext.map((row) => row.supplier.id)).toEqual(['inactive', 'supplier1'])
    expect(summaries).toEqual(before)
  })

  it('preserves aging boundaries, clamps future dates, and excludes cancelled or settled dues', () => {
    const bills = [
      bill({ id: 'future', date: '2026-11-09', duePaise: 100 }),
      bill({ id: 'day30', date: '2026-10-09', duePaise: 200 }),
      bill({ id: 'day31', date: '2026-10-08', duePaise: 300, bardanPending: true }),
      bill({ id: 'day60', date: '2026-09-09', duePaise: 400 }),
      bill({ id: 'day61', date: '2026-09-08', duePaise: 500 }),
      bill({ id: 'nil', date: '2026-09-01', duePaise: 0, bardanPending: false }),
      bill({ id: 'cancelled', date: '2026-09-01', cancelled: true, duePaise: 99_999 }),
    ]
    const result = buildPurchaseDashboard({ ...emptyInput, bills })

    expect(result.snapshot.aging).toEqual({ bucket0to30: 300, bucket31to60: 700, bucket60plus: 500 })
    expect(result.snapshot).toMatchObject({ billCount: 6, bardanPendingBills: 1, totalProcuredKg: 600, totalProcuredPaise: 600_000 })
  })

  it('counts only outgoing credit kinds as paid while retaining non-cash months and cancelled recent operations', () => {
    const payments = [
      payment({ id: 'cash', date: today, kind: 'payment', amountPaise: 100_000 }),
      payment({ id: 'behalf', date: today, kind: 'paid_on_behalf', amountPaise: 20_000 }),
      payment({ id: 'refund', date: '2026-07-01', kind: 'refund_received', amountPaise: 50_000 }),
      payment({ id: 'settle', date: '2026-08-01', kind: 'settle_off', amountPaise: 3_000 }),
      payment({ id: 'bardan', date: today, kind: 'bardan_advance', amountPaise: 4_000 }),
      payment({ id: 'cancelled', date: '2026-12-01', cancelled: true, amountPaise: 999_000 }),
      payment({ id: 'unknown', date: '2026-05-01', kind: 'legacy-unknown', amountPaise: 888_000 }),
    ]
    const result = buildPurchaseDashboard({ ...emptyInput, payments })

    expect(result.snapshot.totalPaidPaise).toBe(120_000)
    expect(result.todayPaid).toEqual({ count: 2, paise: 120_000 })
    expect(result.cadenceRows.map((row) => [row.monthKey, row.paidRupees])).toEqual([['2026-11', 1_200], ['2026-08', 0]])
    expect(result.recentPayments[0].id).toBe('cancelled')
    expect(result.recentPayments).toHaveLength(5)
  })

  it('normalizes purchase grades and lets later traversal win an equal-date rate tie', () => {
    const firstLine = lineFixture({ itemName: '  BRASS   scrap ', weightG: 1_000, rateMilli: 10_000, amountPaise: 1_000 })
    const secondLine = lineFixture({ id: 'line2', itemName: 'Brass Scrap', weightG: 2_000, rateMilli: 30_000, amountPaise: 6_000 })
    const otherLines = ['Chol', 'Pata', 'Marobol', 'Sisu', 'Gun Metal'].map((name, index) =>
      lineFixture({ id: `grade${index}`, itemName: name, weightG: 1_000, rateMilli: 10_000, amountPaise: 1_000 }))
    const bills = [
      bill({ id: 'first', date: today, totalKg: 6, lines: [firstLine, ...otherLines] }),
      bill({ id: 'second', date: today, totalKg: 2, lines: [secondLine] }),
    ]
    const result = buildPurchaseDashboard({ ...emptyInput, bills })

    expect(result.gradeRows[0]).toMatchObject({
      name: 'Brass Scrap', totalKg: 3, totalSpendRupees: 70, thisMonthKg: 3, lastMonthKg: 0,
      latestRate: 30, latestBillDate: today, volumeShare: 37.5,
    })
    expect(result.gradeRows[0].avgRate).toBeCloseTo(70 / 3)

  })

  it('falls back to the latest non-current procurement month when current-month weight is zero', () => {
    const bills = [
      bill({ id: 'sep', date: '2026-09-01', totalKg: 10 }),
      bill({ id: 'oct', date: '2026-10-01', totalKg: 20 }),
      bill({ id: 'zero', date: today, totalKg: 0 }),
    ]
    const result = buildPurchaseDashboard({ ...emptyInput, bills })
    expect(result.snapshot).toMatchObject({ recentKg: 20, recentKgLabel: 'in Oct 2026' })
    expect(result.cadenceRows.map((row) => row.monthKey)).toEqual(['2026-11', '2026-10', '2026-09'])

    const current = buildPurchaseDashboard({ ...emptyInput, bills: [...bills, bill({ date: today, totalKg: 5 })] })
    expect(current.snapshot).toMatchObject({ recentKg: 5, recentKgLabel: 'this month' })
    expect(current.todayProcurement).toEqual({ bills: 2, kg: 5 })
  })

  it('returns a genuine empty dashboard without mutating the recent-operation inputs', () => {
    const empty = buildPurchaseDashboard(emptyInput)
    expect(empty.snapshot).toMatchObject({ totalWeOwePaise: 0, totalPaidPaise: 0, billCount: 0, recentKg: 0, recentKgLabel: '', avgProcuredRate: 0 })
    expect(empty.gradeRows).toEqual([])
    expect(empty.cadenceRows).toEqual([])
    expect(empty.todayProcurement).toEqual({ bills: 0, kg: 0 })
    expect(empty.todayPaid).toEqual({ count: 0, paise: 0 })

    const bills = [bill({ id: 'older' }), bill({ id: 'latest', date: today, cancelled: true })]
    const result = buildPurchaseDashboard({ ...emptyInput, bills })
    expect(result.recentBills.map((row) => row.id)).toEqual(['latest', 'older'])
    expect(bills.map((row) => row.id)).toEqual(['older', 'latest'])
  })
})
