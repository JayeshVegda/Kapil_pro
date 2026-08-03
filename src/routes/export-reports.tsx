import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, BookOpen, Download, FileArchive, FileSpreadsheet, FileText, Gauge, ReceiptText, Users, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { CompactExportCard } from '@/components/exports/more-exports-panel'
import { PartyStatementPreview } from '@/components/exports/party-statement-preview'
import { ExportSurface } from '@/components/exports/export-surface'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM, type BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { buildBackupSnapshot, type BackupSnapshot } from '@/data/backup'
import { pb } from '@/data/pocketbase'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { getBillingUnit, isGasBillingItem } from '@/domain/billing-modes'
import { isOnOrBeforeDay } from '@/domain/financial-math'
import { BILL_PREVIEW_CARD_CLASS, BILL_PRINT_JPEG_QUALITY_DOWNLOAD } from '@/lib/bill-print-export'
import { BILL_JPEG_OUTPUT_WIDTH_PX } from '@/lib/image-export-config'
import { formatCompanyName, formatCustomerDisplayName } from '@/lib/customer-display'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { buildPartyStatementLedger } from '@/lib/exports/party-statement-ledger'
import { buildPartyStatementViewModel, type PartyStatementViewModel } from '@/lib/exports/party-statement-presenter'
import { createXlsxBlob, inferSheetColumns, type CellValue, type SheetSpec } from '@/lib/exports/xlsx-workbook'
import { getBookRange } from '@/domain/bill-books'
import { formatInQty, formatInrInteger } from '@/lib/inr-format'
import {
  buildMonthlyExportReport,
  buildOutstandingReport,
  buildRateAnalysisReport,
  buildSalesExportReport,
  deriveReportDefaults,
  type ExportBill,
  type ExportCustomer,
  type ExportItem,
  type ExportLine,
  type ExportPayment,
  type MonthlyExportReport,
  type OutstandingStatus,
  type SalesGroupBy,
  type SalesItemType,
} from '@/domain/export-report-builders'

export const Route = createFileRoute('/export-reports')({
  component: ExportReportsPage,
})

type CsvFile = { filename: string; content: string }
type PBRecord = Record<string, unknown> & { id: string }
type ReportKind = 'party' | 'monthly' | 'sales' | 'rates' | 'outstanding' | 'book'
type DatePreset = 'thisMonth' | 'lastMonth' | 'thisFy' | 'custom'
type ReportPreview = {
  title: string
  subtitle: string
  slug: string
  columns: string[]
  rows: string[][]
  summary: Array<{ label: string; value: string }>
  csvRows?: string[][]
  statementViewModel?: PartyStatementViewModel
}

const SECONDARY_EXPORTS: Array<{ id: Exclude<ReportKind, 'party'>; title: string; subtitle: string; icon: ReactNode }> = [
  { id: 'book', title: 'Book Download', subtitle: 'Download one whole bill book as a ZIP of PDFs.', icon: <BookOpen size={16} /> },
]

const EXPORTS_PAGE_SECTIONS = ['party-statement', 'monthly-summary', 'sales-register', 'rate-analysis', 'outstanding', 'more-exports'] as const
const PRIMARY_STATEMENT_ACTIONS = ['download-pdf', 'download-excel', 'download-csv', 'download-package'] as const

async function loadPdfTools() {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  return { jsPDF, autoTable: autoTableModule.default }
}

async function loadZip() {
  return (await import('jszip')).default
}

async function loadCreateRoot(): Promise<(container: Element | DocumentFragment) => Root> {
  return (await import('react-dom/client')).createRoot
}

async function loadExportNodeAsJpgBlob() {
  return (await import('@/lib/image-export')).exportNodeAsJpgBlob
}

export function getExportsPageSectionsForTest() {
  return [...EXPORTS_PAGE_SECTIONS]
}

export function getPrimaryPartyStatementActionsForTest() {
  return [...PRIMARY_STATEMENT_ACTIONS]
}

export function getSecondaryExportIdsForTest() {
  return SECONDARY_EXPORTS.map((item) => item.id)
}

function ExportReportsPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [reportKind, setReportKind] = useState<ReportKind>('party')
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [fromDate, setFromDate] = useState(monthBounds(today.slice(0, 7)).start)
  const [toDate, setToDate] = useState(today)
  const [partyId, setPartyId] = useState('')
  const [bookNoInput, setBookNoInput] = useState('')
  const [includeBillItems] = useState(true)
  const [includePartyBills, setIncludePartyBills] = useState(true)
  const [salesPartyId, setSalesPartyId] = useState('')
  const [salesItemId, setSalesItemId] = useState('')
  const [salesItemType, setSalesItemType] = useState<SalesItemType>('all')
  const [salesGroupBy, setSalesGroupBy] = useState<SalesGroupBy>('bill')
  const [outstandingStatus, setOutstandingStatus] = useState<OutstandingStatus>('positive')
  const [statusText, setStatusText] = useState('')

  const optionsQuery = useQuery({
    queryKey: ['export-reports-options'],
    queryFn: async () => {
      const [customersRaw, billsRaw] = await Promise.all([
        pb.collection('customers').getFullList({ sort: 'company_name,name' }),
        pb.collection('bills').getFullList({ sort: '-date,-bill_no' }),
      ])
      return { customers: customersRaw as PBRecord[], bills: billsRaw as PBRecord[] }
    },
  })
  const needsSnapshot = true
  const snapshotQuery = useQuery({
    queryKey: ['export-reports-snapshot'],
    queryFn: buildBackupSnapshot,
    enabled: needsSnapshot,
  })
  const snapshot = snapshotQuery.data
  const customers = useMemo(() => (optionsQuery.data?.customers ?? []).filter((row) => row.active !== false).sort((a, b) => displayCustomer(a).localeCompare(displayCustomer(b))), [optionsQuery.data?.customers])
  const bookOptions = useMemo(() => buildBookOptions(optionsQuery.data?.bills), [optionsQuery.data?.bills])
  const selectedParty = customers.find((row) => row.id === partyId)
  const dateRange = useMemo(() => resolveDateRange(datePreset, month, fromDate, toDate, today), [datePreset, month, fromDate, toDate, today])
  const partyPreview = useMemo<ReportPreview | null>(() => (snapshot && partyId ? buildPreview(snapshot, 'party', { partyId, bookNo: bookNoInput, dateRange, includeBillItems }) : null), [snapshot, partyId, bookNoInput, dateRange, includeBillItems])
  const activePreview = useMemo<ReportPreview | null>(() => {
    return snapshot && (reportKind === 'party' || reportKind === 'sales' || reportKind === 'book') ? buildPreview(snapshot, reportKind, { partyId, bookNo: bookNoInput, dateRange, includeBillItems }) : null
  }, [snapshot, reportKind, partyId, bookNoInput, dateRange, includeBillItems])
  const normalizedReportData = useMemo(() => snapshot ? normalizeReportData(snapshot) : null, [snapshot])
  const reportDefaults = useMemo(() => normalizedReportData ? deriveReportDefaults(normalizedReportData.bills) : null, [normalizedReportData])
  useEffect(() => {
    if (!reportDefaults?.customerId) return
    setPartyId((current) => current || reportDefaults.customerId)
    setMonth((current) => current === today.slice(0, 7) ? reportDefaults.month : current)
  }, [reportDefaults, today])
  const monthlyReport = useMemo(() => normalizedReportData ? buildMonthlyExportReport({ month, ...normalizedReportData }) : null, [month, normalizedReportData])
  const salesReport = useMemo(() => normalizedReportData ? buildSalesExportReport({
    from: dateRange.start,
    to: dateRange.end,
    customerId: salesPartyId,
    itemId: salesItemId,
    itemType: salesItemType,
    groupBy: salesGroupBy,
    bills: normalizedReportData.bills,
    lines: normalizedReportData.lines,
    customers: normalizedReportData.customers,
    items: normalizedReportData.items,
  }) : null, [dateRange.end, dateRange.start, normalizedReportData, salesGroupBy, salesItemId, salesItemType, salesPartyId])
  const rateReport = useMemo(() => normalizedReportData ? buildRateAnalysisReport({ from: dateRange.start, to: dateRange.end, customerId: salesPartyId, itemId: salesItemId, bills: normalizedReportData.bills, lines: normalizedReportData.lines, items: normalizedReportData.items }) : null, [dateRange.end, dateRange.start, normalizedReportData, salesItemId, salesPartyId])
  const outstandingReport = useMemo(() => normalizedReportData ? buildOutstandingReport({ asOf: toDate, customerId: salesPartyId, status: outstandingStatus, customers: normalizedReportData.customers, bills: normalizedReportData.bills, lines: normalizedReportData.lines, payments: normalizedReportData.payments }) : null, [normalizedReportData, outstandingStatus, salesPartyId, toDate])
  const isInitialLoading = optionsQuery.isLoading
  const isReportLoading = needsSnapshot && snapshotQuery.isLoading
  const isReportError = optionsQuery.isError || snapshotQuery.isError

  function downloadCsvReport(targetPreview = activePreview) {
    const preview = targetPreview
    if (!preview) return
    downloadCsv({ filename: `${preview.slug}.csv`, content: toCsv(preview.csvRows ?? [preview.columns, ...preview.rows]) })
  }

  function downloadExcelReport(targetPreview = activePreview) {
    void downloadExcelReportAsync(targetPreview)
  }

  async function downloadExcelReportAsync(targetPreview = activePreview) {
    const preview = targetPreview
    if (!preview) return
    // csvRows carry unformatted values where a report provides them.
    const [headers, ...rows] = preview.csvRows ?? [preview.columns, ...preview.rows]
    const blob = await createXlsxBlob([
      {
        name: 'Report',
        totalsLabel: 'Total',
        columns: inferSheetColumns(headers ?? preview.columns, rows),
        rows,
      },
    ])
    downloadBlob(`${preview.slug}.xlsx`, blob)
  }

  function downloadPdfReport(targetPreview = activePreview, targetKind = reportKind) {
    void downloadPdfReportAsync(targetPreview, targetKind)
  }

  async function downloadPdfReportAsync(targetPreview = activePreview, targetKind = reportKind) {
    const preview = targetPreview
    if (!snapshot || !preview) return
    if (targetKind === 'party' && preview.statementViewModel) {
      const { createPartyStatementPdf } = await import('@/lib/exports/report-pdf')
      const doc = await createPartyStatementPdf(preview.statementViewModel)
      doc.save(`${preview.slug}.pdf`)
      return
    }
    const doc = await createReportPdf(preview.title, preview.subtitle, preview.columns, preview.rows, preview.summary)
    doc.save(`${preview.slug}.pdf`)
  }

  async function downloadPartyZip() {
    if (!snapshot || !selectedParty) return
    const packageData = buildPartyPackage(snapshot, selectedParty.id, dateRange, includeBillItems)
    if (!packageData) {
      setStatusText('Select a party with ledger data first.')
      return
    }

    setStatusText(`Preparing ZIP package: summaries, CSV, Excel${includePartyBills ? `, and ${packageData.bills.length} bill files` : ''}...`)
    const JSZip = await loadZip()
    const zip = new JSZip()
    const billsFolder = zip.folder('Bills') ?? zip
    const paymentsFolder = zip.folder('Payments') ?? zip
    zip.folder('Documents')

    billsFolder.file('Bills_Summary.pdf', (await createReportPdf('Bills Summary', packageData.subtitle, packageData.billSummaryColumns, packageData.billSummaryRows, packageData.billSummary)).output('arraybuffer'))
    billsFolder.file('Bills_Data.csv', toCsv(packageData.billCsvRows))
    paymentsFolder.file('Payments_Summary.pdf', (await createReportPdf('Payments Received', packageData.subtitle, packageData.paymentSummaryColumns, packageData.paymentSummaryRows, packageData.paymentSummary)).output('arraybuffer'))
    paymentsFolder.file('Payments_Data.csv', toCsv(packageData.paymentCsvRows))
    zip.file('Party_Statement.pdf', (await createReportPdf(packageData.statementTitle, packageData.subtitle, packageData.statementColumns, packageData.statementRows, packageData.statementSummary)).output('arraybuffer'))
    zip.file('Complete_Report.xlsx', await createPartyWorkbook(packageData))
    zip.file('README.txt', buildPartyReadme(packageData, includePartyBills))

    if (includePartyBills) {
      const billImagesFolder = billsFolder.folder('Images') ?? billsFolder
      const billPdfsFolder = billsFolder.folder('PDFs') ?? billsFolder
      for (const [index, bill] of packageData.bills.entries()) {
        setStatusText(`Rendering bill ${index + 1} of ${packageData.bills.length}...`)
        const jpg = await createBillJpgBlob(snapshot, bill)
        const filename = partyBillFilename(bill)
        billImagesFolder.file(`${filename}.jpg`, jpg)
        billPdfsFolder.file(`${filename}.pdf`, await createBillPdfBlob(jpg))
      }
    }

    setStatusText('Compressing ZIP package...')
    const blob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(packageData.zipFilename, blob)
    setStatusText(`Downloaded ${packageData.zipFilename}`)
  }

  async function downloadBookZip() {
    if (!snapshot) return
    const bookNo = Number(bookNoInput)
    if (!Number.isFinite(bookNo) || bookNo <= 0) {
      setStatusText('Enter a valid book number first.')
      return
    }
    const bills = snapshot.data.bills.filter((bill) => num(bill.book_no) === bookNo).sort(compareBillNo)
    if (bills.length === 0) {
      setStatusText(`No bills found in book ${bookNo}.`)
      return
    }

    setStatusText(`Preparing ${bills.length} print-layout bills and book CSV for book ${bookNo}...`)
    const JSZip = await loadZip()
    const zip = new JSZip()
    const billsFolder = zip.folder('Bills') ?? zip
    const imageFolder = billsFolder.folder('Images') ?? billsFolder
    const pdfFolder = billsFolder.folder('PDFs') ?? billsFolder
    zip.file(`Book_${bookNo}_Summary.xlsx`, await createXlsxBlob(buildBookWorkbookSheets(snapshot, bills, bookNo)))
    zip.file(`Book_${bookNo}_Register.pdf`, (await createReportPdf(`Book ${bookNo} Register`, `${bills.length} bills`, ['Date', 'Bill', 'Party', 'Amount', 'Details'], buildBookRegisterRows(snapshot, bills), [{ label: 'Bills', value: String(bills.length) }])).output('arraybuffer'))
    billsFolder.file(`Book_${bookNo}_Details.csv`, buildBookDetailsCsv(snapshot, bills))
    for (const bill of bills) {
      const jpg = await createBillJpgBlob(snapshot, bill)
      const filename = partyBillFilename(bill)
      imageFolder.file(`${filename}.jpg`, jpg)
      pdfFolder.file(`${filename}.pdf`, await createBillPdfBlob(jpg))
    }
    const readme = [`Kapil Products`, `Book ${bookNo}`, `${bills.length} bill JPG files using Print Bill layout`, `${bills.length} bill PDF files`, `1 book CSV detail file`, `Generated: ${new Date().toLocaleString()}`].join('\n')
    zip.file('README.txt', readme)
    const blob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(`Book_${bookNo}_${readableDate(datePart(bills[0]?.date ?? getLocalIsoDate()))}.zip`, blob)
    setStatusText(`Book ${bookNo} ZIP downloaded with ${bills.length} Print Bill JPG/PDF files.`)
  }

  async function downloadMonthlyPdf() {
    if (!monthlyReport) return
    const doc = await createReportPdf(
      `Monthly Report · ${formatMonthYear(monthlyReport.month)}`,
      'Kapil Products · selling and collection performance',
      ['Date', 'Invoice Sales', 'Collections', 'Gas Kg', 'Sell Rate', 'Market', 'Premium'],
      monthlyReport.dailyRows.map((row) => [
        formatFullDate(row.date),
        formatInrInteger(row.invoiceSales),
        formatInrInteger(row.collections),
        formatNumber(row.gasKg),
        formatOptionalRate(row.sellingRate),
        formatOptionalRate(row.marketRate),
        formatOptionalSignedRate(row.premiumPerKg),
      ]),
      monthlySummaryCards(monthlyReport.summary),
    )
    doc.save(`monthly-report-${monthlyReport.month}.pdf`)
  }

  async function downloadMonthlyExcel() {
    if (!monthlyReport) return
    const blob = await createXlsxBlob(monthlyWorkbookSheets(monthlyReport))
    downloadBlob(`monthly-report-${monthlyReport.month}.xlsx`, blob)
  }

  async function downloadMonthlyCsvPackage() {
    if (!monthlyReport) return
    const JSZip = await loadZip()
    const zip = new JSZip()
    zip.file('Summary.csv', toCsv([
      ['Metric', 'Value'],
      ...monthlySummaryCards(monthlyReport.summary).map((row) => [row.label, row.value]),
    ]))
    zip.file('Items.csv', toCsv([
      ['Item', 'Sales', 'Kg', 'Bags', 'Selling Rate', 'Market Rate', 'Premium'],
      ...monthlyReport.itemRows.map((row) => [row.itemName, row.sales, row.kg, row.bags, row.weightedSellingRate ?? '', row.weightedMarketRate ?? '', row.premiumPerKg ?? '']),
    ]))
    zip.file('Customers.csv', toCsv([
      ['Customer', 'Sales', 'Share %', 'Kg', 'Bags', 'Bills', 'Selling Rate', 'Premium'],
      ...monthlyReport.customerRows.map((row) => [row.customerName, row.sales, row.salesSharePct, row.kg, row.bags, row.billCount, row.weightedSellingRate ?? '', row.premiumPerKg ?? '']),
    ]))
    zip.file('Daily.csv', toCsv([
      ['Date', 'Invoice Sales', 'Collections', 'Gas Sales', 'Gas Kg', 'Gas Bags', 'Selling Rate', 'Market Rate', 'Premium'],
      ...monthlyReport.dailyRows.map((row) => [row.date, row.invoiceSales, row.collections, row.gasSales, row.gasKg, row.gasBags, row.sellingRate ?? '', row.marketRate ?? '', row.premiumPerKg ?? '']),
    ]))
    downloadBlob(`monthly-report-${monthlyReport.month}-csv.zip`, await zip.generateAsync({ type: 'blob' }))
  }

  async function downloadSalesPdf() {
    if (!salesReport) return
    const doc = await createReportPdf(
      'Sales Report',
      dateRange.label,
      ['Group', 'Bills', 'Item Sales', 'Qty', 'Bags', 'Avg Gas Rate'],
      salesReport.groupRows.map((row) => [row.label, String(row.invoiceCount), formatInrInteger(row.itemSales), formatNumber(row.quantity), formatNumber(row.bags), formatOptionalRate(row.weightedSellingRate)]),
      salesSummaryCards(salesReport.summary),
    )
    doc.save(`sales-report-${dateRange.start}-to-${dateRange.end}.pdf`)
  }

  async function downloadSalesExcel() {
    if (!salesReport) return
    const blob = await createXlsxBlob(salesWorkbookSheets(salesReport, dateRange.label))
    downloadBlob(`sales-report-${dateRange.start}-to-${dateRange.end}.xlsx`, blob)
  }

  function downloadSalesCsv() {
    if (!salesReport) return
    downloadCsv({
      filename: `sales-report-${dateRange.start}-to-${dateRange.end}.csv`,
      content: toCsv([salesDetailHeaders(), ...salesReport.detailRows.map(salesDetailValues)]),
    })
  }

  async function downloadSimpleAnalysis(kind: 'rates' | 'outstanding', format: 'pdf' | 'xlsx' | 'csv') {
    const isRates = kind === 'rates'
    const headers = isRates
      ? ['Party', 'Item', 'Sales', 'Kg', 'Bags', 'Avg Sell', 'Avg Market', 'Premium', 'Min Rate', 'Max Rate']
      : ['Party', 'Opening', 'Bills', 'Payments', 'Balance', 'Oldest Activity', 'Ageing']
    const rows: CellValue[][] = isRates
      ? (rateReport?.rows ?? []).map((row) => [row.customerName, row.itemName, row.gasSales, row.gasKg, row.gasBags, row.weightedSellingRate, row.weightedMarketRate, row.premiumPerKg, row.minSellingRate, row.maxSellingRate])
      : (outstandingReport?.rows ?? []).map((row) => [row.customerName, row.openingBalance, row.billedAmount, row.payments, row.closingBalance, row.oldestActivityDate, row.ageingBand])
    const slug = isRates ? `rate-analysis-${dateRange.start}-to-${dateRange.end}` : `outstanding-as-of-${toDate}`
    if (format === 'csv') return downloadCsv({ filename: `${slug}.csv`, content: toCsv([headers, ...rows]) })
    if (format === 'xlsx') {
      const blob = await createXlsxBlob([{ name: isRates ? 'Rate Analysis' : 'Outstanding', columns: inferSheetColumns(headers, rows), rows }])
      return downloadBlob(`${slug}.xlsx`, blob)
    }
    const displayRows = rows.map((row) => row.map((cell) => typeof cell === 'number' ? formatNumber(cell) : String(cell ?? '')))
    const doc = await createReportPdf(isRates ? 'Rate Analysis' : 'Outstanding Balances', isRates ? dateRange.label : `As of ${formatFullDate(toDate)}`, headers, displayRows, isRates ? rateSummaryCards(rateReport?.summary) : outstandingSummaryCards(outstandingReport?.summary))
    doc.save(`${slug}.pdf`)
  }

  return (
    <div className="w-full space-y-5 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {isInitialLoading && <ExportSurface><p className="text-sm text-slate-500">Preparing report options...</p></ExportSurface>}
      {isReportError && <ExportSurface><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-red-800">Report data could not load.</p><p className="mt-1 text-xs text-red-600">Check the connection, then try again.</p></div><button type="button" className={secondaryButtonClass} onClick={() => { void optionsQuery.refetch(); void snapshotQuery.refetch() }}>Retry</button></div></ExportSurface>}

      {!isInitialLoading && !isReportError && (
        <>
          <DocumentStudioHeader reportKind={reportKind} onChange={setReportKind} />

          {reportKind === 'party' ? <ReportWorkspace
            eyebrow="Party statement"
            title={selectedParty ? displayCustomer(selectedParty) : 'Select a party'}
            subtitle={dateRange.label}
            filters={<>
              <Field label="Party"><select className={inputClass} value={partyId} onChange={(event) => setPartyId(event.target.value)}><option value="">Select party</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{displayCustomer(customer)}</option>)}</select></Field>
              <Field label="Period"><select className={inputClass} value={datePreset} onChange={(event) => setDatePreset(event.target.value as DatePreset)}><option value="thisMonth">Selected month</option><option value="lastMonth">Previous month</option><option value="thisFy">This financial year</option><option value="custom">Custom range</option></select></Field>
              {datePreset !== 'custom' && datePreset !== 'thisFy' ? <Field label="Month"><input className={inputClass} type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field> : null}
              {datePreset === 'custom' ? <><Field label="From"><input className={inputClass} type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field><Field label="To"><input className={inputClass} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field></> : null}
              <label className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={includePartyBills} onChange={(event) => setIncludePartyBills(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-blue-600" /> Bill files in package</label>
            </>}
            actions={<><button type="button" className={primaryButtonClass} onClick={() => downloadPdfReport(partyPreview, 'party')} disabled={isReportLoading || !partyPreview?.rows.length}><FileText size={14} /> PDF</button><button type="button" className={secondaryButtonClass} onClick={() => downloadExcelReport(partyPreview)} disabled={!partyPreview?.rows.length}><FileSpreadsheet size={14} /> Excel</button><button type="button" className={secondaryButtonClass} onClick={() => downloadCsvReport(partyPreview)} disabled={!partyPreview?.rows.length}><Download size={14} /> CSV</button><button type="button" className={secondaryButtonClass} onClick={() => void downloadPartyZip()} disabled={!selectedParty}><FileArchive size={14} /> Full Package</button></>}
            summary={partyPreview?.summary ?? []}
          >
            {isReportLoading ? <PreviewEmpty>Loading statement data…</PreviewEmpty> : <PartyStatementPreview
              title={partyPreview?.title ?? 'Party Statement Preview'}
              subtitle={partyPreview?.subtitle ?? 'Select a party and period to preview the statement.'}
              summary={partyPreview?.summary ?? []}
              contextLine={selectedParty && partyPreview ? `Showing statement for ${displayCustomer(selectedParty)} · Period: ${dateRange.label}` : undefined}
              columns={partyPreview?.columns ?? []}
              rows={partyPreview?.rows ?? []}
              emptyMessage="No statement entries match this period. Choose another month or date range."
            />}
          </ReportWorkspace> : null}

          {reportKind === 'monthly' ? (
            <ReportWorkspace
              eyebrow="Monthly report"
              title={monthlyReport ? formatMonthYear(monthlyReport.month) : 'Monthly selling report'}
              subtitle="A shareable view of sales, collections, gas volume, and selling rate."
              filters={
                <Field label="Month">
                  <input className={inputClass} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
                </Field>
              }
              actions={
                <>
                  <button type="button" className={primaryButtonClass} onClick={() => void downloadMonthlyPdf()} disabled={!monthlyReport || monthlyReport.dailyRows.length === 0}><FileText size={14} /> PDF</button>
                  <button type="button" className={secondaryButtonClass} onClick={() => void downloadMonthlyExcel()} disabled={!monthlyReport}><FileSpreadsheet size={14} /> Excel</button>
                  <button type="button" className={secondaryButtonClass} onClick={() => void downloadMonthlyCsvPackage()} disabled={!monthlyReport}><FileArchive size={14} /> CSV package</button>
                </>
              }
              summary={monthlyReport ? monthlySummaryCards(monthlyReport.summary) : []}
            >
              {monthlyReport ? <MonthlyReportPreview report={monthlyReport} /> : <PreviewEmpty>Preparing the monthly report...</PreviewEmpty>}
            </ReportWorkspace>
          ) : null}

          {reportKind === 'sales' ? (
            <ReportWorkspace
              eyebrow="Sales report"
              title="Sales activity"
              subtitle={dateRange.label}
              filters={
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Field label="Period">
                    <select className={inputClass} value={datePreset} onChange={(event) => setDatePreset(event.target.value as DatePreset)}>
                      <option value="thisMonth">This month</option>
                      <option value="lastMonth">Last month</option>
                      <option value="thisFy">This financial year</option>
                      <option value="custom">Custom range</option>
                    </select>
                  </Field>
                  {datePreset !== 'custom' && datePreset !== 'thisFy' ? <Field label="Month"><input className={inputClass} type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field> : null}
                  {datePreset === 'custom' ? <><Field label="From"><input className={inputClass} type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field><Field label="To"><input className={inputClass} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field></> : null}
                  <Field label="Party"><select className={inputClass} value={salesPartyId} onChange={(event) => setSalesPartyId(event.target.value)}><option value="">All parties</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{displayCustomer(customer)}</option>)}</select></Field>
                  <Field label="Item"><select className={inputClass} value={salesItemId} onChange={(event) => setSalesItemId(event.target.value)}><option value="">All items</option>{normalizedReportData?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                  <Field label="Type"><select className={inputClass} value={salesItemType} onChange={(event) => setSalesItemType(event.target.value as SalesItemType)}><option value="all">All types</option><option value="gas">Gas</option><option value="electronic">Electronic</option></select></Field>
                  <Field label="Group by"><select className={inputClass} value={salesGroupBy} onChange={(event) => setSalesGroupBy(event.target.value as SalesGroupBy)}><option value="bill">Bill</option><option value="customer">Customer</option><option value="item">Item</option><option value="day">Day</option></select></Field>
                </div>
              }
              actions={
                <>
                  <button type="button" className={primaryButtonClass} onClick={() => void downloadSalesPdf()} disabled={!salesReport || salesReport.groupRows.length === 0}><FileText size={14} /> PDF</button>
                  <button type="button" className={secondaryButtonClass} onClick={() => void downloadSalesExcel()} disabled={!salesReport}><FileSpreadsheet size={14} /> Excel</button>
                  <button type="button" className={secondaryButtonClass} onClick={downloadSalesCsv} disabled={!salesReport}><Download size={14} /> CSV</button>
                </>
              }
              summary={salesReport ? salesSummaryCards(salesReport.summary) : []}
            >
              {salesReport ? <SalesReportPreview report={salesReport} /> : <PreviewEmpty>Preparing the sales report...</PreviewEmpty>}
            </ReportWorkspace>
          ) : null}

          {reportKind === 'rates' ? <ReportWorkspace
            eyebrow="Rate analysis"
            title="Selling rate versus market"
            subtitle={dateRange.label}
            filters={<><CommonPeriodFilters datePreset={datePreset} setDatePreset={setDatePreset} month={month} setMonth={setMonth} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} /><Field label="Party"><select className={inputClass} value={salesPartyId} onChange={(event) => setSalesPartyId(event.target.value)}><option value="">All parties</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{displayCustomer(customer)}</option>)}</select></Field><Field label="Gas item"><select className={inputClass} value={salesItemId} onChange={(event) => setSalesItemId(event.target.value)}><option value="">All gas items</option>{normalizedReportData?.items.filter((item) => item.type === 'gas').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></>}
            actions={<AnalysisActions onDownload={(format) => void downloadSimpleAnalysis('rates', format)} disabled={!rateReport?.rows.length} />}
            summary={rateSummaryCards(rateReport?.summary)}
          >
            {rateReport?.rows.length ? <ReportTable title="Party and item rates" columns={['Party', 'Item', 'Sales', 'Kg', 'Bags', 'Avg Sell', 'Market', 'Premium', 'Low', 'High']} rows={rateReport.rows.map((row) => [row.customerName, row.itemName, formatInrInteger(row.gasSales), formatNumber(row.gasKg), formatNumber(row.gasBags), formatOptionalRate(row.weightedSellingRate), formatOptionalRate(row.weightedMarketRate), formatOptionalSignedRate(row.premiumPerKg), formatOptionalRate(row.minSellingRate), formatOptionalRate(row.maxSellingRate)])} /> : <PreviewEmpty>No gas rate data matches these filters. Try another period, party, or item.</PreviewEmpty>}
          </ReportWorkspace> : null}

          {reportKind === 'outstanding' ? <ReportWorkspace
            eyebrow="Outstanding"
            title="Party balances"
            subtitle={`As of ${formatFullDate(toDate)}`}
            filters={<><Field label="As of"><input className={inputClass} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field><Field label="Party"><select className={inputClass} value={salesPartyId} onChange={(event) => setSalesPartyId(event.target.value)}><option value="">All parties</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{displayCustomer(customer)}</option>)}</select></Field><Field label="Show"><select className={inputClass} value={outstandingStatus} onChange={(event) => setOutstandingStatus(event.target.value as OutstandingStatus)}><option value="positive">Outstanding only</option><option value="overdue">Older than 30 days</option><option value="all">All non-zero balances</option></select></Field></>}
            actions={<AnalysisActions onDownload={(format) => void downloadSimpleAnalysis('outstanding', format)} disabled={!outstandingReport?.rows.length} />}
            summary={outstandingSummaryCards(outstandingReport?.summary)}
          >
            {outstandingReport?.rows.length ? <ReportTable title="Customer balances" columns={['Party', 'Opening', 'Bills', 'Payments', 'Balance', 'Oldest', 'Ageing']} rows={outstandingReport.rows.map((row) => [row.customerName, formatInrInteger(row.openingBalance), formatInrInteger(row.billedAmount), formatInrInteger(row.payments), formatInrInteger(row.closingBalance), row.oldestActivityDate ? formatFullDate(row.oldestActivityDate) : '—', row.ageingBand])} /> : <PreviewEmpty>No party balances match this view.</PreviewEmpty>}
          </ReportWorkspace> : null}

          {isReportLoading && <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-sm" role="status">Preparing selected export data...</p>}
          {statusText && <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-sm" role="status">{statusText}</p>}

          <details className="group rounded-xl border border-slate-200 bg-white shadow-sm" open={reportKind === 'book'}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
              <span><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Bulk bill files</span><span className="mt-0.5 block text-sm font-semibold text-slate-900">Download one complete bill book</span></span>
              <BookOpen size={18} className="text-slate-500" />
            </summary>
            <div className="border-t border-slate-200 p-4 sm:p-5">
              <CompactExportCard title="Book Download" subtitle="Register, workbook, CSV, and every bill as JPG and PDF.">
                <Field label="Book No">
                  <select className={inputClass} value={bookNoInput} onChange={(event) => {
                    setBookNoInput(event.target.value)
                    setReportKind('book')
                  }}>
                    <option value="">Select book</option>
                    {bookOptions.map((book) => (
                      <option key={book.bookNo} value={book.bookNo}>Book {book.bookNo} - {book.count} bills ({book.fromDate} to {book.toDate})</option>
                    ))}
                  </select>
                </Field>
                <div className="mt-3">{reportKind === 'book' && <BookPreview snapshot={snapshot} bookNo={bookNoInput} />}</div>
                <button type="button" className={`${primaryButtonClass} mt-3`} onClick={() => void downloadBookZip()} disabled={isReportLoading || !snapshot || !bookNoInput.trim()}>
                  <FileArchive size={14} /> Download Book ZIP
                </button>
              </CompactExportCard>
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function AnalysisActions({ onDownload, disabled }: { onDownload: (format: 'pdf' | 'xlsx' | 'csv') => void; disabled: boolean }) {
  return <><button type="button" className={primaryButtonClass} onClick={() => onDownload('pdf')} disabled={disabled}><FileText size={14} /> PDF</button><button type="button" className={secondaryButtonClass} onClick={() => onDownload('xlsx')} disabled={disabled}><FileSpreadsheet size={14} /> Excel</button><button type="button" className={secondaryButtonClass} onClick={() => onDownload('csv')} disabled={disabled}><Download size={14} /> CSV</button></>
}

function CommonPeriodFilters({ datePreset, setDatePreset, month, setMonth, fromDate, setFromDate, toDate, setToDate }: { datePreset: DatePreset; setDatePreset: (value: DatePreset) => void; month: string; setMonth: (value: string) => void; fromDate: string; setFromDate: (value: string) => void; toDate: string; setToDate: (value: string) => void }) {
  return <><Field label="Period"><select className={inputClass} value={datePreset} onChange={(event) => setDatePreset(event.target.value as DatePreset)}><option value="thisMonth">Selected month</option><option value="lastMonth">Previous month</option><option value="thisFy">This financial year</option><option value="custom">Custom range</option></select></Field>{datePreset !== 'custom' && datePreset !== 'thisFy' ? <Field label="Month"><input className={inputClass} type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field> : null}{datePreset === 'custom' ? <><Field label="From"><input className={inputClass} type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field><Field label="To"><input className={inputClass} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field></> : null}</>
}

function DocumentStudioHeader({ reportKind, onChange }: { reportKind: ReportKind; onChange: (kind: ReportKind) => void }) {
  const tabs: Array<{ id: Exclude<ReportKind, 'book'>; label: string; detail: string; icon: ReactNode }> = [
    { id: 'party', label: 'Party Statement', detail: 'Customer ledger', icon: <Users size={16} /> },
    { id: 'monthly', label: 'Monthly Summary', detail: 'Selling performance', icon: <BarChart3 size={16} /> },
    { id: 'sales', label: 'Sales Register', detail: 'Invoice and item detail', icon: <ReceiptText size={16} /> },
    { id: 'rates', label: 'Rate Analysis', detail: 'Sell vs market', icon: <Gauge size={16} /> },
    { id: 'outstanding', label: 'Outstanding', detail: 'Party balances', icon: <WalletCards size={16} /> },
  ]
  return (
    <section className="overflow-hidden border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h1 className="text-xl font-bold tracking-tight text-slate-950">Reports</h1><p className="mt-0.5 text-xs text-slate-500">Sales, gas rates, statements, and balances</p></div>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Kapil Products</span>
        </div>
      </div>
      <div className="flex overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 sm:px-4">
        {tabs.map((tab) => {
          const active = reportKind === tab.id
          return <button key={tab.id} type="button" onClick={() => onChange(tab.id)} className={`relative flex shrink-0 items-center gap-2 px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${active ? 'text-blue-800' : 'text-slate-500 hover:text-slate-900'}`}>
            <span className={active ? 'text-blue-700' : 'text-slate-400'}>{tab.icon}</span>
            <span><span className="block whitespace-nowrap text-xs font-bold">{tab.label}</span><span className="hidden whitespace-nowrap text-[10px] opacity-75 lg:block">{tab.detail}</span></span>
            {active ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-blue-700" /> : null}
          </button>
        })}
      </div>
    </section>
  )
}

function ReportWorkspace({ eyebrow, title, subtitle, filters, actions, summary, children }: { eyebrow: string; title: string; subtitle: string; filters: ReactNode; actions: ReactNode; summary: Array<{ label: string; value: string }>; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.08em] text-blue-700">{eyebrow}</p><h2 className="truncate text-base font-bold text-slate-950">{title}</h2><p className="text-xs text-slate-500">{subtitle}</p></div>
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        </div>
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5"><div className="flex flex-wrap items-end gap-3">{filters}</div></div>
        <div className="grid grid-cols-2 gap-px bg-slate-200 md:grid-cols-4">
          {summary.slice(0, 8).map((item) => <div key={item.label} className="bg-slate-50 px-3 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">{item.label}</p><p className="mt-1 truncate font-mono text-sm font-bold tabular-nums text-slate-950" title={item.value}>{item.value}</p></div>)}
        </div>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 sm:px-5"><span className="inline-flex items-center gap-2 text-[11px] font-bold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Live preview</span><span className="text-[11px] text-slate-400">Updates with your filters</span></div>
        <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

function MonthlyReportPreview({ report }: { report: MonthlyExportReport }) {
  const current = report.summary
  const previous = report.previous.summary
  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-3">
        <ComparisonMetric label="Gas kg" current={current.gasKg} previous={previous.gasKg} format={formatNumber} />
        <ComparisonMetric label="Gas sales" current={current.gasSales} previous={previous.gasSales} format={formatInrInteger} />
        <ComparisonMetric label="Avg selling rate" current={current.weightedSellingRate ?? 0} previous={previous.weightedSellingRate ?? 0} format={(value) => formatOptionalRate(value || null)} />
      </div>
      <ReportTable title="Items" columns={['Item', 'Gas Sales', 'Kg', 'Bags', 'Avg Sell', 'Avg Market', 'Premium']} rows={report.itemRows.map((row) => [row.itemName, formatInrInteger(row.sales), formatNumber(row.kg), formatNumber(row.bags), formatOptionalRate(row.weightedSellingRate), formatOptionalRate(row.weightedMarketRate), formatOptionalSignedRate(row.premiumPerKg)])} />
      <ReportTable title="Customers" columns={['Customer', 'Gas Sales', 'Share', 'Kg', 'Bags', 'Bills', 'Avg Sell']} rows={report.customerRows.map((row) => [row.customerName, formatInrInteger(row.sales), `${row.salesSharePct.toFixed(1)}%`, formatNumber(row.kg), formatNumber(row.bags), String(row.billCount), formatOptionalRate(row.weightedSellingRate)])} />
      <ReportTable title="Daily activity" columns={['Date', 'Invoice Sales', 'Collections', 'Gas Kg', 'Sell Rate', 'Premium']} rows={report.dailyRows.map((row) => [formatFullDate(row.date), formatInrInteger(row.invoiceSales), formatInrInteger(row.collections), formatNumber(row.gasKg), formatOptionalRate(row.sellingRate), formatOptionalSignedRate(row.premiumPerKg)])} />
    </div>
  )
}

type SalesReportResult = ReturnType<typeof buildSalesExportReport>

function SalesReportPreview({ report }: { report: SalesReportResult }) {
  return (
    <div className="space-y-5">
      {report.groupRows.length === 0 ? <PreviewEmpty>No sales match these filters.</PreviewEmpty> : null}
      {report.groupRows.length > 0 ? <ReportTable title="Grouped results" columns={['Group', 'Bills', 'Item Sales', 'Qty', 'Bags', 'Avg Gas Rate']} rows={report.groupRows.map((row) => [row.label, String(row.invoiceCount), formatInrInteger(row.itemSales), formatNumber(row.quantity), formatNumber(row.bags), formatOptionalRate(row.weightedSellingRate)])} /> : null}
      {report.detailRows.length > 0 ? <ReportTable title="Bill line detail" columns={['Date', 'Bill', 'Party', 'Item', 'Qty', 'Rate', 'Market', 'Premium', 'Amount']} rows={report.detailRows.slice(0, 100).map((row) => [formatFullDate(row.date), row.billRef, row.customerName, row.itemName, `${formatNumber(row.qty)} ${row.unit}`, formatInrInteger(row.sellingRate), formatOptionalRate(row.marketRate), formatOptionalSignedRate(row.premiumPerKg), formatInrInteger(row.itemAmount)])} footer={report.detailRows.length > 100 ? `Showing first 100 of ${report.detailRows.length} lines. Excel and CSV contain all rows.` : undefined} /> : null}
    </div>
  )
}

function ComparisonMetric({ label, current, previous, format }: { label: string; current: number; previous: number; format: (value: number) => string }) {
  const delta = previous > 0 ? ((current - previous) / previous) * 100 : null
  return <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">{label}</p><p className="mt-1 font-mono text-base font-bold text-slate-950">{format(current)}</p><p className={`mt-1 text-[11px] font-semibold ${delta == null ? 'text-slate-400' : delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{delta == null ? 'No previous-month base' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs previous month`}</p></div>
}

function ReportTable({ title, columns, rows, footer }: { title: string; columns: string[]; rows: string[][]; footer?: string }) {
  return <section><div className="mb-2 flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold text-slate-950">{title}</h3><span className="text-[11px] text-slate-500">{rows.length} rows</span></div><div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[680px] border-collapse text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.05em] text-slate-500"><tr>{columns.map((column, index) => <th key={column} className={`px-3 py-2.5 font-semibold ${index === 0 ? 'text-left' : 'text-right'}`}>{column}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`} className="hover:bg-blue-50/40">{row.map((cell, cellIndex) => <td key={cellIndex} className={`px-3 py-2.5 ${cellIndex === 0 ? 'text-left font-medium text-slate-800' : 'text-right font-mono tabular-nums text-slate-700'}`}>{cell}</td>)}</tr>)}</tbody></table></div>{footer ? <p className="mt-2 text-[11px] text-slate-500">{footer}</p> : null}</section>
}

function PreviewEmpty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">{children}</div>
}

function buildPreview(
  snapshot: BackupSnapshot,
  kind: ReportKind,
  options: { partyId: string; bookNo: string; dateRange: { start: string; end: string; label: string }; includeBillItems: boolean },
): ReportPreview {
  if (kind === 'party') return buildPartyStatement(snapshot, options.partyId, options.dateRange, options.includeBillItems)
  if (kind === 'sales') return buildSalesRegister(snapshot, options.dateRange, options.includeBillItems)
  if (kind === 'book') return buildBookSummary(snapshot, options.bookNo)

  return buildBookSummary(snapshot, options.bookNo)
}

function buildPartyStatement(snapshot: BackupSnapshot, partyId: string, range: { start: string; end: string; label: string }, _includeBillItems: boolean): ReportPreview {
  const customer = snapshot.data.customers.find((row) => row.id === partyId)
  const customerName = customer ? displayCustomer(customer) : 'Party Statement'

  const ledger = buildPartyStatementLedger({
    customer: customer ?? { id: partyId, opening_balance: 0 },
    range,
    bills: snapshot.data.bills,
    billItems: snapshot.data.billItems,
    payments: snapshot.data.payments,
  })

  const statementViewModel = buildPartyStatementViewModel({
    customerDisplayName: customerName,
    rangeLabel: range.label,
    generatedOn: getLocalIsoDate(),
    ledger,
  })

  return {
    title: statementViewModel.title,
    subtitle: statementViewModel.subtitle,
    slug: `party-statement-${safeFilename(customerName)}-${range.start}-to-${range.end}`,
    columns: statementViewModel.columns,
    rows: statementViewModel.rows,
    summary: statementViewModel.summary,
    csvRows: statementViewModel.csvRows,
    statementViewModel,
  }
}

function buildSalesRegister(snapshot: BackupSnapshot, range: { start: string; end: string; label: string }, includeBillItems: boolean) {
  const itemBaseByBill = billItemBaseMap(snapshot.data.billItems)
  const billItemsByBill = groupBy(snapshot.data.billItems, (row) => String(row.bill ?? ''))
  const bills = snapshot.data.bills.filter((bill) => datePart(bill.date) >= range.start && datePart(bill.date) <= range.end).sort(compareBillDate)
  const rows = bills.map((bill) => {
    const total = calculateBillTotalFromBase(itemBaseByBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount))
    return [
      formatFullDate(datePart(bill.date)),
      billRef(bill),
      String(bill.customer_name ?? ''),
      formatInrInteger(itemBaseByBill.get(bill.id) ?? 0),
      formatInrInteger(num(bill.transport)),
      formatInrInteger(num(bill.gst_amount)),
      formatInrInteger(total),
      includeBillItems ? itemDetails(snapshot, billItemsByBill.get(bill.id) ?? []) : String(bill.lr_no ?? ''),
    ]
  })
  const total = bills.reduce((sum, bill) => sum + calculateBillTotalFromBase(itemBaseByBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount)), 0)
  return {
    title: 'Sales Register',
    subtitle: range.label,
    slug: `sales-register-${range.start}-to-${range.end}`,
    columns: ['Date', 'Bill', 'Party', 'Items', 'Transport', 'GST', 'Total', 'Details'],
    rows,
    summary: [
      { label: 'Bills', value: String(bills.length) },
      { label: 'Sales', value: formatInrInteger(total) },
    ],
  }
}

