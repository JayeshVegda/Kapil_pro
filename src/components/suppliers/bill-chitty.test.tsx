import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeChittyTotals, BillChitty, BillChittyKpiBox, type BillChittyData } from './bill-chitty'
import { isBrassBenchmarkItem } from '@/domain/purchase-market-benchmark'

function sampleData(): BillChittyData {
  return {
    inNo: 'IN-101',
    date: '2026-11-01',
    supplierName: 'Shakti Metals',
    pool: 'kacha',
    taxMode: 'rcm',
    gstRateBp: 1800,
    supplierBillNo: 'SB-9',
    lines: [
      { itemName: 'Brass Scrap', weightG: 40_000, rateMilli: 7_200_000, amountPaise: 2_880_000 },
      { itemName: 'Copper', weightG: 10_000, rateMilli: 6_500_000, amountPaise: 650_000 },
    ],
    adjustments: [
      { type: 'labour', amountPaise: -2500 },
      { type: 'quality_cut', amountPaise: -1000 },
      { type: 'other', amountPaise: 500, note: 'Weighing' },
    ],
    bardan: [
      { bardanG: 3000, rateMilli: 1_000_000, method: 'deduct', creditPaise: 30_000, cashAmountPaise: 0, date: '2026-11-01', note: '' },
      { bardanG: 0, rateMilli: 0, method: 'cash_back', creditPaise: 0, cashAmountPaise: 12_000, date: '2026-11-02', note: '' },
    ],
    paidRows: [
      { date: '2026-11-03', mode: 'cash', reference: '', amountPaise: 1_500_000, pinned: false },
      { date: '2026-11-04', mode: 'upi', reference: 'UPI-7', amountPaise: 400_000, pinned: false },
    ],
  }
}

describe('computeChittyTotals', () => {
  it('returns identical totals for view and preview modes', () => {
    expect(computeChittyTotals(sampleData(), 'preview')).toEqual(computeChittyTotals(sampleData(), 'view'))
  })

  it('accumulates lines and payments, then derives due', () => {
    const totals = computeChittyTotals(sampleData())
    expect(totals.linesTotalPaise).toBe(3_530_000)
    expect(totals.paidPaise).toBe(1_900_000)
    expect(totals.duePaise).toBe(Math.max(0, totals.netPaise - 1_900_000))
    expect(totals.bardanCreditPaise).toBeGreaterThan(0)
  })

  it('status derives from cancellation override, then paid/due', () => {
    expect(computeChittyTotals({ ...sampleData(), cancelled: true, cancelReason: 'dup' }).status).toBe('cancelled')
    expect(computeChittyTotals({ ...sampleData(), statusOverride: 'nil' }).status).toBe('nil')
    const t = computeChittyTotals(sampleData())
    expect(t.duePaise > 0).toBe(t.status !== 'nil')
  })
})

