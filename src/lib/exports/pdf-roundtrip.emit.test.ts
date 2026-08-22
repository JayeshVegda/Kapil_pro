/**
 * Emits a real PDF through the shared engine so it can be inspected with an
 * actual PDF reader — in particular that the rupee sign survives, which the old
 * Helvetica-based builders could not render. Skipped unless PDF_EMIT_DIR is set.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStyledPdf } from '@/lib/exports/pdf-engine'

const emitDir = process.env.PDF_EMIT_DIR

describe.skipIf(!emitDir)('pdf engine round trip', () => {
  it('renders a statement PDF with rupee amounts', async () => {
    const doc = await createStyledPdf({
      title: 'Mukesh Traders — Party Statement',
      subtitle: 'Period: 01-04-2026 to 26-07-2026 | Generated from Kapil Pro',
      summary: [
        { label: 'Opening Balance', value: '₹1,29,300' },
        { label: 'Total Bills', value: '₹4,51,000' },
        { label: 'Total Payments', value: '₹3,80,650' },
        { label: 'Closing Balance', value: '₹1,99,650' },
      ],
      sections: [
        {
          kind: 'table',
          columns: [
            { header: 'Date', width: 62 },
            { header: 'Type', width: 48 },
            { header: 'Ref' },
            { header: 'Debit', align: 'right' },
            { header: 'Credit', align: 'right' },
            { header: 'Balance', align: 'right' },
          ],
          rows: [
            ['03-05-2026', 'Bill', '51/60 — Spindle 250kg @ 180', '₹45,000', '', '₹1,74,300'],
            ['11-05-2026', 'Payment', 'Bank NEFT', '', '₹50,000', '₹1,24,300'],
            ['04-06-2026', 'Bill', '51/101 — Spindle 100kg @ 185', '₹18,500', '', '₹1,42,800'],
          ],
          footerRow: ['', '', 'Total', '₹63,500', '₹50,000', ''],
        },
      ],
    })
    const buffer = Buffer.from(doc.output('arraybuffer'))
    writeFileSync(join(emitDir as string, 'roundtrip.pdf'), buffer)
    expect(buffer.length).toBeGreaterThan(10_000)
  })
})