function buildBookSummary(snapshot: BackupSnapshot, bookNoInput: string) {
  const bookNo = Number(bookNoInput)
  const bills = Number.isFinite(bookNo) ? snapshot.data.bills.filter((bill) => num(bill.book_no) === bookNo) : []
  return {
    title: bookNoInput ? `Book ${bookNoInput}` : 'Book Download',
    subtitle: bills.length ? `${bills.length} bills ready for ZIP export.` : 'Enter a book number to see available bills.',
    slug: `book-${bookNoInput || 'export'}`,
    columns: ['Bill', 'Date', 'Party'],
    rows: bills.sort(compareBillNo).map((bill) => [billRef(bill), formatFullDate(datePart(bill.date)), String(bill.customer_name ?? '')]),
    summary: [{ label: 'Bills', value: String(bills.length) }],
  }
}

function buildBookOptions(bills?: PBRecord[]) {
  if (!bills) return []
  const byBook = new Map<number, { bookNo: number; count: number; fromDate: string; toDate: string }>()
  for (const bill of bills) {
    const bookNo = num(bill.book_no)
    if (!bookNo) continue
    const date = datePart(bill.date)
    const current = byBook.get(bookNo) ?? { bookNo, count: 0, fromDate: date, toDate: date }
    current.count += 1
    if (date && (!current.fromDate || date < current.fromDate)) current.fromDate = date
    if (date && (!current.toDate || date > current.toDate)) current.toDate = date
    byBook.set(bookNo, current)
  }
  return [...byBook.values()]
    .sort((a, b) => b.bookNo - a.bookNo)
    .map((book) => ({
      ...book,
      fromDate: formatFullDate(book.fromDate),
      toDate: formatFullDate(book.toDate),
    }))
}

