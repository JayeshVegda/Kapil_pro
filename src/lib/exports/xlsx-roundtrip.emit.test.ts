/**
 * Emits a real .xlsx into the scratchpad so it can be opened with an actual
 * spreadsheet reader. Skipped unless XLSX_EMIT_DIR is set, so normal test runs
 * stay side-effect free.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createXlsxBlob, type SheetSpec } from '@/lib/exports/xlsx-workbook'

const emitDir = process.env.XLSX_EMIT_DIR

describe.skipIf(!emitDir)('xlsx round trip', () => {
  it('writes a workbook a spreadsheet reader can open', async () => {
    const sheets: SheetSpec[] = [
      {
        name: 'Bills',
        totalsLabel: 'Total',
        columns: [
          { header: 'Date', type: 'date' },
          { header: 'Bill', type: 'text' },
          { header: 'Party', type: 'text' },
          { header: 'Qty', type: 'integer', total: true },
          { header: 'Amount', type: 'currency', total: true },
        ],
        rows: [
          ['2026-06-04', '51/101', 'Ashish Ind.', 250, 45000],
          ['2026-06-11', '101/102', 'Mukesh Traders & Co <Pvt>', 100, 18500.5],
          ['2026-07-02', '151/160', 'Long Party Name For Column Width Check', 1250, 987654.25],
        ],
      },
      {
        name: 'Payments',
        totalsLabel: 'Total',
        columns: [
          { header: 'Date', type: 'date' },
          { header: 'Mode', type: 'text' },
          { header: 'Amount', type: 'currency', total: true },
        ],
        rows: [
          ['2026-06-20', 'Bank', 30000],
          ['2026-07-05', 'Cash', 12500.75],
        ],
      },
    ]

    const blob = await createXlsxBlob(sheets)
    const buffer = Buffer.from(await blob.arrayBuffer())
    writeFileSync(join(emitDir as string, 'roundtrip.xlsx'), buffer)
    expect(buffer.length).toBeGreaterThan(1000)
  })
})
