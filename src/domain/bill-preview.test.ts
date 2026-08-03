import { describe, expect, it } from 'vitest'
import { dedupeBillPreviewCredits } from './bill-preview'

describe('new bill preview credits', () => {
  it('shows each payment once by payment id', () => {
    expect(dedupeBillPreviewCredits([
      { id: 'p-old', date: '2026-07-01', amount: 500 },
      { id: 'p-new', date: '2026-08-03', amount: 300 },
      { id: 'p-old', date: '2026-07-01', amount: 500 },
    ])).toEqual([
      { id: 'p-old', date: '2026-07-01', amount: 500 },
      { id: 'p-new', date: '2026-08-03', amount: 300 },
    ])
  })
})