type PartyPackage = {
  customerName: string
  subtitle: string
  periodLabel: string
  generatedLabel: string
  zipFilename: string
  openingBalance: number
  closingBalance: number
  totalBills: number
  totalPayments: number
  totalQty: number
  bills: PBRecord[]
  payments: PBRecord[]
  statementTitle: string
  statementColumns: string[]
  statementRows: string[][]
  statementSummary: Array<{ label: string; value: string }>
  billSummaryColumns: string[]
  billSummaryRows: string[][]
  billSummary: Array<{ label: string; value: string }>
  paymentSummaryColumns: string[]
  paymentSummaryRows: string[][]
  paymentSummary: Array<{ label: string; value: string }>
  billCsvRows: string[][]
  paymentCsvRows: string[][]
  workbookSheets: SheetSpec[]
}

function buildPartyPackage(snapshot: BackupSnapshot, partyId: string, range: { start: string; end: string; label: string }, includeBillItems: boolean): PartyPackage | null {
  const customer = snapshot.data.customers.find((row) => row.id === partyId)
  if (!customer) return null

  const customerName = displayCustomer(customer)
  const generatedLabel = new Date().toLocaleString()
  const itemBaseByBill = billItemBaseMap(snapshot.data.billItems)
  const billItemsByBill = groupBy(snapshot.data.billItems, (row) => String(row.bill ?? ''))
  let opening = num(customer.opening_balance)

  const allEvents = [
    ...snapshot.data.bills
      .filter((bill) => String(bill.customer ?? '') === partyId)
      .map((bill) => {
        const total = billTotal(snapshot, bill)
        return {
          id: bill.id,
          date: datePart(bill.date),
          type: 'Bill',
          ref: billRef(bill),
          debit: total,
          credit: 0,
          details: includeBillItems ? itemDetails(snapshot, billItemsByBill.get(bill.id) ?? []) : String(bill.lr_no ?? ''),
        }
      }),
    ...snapshot.data.payments
      .filter((payment) => String(payment.customer ?? '') === partyId)
      .map((payment) => ({
        id: payment.id,
        date: datePart(payment.date),
        type: 'Payment',
        ref: String(payment.mode ?? ''),
        debit: 0,
        credit: num(payment.amount),
        details: String(payment.note ?? ''),
      })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type))

  for (const event of allEvents.filter((event) => event.date && event.date < range.start)) opening += event.debit - event.credit

  let balance = opening
  const balanceAfterById = new Map<string, number>()
  const rangeEvents = allEvents.filter((event) => event.date >= range.start && event.date <= range.end)
  const statementRows = [['', 'Opening', 'Opening Balance', '', '', formatInrInteger(balance), 'Balance carried forward']]
  // Same statement, but with raw values so Excel gets real dates and numbers.
  const statementSheetRows: CellValue[][] = [['', 'Opening', 'Opening Balance', null, null, balance, 'Balance carried forward']]
  for (const event of rangeEvents) {
    balance += event.debit - event.credit
    balanceAfterById.set(event.id, balance)
    statementRows.push([
      formatFullDate(event.date),
      event.type,
      event.ref,
      event.debit ? formatInrInteger(event.debit) : '',
      event.credit ? formatInrInteger(event.credit) : '',
      formatInrInteger(balance),
      event.details,
    ])
    statementSheetRows.push([
      datePart(event.date),
      event.type,
      event.ref,
      event.debit || null,
      event.credit || null,
      balance,
      event.details,
    ])
  }

  const bills = snapshot.data.bills
    .filter((bill) => String(bill.customer ?? '') === partyId && datePart(bill.date) >= range.start && datePart(bill.date) <= range.end)
    .sort(compareBillDate)
  const payments = snapshot.data.payments
    .filter((payment) => String(payment.customer ?? '') === partyId && datePart(payment.date) >= range.start && datePart(payment.date) <= range.end)
    .sort((a, b) => datePart(a.date).localeCompare(datePart(b.date)))
  const totalBills = bills.reduce((sum, bill) => sum + billTotal(snapshot, bill), 0)
  const totalPayments = payments.reduce((sum, payment) => sum + num(payment.amount), 0)
  const totalGasQty = bills.reduce((sum, bill) => {
    const items = billItemsByBill.get(bill.id) ?? []
    return sum + items
      .filter((item) => isGasBillingItem({ type: String(findSnapshotItem(snapshot, item)?.type ?? '') }))
      .reduce((itemSum, item) => itemSum + num(item.qty), 0)
  }, 0)
  const totalElectronicQty = bills.reduce((sum, bill) => {
    const items = billItemsByBill.get(bill.id) ?? []
    return sum + items
      .filter((item) => !isGasBillingItem({ type: String(findSnapshotItem(snapshot, item)?.type ?? '') }))
      .reduce((itemSum, item) => itemSum + num(item.qty), 0)
  }, 0)
  const totalQty = totalGasQty + totalElectronicQty

  const billSummaryRows = bills.map((bill) => {
    const items = billItemsByBill.get(bill.id) ?? []
    return [
      formatFullDate(datePart(bill.date)),
      billRef(bill),
      itemDetails(snapshot, items) || '-',
      formatExportQty(snapshot, items),
      formatInrInteger(billTotal(snapshot, bill)),
    ]
  })
  const paymentSummaryRows = payments.map((payment) => [
    formatFullDate(datePart(payment.date)),
    String(payment.mode ?? 'Cash') || 'Cash',
    String(payment.note ?? ''),
    formatInrInteger(num(payment.amount)),
    formatInrInteger(balanceAfterById.get(payment.id) ?? 0),
  ])
  const billCsvRows = [
    ['Date', 'Bill Number', 'Reference', 'Item Name', 'Quantity', 'Unit', 'Rate', 'Amount', 'Balance'],
    ...bills.map((bill) => {
      const items = billItemsByBill.get(bill.id) ?? []
      const qty = items.reduce((sum, item) => sum + num(item.qty), 0)
      const base = itemBaseByBill.get(bill.id) ?? 0
      return [
        csvDate(datePart(bill.date)),
        billRef(bill),
        billRef(bill),
        itemDetails(snapshot, items) || 'Items',
        String(qty),
        formatExportUnit(snapshot, items),
        String(qty > 0 ? Math.round(base / qty) : 0),
        String(billTotal(snapshot, bill)),
        String(balanceAfterById.get(bill.id) ?? 0),
      ]
    }),
  ]
  const paymentCsvRows = [
    ['Date', 'Mode', 'Reference', 'Amount', 'Balance After'],
    ...payments.map((payment) => [
      csvDate(datePart(payment.date)),
      String(payment.mode ?? 'Cash') || 'Cash',
      String(payment.note ?? ''),
      String(num(payment.amount)),
      String(balanceAfterById.get(payment.id) ?? 0),
    ]),
  ]
  const periodLabel = `${formatFullDate(range.start)} to ${formatFullDate(range.end)}`
  const workbookSheets: SheetSpec[] = [
    {
      name: 'Summary',
      columns: [
        { header: 'Metric', type: 'text', width: 24 },
        { header: 'Value', type: 'currency', width: 18 },
        { header: 'Note', type: 'text', width: 22 },
      ],
      rows: [
        ['Party', customerName, ''],
        ['Period', periodLabel, ''],
        ['Opening Balance', opening, ''],
        ['Total Bills', totalBills, `${bills.length} bills`],
        ['Total Payments', totalPayments, `${payments.length} payments`],
        ['Net Change', totalBills - totalPayments, ''],
        ['Closing Balance', balance, ''],
        ['Total Quantity Sold', totalQty, ''],
        ['Average Bill Size', bills.length ? Math.round(totalBills / bills.length) : 0, ''],
        ['Average Payment', payments.length ? Math.round(totalPayments / payments.length) : 0, ''],
      ],
    },
    {
      name: 'Bills',
      totalsLabel: `${bills.length} bills`,
      columns: [
        { header: 'Date', type: 'date' },
        { header: 'Bill Number', type: 'text' },
        { header: 'Item Name', type: 'text' },
        { header: 'Quantity', type: 'number', total: true },
        { header: 'Unit', type: 'text' },
        { header: 'Rate', type: 'currency' },
        { header: 'Amount', type: 'currency', total: true },
        { header: 'Balance', type: 'currency' },
      ],
      rows: bills.map((bill) => {
        const items = billItemsByBill.get(bill.id) ?? []
        const qty = items.reduce((sum, item) => sum + num(item.qty), 0)
        const base = itemBaseByBill.get(bill.id) ?? 0
        return [
          datePart(bill.date),
          billRef(bill),
          itemDetails(snapshot, items) || 'Items',
          qty,
          formatExportUnit(snapshot, items),
          qty > 0 ? Math.round(base / qty) : 0,
          billTotal(snapshot, bill),
          balanceAfterById.get(bill.id) ?? 0,
        ]
      }),
    },
    {
      name: 'Payments',
      totalsLabel: `${payments.length} payments`,
      columns: [
        { header: 'Date', type: 'date' },
        { header: 'Mode', type: 'text' },
        { header: 'Reference', type: 'text' },
        { header: 'Amount', type: 'currency', total: true },
        { header: 'Balance After', type: 'currency' },
      ],
      rows: payments.map((payment) => [
        datePart(payment.date),
        String(payment.mode ?? 'Cash') || 'Cash',
        String(payment.note ?? ''),
        num(payment.amount),
        balanceAfterById.get(payment.id) ?? 0,
      ]),
    },
    {
      name: 'Statement',
      totalsLabel: 'Total',
      columns: [
        { header: 'Date', type: 'date' },
        { header: 'Type', type: 'text' },
        { header: 'Ref', type: 'text' },
        { header: 'Debit', type: 'currency', total: true },
        { header: 'Credit', type: 'currency', total: true },
        { header: 'Balance', type: 'currency' },
        { header: 'Details', type: 'text' },
      ],
      rows: statementSheetRows,
    },
    {
      name: 'Analytics',
      columns: [
        { header: 'Metric', type: 'text', width: 22 },
        { header: 'Value', type: 'text', width: 18 },
      ],
      rows: [
        ['Largest Bill', bills.length ? Math.max(...bills.map((bill) => billTotal(snapshot, bill))) : 0],
        ['Smallest Bill', bills.length ? Math.min(...bills.map((bill) => billTotal(snapshot, bill))) : 0],
        ['Collection Rate', totalBills ? `${Math.round((totalPayments / totalBills) * 100)}%` : '0%'],
      ],
    },
  ]

  return {
    customerName,
    subtitle: `Party: ${customerName} | Period: ${periodLabel} | Generated: ${generatedLabel}`,
    periodLabel,
    generatedLabel,
    zipFilename: `${safeReadableFilename(customerName)}_${readableDate(range.start)}_to_${readableDate(range.end)}.zip`,
    openingBalance: opening,
    closingBalance: balance,
    totalBills,
    totalPayments,
    totalQty,
    bills,
    payments,
    statementTitle: `${customerName} Party Statement`,
    statementColumns: ['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance', 'Details'],
    statementRows,
    statementSummary: [
      { label: 'Opening', value: formatInrInteger(opening) },
      { label: 'Bills', value: formatInrInteger(totalBills) },
      { label: 'Payments', value: formatInrInteger(totalPayments) },
      { label: 'Closing', value: formatInrInteger(balance) },
    ],
    billSummaryColumns: ['Date', 'Bill No.', 'Items', 'Qty', 'Amount'],
    billSummaryRows,
    billSummary: [
      { label: 'Total Bills', value: String(bills.length) },
      { label: 'Total Qty', value: formatQtyTotals(totalGasQty, totalElectronicQty) },
      { label: 'Total Amount', value: formatInrInteger(totalBills) },
    ],
    paymentSummaryColumns: ['Date', 'Mode', 'Reference', 'Amount', 'Balance After'],
    paymentSummaryRows,
    paymentSummary: [
      { label: 'Payments', value: String(payments.length) },
      { label: 'Total Received', value: formatInrInteger(totalPayments) },
      { label: 'Average', value: formatInrInteger(payments.length ? totalPayments / payments.length : 0) },
    ],
    billCsvRows,
    paymentCsvRows,
    workbookSheets,
  }
}

