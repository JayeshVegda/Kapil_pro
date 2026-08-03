/**
 * The one PDF engine for every report in the app.
 *
 * Every export (party statement, sales register, book register, company report)
 * renders through this module so they all share one look: slate header band,
 * summary chips, zebra tables, right-aligned amounts, numbered footer.
 *
 * Uses the app's own Geist font (embedded via pdf-fonts.ts) — jsPDF's built-in
 * Helvetica is Latin-1 only and turns the rupee sign into garbage.
 */
import type { jsPDF } from 'jspdf'

export type PdfAlign = 'left' | 'right' | 'center'

export type PdfColumn = {
  header: string
  align?: PdfAlign
  /** Fixed width in pt; omitted columns share the remaining width. */
  width?: number
}

export type PdfSummaryItem = { label: string; value: string }

export type PdfTableSection = {
  kind: 'table'
  title?: string
  columns: PdfColumn[]
  rows: Array<Array<string | number>>
  /** Rendered bold above a top border, e.g. a totals line. */
  footerRow?: Array<string | number>
}

export type PdfKeyValueSection = {
  kind: 'keyValues'
  title?: string
  rows: PdfSummaryItem[]
}

export type PdfSection = PdfTableSection | PdfKeyValueSection

export type PdfReportSpec = {
  title: string
  subtitle?: string
  summary?: PdfSummaryItem[]
  sections: PdfSection[]
  orientation?: 'portrait' | 'landscape'
}

// Palette mirrors the app: sidebar slate, soft slate dividers, blue accent.
const INK = { r: 15, g: 23, b: 42 } // slate-900
const BAND = { r: 30, g: 42, b: 59 } // #1e2a3b sidebar
const MUTED = { r: 100, g: 116, b: 139 } // slate-500
const LINE = { r: 226, g: 232, b: 240 } // slate-200
const ZEBRA = { r: 248, g: 250, b: 252 } // slate-50

const MARGIN = 32
const BAND_HEIGHT = 64

let fontsRegistered = false

async function loadPdfDeps() {
  const [{ jsPDF }, autoTableModule, fonts] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/lib/exports/pdf-fonts'),
  ])
  return { jsPDF, autoTable: autoTableModule.default, fonts }
}

function registerFonts(doc: jsPDF, fonts: { PDF_FONT_FAMILY: string; GEIST_PDF_REGULAR_B64: string; GEIST_PDF_BOLD_B64: string }) {
  // jsPDF keeps the VFS on the constructor, so one registration serves all docs.
  if (!fontsRegistered) {
    doc.addFileToVFS('GeistPdf-Regular.ttf', fonts.GEIST_PDF_REGULAR_B64)
    doc.addFileToVFS('GeistPdf-Bold.ttf', fonts.GEIST_PDF_BOLD_B64)
    fontsRegistered = true
  }
  doc.addFont('GeistPdf-Regular.ttf', fonts.PDF_FONT_FAMILY, 'normal')
  doc.addFont('GeistPdf-Bold.ttf', fonts.PDF_FONT_FAMILY, 'bold')
  doc.setFont(fonts.PDF_FONT_FAMILY, 'normal')
}

