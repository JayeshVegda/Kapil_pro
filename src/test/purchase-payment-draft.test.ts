import { expect, it } from 'vitest'
import { parsePurchasePaymentDraft } from '@/domain/purchase-payment-draft'

const payload = { supplier_name: 'Maruti Metals', date: '2026-11-15', kind: 'payment', amount_rs: '90000.01' }

it('parses Purchase payment money from strings without float drift', () => {
  expect(parsePurchasePaymentDraft(1, payload)).toMatchObject({ kind: 'valid', amountPaise: 9000001, value: { pool: 'kacha' } })
  expect(parsePurchasePaymentDraft(1, { ...payload, amount_rs: '0.01' })).toMatchObject({ kind: 'valid', amountPaise: 1 })
  for (const amount_rs of ['1.001', '1e5', '900000000000000000', '0', '-1']) {
    expect(parsePurchasePaymentDraft(1, { ...payload, amount_rs }).kind).toBe('invalid')
  }
  expect(parsePurchasePaymentDraft(1, { ...payload, mode: 'Cash' }).kind).toBe('invalid')
  expect(parsePurchasePaymentDraft(2, payload).kind).toBe('invalid')
  for (const mode of ['neft', 'rtgs', 'cheque', 'upi']) {
    expect(parsePurchasePaymentDraft(1, { ...payload, mode }).kind).toBe('invalid')
    expect(parsePurchasePaymentDraft(1, { ...payload, mode, reference: 'TX-1' }).kind).toBe('valid')
  }
})
