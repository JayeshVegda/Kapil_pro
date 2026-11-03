import { describe, expect, it } from 'vitest'
import { validateManualPins } from './supplier-settlement'

describe('supplier manual-pin validation', () => {
  it('rejects cross-pool pin', () => {
    const paymentPool = 'kacha'
    const paymentAmountPaise = 50_000_00 // ₹50,000

    const pins = [
      {
        billId: 'bill-gst-1',
        billPool: 'gst' as const,
        billDuePaise: 30_000_00,
        pinnedPaise: 20_000_00,
      },
    ]

    const result = validateManualPins(paymentPool, paymentAmountPaise, pins)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/cross-pool pin rejected/i)
  })

  it('rejects pin exceeding bill due amount (over-pin on bill)', () => {
    const paymentPool = 'gst'
    const paymentAmountPaise = 100_000_00 // ₹1,00,000

    const pins = [
      {
        billId: 'bill-gst-1',
        billPool: 'gst' as const,
        billDuePaise: 40_000_00, // ₹40,000 due
        pinnedPaise: 45_000_00, // trying to pin ₹45,000!
      },
    ]

    const result = validateManualPins(paymentPool, paymentAmountPaise, pins)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/over-pin on bill rejected/i)
  })

  it('rejects total pins exceeding payment amount (over-pin on payment)', () => {
    const paymentPool = 'kacha'
    const paymentAmountPaise = 50_000_00 // ₹50,000 payment

    const pins = [
      {
        billId: 'bill-kacha-1',
        billPool: 'kacha' as const,
        billDuePaise: 40_000_00,
        pinnedPaise: 35_000_00,
      },
      {
        billId: 'bill-kacha-2',
        billPool: 'kacha' as const,
        billDuePaise: 30_000_00,
        pinnedPaise: 20_000_00, // 35k + 20k = 55k > 50k!
      },
    ]

    const result = validateManualPins(paymentPool, paymentAmountPaise, pins)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/over-pin on payment rejected/i)
  })

  it('accepts valid pins within bill due and within payment total', () => {
    const paymentPool = 'kacha'
    const paymentAmountPaise = 50_000_00 // ₹50,000 payment

    const pins = [
      {
        billId: 'bill-kacha-1',
        billPool: 'kacha' as const,
        billDuePaise: 30_000_00,
        pinnedPaise: 30_000_00,
      },
      {
        billId: 'bill-kacha-2',
        billPool: 'kacha' as const,
        billDuePaise: 25_000_00,
        pinnedPaise: 15_000_00,
      },
    ]

    const result = validateManualPins(paymentPool, paymentAmountPaise, pins)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })
})
