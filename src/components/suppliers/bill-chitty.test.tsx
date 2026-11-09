import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeChittyTotals, BillChitty, BillChittyKpiBox, type BillChittyData } from './bill-chitty'

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

  it('explains bardan deduction before the already-netted bill total', () => {
    const html = renderToStaticMarkup(<BillChitty data={sampleData()} />)

    expect(html).toContain('Less: Bardan')
    expect(html.indexOf('Less: Bardan')).toBeLessThan(html.indexOf('Bill Net Amount'))
    expect(html).toContain('Included in bill net')
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
    const html = renderToStaticMarkup(<BillChitty data={sampleData()} />)
    expect(html).toContain('>#<')
    expect(html).toContain('>Item Description<')
    expect(html).toContain('>Bardan<')
    expect(html).toContain('>Weight<')
    expect(html).toContain('>Rate<')
    expect(html).toContain('>Amount<')
  })

  it('renders material lines via table on tablet/desktop and a stacked list on phones with no horizontal scroll container', () => {
    const html = renderToStaticMarkup(<BillChitty data={sampleData()} />)
    // The former overflow-x-auto wrapper is banned on the paper chitty: it never scrolls horizontally.
    expect(html).not.toContain('overflow-x-auto')
    // Phone fallback stacks the same line data without duplicating the amounts differently.
    expect(html).toContain('Bardan')
  })

  it('renders bold Bill Net Amount and removes duplicate gross subtotal', () => {
    const html = renderToStaticMarkup(<BillChitty data={sampleData()} />)
    expect(html).toContain('Bill Net Amount')
    expect(html).not.toContain('Items Gross Subtotal')
  })

  it('renders Payments & Credits Applied with grayish background', () => {
    const html = renderToStaticMarkup(<BillChitty data={sampleData()} />)
    expect(html).toContain('Payments &amp; Credits Applied')
    expect(html).toContain('bg-slate-100')
  })

  it('renders Balance Due with nil when fully paid and no trailing formula noise', () => {
    const paidInFull: BillChittyData = {
      ...sampleData(),
      paidRows: [{ date: '2026-11-04', mode: 'bank', reference: 'FULL', amountPaise: 50_000_000, pinned: false }],
    }
    const html = renderToStaticMarkup(<BillChitty data={paidInFull} />)
    expect(html).toContain('Balance Due')
    expect(html).toContain('>nil<')
    expect(html).not.toContain('(Bill ₹')
    expect(html).not.toContain('(Payable for this bill)')
  })

  it('turns Bill No red for GST bills', () => {
    const gstData: BillChittyData = { ...sampleData(), pool: 'gst', taxMode: 'gst' }
    const html = renderToStaticMarkup(<BillChitty data={gstData} />)
    expect(html).toContain('text-rose-600')
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
