import { describe, expect, it } from 'vitest'
import { parseBillCommand, parseContextCommand, parsePaymentCommand } from './commands'

const customers = [
  { id: 'c1', name: 'Sambhu Bhai', companyName: 'Sambhu Brass', customerName: 'Sambhu Bhai' },
  { id: 'c2', name: 'Ashish Ind.', companyName: 'Ashish Ind.', customerName: 'Ashish Ind.' },
]

const items = [
  { id: 'i1', name: 'Spindle (8.5GM)', defaultRate: 40, type: 'gas', unit: 'kg', bagWeight: 50 },
  { id: 'i2', name: 'Tapper Plug (10.50GM)', defaultRate: 60, type: 'gas', unit: 'kg', bagWeight: 50 },
  { id: 'i3', name: 'F5 (400GM)', defaultRate: 4.35, type: 'electronic', unit: 'piece', bagWeight: 0 },
]

describe('command parsing', () => {
  it('parses payment amounts and friendly dates', () => {
    const yday = parsePaymentCommand('sambhu 5l yday', customers, '2026-05-20')
    expect(yday).toMatchObject({
      ok: true,
      command: { kind: 'payment', amount: 500000, date: '2026-05-19' },
    })

    const monthName = parsePaymentCommand('sambhu 5l bank 15-may', customers, '2026-05-20')
    expect(monthName).toMatchObject({
      ok: true,
      command: { kind: 'payment', mode: 'Bank', date: '2026-05-15' },
    })
  })

  it('parses multi-item bill commands with rates, gst, transport, and backdate', () => {
    const parsed = parseBillCommand('ashish spindle 1 550 tapper 4 dr 70 gst +t 500 15-may', customers, items, '2026-05-20', 500)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.command.customer.id).toBe('c2')
    expect(parsed.command.gstMode).toBe('percent18')
    expect(parsed.command.transport).toBe(500)
    expect(parsed.command.date).toBe('2026-05-15')
    expect(parsed.command.items).toHaveLength(2)
    expect(parsed.command.items[0]).toMatchObject({
      item: { id: 'i1' },
      qty: 50,
      rate: 550,
      defaultRate: 80,
      manualRateEdited: true,
    })
    expect(parsed.command.items[1]).toMatchObject({
      item: { id: 'i2' },
      qty: 200,
      defaultRate: 70,
      rate: 540,
      manualRateEdited: false,
    })
  })

  it('parses bill book number, explicit bill ref, and padded numeric dates', () => {
    const bookOnly = parseBillCommand('ashish spindle 1 book 52 1-04-2026', customers, items, '2026-05-20', 500)
    expect(bookOnly).toMatchObject({
      ok: true,
      command: { kind: 'bill', bookNo: 52, billNo: null, date: '2026-04-01' },
    })

    const ref = parseBillCommand('ashish spindle 1 1/04', customers, items, '2026-05-20', 500)
    expect(ref).toMatchObject({
      ok: true,
      command: { kind: 'bill', bookNo: 1, billNo: 4, date: '2026-05-20' },
    })
  })

  it('uses configurable-style prefixes through context parsing defaults', () => {
    const parsed = parseContextCommand('b sambhu 2', 'neutral', { customers, items, today: '2026-05-20', mktRate: 500 })
    expect(parsed).toMatchObject({
      ok: true,
      command: { kind: 'bill', customer: { id: 'c1' }, item: { id: 'i1' }, qty: 100, rate: 540 },
    })
  })

  it('uses spindle by default, supports sp/tp aliases, and treats 50 as kilograms', () => {
    expect(parseContextCommand('b sambhu 2', 'neutral', { customers, items, today: '2026-05-20', mktRate: 500 })).toMatchObject({
      ok: true,
      command: { item: { id: 'i1' }, qty: 100, displayQty: '2 bags / 100 kg' },
    })
    expect(parseContextCommand('b sambhu sp 50', 'neutral', { customers, items, today: '2026-05-20', mktRate: 500 })).toMatchObject({
      ok: true,
      command: { item: { id: 'i1' }, qty: 50, displayQty: '50 kg / 1 bag' },
    })
    expect(parseContextCommand('b sambhu tp 2', 'neutral', { customers, items, today: '2026-05-20', mktRate: 500 })).toMatchObject({
      ok: true,
      command: { item: { id: 'i2' }, qty: 100 },
    })
  })

  it('parses multiple bill-attached payments with independent dates and modes', () => {
    const parsed = parseContextCommand('b sambhu 5 + p 3l tmr + p 1l bank fri', 'neutral', {
      customers,
      items,
      today: '2026-08-03',
      mktRate: 845,
    })

    expect(parsed).toMatchObject({
      ok: true,
      command: {
        kind: 'bill',
        date: '2026-08-03',
        attachedPayments: [
          { amount: 300000, mode: 'Cash', date: '2026-08-04', note: '' },
          { amount: 100000, mode: 'Bank', date: '2026-08-07', note: '' },
        ],
      },
    })
  })

  it('keeps ordinary plus-separated bill items backward compatible', () => {
    const parsed = parseContextCommand('b sambhu spindle 2 + tapper 1', 'neutral', {
      customers,
      items,
      today: '2026-08-03',
      mktRate: 845,
    })
    expect(parsed).toMatchObject({ ok: true, command: { kind: 'bill', items: [{ item: { id: 'i1' } }, { item: { id: 'i2' } }], attachedPayments: [] } })
  })

  it('keeps electronic bill commands on unit price instead of market rate', () => {
    const parsed = parseBillCommand('ashish f5 40000', customers, items, '2026-05-20', 801)
    expect(parsed).toMatchObject({
      ok: true,
      command: {
        items: [
          {
            item: { id: 'i3' },
            qty: 40000,
            defaultRate: 4.35,
            rate: 4.35,
            manualRateEdited: false,
          },
        ],
      },
    })
  })

  it('uses the selected customer last price before the item master default', () => {
    const parsed = parseContextCommand('b sambhu spindle 2', 'neutral', {
      customers,
      items,
      today: '2026-05-20',
      mktRate: 845,
      lastRates: {
        'c1:i1': { rate: 910, mktRate: 800, gstRate: 0 },
      },
    })

    expect(parsed).toMatchObject({
      ok: true,
      command: { items: [{ item: { id: 'i1' }, defaultRate: 110, rate: 955 }] },
    })
  })

  it('marks an explicit dr so customer history cannot overwrite it on New Bill', () => {
    const parsed = parseContextCommand('b sambhu 12 dr 150', 'neutral', {
      customers,
      items,
      today: '2026-08-06',
      mktRate: 855,
      lastRates: {
        'c1:i1': { rate: 990, mktRate: 855, gstRate: 0 },
      },
    })

    expect(parsed).toMatchObject({
      ok: true,
      command: {
        items: [{ defaultRate: 150, rate: 1005, manualRateEdited: false, rateMode: 'explicit_default' }],
      },
    })
  })

  it('marks fr as an exact final rate', () => {
    const parsed = parseContextCommand('b sambhu 12 fr 1050', 'neutral', {
      customers,
      items,
      today: '2026-08-06',
      mktRate: 855,
    })

    expect(parsed).toMatchObject({
      ok: true,
      command: { items: [{ rate: 1050, rateMode: 'explicit_final' }] },
    })
  })

  it('uses an explicit mkt value for the bill and automatic gas rates', () => {
    const parsed = parseContextCommand('b sambhu 12 mkt 900', 'neutral', {
      customers,
      items,
      today: '2026-08-06',
      mktRate: 855,
    })

    expect(parsed).toMatchObject({
      ok: true,
      command: { mktRate: 900, items: [{ defaultRate: 40, rate: 940 }] },
    })
  })

  it('rejects negative transport and gst amounts', () => {
    const negativeTransport = parseBillCommand('ashish spindle 2 +t -500', customers, items, '2026-05-20', 500)
    expect(negativeTransport).toMatchObject({ ok: true, command: { transport: 0 } })

    const negativeGst = parseBillCommand('ashish spindle 2 cgst -300', customers, items, '2026-05-20', 500)
    expect(negativeGst).toMatchObject({ ok: true, command: { gstAmount: 0, gstMode: 'none' } })
  })

  it('handles ambiguous numeric dates safely', () => {
    // Day/month swap keeps 6/13 usable (June 13) instead of producing month 13.
    const swapped = parseBillCommand('ashish spindle 2 on 6/13', customers, items, '2026-05-20', 500)
    expect(swapped).toMatchObject({ ok: true, command: { date: '2026-06-13' } })

    // Impossible in both orders fails the command with a clear error.
    const impossible = parseBillCommand('ashish spindle 2 on 32/2', customers, items, '2026-05-20', 500)
    expect(impossible).toMatchObject({ ok: false, error: 'Invalid date: 32/2' })
  })

  it('keeps parties with numbers in their names out of the amount slot', () => {
    const numberedParties = [
      { id: 'n1', name: 'No 1 Traders', companyName: 'No 1 Traders', customerName: 'No 1 Traders' },
      ...customers,
    ]
    const parsed = parsePaymentCommand('no 1 traders 500 cash', numberedParties, '2026-05-20')
    expect(parsed).toMatchObject({
      ok: true,
      command: { kind: 'payment', customer: { id: 'n1' }, amount: 500, mode: 'Cash' },
    })
  })

  it('maps sp7 and sp8 aliases to the right spindle variants', () => {
    const withVariants = [
      { id: 'i1', name: 'Spindle (7.5GM)', defaultRate: 40, type: 'gas', unit: 'kg', bagWeight: 50 },
      { id: 'i2', name: 'Spindle (8.5GM)', defaultRate: 40, type: 'gas', unit: 'kg', bagWeight: 50 },
    ]
    const sp7 = parseBillCommand('sambhu sp7 2', customers, withVariants, '2026-05-20', 500)
    const sp8 = parseBillCommand('sambhu sp8 2', customers, withVariants, '2026-05-20', 500)
    expect(sp7.ok && sp7.command.items[0].item.id).toBe('i1')
    expect(sp8.ok && sp8.command.items[0].item.id).toBe('i2')
  })

  it("always treats 'on <date>' as a date, never a book/bill ref", () => {
    const parsed = parseBillCommand('sambhu spindle 2 on 23/8', customers, items, '2026-05-20', 500)
    expect(parsed).toMatchObject({ ok: true, command: { bookNo: null, billNo: null, date: '2026-08-23' } })
  })

  it('uses the book pattern to tell bare n/n refs from dates', () => {
    // Book 51 holds bills 51-100, so 51/75 is a valid ref.
    const ref = parseBillCommand('sambhu spindle 2 51/75', customers, items, '2026-05-20', 500)
    expect(ref).toMatchObject({ ok: true, command: { bookNo: 51, billNo: 75 } })

    // Book 101 holds 101-150.
    const ref101 = parseBillCommand('sambhu spindle 2 101/120', customers, items, '2026-05-20', 500)
    expect(ref101).toMatchObject({ ok: true, command: { bookNo: 101, billNo: 120 } })

    // Book 23 does not exist in the 1,51,101,... pattern -> read 23/8 as 23 August.
    const date = parseBillCommand('sambhu spindle 2 23/8', customers, items, '2026-05-20', 500)
    expect(date).toMatchObject({ ok: true, command: { bookNo: null, billNo: null, date: '2026-08-23' } })

    // Bill outside the book range is not a ref either; 51/8 is no date either -> loud error.
    const neither = parseBillCommand('sambhu spindle 2 51/8', customers, items, '2026-05-20', 500)
    expect(neither.ok).toBe(false)
  })

  it('rejects two rates on the same line instead of silently overwriting', () => {
    const parsed = parseBillCommand('sambhu spindle 2 645 700', customers, items, '2026-05-20', 500)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('Two rates')
  })

  it('parses a party-only command as preselect-only', () => {
    const parsed = parseBillCommand('sambhu', customers, items, '2026-05-20', 500)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.command).toMatchObject({ kind: 'bill', partyOnly: true, customer: { id: 'c1' }, date: '2026-05-20' })
    expect(parsed.command.items).toHaveLength(0)
  })
})
