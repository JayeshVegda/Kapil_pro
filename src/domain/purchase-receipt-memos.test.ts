import { describe, expect, it } from 'vitest'
import { extractUserNote, formatPrivateNoteWithBags, parseBagsAtReceiptKg } from './supplier-purchases'
import { formatPurchaseLineMemos, parsePurchaseLineMemos, purchaseReceiptMemoText } from './purchase-receipt-memos'

describe('purchase receipt memos', () => {
  it('round-trips stable line memos including Unicode and punctuation', () => {
    const memos = { line1: '12', line2: 'બોરી [A] · 3.5 kg\nreturned' }
    const saved = formatPurchaseLineMemos('Operator note', memos)

    expect(parsePurchaseLineMemos(saved)).toEqual(memos)
    expect(extractUserNote(saved)).toBe('Operator note')
  })

  it('retains receipt weight metadata while hiding line metadata from user notes', () => {
    const saved = formatPurchaseLineMemos(formatPrivateNoteWithBags('Quality checked', 2.5), { line1: '6' })

    expect(parseBagsAtReceiptKg(saved)).toBe(2.5)
    expect(extractUserNote(saved)).toBe('Quality checked')
    expect(parsePurchaseLineMemos(saved)).toEqual({ line1: '6' })
  })

  it('replaces removed or edited line memos rather than keeping orphan entries', () => {
    const first = formatPurchaseLineMemos('Note', { line1: '8', line2: '4' })
    const updated = formatPurchaseLineMemos(first, { line1: '10', line2: '' })

    expect(parsePurchaseLineMemos(updated)).toEqual({ line1: '10' })
    expect(updated.match(/purchase_line_memos_v1/g)).toHaveLength(1)
    expect(formatPurchaseLineMemos(updated, {})).toBe('Note')
  })

  it('reads legacy bills without metadata and damaged metadata safely', () => {
    expect(parsePurchaseLineMemos('Old note')).toEqual({})
    expect(parsePurchaseLineMemos('[purchase_line_memos_v1:broken%ZZ]')).toEqual({})
    expect(purchaseReceiptMemoText('12')).toBe('12 bags')
    expect(purchaseReceiptMemoText('2 kg bags')).toBe('2 kg bags')
  })
})