async function createReportPdf(title: string, subtitle: string, columns: string[], rows: string[][], summary: Array<{ label: string; value: string }>) {
  const { createSimpleTablePdf } = await import('@/lib/exports/pdf-engine')
  return createSimpleTablePdf({ title, subtitle, columns, rows, summary })
}





function buildBookDetailsCsv(snapshot: BackupSnapshot, bills: PBRecord[]) {
  return toCsv(buildBookCsvRows(snapshot, bills))
}

function buildBookCsvRows(snapshot: BackupSnapshot, bills: PBRecord[]): Array<Array<string | number>> {
  const itemBaseByBill = billItemBaseMap(snapshot.data.billItems)
  const rows: Array<Array<string | number>> = [
    ['Book', 'Bill No', 'Date', 'Party', 'LR No', 'Market Rate', 'Item', 'Qty Kg', 'Bags', 'Rate', 'Amount', 'Transport', 'GST', 'Bill Total'],
  ]
  for (const bill of bills) {
    const items = snapshot.data.billItems.filter((row) => String(row.bill ?? '') === bill.id)
    const base = itemBaseByBill.get(bill.id) ?? 0
    const total = calculateBillTotalFromBase(base, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount))
    if (items.length === 0) {
      rows.push([
        num(bill.book_no),
        num(bill.bill_no),
        datePart(bill.date),
        String(bill.customer_name ?? ''),
        String(bill.lr_no ?? ''),
        num(bill.mkt),
        '',
        '',
        '',
        '',
        '',
        num(bill.transport),
        num(bill.gst_amount),
        total,
      ])
      continue
    }
    for (const item of items) {
      rows.push([
        num(bill.book_no),
        num(bill.bill_no),
        datePart(bill.date),
        String(bill.customer_name ?? ''),
        String(bill.lr_no ?? ''),
        num(bill.mkt),
        String(item.item_name ?? ''),
        num(item.qty),
        num(item.bags),
        num(item.rate),
        num(item.amount),
        num(bill.transport),
        num(bill.gst_amount),
        total,
      ])
    }
  }
  return rows
}

