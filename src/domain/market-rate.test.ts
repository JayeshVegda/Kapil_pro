import { describe, expect, it } from 'vitest'
import { parseBrassB2BRate } from './market-rate'

describe('BrassB2B market rate parsing', () => {
  it('selects the newest valid Brass channel bulletin instead of trusting feed order', () => {
    const xml = `
      <rss><channel>
        <item><description>Date : 15.07.2026 Jamnagar Brass Vilaity (Local): 832 Delhi</description></item>
        <item><description>Date : 16.07.2026 Jamnagar Brass Vilaity (Local): 845 Delhi</description></item>
      </channel></rss>`

    expect(parseBrassB2BRate(xml)).toEqual({ localRate: 845, date: '16.07.2026' })
  })

  it('ignores bulletins without a valid local brass rate', () => {
    expect(parseBrassB2BRate('<rss><item><description>Brass channel unavailable</description></item></rss>')).toEqual({ localRate: null, date: '' })
  })
})
