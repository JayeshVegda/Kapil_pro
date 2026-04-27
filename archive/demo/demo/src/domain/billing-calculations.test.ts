import { describe, expect, it } from 'vitest'
import { calculateBillTotalFromBase, calculateBillTotals } from '@/domain/billing-calculations'

describe('billing calculations', () => {
  it('calculates totals from line items, transport and gst', () => {
    const totals = calculateBillTotals({
      items: [
        { qty: 10, rate: 120 },
        { qty: 5, rate: 80 },
      ],
      transport: 300,
      gstRate: 18,
    })

    expect(totals.itemsTotal).toBe(1600)
    expect(totals.gstAmount).toBe(288)
    expect(totals.grandTotal).toBe(2188)
    expect(totals.totalQty).toBe(15)
  })

  it('keeps dashboard total logic aligned with bill write-side math', () => {
    const itemsTotal = 1500
    const transport = 200
    const gstRate = 18
    const grandTotal = calculateBillTotalFromBase(itemsTotal, transport, gstRate)

    expect(grandTotal).toBe(1970)
  })
})
