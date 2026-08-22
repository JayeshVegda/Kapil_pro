import { describe, expect, it } from 'vitest'
import { buildWorkbookParts, columnName, inferSheetColumns, safeSheetName, toExcelSerialDate, xmlEscape, type SheetSpec } from '@/lib/exports/xlsx-workbook'

const GENERATED_AT = '2026-07-26T00:00:00.000Z'

const billsSheet: SheetSpec = {
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
    ['2026-06-11', '101/102', 'Mukesh Traders', 100, 18500.5],
  ],
}

function parts(sheets: SheetSpec[]) {
  return buildWorkbookParts(sheets, GENERATED_AT)
}

describe('columnName', () => {
  it('maps 1-based indexes to spreadsheet letters', () => {
    expect(columnName(1)).toBe('A')
    expect(columnName(26)).toBe('Z')
    expect(columnName(27)).toBe('AA')
    expect(columnName(52)).toBe('AZ')
  })
})

describe('toExcelSerialDate', () => {
  it('converts ISO dates to Excel serials', () => {
    // 1900-01-01 is serial 2 in Excel's (deliberately wrong) calendar.
    expect(toExcelSerialDate('1900-01-01')).toBe(2)
    expect(toExcelSerialDate('2026-07-26')).toBe(46229)
  })

  it('reads the date part of a timestamp', () => {
    expect(toExcelSerialDate('2026-07-26 10:35:00')).toBe(46229)
  })

  it('reads the dd-mm-yyyy form the app formatters produce', () => {
    expect(toExcelSerialDate('26-07-2026')).toBe(toExcelSerialDate('2026-07-26'))
    expect(toExcelSerialDate('04-06-2026')).toBe(toExcelSerialDate('2026-06-04'))
  })

  it('returns null for values that are not dates', () => {
    expect(toExcelSerialDate('')).toBeNull()
    expect(toExcelSerialDate(null)).toBeNull()
    expect(toExcelSerialDate('not a date')).toBeNull()
    expect(toExcelSerialDate('45-13-2026')).toBeNull()
  })
})