function drawHeaderBand(doc: jsPDF, family: string, spec: PdfReportSpec) {
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFillColor(BAND.r, BAND.g, BAND.b)
  doc.rect(0, 0, pageWidth, BAND_HEIGHT, 'F')

  doc.setFont(family, 'bold')
  doc.setFontSize(15)
  doc.setTextColor(255, 255, 255)
  doc.text(spec.title, MARGIN, 27)

  if (spec.subtitle) {
    doc.setFont(family, 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(203, 213, 225) // slate-300
    doc.text(spec.subtitle, MARGIN, 42)
  }

  doc.setFont(family, 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(148, 163, 184) // slate-400
  doc.text('KAPIL PRODUCTS', pageWidth - MARGIN, 27, { align: 'right' })
  doc.setTextColor(INK.r, INK.g, INK.b)
}

function drawSummaryChips(doc: jsPDF, family: string, summary: PdfSummaryItem[], startY: number) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const gap = 8
  const chipWidth = (pageWidth - MARGIN * 2 - gap * (summary.length - 1)) / summary.length
  const chipHeight = 34

  summary.forEach((item, index) => {
    const x = MARGIN + index * (chipWidth + gap)
    doc.setFillColor(ZEBRA.r, ZEBRA.g, ZEBRA.b)
    doc.setDrawColor(LINE.r, LINE.g, LINE.b)
    doc.roundedRect(x, startY, chipWidth, chipHeight, 3, 3, 'FD')

    doc.setFont(family, 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
    doc.text(item.label.toUpperCase(), x + 8, startY + 12)

    doc.setFont(family, 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(INK.r, INK.g, INK.b)
    doc.text(item.value, x + 8, startY + 26)
  })

  return startY + chipHeight
}

function drawFooter(doc: jsPDF, family: string) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  doc.setDrawColor(LINE.r, LINE.g, LINE.b)
  doc.line(MARGIN, pageHeight - 26, pageWidth - MARGIN, pageHeight - 26)
  doc.setFont(family, 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text('Kapil Products — generated from Kapil Pro', MARGIN, pageHeight - 15)
  doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - MARGIN, pageHeight - 15, { align: 'right' })
  doc.setTextColor(INK.r, INK.g, INK.b)
}

export async function createStyledPdf(spec: PdfReportSpec): Promise<jsPDF> {
  const { jsPDF, autoTable, fonts } = await loadPdfDeps()
  const doc = new jsPDF({ orientation: spec.orientation ?? 'portrait', unit: 'pt', format: 'a4' })
  registerFonts(doc, fonts)
  const family = fonts.PDF_FONT_FAMILY

  drawHeaderBand(doc, family, spec)
  let cursorY = BAND_HEIGHT + 14
  if (spec.summary && spec.summary.length > 0) {
    cursorY = drawSummaryChips(doc, family, spec.summary, cursorY) + 12
  }

  for (const section of spec.sections) {
    if (section.kind === 'keyValues') {
      autoTable(doc, {
        startY: cursorY + (section.title ? 16 : 0),
        theme: 'plain',
        body: section.rows.map((row) => [row.label, row.value]),
        styles: { font: family, fontSize: 8.5, cellPadding: { top: 4, bottom: 4, left: 0, right: 8 }, textColor: [INK.r, INK.g, INK.b] },
        columnStyles: {
          0: { textColor: [MUTED.r, MUTED.g, MUTED.b], cellWidth: 150 },
          1: { fontStyle: 'bold' },
        },
        margin: { left: MARGIN, right: MARGIN, bottom: 40 },
        willDrawPage: () => {
          if (section.title) drawSectionTitle(doc, family, section.title, cursorY)
        },
        didDrawPage: () => drawFooter(doc, family),
      })
    } else {
      const columnStyles: Record<number, { halign?: PdfAlign; cellWidth?: number }> = {}
      section.columns.forEach((column, index) => {
        columnStyles[index] = {
          ...(column.align ? { halign: column.align } : {}),
          ...(column.width ? { cellWidth: column.width } : {}),
        }
      })
      const body: Array<Array<string | number>> = [...section.rows]
      const footRows = section.footerRow ? [section.footerRow.map(String)] : undefined

      autoTable(doc, {
        startY: cursorY + (section.title ? 16 : 0),
        head: [section.columns.map((column) => column.header)],
        body,
        foot: footRows,
        showFoot: 'lastPage',
        styles: {
          font: family,
          fontSize: 8,
          cellPadding: { top: 4.5, bottom: 4.5, left: 6, right: 6 },
          overflow: 'linebreak',
          valign: 'middle',
          lineColor: [LINE.r, LINE.g, LINE.b],
          lineWidth: 0.4,
          textColor: [INK.r, INK.g, INK.b],
        },
        headStyles: {
          font: family,
          fontStyle: 'bold',
          fillColor: [BAND.r, BAND.g, BAND.b],
          textColor: 255,
          fontSize: 7.5,
          cellPadding: { top: 5.5, bottom: 5.5, left: 6, right: 6 },
        },
        footStyles: {
          font: family,
          fontStyle: 'bold',
          fillColor: [ZEBRA.r, ZEBRA.g, ZEBRA.b],
          textColor: [INK.r, INK.g, INK.b],
          lineColor: [LINE.r, LINE.g, LINE.b],
          lineWidth: 0.4,
        },
        alternateRowStyles: { fillColor: [ZEBRA.r, ZEBRA.g, ZEBRA.b] },
        columnStyles,
        margin: { left: MARGIN, right: MARGIN, bottom: 40 },
        willDrawPage: (data) => {
          // Repeat the header band on subsequent pages, without the summary chips.
          if (data.pageNumber > 1) drawHeaderBand(doc, family, spec)
        },
        didDrawPage: () => {
          if (section.title) drawSectionTitle(doc, family, section.title, cursorY)
          drawFooter(doc, family)
        },
      })
    }
    cursorY = lastAutoTableY(doc) + 18
  }

  // Single-section documents may not have drawn a footer (plain theme edge cases).
  if (spec.sections.length === 0) drawFooter(doc, family)

  return doc
}

function drawSectionTitle(doc: jsPDF, family: string, title: string, y: number) {
  doc.setFont(family, 'bold')
  doc.setFontSize(9)
  doc.setTextColor(INK.r, INK.g, INK.b)
  doc.text(title, MARGIN, y + 6)
}

function lastAutoTableY(doc: jsPDF) {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? BAND_HEIGHT + 20
}

/**
 * Compat shape used by the existing pages: one table plus a summary strip.
 * `numericColumns` marks which columns right-align (amounts, quantities).
 */
export async function createSimpleTablePdf(input: {
  title: string
  subtitle?: string
  columns: string[]
  rows: Array<Array<string | number>>
  summary?: PdfSummaryItem[]
  numericColumns?: number[]
  orientation?: 'portrait' | 'landscape'
  footerRow?: Array<string | number>
}): Promise<jsPDF> {
  const numeric = new Set(input.numericColumns ?? inferNumericColumns(input.columns))
  return createStyledPdf({
    title: input.title,
    subtitle: input.subtitle,
    summary: input.summary,
    orientation: input.orientation ?? (input.columns.length > 6 ? 'landscape' : 'portrait'),
    sections: [
      {
        kind: 'table',
        columns: input.columns.map((header, index) => ({ header, align: numeric.has(index) ? 'right' : 'left' })),
        rows: input.rows,
        footerRow: input.footerRow,
      },
    ],
  })
}

const NUMERIC_HEADER = /(amount|balance|debit|credit|rate|total|qty|quantity|bags|value|paid|due|advance|transport|gst|bills|payments|count|kg)/i

/** Right-align columns whose headers look numeric — same heuristic family as the XLSX writer. */
export function inferNumericColumns(headers: string[]): number[] {
  return headers.flatMap((header, index) => (NUMERIC_HEADER.test(String(header)) ? [index] : []))
}