function buildBookWorkbookSheets(snapshot: BackupSnapshot, bills: PBRecord[], bookNo: number): SheetSpec[] {
  const total = bills.reduce((sum, bill) => sum + billTotal(snapshot, bill), 0)
  const parties = new Set(bills.map((bill) => String(bill.customer ?? ''))).size
  const { firstBillNo, lastBillNo } = getBookRange(bookNo)
  // Row 0 of the CSV builders is the header, which the sheet spec supplies itself.
  const detailRows = buildBookCsvRows(snapshot, bills).slice(1)
  const partyRows = buildBookPartyRows(snapshot, bills).slice(1)

  return [
    {
      name: 'Overview',
      columns: [
        { header: 'Metric', type: 'text', width: 20 },
        { header: 'Value', type: 'text', width: 26 },
      ],
      rows: [
        ['Book', bookNo],
        ['Book Range', `${firstBillNo}-${lastBillNo}`],
        ['Total Bills', bills.length],
        ['Total Amount', total],
        ['Parties', parties],
        ['From', bills[0] ? formatFullDate(datePart(bills[0].date)) : ''],
        ['To', bills.at(-1) ? formatFullDate(datePart(bills.at(-1)?.date)) : ''],
      ],
    },
    {
      name: 'Bill Details',
      totalsLabel: 'Total',
      columns: [
        { header: 'Book', type: 'integer' },
        { header: 'Bill No', type: 'integer' },
        { header: 'Date', type: 'date' },
        { header: 'Party', type: 'text' },
        { header: 'LR No', type: 'text' },
        { header: 'Market Rate', type: 'currency' },
        { header: 'Item', type: 'text' },
        { header: 'Qty Kg', type: 'number', total: true },
        { header: 'Bags', type: 'number', total: true },
        { header: 'Rate', type: 'currency' },
        { header: 'Amount', type: 'currency', total: true },
        { header: 'Transport', type: 'currency' },
        { header: 'GST', type: 'currency' },
        // Repeated on every line of a multi-item bill, so summing it would double count.
        { header: 'Bill Total', type: 'currency' },
      ],
      rows: detailRows,
    },
    {
      name: 'Party-wise',
      totalsLabel: 'Total',
      columns: [
        { header: 'Party', type: 'text', width: 28 },
        { header: 'Bills', type: 'integer', total: true },
        { header: 'Amount', type: 'currency', total: true },
      ],
      rows: partyRows,
    },
  ]
}

function buildBookRegisterRows(snapshot: BackupSnapshot, bills: PBRecord[]) {
  const billItemsByBill = groupBy(snapshot.data.billItems, (row) => String(row.bill ?? ''))
  return bills.map((bill) => [
    formatFullDate(datePart(bill.date)),
    billRef(bill),
    String(bill.customer_name ?? ''),
    formatInrInteger(billTotal(snapshot, bill)),
    itemDetails(snapshot, billItemsByBill.get(bill.id) ?? []),
  ])
}

