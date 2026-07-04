import { describe, expect, it } from 'vitest'
import { buildCommandDraftForTest, buildCommandSuggestionsForTest } from './app-shell'

const customers = [
  { id: 'c1', name: 'Sambhu Brass', companyName: 'Sambhu Brass', customerName: 'Sambhu Bhai' },
]

const items = [
  { id: 'gas-spindle', name: 'Spindle (8.5GM)', defaultRate: 80, type: 'gas', unit: 'kg', bagWeight: 50 },
  { id: 'gas-tapper', name: 'Tapper Plug (10.50GM)', defaultRate: 70, type: 'gas', unit: 'kg', bagWeight: 50 },
  { id: 'electronic-part', name: 'Electronic Part', defaultRate: 120, type: 'electronic', unit: 'piece' },
]

describe('Command K guidance', () => {
  it('suggests gas bill items and excludes electronic items', () => {
    const suggestions = buildCommandSuggestionsForTest('b Sambhu ', customers, items)

    expect(suggestions.map((suggestion) => suggestion.label)).toContain('Spindle (8.5GM)')
    expect(suggestions.map((suggestion) => suggestion.label)).not.toContain('Electronic Part')
  })

  it('keeps a typed gas item match at the top of bill suggestions', () => {
    const suggestions = buildCommandSuggestionsForTest('b Sambhu spi', customers, items)

    expect(suggestions[0]?.label).toBe('Spindle (8.5GM)')
  })

  it('does not expose removed stock command suggestions', () => {
    const suggestions = buildCommandSuggestionsForTest('s ', customers, items)

    expect(suggestions.map((suggestion) => suggestion.label)).not.toContain('Spindle (8.5GM)')
    expect(suggestions.map((suggestion) => suggestion.label)).not.toContain('Electronic Part')
  })

  it('guides the next bill token after an item is recognized', () => {
    const draft = buildCommandDraftForTest('b Sambhu spindle', customers, items)

    expect(draft?.suggestions).toContain('Add quantity in bags or kg')
    expect(draft?.suggestions).toContain('Optional: dr 80')
  })
})
