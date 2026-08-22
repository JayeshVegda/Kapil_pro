/**
 * Minimal but properly typed XLSX writer.
 *
 * Built on JSZip (already a dependency) rather than a spreadsheet library, to
 * keep the export bundle small. Unlike a plain CSV dump this writes real cell
 * types, so amounts sort and SUM correctly in Excel and dates behave as dates.
 */

export type CellValue = string | number | null | undefined

export type ColumnType = 'text' | 'integer' | 'number' | 'currency' | 'date'

export type SheetColumn = {
  header: string
  type?: ColumnType
  /** Column width in characters. Derived from the content when omitted. */
  width?: number
  /** Add this column to the totals row. Only meaningful for numeric columns. */
  total?: boolean
}

export type SheetSpec = {
  name: string
  columns: SheetColumn[]
  rows: CellValue[][]
  /** Label placed in the first column of the totals row. */
  totalsLabel?: string
}

// Custom number formats start at 164; ids below that are reserved by Excel.
const NUM_FMT_INTEGER = 164
const NUM_FMT_CURRENCY = 165
const NUM_FMT_DATE = 166
const NUM_FMT_NUMBER = 167

// Indian grouping (lakh / crore) rather than thousands.
const INDIAN_CURRENCY = '[&gt;=10000000]&quot;₹&quot;#\\,##\\,##\\,##0.00;[&gt;=100000]&quot;₹&quot;#\\,##\\,##0.00;&quot;₹&quot;#\\,##0.00'
const INDIAN_INTEGER = '[&gt;=10000000]#\\,##\\,##\\,##0;[&gt;=100000]#\\,##\\,##0;#\\,##0'

/** cellXfs indices, in the order they are written below. */
const STYLE = {
  default: 0,
  header: 1,
  text: 2,
  integer: 3,
  number: 4,
  currency: 5,
  date: 6,
  totalText: 7,
  totalInteger: 8,
  totalNumber: 9,
  totalCurrency: 10,
} as const

const BODY_STYLE_BY_TYPE: Record<ColumnType, number> = {
  text: STYLE.text,
  integer: STYLE.integer,
  number: STYLE.number,
  currency: STYLE.currency,
  date: STYLE.date,
}

const TOTAL_STYLE_BY_TYPE: Record<ColumnType, number> = {
  text: STYLE.totalText,
  integer: STYLE.totalInteger,
  number: STYLE.totalNumber,
  currency: STYLE.totalCurrency,
  date: STYLE.totalText,
}

export function xmlEscape(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are illegal in XML 1.0 and would corrupt the file.
    // Tab, newline and carriage return are the only ones allowed through.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

export function columnName(index: number) {
  let name = ''
  let current = index
  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }
  return name
}

/**
 * Excel stores dates as days since 1899-12-30. Accepts ISO (`yyyy-mm-dd`) and the
 * `dd-mm-yyyy` form the app's own formatters produce. Returns null otherwise.
 */
export function toExcelSerialDate(value: CellValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').trim()
  if (!text) return null

  let year: number
  let month: number
  let day: number
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text)
  if (iso) {
    ;[, year, month, day] = iso.map(Number) as unknown as [number, number, number, number]
  } else if (dmy) {
    day = Number(dmy[1])
    month = Number(dmy[2])
    year = Number(dmy[3])
  } else {
    return null
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const utc = Date.UTC(year, month - 1, day)
  const epoch = Date.UTC(1899, 11, 30)
  const serial = Math.round((utc - epoch) / 86_400_000)
  return Number.isFinite(serial) ? serial : null
}

const DATE_HEADERS = /^(date|day)$/i
const CURRENCY_HEADERS = /(amount|balance|debit|credit|rate|total|value|paid|due|advance|transport|gst|opening|closing)/i
const COUNT_HEADERS = /(qty|quantity|bags|bills|count|payments|pieces|pcs|kg)/i

/**
 * Best-effort column types for a generic report preview, which only carries
 * header strings. Header names are the strongest signal available.
 */
