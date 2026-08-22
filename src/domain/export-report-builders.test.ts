import { describe, expect, it } from 'vitest'
import {
  buildMonthlyExportReport,
  buildOutstandingReport,
  buildRateAnalysisReport,
  buildSalesExportReport,
  deriveReportDefaults,
} from '@/domain/export-report-builders'

const customers = [
  { id: 'customer-a', name: 'A Traders', active: true },
  { id: 'customer-b', name: 'B Traders', active: true },
]

const items = [
  { id: 'spindle', name: 'Spindle', type: 'gas', unit: 'kg' },
  { id: 'switch', name: 'Switch', type: 'electronic', unit: 'piece' },
]

const bills = [
  { id: 'june', date: '2026-06-20', customerId: 'customer-a', customerName: 'A Traders', bookNo: 1, billNo: 1, marketRate: 500, transport: 100, gstRate: 0, gstAmount: 0, lrNo: '' },
  { id: 'july-a', date: '2026-07-10', customerId: 'customer-a', customerName: 'A Traders', bookNo: 1, billNo: 2, marketRate: 520, transport: 200, gstRate: 0, gstAmount: 0, lrNo: 'LR-1' },
  { id: 'july-b', date: '2026-07-12', customerId: 'customer-b', customerName: 'B Traders', bookNo: 1, billNo: 3, marketRate: 510, transport: 0, gstRate: 0, gstAmount: 0, lrNo: '' },
]

const lines = [
  { id: 'l1', billId: 'june', itemId: 'spindle', itemName: 'Spindle', qty: 100, bags: 2, rate: 600, amount: 60_000 },
  { id: 'l2', billId: 'july-a', itemId: 'spindle', itemName: 'Spindle', qty: 200, bags: 4, rate: 640, amount: 128_000 },
  { id: 'l3', billId: 'july-b', itemId: 'spindle', itemName: 'Spindle', qty: 100, bags: 2, rate: 650, amount: 65_000 },
  { id: 'l4', billId: 'july-b', itemId: 'switch', itemName: 'Switch', qty: 3, bags: 0, rate: 2_000, amount: 6_000 },
]

describe('buildMonthlyExportReport', () => {
  it('builds a July selling report with a previous-month comparison', () => {
    const report = buildMonthlyExportReport({ month: '2026-07', bills, lines, customers, items, payments: [{ id: 'p1', date: '2026-07-15', customerId: 'customer-a', amount: 50_000 }] })

    expect(report.summary).toMatchObject({
      invoiceSales: 199_200,
      gasSales: 193_000,
      gasKg: 300,
      gasBags: 6,
      weightedSellingRate: 643.3333333333334,
      weightedMarketRate: 516.6666666666666,
      premiumPerKg: 126.66666666666674,
      collections: 50_000,
      billCount: 2,
      activeCustomerCount: 2,
    })
    expect(report.previous.summary.gasKg).toBe(100)
    expect(report.itemRows[0]).toMatchObject({ itemName: 'Spindle', kg: 300, sales: 193_000 })
    expect(report.customerRows.map((row) => row.customerName)).toEqual(['A Traders', 'B Traders'])
    expect(report.dailyRows).toHaveLength(3)
  })
})

describe('buildSalesExportReport', () => {
  it('filters gas sales and groups them by customer while retaining detail rows', () => {
    const report = buildSalesExportReport({
      from: '2026-07-01',
      to: '2026-07-31',
      customerId: '',
      itemId: '',
      itemType: 'gas',
      groupBy: 'customer',
      bills,
      lines,
      customers,
      items,
    })

    expect(report.summary).toMatchObject({ invoiceCount: 2, invoiceTotal: 199_200, itemSales: 193_000, quantity: 300, bags: 6, weightedSellingRate: 643.3333333333334 })
    expect(report.detailRows).toHaveLength(2)
    expect(report.groupRows).toEqual([
      expect.objectContaining({ key: 'customer-a', label: 'A Traders', invoiceCount: 1, itemSales: 128_000 }),
      expect.objectContaining({ key: 'customer-b', label: 'B Traders', invoiceCount: 1, itemSales: 65_000 }),
    ])
  })
})

describe('deriveReportDefaults', () => {
  it('selects the party and month from the most recent bill', () => {
    expect(deriveReportDefaults(bills)).toEqual({ customerId: 'customer-b', month: '2026-07' })
    expect(deriveReportDefaults([])).toEqual({ customerId: '', month: '' })
  })
})

describe('buildRateAnalysisReport', () => {
  it('uses quantity-weighted rates and exposes the rate range', () => {
    const report = buildRateAnalysisReport({ from: '2026-07-01', to: '2026-07-31', customerId: '', itemId: '', bills, lines, items })

    expect(report.summary).toMatchObject({ gasKg: 300, gasBags: 6, gasSales: 193_000, weightedSellingRate: 643.3333333333334, weightedMarketRate: 516.6666666666666 })
    expect(report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ customerName: 'A Traders', itemName: 'Spindle', minSellingRate: 640, maxSellingRate: 640 }),
      expect.objectContaining({ customerName: 'B Traders', itemName: 'Spindle', minSellingRate: 650, maxSellingRate: 650 }),
    ]))
  })
})

describe('buildOutstandingReport', () => {
  it('combines opening balances, bills, and payments as of a date', () => {
    const report = buildOutstandingReport({
      asOf: '2026-07-31',
      customerId: '',
      status: 'all',
      customers: [
        { ...customers[0], openingBalance: 1_000 },
        { ...customers[1], openingBalance: 0 },
      ],
      bills,
      lines,
      payments: [{ id: 'p1', date: '2026-07-15', customerId: 'customer-a', amount: 50_000 }],
    })

    expect(report.summary).toMatchObject({ totalOutstanding: 210_300, customerCount: 2, largestBalance: 139_300 })
    expect(report.rows.find((row) => row.customerId === 'customer-a')).toMatchObject({ billedAmount: 188_300, payments: 50_000, closingBalance: 139_300 })
  })
})
