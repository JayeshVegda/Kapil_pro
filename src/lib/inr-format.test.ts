import { describe, expect, it } from 'vitest'
import { parseBillQuickPaymentAmountInput, parseIndianPaymentAmountInput } from './inr-format'

describe('parseIndianPaymentAmountInput', () => {
  it('treats bare payment numbers as lakhs', () => {
    expect(parseIndianPaymentAmountInput('2')).toBe(2_00_000)
    expect(parseIndianPaymentAmountInput('142')).toBe(1_42_00_000)
  })

  it('supports common Indian amount suffixes', () => {
    expect(parseIndianPaymentAmountInput('2.5l')).toBe(2_50_000)
    expect(parseIndianPaymentAmountInput('50k')).toBe(50_000)
    expect(parseIndianPaymentAmountInput('1.2cr')).toBe(1_20_00_000)
  })

  it('accepts formatted rupee input and rejects invalid values', () => {
    expect(parseIndianPaymentAmountInput('₹2,50,000')).toBe(2_50_000)
    expect(parseIndianPaymentAmountInput('abc')).toBe(0)
    expect(parseIndianPaymentAmountInput('-2')).toBe(0)
  })
})

describe('parseBillQuickPaymentAmountInput', () => {
  it('treats bare bill quick-payment numbers as thousands', () => {
    expect(parseBillQuickPaymentAmountInput('190')).toBe(1_90_000)
    expect(parseBillQuickPaymentAmountInput('1900')).toBe(19_00_000)
  })

  it('supports explicit suffixes and formatted INR', () => {
    expect(parseBillQuickPaymentAmountInput('1.9l')).toBe(1_90_000)
    expect(parseBillQuickPaymentAmountInput('50k')).toBe(50_000)
    expect(parseBillQuickPaymentAmountInput('₹1,90,000')).toBe(1_90_000)
  })
})
