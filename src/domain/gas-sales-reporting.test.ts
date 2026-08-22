import { describe, expect, it } from 'vitest'
import { buildGasSalesReport } from '@/domain/gas-sales-reporting'

describe('buildGasSalesReport', () => {
  it('weights selling and bill-market rates by gas kilograms', () => {
    const report = buildGasSalesReport({
      bills: [
        { id: 'bill-a', date: '2026-07-02', customerId: 'customer-a', customerName: 'A Traders', marketRate: 500 },
        { id: 'bill-b', date: '2026-07-03', customerId: 'customer-b', customerName: 'B Traders', marketRate: 520 },
      ],
      lines: [
        { billId: 'bill-a', itemId: 'spindle', itemName: 'Spindle', itemType: 'gas', qty: 100, bags: 2, amount: 60_000 },
        { billId: 'bill-b', itemId: 'spindle', itemName: 'Spindle', itemType: 'gas', qty: 300, bags: 6, amount: 198_000 },
      ],
    })

    expect(report.overall).toMatchObject({
      sales: 258_000,
      kg: 400,
      bags: 8,
      weightedSellingRate: 645,
      weightedMarketRate: 515,
      premiumPerKg: 130,
    })
    expect(report.overall.premiumPct).toBeCloseTo(25.2427, 4)
  })

  it('groups gas performance by month, day, item, and customer', () => {
    const report = buildGasSalesReport({
      bills: [
        { id: 'bill-a', date: '2026-06-30', customerId: 'customer-a', customerName: 'A Traders', marketRate: 500 },
        { id: 'bill-b', date: '2026-07-03', customerId: 'customer-a', customerName: 'A Traders', marketRate: 520 },
        { id: 'bill-c', date: '2026-07-03', customerId: 'customer-b', customerName: 'B Traders', marketRate: 510 },
      ],
      lines: [
        { billId: 'bill-a', itemId: 'spindle', itemName: 'Spindle', itemType: 'gas', qty: 100, bags: 2, amount: 60_000 },
        { billId: 'bill-b', itemId: 'spindle', itemName: 'Spindle', itemType: 'gas', qty: 200, bags: 4, amount: 128_000 },
        { billId: 'bill-c', itemId: 'plug', itemName: 'Tapper Plug', itemType: 'gas', qty: 100, bags: 2, amount: 65_000 },
      ],
    })

    expect(report.byMonth.map((row) => [row.key, row.kg, row.weightedSellingRate])).toEqual([
      ['2026-06', 100, 600],
      ['2026-07', 300, 643.3333333333334],
    ])
    expect(report.byDay[1]).toMatchObject({ key: '2026-07-03', sales: 193_000, kg: 300, billCount: 2 })
    expect(report.byItem.map((row) => [row.key, row.kg])).toEqual([
      ['spindle', 300],
      ['plug', 100],
    ])
    expect(report.byCustomer[0]).toMatchObject({
      key: 'customer-a',
      label: 'A Traders',
      sales: 188_000,
      kg: 300,
      billCount: 2,
    })
  })

  it('excludes electronic lines and keeps selling metrics when market rates are missing', () => {
    const report = buildGasSalesReport({
      bills: [
        { id: 'bill-a', date: '2026-07-02', customerId: 'customer-a', customerName: 'A Traders', marketRate: 0 },
      ],
      lines: [
        { billId: 'bill-a', itemId: 'gas', itemName: 'Spindle', itemType: 'gas', qty: 100, bags: 2, amount: 60_000 },
        { billId: 'bill-a', itemId: 'switch', itemName: 'Switch', itemType: 'electronic', qty: 10, bags: 0, amount: 20_000 },
        { billId: 'bill-a', itemId: 'bad', itemName: 'Bad quantity', itemType: 'gas', qty: 0, bags: 0, amount: 1_000 },
      ],
    })

    expect(report.overall).toMatchObject({
      sales: 61_000,
      kg: 100,
      weightedSellingRate: 610,
      weightedMarketRate: null,
      premiumPerKg: null,
      premiumPct: null,
    })
  })
})
