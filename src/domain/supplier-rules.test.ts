import { describe, expect, it } from 'vitest'
import {
  allowedTaxModesForPool,
  computeBardanAgeBucket,
  resolveTaxModeForPool,
} from './supplier-purchases'

describe('Pool-to-tax-mode rule', () => {
  it('forces tax mode "none" for kacha pool', () => {
    expect(allowedTaxModesForPool('kacha')).toEqual(['none'])
    expect(resolveTaxModeForPool('kacha', 'gst')).toBe('none')
    expect(resolveTaxModeForPool('kacha', 'rcm')).toBe('none')
    expect(resolveTaxModeForPool('kacha', 'none')).toBe('none')
    expect(resolveTaxModeForPool('kacha')).toBe('none')
  })

  it('allows only gst and rcm for gst pool and rejects none', () => {
    expect(allowedTaxModesForPool('gst')).toEqual(['gst', 'rcm'])
    expect(resolveTaxModeForPool('gst', 'rcm')).toBe('rcm')
    expect(resolveTaxModeForPool('gst', 'gst')).toBe('gst')
    // Defaults to 'gst' if 'none' or invalid mode is requested
    expect(resolveTaxModeForPool('gst', 'none')).toBe('gst')
    expect(resolveTaxModeForPool('gst')).toBe('gst')
  })
})

describe('Bardan-pending day-age buckets', () => {
  it('classifies days < 7 as fresh', () => {
    expect(computeBardanAgeBucket(0)).toBe('fresh')
    expect(computeBardanAgeBucket(3)).toBe('fresh')
    expect(computeBardanAgeBucket(6)).toBe('fresh')
  })

  it('classifies days 7 to 10 as warning (amber)', () => {
    expect(computeBardanAgeBucket(7)).toBe('warning')
    expect(computeBardanAgeBucket(8)).toBe('warning')
    expect(computeBardanAgeBucket(10)).toBe('warning')
  })

  it('classifies days > 10 as critical (red)', () => {
    expect(computeBardanAgeBucket(11)).toBe('critical')
    expect(computeBardanAgeBucket(15)).toBe('critical')
    expect(computeBardanAgeBucket(30)).toBe('critical')
  })
})
