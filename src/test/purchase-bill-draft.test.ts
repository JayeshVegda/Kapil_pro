import { describe, expect, it } from 'vitest'
import { calculateDraftLinePaise, parsePurchaseBillDraft, parsePurchaseDecimal } from '@/domain/purchase-bill-draft'

describe('purchase bill draft validation', () => {
  const draft = {
    supplier_name: 'Scrap Supplier', date: '2026-11-15', pool: 'kacha', tax_mode: 'none',
    lines: [{ item_name: 'Brass Scrap', weight_g: 1250, rate_milli: 450500, amount_paise: 56313 }],
  }

  it('accepts integer purchase units without converting them to floats', () => {
    expect(parsePurchaseBillDraft(1, draft)).toEqual({ kind: 'valid', value: draft })
  })

  it('marks fractional money and unsupported versions invalid', () => {
    expect(parsePurchaseBillDraft(1, { ...draft, lines: [{ ...draft.lines[0], rate_milli: 450.5 }] }).kind).toBe('invalid')
    expect(parsePurchaseBillDraft(3, draft).kind).toBe('invalid')
  })

  it('parses human decimal strings exactly for schema 2', () => {
    expect(parsePurchaseDecimal('90.5', 3, 'Weight')).toBe(90500)
    expect(parsePurchaseDecimal('395', 3, 'Rate')).toBe(395000)
    expect(parsePurchaseDecimal('90000', 2, 'Amount')).toBe(9000000)
    expect(parsePurchaseDecimal('0.001', 3, 'Weight')).toBe(1)
    expect(calculateDraftLinePaise(90500, 395000)).toBe(3574750)
    const parsed = parsePurchaseBillDraft(2, {
      supplier_name: 'Scrap Supplier', date: '2026-11-15',
      lines: [{ item_name: 'Brass Scrap', weight_kg: '90.5', rate_rs_per_kg: '395', amount_rs: '90000' }],
    })
    expect(parsed.kind).toBe('valid')
    if (parsed.kind === 'valid') {
      expect(parsed.value.pool).toBe('kacha')
      expect(parsed.value.lines[0]).toMatchObject({ weight_g: 90500, rate_milli: 395000, amount_paise: 9000000 })
    }
  })

  it('rejects excess decimals, exponent notation and unsafe magnitudes', () => {
    expect(() => parsePurchaseDecimal('1.0001', 3, 'Weight')).toThrow('at most 3')
    expect(() => parsePurchaseDecimal('1.001', 2, 'Amount')).toThrow('at most 2')
    expect(() => parsePurchaseDecimal('1e5', 2, 'Amount')).toThrow('decimal number')
    expect(() => parsePurchaseDecimal('999999999999999999', 2, 'Amount')).toThrow('too large')
    expect(() => calculateDraftLinePaise(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow('too large')
  })
})