export function inferSheetColumns(headers: string[], rows: CellValue[][]): SheetColumn[] {
  return headers.map((header, index) => {
    const label = String(header ?? '').trim()
    const sample = rows.map((row) => row[index]).filter((value) => value !== null && value !== undefined && value !== '')
    const allNumeric = sample.length > 0 && sample.every((value) => toFiniteNumber(value) !== null)
    const allDates = sample.length > 0 && sample.every((value) => toExcelSerialDate(value) !== null)

    if (DATE_HEADERS.test(label) && allDates) return { header: label, type: 'date' as const }
    if (!allNumeric) return { header: label, type: 'text' as const }
    if (CURRENCY_HEADERS.test(label)) return { header: label, type: 'currency' as const, total: true }
    if (COUNT_HEADERS.test(label)) return { header: label, type: 'number' as const, total: true }
    return { header: label, type: 'number' as const }
  })
}

function toFiniteNumber(value: CellValue): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[₹,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/** Width from the widest cell, clamped so one long note cannot blow out the sheet. */
function deriveWidth(column: SheetColumn, values: CellValue[]) {
  if (column.width) return column.width
  const longest = values.reduce<number>((max, value) => Math.max(max, String(value ?? '').length), column.header.length)
  return Math.min(46, Math.max(9, longest + 2))
}

function cellXml(ref: string, value: CellValue, type: ColumnType, styleIndex: number) {
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}" s="${styleIndex}"/>`
  }
  if (type === 'date') {
    const serial = toExcelSerialDate(value)
    if (serial === null) return `<c r="${ref}" s="${STYLE.text}" t="inlineStr"><is><t>${xmlEscape(String(value))}</t></is></c>`
    return `<c r="${ref}" s="${styleIndex}"><v>${serial}</v></c>`
  }
  if (type === 'integer' || type === 'number' || type === 'currency') {
    const numeric = toFiniteNumber(value)
    // Fall back to text so a stray label in a numeric column still shows up.
    if (numeric === null) return `<c r="${ref}" s="${STYLE.text}" t="inlineStr"><is><t>${xmlEscape(String(value))}</t></is></c>`
    return `<c r="${ref}" s="${styleIndex}"><v>${numeric}</v></c>`
  }
  return `<c r="${ref}" s="${styleIndex}" t="inlineStr"><is><t>${xmlEscape(String(value))}</t></is></c>`
}