describe('BillChitty UI standardization', () => {
  it('shows in-kind bardan as information without inventing a monetary deduction', () => {
    const data: BillChittyData = {
      ...sampleData(), taxMode: 'none', gstRateBp: 0, adjustments: [], paidRows: [],
      lines: [{ itemName: 'Scrap', weightG: 1000, rateMilli: 800000, amountPaise: 80000 }],
      bardan: [{ bardanG: 1000, rateMilli: 800000, method: 'in_kind', creditPaise: 0, cashAmountPaise: 0, date: '2026-11-01', note: 'Bags returned' }],
    }

    const html = renderToStaticMarkup(<BillChitty data={data} />)

    expect(html).toContain('Settled in kind')
    expect(html).not.toContain('₹8,000')
    expect(computeChittyTotals(data).duePaise).toBe(80000)
  })

  it('cash-back prints its cash memo without reducing the payable', () => {
    const data: BillChittyData = {
      ...sampleData(), bardan: [{ bardanG: 1000, rateMilli: 800000, method: 'cash_back', creditPaise: 0, cashAmountPaise: 12000, date: '2026-11-01', note: '' }],
    }

    const html = renderToStaticMarkup(<BillChitty data={data} />)

    expect(html).toContain('Cash memo')
    expect(html).toContain('₹120.00')
    expect(html).not.toContain('₹8,000')
  })

  it('explains bardan after the net and labels the deduction with a minus sign', () => {
    const html = renderToStaticMarkup(<BillChitty data={sampleData()} />)

    expect(html).toContain('BARDAN')
    expect(html.indexOf('BARDAN')).toBeGreaterThan(html.indexOf('BILL NET AMOUNT'))
    expect(html).not.toContain('Bardan total')
    expect(html).not.toContain('Included in bill net')
  })

  it('shows bardan advance once as an applied payment and separately as a memo', () => {
    const data: BillChittyData = {
      ...sampleData(),
      bardan: [{ bardanG: 1000, rateMilli: 800000, method: 'advance', creditPaise: 80000, cashAmountPaise: 0, date: '2026-11-01', note: '' }],
      paidRows: [{ date: '2026-11-01', mode: 'other', reference: 'Bardan advance', amountPaise: 80000, pinned: false }],
    }

    const html = renderToStaticMarkup(<BillChitty data={data} />)

    expect(html).toContain('Pool credit')
    expect(computeChittyTotals(data).paidPaise).toBe(80000)
  })

  it('renders opening advance references even without a payment mode', () => {
    const data: BillChittyData = { ...sampleData(), paidRows: [{ date: '', mode: '', reference: 'Opening Advance', amountPaise: 50000, pinned: false }] }

    const html = renderToStaticMarkup(<BillChitty data={data} />)

    expect(html).toContain('Opening Advance')
  })

  it('renders top left Kapil Product and Jamnagar, top right Bill No and Date without status stamp', () => {
    const html = renderToStaticMarkup(<BillChitty data={sampleData()} />)
    expect(html).toContain('KAPIL PRODUCTS')
    expect(html).toContain('Jamnagar')
    expect(html).toContain('Bill No:')
    expect(html).toContain('IN-101')
    expect(html).toContain('Date:')
    // No status stamp in chitty
    expect(html).not.toContain('uppercase tracking-wider border-amber-300')
    expect(html).not.toContain('border-rose-300')
    // No kacha / gst badge in party line
    expect(html).not.toContain('KACHA POOL')
  })

  it('renders table with Bardan column between item description and weight', () => {
    const data = sampleData()
    data.lines[0].bardanText = '3 bags'
    const html = renderToStaticMarkup(<BillChitty data={data} />)
    expect(html).toContain('>#<')
    expect(html).toContain('>Item<')
    expect(html).toContain('>Bags<')
    expect(html).toContain('>Gross weight<')
    expect(html).toContain('>Rate<')
    expect(html).toContain('>Amount<')
  })

  it('hides an empty or zero Bardan column while keeping saved settlements', () => {
    const data = sampleData()
    data.lines[0].bardanText = '0 bags'
    const html = renderToStaticMarkup(<BillChitty data={data} />)
    expect(html).not.toContain('>Bags<')
    expect(html).toContain('−₹300.00')
  })

  it('renders material lines via table on tablet/desktop and a stacked list on phones with no horizontal scroll container', () => {
    const html = renderToStaticMarkup(<BillChitty data={sampleData()} />)
    // The former overflow-x-auto wrapper is banned on the paper chitty: it never scrolls horizontally.
    expect(html).not.toContain('overflow-x-auto')
    // Phone fallback stacks the same line data without duplicating the amounts differently.
    expect(html).toContain('kg gross')
  })

  it('renders bold Bill Net Amount and removes duplicate gross subtotal', () => {
    const html = renderToStaticMarkup(<BillChitty data={sampleData()} />)
    expect(html).toContain('BILL NET AMOUNT')
    expect(html).not.toContain('Items Gross Subtotal')
  })

  it('renders dated payments as deductions', () => {
    const html = renderToStaticMarkup(<BillChitty data={sampleData()} />)
    expect(html).toContain('>PAYMENT<')
    expect(html).toContain('Paid on 03-11-2026 (cash)')
    expect(html).toContain('−₹15,000.00')
  })

  it('renders paid in full for an exact payment and advance for an overpayment', () => {
    const balance = computeChittyTotals(sampleData()).netPaise
    const paidInFull: BillChittyData = {
      ...sampleData(),
      paidRows: [{ date: '2026-11-04', mode: 'bank', reference: 'FULL', amountPaise: balance, pinned: false }],
    }
    const html = renderToStaticMarkup(<BillChitty data={paidInFull} />)
    expect(html).toContain('BALANCE DUE')
    expect(html).toContain('>PAID IN FULL<')
    expect(html).not.toContain('(Bill ₹')
    expect(html).not.toContain('(Payable for this bill)')
    const advance = renderToStaticMarkup(<BillChitty data={{ ...paidInFull, advancePaise: 50_000 }} />)
    expect(advance).toContain('>ADVANCE<')
    expect(advance).toContain('₹500.00')
    expect(advance).not.toContain('PAID IN FULL')
  })

  it('turns Bill No red for GST bills', () => {
    const gstData: BillChittyData = { ...sampleData(), pool: 'gst', taxMode: 'gst' }
    const html = renderToStaticMarkup(<BillChitty data={gstData} />)
    expect(html).toContain('text-rose-600')
  })

  it('shows charged GST in the item table and narrow preview, not in adjustments', () => {
    const data: BillChittyData = {
      ...sampleData(), taxMode: 'gst', gstRateBp: 1800, adjustments: [], bardan: [], paidRows: [],
      lines: [{ itemName: 'Brass', weightG: 1000, rateMilli: 100_000, amountPaise: 10_000, bardanText: '1 bag' }],
    }
    const html = renderToStaticMarkup(<BillChitty data={data} />)
    expect(computeChittyTotals(data)).toMatchObject({ taxPaise: 1800, netPaise: 11_800 })
    expect(html.match(/<tbody.*?<\/tbody>/)?.[0]).toMatch(/<td[^>]*>GST 18%<\/td><td[^>]*>\+₹18\.00<\/td>/)
    expect(html.match(/<ol.*?<\/ol>/)?.[0]).toContain('GST 18%')
    expect(html).not.toContain('>ADJUSTMENTS<')
    const rcm = renderToStaticMarkup(<BillChitty data={{ ...data, taxMode: 'rcm' }} />)
    expect(rcm).not.toContain('GST 18%')
    expect(rcm).toContain('RCM liability')
  })

  it('keeps the supplied net and due amounts and shows the same breakdown in preview and print', () => {
    const data: BillChittyData = {
      ...sampleData(), taxMode: 'none', gstRateBp: 0,
      lines: [
        { itemName: 'Brass', weightG: 1_500_000, rateMilli: 880_000, amountPaise: 132_000_000, bardanText: '15 bags' },
        { itemName: 'Lead', weightG: 680_000, rateMilli: 370_000, amountPaise: 25_160_000, bardanText: '10 bags' },
      ],
      adjustments: [
        { type: 'quality_cut', amountPaise: 500_000, note: 'Quality Cut (Dhur)' },
        { type: 'labour', amountPaise: 50_000 },
        { type: 'transport', amountPaise: 200_000 },
        { type: 'other', amountPaise: -90_000, note: 'Delay' },
      ],
      bardan: [
        { ...sampleData().bardan[0], itemName: 'Brass', bagCount: 15, bardanG: 23_000, rateMilli: 880_000, creditPaise: 2_024_000, note: 'private bardan text' },
        { ...sampleData().bardan[0], itemName: 'Lead', bagCount: 10, bardanG: 15_000, rateMilli: 370_000, creditPaise: 555_000 },
      ],
      paidRows: [{ ...sampleData().paidRows[0], amountPaise: 80_000_000, hasNote: true }],
      bagsAtReceiptKg: 38,
      vehicleNo: 'GJ-10-AB-1234',
    }
    expect(computeChittyTotals(data)).toMatchObject({ netPaise: 154_241_000, duePaise: 74_241_000 })
    const html = renderToStaticMarkup(<BillChitty data={data} />)
    expect(renderToStaticMarkup(<BillChitty data={data} mode="preview" />)).toBe(html)
    expect(html).not.toContain('Rupees Fifteen Lakh')
    expect(html).not.toContain('already in net')
    expect(html).toContain('₹7,42,410.00')
    expect(html).toContain('1500.000 kg gross')
    expect(html).toContain('Paid on 03-11-2026 (cash)')
    expect(html).toContain('Payment note recorded')
    expect(html).toContain('Supplier invoice no.')
    expect(html).toContain('SB-9')
    expect(html).toContain('Bag weight memo')
    expect(html).toContain('GJ-10-AB-1234')
    expect(html).not.toContain('<tfoot')
    expect(html).not.toContain('PURCHASE BILL')
    expect(html).not.toContain('Received by')
    expect(html).toContain('Less: Quality Cut (Dhur)')
    expect(html).toContain('Less: Delay')
    expect(html).toContain('× ₹880')
    expect(html).not.toContain('₹880.000')
    expect(html).not.toContain('private bardan text')
  })

  it('excludes an unselected supplier chitti from print and only benchmarks Brass', () => {
    const html = renderToStaticMarkup(<BillChitty data={{ ...sampleData(), supplierName: ' ', paidRows: [] }} mode="preview" />)
    expect(html).toContain('Supplier not selected')
    expect(html).not.toContain('print-chitty')
    expect(html).not.toContain('>PAYMENT<')
    expect(isBrassBenchmarkItem('Brass Scrap')).toBe(true)
    expect(isBrassBenchmarkItem('Lead')).toBe(false)
    expect(isBrassBenchmarkItem('Brass Copper Mix')).toBe(false)
  })

  it('omits blank optional details, round-off and duplicate single-entry totals', () => {
    const data: BillChittyData = {
      ...sampleData(), supplierBillNo: ' ', taxMode: 'none',
      lines: [{ itemName: 'Brass', weightG: 1000, rateMilli: 100_001, amountPaise: 10_099 }],
      adjustments: [{ type: 'transport', amountPaise: 100 }],
      bardan: [{ ...sampleData().bardan[0], creditPaise: 100 }],
    }
    expect(computeChittyTotals(data).roundOffPaise).not.toBe(0)
    const html = renderToStaticMarkup(<BillChitty data={data} />)
    expect(html).not.toMatch(/Round off|Adjustments total|Bardan total|Supplier invoice no\.|Bag weight memo|Vehicle no\./)
    expect(html).toContain('₹101.00')
  })
})

describe('BillChittyKpiBox', () => {
  it('shows the bill amount, applied payments, due and pool', () => {
    const html = renderToStaticMarkup(<BillChittyKpiBox data={sampleData()} />)
    expect(html).toContain('Bill settlement')
    expect(html).toContain('Bill amount')
    expect(html).toContain('Paid so far')
    expect(html).toContain('Still to pay')
    expect(html).toContain('Kacha')
  })
})
