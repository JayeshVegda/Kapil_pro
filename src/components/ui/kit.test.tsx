import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from './data-table'
import { MoneyCell } from './money-cell'
import { StatusChip, statusToneClass } from './status-chip'

describe('shared table kit', () => {
  it('maps status tones to restrained state colors', () => {
    expect(Object.keys(statusToneClass)).toEqual(['neutral', 'selection', 'success', 'warning', 'danger'])
    expect(renderToStaticMarkup(<StatusChip tone="warning">Pending</StatusChip>)).toContain('text-amber')
  })

  it('formats rupees and paise with Indian grouping and tabular figures', () => {
    expect(renderToStaticMarkup(<MoneyCell valuePaise={123456789} />)).toContain('₹12,34,567.89')
    expect(renderToStaticMarkup(<MoneyCell valueRupees={1234567} />)).toContain('₹12,34,567')
    expect(renderToStaticMarkup(<MoneyCell valuePaise={100} />)).toContain('tabular-nums')
  })

  it('shows the first 25 of 500 rows by default', () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({ name: `Row ${index + 1}` }))
    const columns: ColumnDef<(typeof rows)[number], unknown>[] = [{ accessorKey: 'name', header: 'Name' }]
    const html = renderToStaticMarkup(<DataTable data={rows} columns={columns} />)
    expect(html).toContain('Row 25')
    expect(html).not.toContain('Row 26</td>')
    expect(html).toContain('1–25 of 500')
  })
})
