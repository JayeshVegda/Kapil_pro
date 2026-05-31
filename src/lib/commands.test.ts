import { describe, expect, it } from 'vitest'
import { parseBillCommand, parseContextCommand, parsePaymentCommand } from './commands'

const customers = [
  { id: 'c1', name: 'Sambhu Bhai', companyName: 'Sambhu Brass', customerName: 'Sambhu Bhai' },
  { id: 'c2', name: 'Ashish Ind.', companyName: 'Ashish Ind.', customerName: 'Ashish Ind.' },
]

const items = [
  { id: 'i1', name: 'Spindle (8.5GM)', defaultRate: 40, type: 'gas', unit: 'kg', bagWeight: 50 },
  { id: 'i2', name: 'Tapper Plug (10.50GM)', defaultRate: 60, type: 'gas', unit: 'kg', bagWeight: 50 },
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
})