function buildBookPartyRows(snapshot: BackupSnapshot, bills: PBRecord[]): Array<Array<string | number>> {
  const totals = new Map<string, { party: string; bills: number; amount: number }>()
  for (const bill of bills) {
    const customerId = String(bill.customer ?? '')
    const current = totals.get(customerId) ?? { party: String(bill.customer_name ?? 'Unknown'), bills: 0, amount: 0 }
    current.bills += 1
    current.amount += billTotal(snapshot, bill)
    totals.set(customerId, current)
  }
  return [
    ['Party', 'Bills', 'Amount'],
    ...[...totals.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((row) => [row.party, row.bills, row.amount]),
  ]
}

async function createBillJpgBlob(snapshot: BackupSnapshot, bill: PBRecord) {
  const props = buildBillPrintProps(snapshot, bill)
  const [createRoot, exportNodeAsJpgBlob] = await Promise.all([
    loadCreateRoot(),
    loadExportNodeAsJpgBlob(),
  ])
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.width = `${BILL_PRINT_PAGE_WIDTH_CM}cm`
  host.style.background = '#ffffff'
  const card = document.createElement('div')
  card.className = BILL_PREVIEW_CARD_CLASS
  card.style.width = `${BILL_PRINT_PAGE_WIDTH_CM}cm`
  host.appendChild(card)
  document.body.appendChild(host)
  const root = createRoot(card)
  try {
    root.render(<BillPrintLayout {...props} />)
    await waitForRenderFrame()
    return await exportNodeAsJpgBlob(card, {
      quality: BILL_PRINT_JPEG_QUALITY_DOWNLOAD,
      preferredWidthPx: BILL_JPEG_OUTPUT_WIDTH_PX,
    })
  } finally {
    root.unmount()
    host.remove()
  }
}

function buildBillPrintProps(snapshot: BackupSnapshot, selectedBill: PBRecord): BillPrintLayoutProps {
  const selectedDate = datePart(selectedBill.date)
  const customerId = String(selectedBill.customer ?? '')
  const customer = snapshot.data.customers.find((row) => row.id === customerId)
  const allCustomerBills = snapshot.data.bills
    .filter((bill) => String(bill.customer ?? '') === customerId && isOnOrBeforeDay(datePart(bill.date), selectedDate))
    .sort((a, b) => datePart(a.date).localeCompare(datePart(b.date)) || num(a.bill_no) - num(b.bill_no))
  const currentIdx = Math.max(0, allCustomerBills.findIndex((bill) => bill.id === selectedBill.id))
  const itemRows = snapshot.data.billItems
    .filter((item) => String(item.bill ?? '') === selectedBill.id)
    .map((item) => {
      const master = snapshot.data.items.find(
        (row) =>
          row.id === String(item.item ?? '') ||
          String(row.name ?? '').trim().toLowerCase() === String(item.item_name ?? '').trim().toLowerCase(),
      )
      return {
        itemName: String(item.item_name ?? ''),
        qty: num(item.qty),
        rate: num(item.rate),
        amount: num(item.amount),
        bags: num(item.bags),
        type: String(master?.type ?? ''),
        unit: String(master?.unit ?? ''),
        bagWeight: num(master?.bag_weight) || 50,
      }
    })
  const itemBaseTotal = itemRows.reduce((sum, row) => sum + row.amount, 0)
  const gstRate = num(selectedBill.gst_rate)
  const gstAmount = num(selectedBill.gst_amount) > 0 ? num(selectedBill.gst_amount) : (itemBaseTotal * gstRate) / 100
  const transport = num(selectedBill.transport)
  const currentBillTotal = itemBaseTotal + gstAmount + transport
  const opening = num(customer?.opening_balance)

  let previousBalance = opening
  for (let index = 0; index < currentIdx; index += 1) {
    previousBalance += billTotal(snapshot, allCustomerBills[index])
  }
  const previousBillDate = currentIdx > 0 ? datePart(allCustomerBills[currentIdx - 1].date) : 'Opening'
  const paidBeforePrevious =
    currentIdx > 0
      ? snapshot.data.payments
          .filter((entry) => String(entry.customer ?? '') === customerId && isOnOrBeforeDay(datePart(entry.date), previousBillDate))
          .reduce((sum, entry) => sum + num(entry.amount), 0)
      : 0
  previousBalance -= paidBeforePrevious

  const previousCutoffDate = currentIdx > 0 ? previousBillDate : ''
  const periodCreditEntries = snapshot.data.payments
    .filter((entry) => {
      if (String(entry.customer ?? '') !== customerId) return false
      const paymentDate = datePart(entry.date)
      if (!isOnOrBeforeDay(paymentDate, selectedDate)) return false
      if (!previousCutoffDate) return true
      return !isOnOrBeforeDay(paymentDate, previousCutoffDate)
    })
    .sort((a, b) => datePart(a.date).localeCompare(datePart(b.date)))
    .map((entry) => ({ date: datePart(entry.date), amount: num(entry.amount) }))
  const periodCredits = periodCreditEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const subtotal = previousBalance + currentBillTotal

  return {
    bookNo: num(selectedBill.book_no),
    billNo: num(selectedBill.bill_no),
    date: selectedDate,
    customerName: customer ? formatCompanyName(customer.company_name, customer.name) : String(selectedBill.customer_name ?? 'Unknown'),
    mkt: num(selectedBill.mkt),
    itemRows,
    gstAmount,
    transport,
    gstRate,
    currentBillTotal,
    previousBalance,
    previousBillDate,
    periodCreditEntries,
    subtotal,
    finalTotal: subtotal - periodCredits,
    totalQty: itemRows.reduce((sum, row) => sum + row.qty, 0),
    totalBags: itemRows.reduce((sum, row) => sum + row.bags, 0),
    lrList: String(selectedBill.lr_no ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  }
}

function waitForRenderFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function createBillPdfBlob(jpg: Blob) {
  const { jsPDF } = await loadPdfTools()
  const dataUrl = await blobToDataUrl(jpg)
  const dimensions = await imageDimensions(dataUrl)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 22
  const scale = Math.min((pageWidth - margin * 2) / dimensions.width, (pageHeight - margin * 2) / dimensions.height)
  const width = dimensions.width * scale
  const height = dimensions.height * scale
  doc.addImage(dataUrl, 'JPEG', (pageWidth - width) / 2, margin, width, height)
  return doc.output('arraybuffer')
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read image.'))
    reader.readAsDataURL(blob)
  })
}

function imageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
    image.onerror = () => reject(new Error('Unable to measure image.'))
    image.src = src
  })
}

async function createPartyWorkbook(packageData: PartyPackage) {
  return createXlsxBlob(packageData.workbookSheets)
}










function buildPartyReadme(packageData: PartyPackage, includesBillFiles: boolean) {
  return [
    `PARTY LEDGER PACKAGE - ${packageData.customerName}`,
    '',
    `Period: ${packageData.periodLabel}`,
    `Generated: ${packageData.generatedLabel}`,
    'Company: Kapil Products',
    '',
    'PACKAGE CONTENTS:',
    '',
    ...(includesBillFiles
      ? [
          `Bills/Images/ - ${packageData.bills.length} bill images in JPG format`,
          `Bills/PDFs/ - ${packageData.bills.length} bills in PDF format`,
        ]
      : []),
    'Bills/Bills_Summary.pdf - formatted summary of all bills',
    'Bills/Bills_Data.csv - raw bill data for import',
    'Payments/Payments_Summary.pdf - formatted payment summary',
    'Payments/Payments_Data.csv - raw payment data',
    'Complete_Report.xlsx - summary, bills, payments, statement, and analytics sheets',
    'Party_Statement.pdf - complete account statement',
    '',
    'SUMMARY:',
    '',
    `Opening Balance: ${formatInrInteger(packageData.openingBalance)}`,
    `Total Bills: ${formatInrInteger(packageData.totalBills)} (${packageData.bills.length} bills)`,
    `Total Payments: ${formatInrInteger(packageData.totalPayments)} (${packageData.payments.length} payments)`,
    `Closing Balance: ${formatInrInteger(packageData.closingBalance)}`,
    '',
    'Generated by: Kapil Pro',
  ].join('\n')
}

function PreviewTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <table className="w-full min-w-[900px]">
        <thead><tr className="bg-slate-50">{columns.map((column) => <Th key={column}>{column}</Th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-slate-500">No rows for this filter.</td></tr>}
          {rows.slice(0, 80).map((row, index) => (
            <tr key={index} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
              {columns.map((column, cellIndex) => <td key={`${column}-${cellIndex}`} className="max-w-[24rem] px-3 py-2 align-top text-xs text-slate-700">{row[cellIndex] || '-'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 80 && <p className="mt-2 text-xs text-slate-500">Preview shows first 80 rows. Export includes all rows.</p>}
    </div>
  )
}

function BookPreview({ snapshot, bookNo }: { snapshot?: BackupSnapshot; bookNo: string }) {
  if (!snapshot || !bookNo.trim()) return <p className="py-8 text-center text-sm text-slate-500">Select a book to preview its bills.</p>
  const preview = buildBookSummary(snapshot, bookNo)
  return <PreviewTable columns={preview.columns} rows={preview.rows} />
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{children}</th>
}

function normalizeReportData(snapshot: BackupSnapshot): { customers: ExportCustomer[]; items: ExportItem[]; bills: ExportBill[]; lines: ExportLine[]; payments: ExportPayment[] } {
  const customerNameById = new Map(snapshot.data.customers.map((customer) => [customer.id, displayCustomer(customer)]))
  const items = snapshot.data.items.map((item) => ({ id: item.id, name: String(item.name ?? ''), type: String(item.type ?? '') || 'gas', unit: String(item.unit ?? '') }))
  return {
    customers: snapshot.data.customers.map((customer) => ({ id: customer.id, name: displayCustomer(customer), active: customer.active !== false, openingBalance: num(customer.opening_balance) })),
    items,
    bills: snapshot.data.bills.map((bill) => ({
      id: bill.id,
      date: datePart(bill.date),
      customerId: String(bill.customer ?? ''),
      customerName: customerNameById.get(String(bill.customer ?? '')) ?? String(bill.customer_name ?? 'Unknown'),
      bookNo: num(bill.book_no),
      billNo: num(bill.bill_no),
      marketRate: num(bill.mkt),
      transport: num(bill.transport),
      gstRate: num(bill.gst_rate),
      gstAmount: num(bill.gst_amount),
      lrNo: String(bill.lr_no ?? ''),
    })),
    lines: snapshot.data.billItems.map((line) => ({ id: line.id, billId: String(line.bill ?? ''), itemId: String(line.item ?? ''), itemName: String(line.item_name ?? ''), qty: num(line.qty), bags: num(line.bags), rate: num(line.rate), amount: num(line.amount) })),
    payments: snapshot.data.payments.map((payment) => ({ id: payment.id, date: datePart(payment.date), customerId: String(payment.customer ?? ''), amount: num(payment.amount) })),
  }
}

function monthlySummaryCards(summary: MonthlyExportReport['summary']) {
  return [
    { label: 'Invoice sales', value: formatInrInteger(summary.invoiceSales) },
    { label: 'Gas sales', value: formatInrInteger(summary.gasSales) },
    { label: 'Gas volume', value: `${formatNumber(summary.gasKg)} kg` },
    { label: 'Gas bags', value: formatNumber(summary.gasBags) },
    { label: 'Avg selling', value: formatOptionalRate(summary.weightedSellingRate) },
    { label: 'Bill market', value: formatOptionalRate(summary.weightedMarketRate) },
    { label: 'Premium', value: formatOptionalSignedRate(summary.premiumPerKg) },
    { label: 'Collections', value: formatInrInteger(summary.collections) },
  ]
}

function salesSummaryCards(summary: SalesReportResult['summary']) {
  return [
    { label: 'Invoices', value: formatNumber(summary.invoiceCount) },
    { label: 'Invoice total', value: formatInrInteger(summary.invoiceTotal) },
    { label: 'Item sales', value: formatInrInteger(summary.itemSales) },
    { label: 'Quantity', value: formatNumber(summary.quantity) },
    { label: 'Bags', value: formatNumber(summary.bags) },
    { label: 'Avg gas rate', value: formatOptionalRate(summary.weightedSellingRate) },
  ]
}

function rateSummaryCards(summary: ReturnType<typeof buildRateAnalysisReport>['summary'] | undefined) {
  if (!summary) return []
  return [
    { label: 'Gas sales', value: formatInrInteger(summary.gasSales) },
    { label: 'Gas volume', value: `${formatNumber(summary.gasKg)} kg` },
    { label: 'Bags', value: formatNumber(summary.gasBags) },
    { label: 'Avg selling', value: formatOptionalRate(summary.weightedSellingRate) },
    { label: 'Avg market', value: formatOptionalRate(summary.weightedMarketRate) },
    { label: 'Premium', value: formatOptionalSignedRate(summary.premiumPerKg) },
  ]
}

function outstandingSummaryCards(summary: ReturnType<typeof buildOutstandingReport>['summary'] | undefined) {
  if (!summary) return []
  return [
    { label: 'Outstanding', value: formatInrInteger(summary.totalOutstanding) },
    { label: 'Parties', value: formatNumber(summary.customerCount) },
    { label: 'Older than 30 days', value: formatInrInteger(summary.overdueAmount) },
    { label: 'Largest balance', value: formatInrInteger(summary.largestBalance) },
  ]
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value)
}

function formatOptionalRate(value: number | null) {
  return value == null ? '—' : `${formatInrInteger(value)}/kg`
}

function formatOptionalSignedRate(value: number | null) {
  if (value == null) return '—'
  return `${value >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(value))}/kg`
}

function monthlyWorkbookSheets(report: MonthlyExportReport): SheetSpec[] {
  return [
    {
      name: 'Summary',
      columns: [
        { header: 'Month', type: 'text' }, { header: 'Invoice Sales', type: 'currency' }, { header: 'Gas Sales', type: 'currency' }, { header: 'Gas Kg', type: 'number' }, { header: 'Gas Bags', type: 'number' }, { header: 'Avg Selling Rate', type: 'currency' }, { header: 'Bill Market Rate', type: 'currency' }, { header: 'Premium Per Kg', type: 'currency' }, { header: 'Collections', type: 'currency' }, { header: 'Bills', type: 'integer' }, { header: 'Active Customers', type: 'integer' },
      ],
      rows: [[report.month, report.summary.invoiceSales, report.summary.gasSales, report.summary.gasKg, report.summary.gasBags, report.summary.weightedSellingRate, report.summary.weightedMarketRate, report.summary.premiumPerKg, report.summary.collections, report.summary.billCount, report.summary.activeCustomerCount]],
    },
    {
      name: 'Items', totalsLabel: 'Total',
      columns: [{ header: 'Item', type: 'text' }, { header: 'Gas Sales', type: 'currency', total: true }, { header: 'Kg', type: 'number', total: true }, { header: 'Bags', type: 'number', total: true }, { header: 'Bills', type: 'integer' }, { header: 'Avg Selling', type: 'currency' }, { header: 'Avg Market', type: 'currency' }, { header: 'Premium', type: 'currency' }],
      rows: report.itemRows.map((row) => [row.itemName, row.sales, row.kg, row.bags, row.billCount, row.weightedSellingRate, row.weightedMarketRate, row.premiumPerKg]),
    },
    {
      name: 'Customers', totalsLabel: 'Total',
      columns: [{ header: 'Customer', type: 'text' }, { header: 'Gas Sales', type: 'currency', total: true }, { header: 'Share %', type: 'number' }, { header: 'Kg', type: 'number', total: true }, { header: 'Bags', type: 'number', total: true }, { header: 'Bills', type: 'integer' }, { header: 'Avg Selling', type: 'currency' }, { header: 'Premium', type: 'currency' }],
      rows: report.customerRows.map((row) => [row.customerName, row.sales, row.salesSharePct, row.kg, row.bags, row.billCount, row.weightedSellingRate, row.premiumPerKg]),
    },
    {
      name: 'Daily', totalsLabel: 'Total',
      columns: [{ header: 'Date', type: 'date' }, { header: 'Invoice Sales', type: 'currency', total: true }, { header: 'Collections', type: 'currency', total: true }, { header: 'Gas Sales', type: 'currency', total: true }, { header: 'Gas Kg', type: 'number', total: true }, { header: 'Gas Bags', type: 'number', total: true }, { header: 'Selling Rate', type: 'currency' }, { header: 'Market Rate', type: 'currency' }, { header: 'Premium', type: 'currency' }],
      rows: report.dailyRows.map((row) => [row.date, row.invoiceSales, row.collections, row.gasSales, row.gasKg, row.gasBags, row.sellingRate, row.marketRate, row.premiumPerKg]),
    },
  ]
}

function salesDetailHeaders() {
  return ['Date', 'Bill', 'Party', 'Item', 'Type', 'Quantity', 'Unit', 'Bags', 'Selling Rate', 'Market Rate', 'Premium', 'Item Amount', 'Transport', 'GST', 'Invoice Total', 'LR No']
}

function salesDetailValues(row: SalesReportResult['detailRows'][number]): CellValue[] {
  return [row.date, row.billRef, row.customerName, row.itemName, row.itemType, row.qty, row.unit, row.bags, row.sellingRate, row.marketRate, row.premiumPerKg, row.itemAmount, row.transport, row.gst, row.invoiceTotal, row.lrNo]
}

function salesWorkbookSheets(report: SalesReportResult, periodLabel: string): SheetSpec[] {
  return [
    {
      name: 'Summary',
      columns: [{ header: 'Period', type: 'text' }, { header: 'Invoices', type: 'integer' }, { header: 'Invoice Total', type: 'currency' }, { header: 'Item Sales', type: 'currency' }, { header: 'Quantity', type: 'number' }, { header: 'Bags', type: 'number' }, { header: 'Avg Gas Rate', type: 'currency' }],
      rows: [[periodLabel, report.summary.invoiceCount, report.summary.invoiceTotal, report.summary.itemSales, report.summary.quantity, report.summary.bags, report.summary.weightedSellingRate]],
    },
    {
      name: 'Grouped', totalsLabel: 'Total',
      columns: [{ header: 'Group', type: 'text' }, { header: 'Invoices', type: 'integer' }, { header: 'Item Sales', type: 'currency', total: true }, { header: 'Quantity', type: 'number', total: true }, { header: 'Bags', type: 'number', total: true }, { header: 'Avg Gas Rate', type: 'currency' }],
      rows: report.groupRows.map((row) => [row.label, row.invoiceCount, row.itemSales, row.quantity, row.bags, row.weightedSellingRate]),
    },
    {
      name: 'Detail', totalsLabel: 'Total',
      columns: [
        { header: 'Date', type: 'date' }, { header: 'Bill', type: 'text' }, { header: 'Party', type: 'text' }, { header: 'Item', type: 'text' }, { header: 'Type', type: 'text' }, { header: 'Quantity', type: 'number', total: true }, { header: 'Unit', type: 'text' }, { header: 'Bags', type: 'number', total: true }, { header: 'Selling Rate', type: 'currency' }, { header: 'Market Rate', type: 'currency' }, { header: 'Premium', type: 'currency' }, { header: 'Item Amount', type: 'currency', total: true }, { header: 'Transport', type: 'currency' }, { header: 'GST', type: 'currency' }, { header: 'Invoice Total', type: 'currency' }, { header: 'LR No', type: 'text' },
      ],
      rows: report.detailRows.map(salesDetailValues),
    },
  ]
}

function downloadCsv(file: CsvFile) {
  downloadFile(file.filename, file.content, 'text/csv;charset=utf-8')
}

function downloadFile(filename: string, content: string, type: string) {
  downloadBlob(filename, new Blob([content], { type }))
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function toCsv(rows: Array<Array<unknown>>) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '')
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
        })
        .join(','),
    )
    .join('\n')
}

