import { describe, expect, it } from 'vitest'
import { MAX_PAYMENT_AMOUNT, parseBillQuickPaymentAmountInput, parseIndianPaymentAmountInput } from './inr-format'

describe('parseIndianPaymentAmountInput', () => {
  it('treats whole numbers 1-999 as thousands', () => {
    expect(parseIndianPaymentAmountInput('1')).toBe(1_000)
    expect(parseIndianPaymentAmountInput('20')).toBe(20_000)
    expect(parseIndianPaymentAmountInput('200')).toBe(2_00_000)
    expect(parseIndianPaymentAmountInput('350')).toBe(3_50_000)
    expect(parseIndianPaymentAmountInput('999')).toBe(9_99_000)
  })

  it('keeps whole numbers >= 1000 exact', () => {
    expect(parseIndianPaymentAmountInput('1000')).toBe(1_000)
    expect(parseIndianPaymentAmountInput('20000')).toBe(20_000)
    expect(parseIndianPaymentAmountInput('49852')).toBe(49_852)
  })

  it('keeps decimal values exact', () => {
    expect(parseIndianPaymentAmountInput('250.00')).toBe(250)
    expect(parseIndianPaymentAmountInput('298200.00')).toBe(298_200)
    expect(parseIndianPaymentAmountInput('250.5')).toBe(250.5)
  })

  it('supports common Indian amount suffixes', () => {
    expect(parseIndianPaymentAmountInput('2.5l')).toBe(2_50_000)
    expect(parseIndianPaymentAmountInput('50k')).toBe(50_000)
    expect(parseIndianPaymentAmountInput('1.2cr')).toBe(1_20_00_000)
  })

  it('accepts formatted rupee input literally and rejects invalid values', () => {
    expect(parseIndianPaymentAmountInput('₹2,50,000')).toBe(2_50_000)
    expect(parseIndianPaymentAmountInput('₹350')).toBe(350)
    expect(parseIndianPaymentAmountInput('abc')).toBe(0)
    expect(parseIndianPaymentAmountInput('-2')).toBe(0)
  })

  it('rejects results above the 1.5 crore ceiling', () => {
    expect(parseIndianPaymentAmountInput('160l')).toBe(0)
    expect(parseIndianPaymentAmountInput('2cr')).toBe(0)
    expect(parseIndianPaymentAmountInput('99l')).toBe(99_00_000)
    expect(parseIndianPaymentAmountInput('1.5cr')).toBe(MAX_PAYMENT_AMOUNT)
  })
})

describe('parseBillQuickPaymentAmountInput', () => {
  it('treats whole numbers 1-999 as thousands', () => {
    expect(parseBillQuickPaymentAmountInput('40')).toBe(40_000)
    expect(parseBillQuickPaymentAmountInput('350')).toBe(3_50_000)
    expect(parseBillQuickPaymentAmountInput('190')).toBe(1_90_000)
  })

  it('keeps whole numbers >= 1000 exact', () => {
    expect(parseBillQuickPaymentAmountInput('1900')).toBe(1_900)
    expect(parseBillQuickPaymentAmountInput('298200')).toBe(2_98_200)
  })

  it('supports explicit suffixes and formatted INR', () => {
    expect(parseBillQuickPaymentAmountInput('4k')).toBe(4_000)
    expect(parseBillQuickPaymentAmountInput('0.5l')).toBe(50_000)
    expect(parseBillQuickPaymentAmountInput('3.5l')).toBe(3_50_000)
    expect(parseBillQuickPaymentAmountInput('50k')).toBe(50_000)
    expect(parseBillQuickPaymentAmountInput('₹1,90,000')).toBe(1_90_000)
  })

  it('keeps decimal input exact', () => {
    expect(parseBillQuickPaymentAmountInput('298200.00')).toBe(298_200)
  })
})
