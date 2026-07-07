import { describe, expect, it } from 'vitest'
import {
  getExportsPageSectionsForTest,
  getPrimaryPartyStatementActionsForTest,
  getSecondaryExportIdsForTest,
} from '@/routes/export-reports'

describe('exports page redesign model', () => {
  it('makes party statement the first visible section', () => {
    expect(getExportsPageSectionsForTest()).toEqual([
      'party-statement-generator',
      'statement-preview',
      'more-exports',
    ])
  })

  it('keeps party statement actions in business priority order', () => {
    expect(getPrimaryPartyStatementActionsForTest()).toEqual([
      'download-pdf',
      'download-csv',
      'download-package',
    ])
  })

  it('keeps only compact business exports as secondary options', () => {
    expect(getSecondaryExportIdsForTest()).toEqual(['book', 'sales'])
  })
})
