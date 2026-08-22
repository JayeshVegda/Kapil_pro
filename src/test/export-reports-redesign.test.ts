import { describe, expect, it } from 'vitest'
import {
  getExportsPageSectionsForTest,
  getPrimaryPartyStatementActionsForTest,
  getSecondaryExportIdsForTest,
} from '@/routes/export-reports'

describe('exports page redesign model', () => {
  it('exposes the focused report studio sections in business priority order', () => {
    expect(getExportsPageSectionsForTest()).toEqual([
      'party-statement',
      'monthly-summary',
      'sales-register',
      'rate-analysis',
      'outstanding',
      'more-exports',
    ])
  })

  it('keeps party statement actions in business priority order', () => {
    expect(getPrimaryPartyStatementActionsForTest()).toEqual([
      'download-pdf',
      'download-excel',
      'download-csv',
      'download-package',
    ])
  })

  it('keeps only compact business exports as secondary options', () => {
    expect(getSecondaryExportIdsForTest()).toEqual(['book'])
  })
})
