import { describe, expect, it } from 'vitest'
import { calculateDraftLinePaise, matchPurchaseMaster, normalizePurchaseAliases, parsePurchaseBillDraft, parsePurchaseDecimal } from '@/domain/purchase-bill-draft'
import { computeBillNet, resolveTaxModeForPool } from '@/domain/supplier-purchases'
import { nextPurchaseInNo } from '@/domain/in-no'
import { sumPaise } from '@/domain/supplier-units'

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

  it('keeps typed bag weight and vehicle separate from private note', () => {
    const payload = { supplier_name: 'Scrap Supplier', date: '2026-11-15', vehicle_no: 'GJ-10-AB-1234',
      bags_at_receipt: '2.500', private_note: 'Handle carefully',
      lines: [{ item_name: 'Brass Scrap', weight_kg: '10', rate_rs_per_kg: '395' }] }
    expect(parsePurchaseBillDraft(2, payload)).toMatchObject({ kind: 'valid', value: {
      vehicle_no: 'GJ-10-AB-1234', bags_at_receipt_g: 2500, private_note: 'Handle carefully',
    } })
    expect(parsePurchaseBillDraft(2, { ...payload, private_note: 'Keep [bags_at_receipt:2.500] dry' })).toMatchObject({
      kind: 'invalid', issues: [expect.stringContaining('Use bags_at_receipt')],
    })
  })

  it('marks contradictory pool and tax mode invalid without silent coercion', () => {
    const line = { item_name: 'Brass Scrap', weight_kg: '1', rate_rs_per_kg: '395' }
    const base = { supplier_name: 'Scrap Supplier', date: '2026-11-15', lines: [line] }
    expect(parsePurchaseBillDraft(2, { ...base, pool: 'gst', tax_mode: 'none' })).toMatchObject({ kind: 'invalid', issues: [expect.stringContaining('GST pool')] })
    for (const tax_mode of ['gst', 'rcm']) {
      expect(parsePurchaseBillDraft(2, { ...base, pool: 'kacha', tax_mode })).toMatchObject({ kind: 'invalid', issues: [expect.stringContaining('Kacha pool')] })
    }
    expect(parsePurchaseBillDraft(1, { ...draft, pool: 'kacha', tax_mode: 'gst' }).kind).toBe('invalid')
  })

  it('validates save-critical purchase fields and allows signed non-quality adjustments', () => {
    const base = { supplier_name: 'Supplier', date: '2026-11-15', lines: [{ item_name: 'Scrap', weight_kg: '10', rate_rs_per_kg: '395' }] }
    for (const change of [
      { lines: [{ item_name: 'Scrap', weight_kg: '10', rate_rs_per_kg: '0' }] },
      { payment: { amount_rs: '100', mode: 'neft' } },
      { gst_rate_bp: 2801 },
      { bardan: [{ weight_kg: '1', rate_rs_per_kg: '395', method: 'deduct', rate_line_index: 2 }] },
      { bardan: [{ weight_kg: '1', rate_rs_per_kg: '395', method: 'advance' }] },
      { adjustments: [{ type: 'quality_cut', amount_rs: '-1' }] },
    ]) expect(parsePurchaseBillDraft(2, { ...base, ...change }).kind).toBe('invalid')
    const signed = parsePurchaseBillDraft(2, { ...base, adjustments: [{ type: 'labour', amount_rs: '-10.50' }] })
    expect(signed).toMatchObject({ kind: 'valid', value: { adjustments: [{ amount_paise: -1050 }] } })
  })

  it('rejects oversized line units and checked aggregate money', () => {
    const base = { supplier_name: 'Supplier', date: '2026-11-15' }
    const line = { item_name: 'Scrap', weight_kg: '1', rate_rs_per_kg: '395' }
    for (const badLine of [
      { ...line, weight_kg: '100000.001' },
      { ...line, rate_rs_per_kg: '10000.001' },
      { ...line, amount_rs: '100000001' },
    ]) expect(parsePurchaseBillDraft(2, { ...base, lines: [badLine] }).kind).toBe('invalid')
    expect(parsePurchaseBillDraft(2, { ...base, lines: [
      { ...line, amount_rs: '60000000' }, { ...line, amount_rs: '60000000' },
    ] }).kind).toBe('invalid')
    expect(() => sumPaise([Number.MAX_SAFE_INTEGER, 1])).toThrow('safe integer')
    expect(() => computeBillNet([{ amountPaise: Number.MAX_SAFE_INTEGER }], [], [], 'none', 0)).toThrow('limit')
  })

  it('rejects excess decimals, exponent notation and unsafe magnitudes', () => {
    expect(() => parsePurchaseDecimal('1.0001', 3, 'Weight')).toThrow('at most 3')
    expect(() => parsePurchaseDecimal('1.001', 2, 'Amount')).toThrow('at most 2')
    expect(() => parsePurchaseDecimal('1e5', 2, 'Amount')).toThrow('decimal number')
    expect(() => parsePurchaseDecimal('999999999999999999', 2, 'Amount')).toThrow('too large')
    expect(() => calculateDraftLinePaise(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow('limit')
    expect(() => parsePurchaseDecimal('1,2', 2, 'Amount')).toThrow('invalid grouping')
  })

  it('keeps whole-rupee payable, GST and RCM, bardan and FY numbering separate', () => {
    const material = calculateDraftLinePaise(90500, 395000)
    const bardanCredit = calculateDraftLinePaise(500, 395000)
    const lines = [{ amountPaise: material }]
    const bardan = [{ method: 'deduct', creditPaise: bardanCredit }]
    const gst = computeBillNet(lines, [], bardan, resolveTaxModeForPool('gst', 'gst'), 1800)
    const rcm = computeBillNet(lines, [], bardan, resolveTaxModeForPool('gst', 'rcm'), 1800)
    expect(gst.netPaise % 100).toBe(0)
    expect(gst.taxPaise).toBe(639900)
    expect(gst.netPaise).toBe(4194900)
    expect(rcm.netPaise).toBe(3555000)
    expect(rcm.rcmLiabilityPaise).toBe(639900)
    expect(resolveTaxModeForPool('kacha', 'gst')).toBe('none')
    expect(nextPurchaseInNo(['IN-2627-0001'], '2026-11-15')).toBe('IN-2627-0002')
    expect(nextPurchaseInNo(['IN-2627-0001'], '2027-04-01')).toBe('IN-2728-0001')
  })

  it('matches only active, unambiguous Purchase aliases within a supplied master list', () => {
    const masters = [
      { id: 'aaaaaaaaaaaaaaa', name: 'Brass Scrap', aliases: 'Old Brass\nPeetal', active: true },
      { id: 'bbbbbbbbbbbbbbb', name: 'Copper Scrap', aliases: 'Tamba', active: false },
    ]
    expect(normalizePurchaseAliases(' old brass, Peetal, old brass ', 'Brass Scrap')).toBe('old brass\nPeetal')
    expect(matchPurchaseMaster('peetal', undefined, masters)?.id).toBe('aaaaaaaaaaaaaaa')
    expect(matchPurchaseMaster('tamba', undefined, masters)).toBeNull()
    expect(matchPurchaseMaster('peetal', undefined, [...masters, { id: 'ccccccccccccccc', name: 'Mixed Scrap', aliases: 'Peetal', active: true }])).toBeNull()
  })
})