function billItemBaseMap(billItems: PBRecord[]) {
  const map = new Map<string, number>()
  for (const item of billItems) {
    const billId = String(item.bill ?? '')
    map.set(billId, (map.get(billId) ?? 0) + num(item.amount))
  }
  return map
}

function displayCustomer(row: PBRecord) {
  const company = String(row.company_name ?? '').trim()
  const name = String(row.name ?? '').trim()
  const display = formatCustomerDisplayName(company, name)
  if (display === 'General / Regular') return display
  return company && company !== name ? `${company} (${name})` : name || company || row.id
}

function billRef(row: PBRecord) {
  return `${num(row.book_no)}/${num(row.bill_no)}`
}

function itemDetails(snapshot: BackupSnapshot, items: PBRecord[]) {
  return items.map((item) => {
    const meta = findSnapshotItem(snapshot, item)
    const unit = getBillingUnit({ type: String(meta?.type ?? ''), unit: String(meta?.unit ?? '') })
    const qty = num(item.qty)
    return `${String(item.item_name ?? '')} ${unit === 'piece' ? `${Math.round(qty)} pcs` : formatInQty(qty, unit)}`
  }).join(' | ')
}

function formatExportQty(snapshot: BackupSnapshot, items: PBRecord[]) {
  const gasQty = items
    .filter((item) => isGasBillingItem({ type: String(findSnapshotItem(snapshot, item)?.type ?? '') }))
    .reduce((sum, item) => sum + num(item.qty), 0)
  const electronicQty = items
    .filter((item) => !isGasBillingItem({ type: String(findSnapshotItem(snapshot, item)?.type ?? '') }))
    .reduce((sum, item) => sum + num(item.qty), 0)
  return formatQtyTotals(gasQty, electronicQty)
}

function formatQtyTotals(gasQty: number, electronicQty: number) {
  if (gasQty > 0 && electronicQty > 0) return `${formatInQty(gasQty, 'kg')} / ${Math.round(electronicQty)} pcs`
  if (electronicQty > 0) return `${Math.round(electronicQty)} pcs`
  return formatInQty(gasQty, 'kg')
}

function formatExportUnit(snapshot: BackupSnapshot, items: PBRecord[]) {
  const hasGas = items.some((item) => isGasBillingItem({ type: String(findSnapshotItem(snapshot, item)?.type ?? '') }))
  const hasElectronic = items.some((item) => !isGasBillingItem({ type: String(findSnapshotItem(snapshot, item)?.type ?? '') }))
  if (hasGas && hasElectronic) return 'mixed'
  return hasElectronic ? 'piece' : 'kg'
}

function findSnapshotItem(snapshot: BackupSnapshot, item: PBRecord) {
  const itemId = String(item.item ?? '')
  const itemName = String(item.item_name ?? '').trim().toLowerCase()
  return snapshot.data.items.find((row) => row.id === itemId || String(row.name ?? '').trim().toLowerCase() === itemName)
}

function datePart(value: unknown) {
  return String(value ?? '').slice(0, 10)
}

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function monthBounds(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const start = `${yearRaw}-${monthRaw}-01`
  const endDate = new Date(year, month, 0)
  return { start, end: `${yearRaw}-${monthRaw}-${String(endDate.getDate()).padStart(2, '0')}` }
}

function previousMonth(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function resolveDateRange(preset: DatePreset, month: string, fromDate: string, toDate: string, today: string) {
  if (preset === 'custom') return { start: fromDate, end: toDate, label: `${formatFullDate(fromDate)} to ${formatFullDate(toDate)}` }
  if (preset === 'thisFy') {
    const currentYear = Number(today.slice(0, 4))
    const currentMonth = Number(today.slice(5, 7))
    const fyStart = currentMonth >= 4 ? currentYear : currentYear - 1
    return { start: `${fyStart}-04-01`, end: today, label: `FY ${fyStart}-${String(fyStart + 1).slice(2)}` }
  }
  const key = preset === 'lastMonth' ? previousMonth(month) : month
  const bounds = monthBounds(key)
  return { ...bounds, label: formatMonthYear(key) }
}

function compareBillDate(a: PBRecord, b: PBRecord) {
  return datePart(a.date).localeCompare(datePart(b.date)) || compareBillNo(a, b)
}

function compareBillNo(a: PBRecord, b: PBRecord) {
  return num(a.bill_no) - num(b.bill_no)
}

function groupBy<T>(rows: T[], getKey: (row: T) => string) {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = getKey(row)
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return map
}

function billTotal(snapshot: BackupSnapshot, bill: PBRecord) {
  const base = snapshot.data.billItems.filter((item) => String(item.bill ?? '') === bill.id).reduce((sum, item) => sum + num(item.amount), 0)
  return calculateBillTotalFromBase(base, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount))
}

function safeFilename(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'report'
}

function safeReadableFilename(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_().-]/g, '')
    .replace(/_+/g, '_')
    .slice(0, 90) || 'Party'
}

function readableDate(value: string) {
  if (!value) return 'No-Date'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  const month = date.toLocaleString('en-US', { month: 'short' })
  return `${month}-${String(date.getDate()).padStart(2, '0')}-${date.getFullYear()}`
}

function csvDate(value: string) {
  if (!value) return ''
  const [year, month, day] = value.split('-')
  return `${day}-${month}-${year}`
}

function partyBillFilename(bill: PBRecord) {
  return `Bill_${billRef(bill).replace(/\//g, '-')}_${readableDate(datePart(bill.date))}`
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'

const primaryButtonClass =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'

const secondaryButtonClass =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
