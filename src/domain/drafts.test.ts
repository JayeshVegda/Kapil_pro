import { describe, expect, it } from 'vitest'
import { buildDraftView, type DraftItemMaster } from './drafts'

const master: DraftItemMaster[] = [
  { id: 'i1', name: 'Spindle (8.5GM)', type: 'gas', unit: 'kg', bagWeight: 50, aliases: 'spindle 8.5 sp' },
  { id: 'i2', name: 'Tapper Plug (10.50GM)', type: 'gas', unit: 'kg', bagWeight: 50 },
  { id: 'i3', name: 'F5 (400GM)', type: 'electronic', unit: 'pcs', bagWeight: 0 },
]

describe('buildDraftView', () => {
  it('computes real totals, GST on items only, and transport', () => {
    const view = buildDraftView(
      { id: 'd1', customer_name: 'Adesh Brass', date: '2026-10-24', mkt: 920, transport: 350, gst_mode: 'percent18', gst_rate: 18 },
      [
        { item: 'i1', item_name: 'Spindle (8.5GM)', qty: 300, bags: 6, rate: 1075 },
        { item: 'i2', item_name: 'Tapper Plug (10.50GM)', qty: 100, bags: 2, rate: 1075 },
      ],
      [{ amount: 25000, mode: 'Bank' }],
      master,
    )
    expect(view.itemsSubtotal).toBe(430000)
    expect(view.gstAmount).toBe(77400)
    expect(view.grandTotal).toBe(view.itemsSubtotal + view.gstAmount + 350)
    expect(view.advanceTotal).toBe(25000)
    expect(view.isEstimate).toBe(false)
  })

  it('converts bags to kg via the matched item bag weight and matches aliases', () => {
    const view = buildDraftView(
      { id: 'd2' },
      [{ item_name: 'spindle 8.5', bags: 6 }],
      [],
      master,
    )
    expect(view.rows[0].itemName).toBe('Spindle (8.5GM)')
    expect(view.rows[0].qty).toBe(300)
    expect(view.rows[0].bags).toBe(6)
    expect(view.rows[0].matched).toBe(true)
    expect(view.rows[0].isGas).toBe(true)
  })

  it('treats rate 0 rows as an estimate and keeps them in the total at zero', () => {
    const view = buildDraftView(
      { id: 'd3' },
      [{ item: 'i1', item_name: 'Spindle (8.5GM)', qty: 300, bags: 6, rate: 1075 }, { item: 'i2', item_name: 'Tapper Plug (10.50GM)', qty: 100, bags: 2 }],
      [],
      master,
    )
    expect(view.hasAutoRates).toBe(true)
    expect(view.isEstimate).toBe(true)
    expect(view.rows[1].rate).toBe(0)
  })

  it('respects a manual GST amount and electronic items never get market treatment', () => {
    const view = buildDraftView(
      { id: 'd4', gst_mode: 'manual', gst_amount: 1250, transport: 0 },
      [{ item: 'i3', item_name: 'F5 (400GM)', qty: 10, rate: 4.35 }],
      [],
      master,
    )
    expect(view.gstAmount).toBe(1250)
    expect(view.rows[0].isGas).toBe(false)
    expect(view.rows[0].unit).toBe('pcs')
    expect(view.rows[0].bags).toBe(0)
    expect(view.grandTotal).toBe(43.5 + 1250)
  })

  it('links the party from expand when the relation is present', () => {
    const view = buildDraftView(
      { id: 'd5', customer_name: '', customer: 'c1', expand: { customer: { id: 'c1', company_name: 'Adesh Brass' } } },
      [],
      [],
      master,
    )
    expect(view.customerId).toBe('c1')
    expect(view.customerName).toBe('Adesh Brass')
    expect(view.isPartyLinked).toBe(true)
  })
})