function worksheetXml(sheet: SheetSpec) {
  const columns = sheet.columns
  const columnCount = Math.max(columns.length, ...sheet.rows.map((row) => row.length), 1)
  const hasTotals = columns.some((column) => column.total)
  const lastDataRow = sheet.rows.length + 1
  const lastColumn = columnName(columnCount)

  const cols = columns
    .map((column, index) => {
      const width = deriveWidth(column, sheet.rows.map((row) => row[index]))
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
    })
    .join('')

  const headerCells = columns
    .map((column, index) => `<c r="${columnName(index + 1)}1" s="${STYLE.header}" t="inlineStr"><is><t>${xmlEscape(column.header)}</t></is></c>`)
    .join('')

  const bodyRows = sheet.rows
    .map((row, rowIndex) => {
      const excelRow = rowIndex + 2
      const cells = columns
        .map((column, columnIndex) => {
          const type = column.type ?? 'text'
          return cellXml(`${columnName(columnIndex + 1)}${excelRow}`, row[columnIndex], type, BODY_STYLE_BY_TYPE[type])
        })
        .join('')
      return `<row r="${excelRow}">${cells}</row>`
    })
    .join('')

  let totalsRow = ''
  if (hasTotals && sheet.rows.length > 0) {
    const excelRow = lastDataRow + 1
    const cells = columns
      .map((column, columnIndex) => {
        const ref = `${columnName(columnIndex + 1)}${excelRow}`
        const type = column.type ?? 'text'
        if (columnIndex === 0) {
          return `<c r="${ref}" s="${STYLE.totalText}" t="inlineStr"><is><t>${xmlEscape(sheet.totalsLabel ?? 'Total')}</t></is></c>`
        }
        if (!column.total) return `<c r="${ref}" s="${STYLE.totalText}"/>`
        const letter = columnName(columnIndex + 1)
        const sum = sheet.rows.reduce((acc, row) => acc + (toFiniteNumber(row[columnIndex]) ?? 0), 0)
        // Both the formula and its cached value, so the file reads correctly
        // before Excel recalculates.
        return `<c r="${ref}" s="${TOTAL_STYLE_BY_TYPE[type]}"><f>SUM(${letter}2:${letter}${lastDataRow})</f><v>${sum}</v></c>`
      })
      .join('')
    totalsRow = `<row r="${excelRow}">${cells}</row>`
  }

  const autoFilter = sheet.rows.length > 0 ? `<autoFilter ref="A1:${lastColumn}${lastDataRow}"/>` : ''

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData><row r="1" ht="18" customHeight="1">${headerCells}</row>${bodyRows}${totalsRow}</sheetData>${autoFilter}</worksheet>`
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="4">` +
    `<numFmt numFmtId="${NUM_FMT_INTEGER}" formatCode="${INDIAN_INTEGER}"/>` +
    `<numFmt numFmtId="${NUM_FMT_CURRENCY}" formatCode="${INDIAN_CURRENCY}"/>` +
    `<numFmt numFmtId="${NUM_FMT_DATE}" formatCode="dd-mm-yyyy"/>` +
    `<numFmt numFmtId="${NUM_FMT_NUMBER}" formatCode="#\\,##0.00"/>` +
    `</numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E2A3B"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF94A3B8"/></top><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="11">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="${NUM_FMT_INTEGER}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="${NUM_FMT_NUMBER}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="${NUM_FMT_CURRENCY}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="${NUM_FMT_DATE}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyFont="1"><alignment vertical="center"/></xf>` +
    `<xf numFmtId="${NUM_FMT_INTEGER}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
    `<xf numFmtId="${NUM_FMT_NUMBER}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
    `<xf numFmtId="${NUM_FMT_CURRENCY}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
}

function contentTypesXml(sheetCount: number) {
  const overrides = Array.from(
    { length: sheetCount },
    (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
}

function workbookRelsXml(sheetCount: number) {
  const sheetRels = Array.from(
    { length: sheetCount },
    (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
}

/** Excel rejects these characters in a sheet name, and caps the name at 31 chars. */
export function safeSheetName(name: string, fallback: string) {
  const cleaned = String(name ?? '').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31)
  return cleaned || fallback
}

function workbookXml(sheetNames: string[]) {
  const sheets = sheetNames
    .map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`
}

function corePropsXml(generatedAtIso: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Kapil Pro</dc:creator><cp:lastModifiedBy>Kapil Pro</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${generatedAtIso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${generatedAtIso}</dcterms:modified></cp:coreProperties>`
}

function appPropsXml(sheetNames: string[]) {
  const vector = sheetNames.map((name) => `<vt:lpstr>${xmlEscape(name)}</vt:lpstr>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Kapil Pro</Application><TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${vector}</vt:vector></TitlesOfParts></Properties>`
}

/** The full set of XLSX parts, exposed separately so it can be tested without zipping. */
export function buildWorkbookParts(sheets: SheetSpec[], generatedAtIso: string): Record<string, string> {
  const named = sheets.map((sheet, index) => ({ ...sheet, name: safeSheetName(sheet.name, `Sheet${index + 1}`) }))
  const names = named.map((sheet) => sheet.name)
  return {
    '[Content_Types].xml': contentTypesXml(named.length),
    '_rels/.rels': rootRelsXml(),
    'docProps/core.xml': corePropsXml(generatedAtIso),
    'docProps/app.xml': appPropsXml(names),
    'xl/workbook.xml': workbookXml(names),
    'xl/_rels/workbook.xml.rels': workbookRelsXml(named.length),
    'xl/styles.xml': stylesXml(),
    ...Object.fromEntries(named.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet)])),
  }
}

export async function createXlsxBlob(sheets: SheetSpec[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const parts = buildWorkbookParts(sheets, new Date().toISOString())
  for (const [path, content] of Object.entries(parts)) {
    zip.file(path, content)
  }
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  })
}