describe('inferSheetColumns', () => {
  const rows = [
    ['26-07-2026', 'Mukesh Traders', '₹1,23,456', '250', 'Bill 51/60'],
    ['27-07-2026', 'Ashish Ind.', '₹98,000', '100', 'Bill 51/61'],
  ]
  const headers = ['Date', 'Party', 'Amount', 'Qty', 'Details']

  it('detects a date column', () => {
    expect(inferSheetColumns(headers, rows)[0]).toEqual({ header: 'Date', type: 'date' })
  })

  it('leaves non-numeric columns as text', () => {
    expect(inferSheetColumns(headers, rows)[1]).toEqual({ header: 'Party', type: 'text' })
    expect(inferSheetColumns(headers, rows)[4]).toEqual({ header: 'Details', type: 'text' })
  })

  it('treats money headers as currency and totals them', () => {
    expect(inferSheetColumns(headers, rows)[2]).toEqual({ header: 'Amount', type: 'currency', total: true })
  })

  it('treats count headers as numbers and totals them', () => {
    expect(inferSheetColumns(headers, rows)[3]).toEqual({ header: 'Qty', type: 'number', total: true })
  })

  it('does not call a column numeric when any value is text', () => {
    const mixed = inferSheetColumns(['Amount'], [['₹100'], ['n/a']])
    expect(mixed[0]).toEqual({ header: 'Amount', type: 'text' })
  })

  it('produces a workbook where inferred amounts are real numbers', () => {
    const sheet = buildWorkbookParts(
      [{ name: 'Report', columns: inferSheetColumns(headers, rows), rows }],
      GENERATED_AT,
    )['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('<v>123456</v>')
    expect(sheet).toContain('<f>SUM(C2:C3)</f>')
  })
})

describe('xmlEscape', () => {
  it('escapes the XML metacharacters', () => {
    expect(xmlEscape('A & B <c> "d"')).toBe('A &amp; B &lt;c&gt; &quot;d&quot;')
  })

  it('strips control characters that would corrupt the file', () => {
    expect(xmlEscape(`bad${String.fromCharCode(7)}value`)).toBe('badvalue')
    expect(xmlEscape(`null${String.fromCharCode(0)}byte`)).toBe('nullbyte')
  })

  it('keeps tab and newline', () => {
    expect(xmlEscape('a\tb\nc')).toBe('a\tb\nc')
  })
})

describe('safeSheetName', () => {
  it('removes characters Excel rejects', () => {
    expect(safeSheetName('Bills/Payments*2026', 'Sheet1')).toBe('Bills Payments 2026')
  })

  it('caps the name at 31 characters', () => {
    expect(safeSheetName('x'.repeat(50), 'Sheet1')).toHaveLength(31)
  })

  it('falls back when nothing usable is left', () => {
    expect(safeSheetName('///', 'Sheet1')).toBe('Sheet1')
  })
})

describe('buildWorkbookParts', () => {
  it('writes every part a reader needs', () => {
    const files = parts([billsSheet])
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'xl/worksheets/sheet1.xml',
      ]),
    )
  })

  it('declares styles.xml in both the content types and the workbook rels', () => {
    const files = parts([billsSheet])
    expect(files['[Content_Types].xml']).toContain('/xl/styles.xml')
    expect(files['xl/_rels/workbook.xml.rels']).toContain('Target="styles.xml"')
  })

  it('writes amounts as numbers, not text', () => {
    const sheet = parts([billsSheet])['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('<v>45000</v>')
    expect(sheet).toContain('<v>18500.5</v>')
    expect(sheet).not.toContain('<t>45000</t>')
  })

  it('writes dates as serials with the date style', () => {
    const sheet = parts([billsSheet])['xl/worksheets/sheet1.xml']
    expect(sheet).toContain(`<v>${toExcelSerialDate('2026-06-04')}</v>`)
  })

  it('freezes the header row and adds an autofilter over the data', () => {
    const sheet = parts([billsSheet])['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('state="frozen"')
    expect(sheet).toContain('<autoFilter ref="A1:E3"/>')
  })

  it('adds a totals row that sums only the flagged columns', () => {
    const sheet = parts([billsSheet])['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('<f>SUM(D2:D3)</f>')
    expect(sheet).toContain('<f>SUM(E2:E3)</f>')
    expect(sheet).toContain('<v>63500.5</v>')
    // Party is text, so it must not gain a SUM.
    expect(sheet).not.toContain('SUM(C2:C3)')
  })

  it('labels the totals row in the first column', () => {
    const sheet = parts([billsSheet])['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('<t>Total</t>')
  })

  it('omits totals and autofilter for an empty sheet', () => {
    const sheet = parts([{ ...billsSheet, rows: [] }])['xl/worksheets/sheet1.xml']
    expect(sheet).not.toContain('SUM(')
    expect(sheet).not.toContain('autoFilter')
  })

  it('falls back to text when a numeric column holds a label', () => {
    const sheet = parts([{ ...billsSheet, rows: [['2026-06-04', '51/101', 'Ashish', 'n/a', 100]] }])['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('<t>n/a</t>')
  })

  it('escapes party names that contain XML characters', () => {
    const sheet = parts([{ ...billsSheet, rows: [['2026-06-04', '1/1', 'Tata & Sons <Pvt>', 1, 1]] }])['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('Tata &amp; Sons &lt;Pvt&gt;')
  })

  it('names sheets safely and keeps workbook rels in step', () => {
    const files = parts([
      { ...billsSheet, name: 'Bills/2026' },
      { ...billsSheet, name: 'Payments' },
    ])
    expect(files['xl/workbook.xml']).toContain('name="Bills 2026"')
    expect(files['xl/workbook.xml']).toContain('name="Payments"')
    expect(files['xl/_rels/workbook.xml.rels']).toContain('sheet2.xml')
    expect(files['xl/worksheets/sheet2.xml']).toBeDefined()
  })
})
