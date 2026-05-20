import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Archive, BookOpen, Download, FileArchive, FileText, PackageCheck, ReceiptText, Users } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM, type BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { buildBackupSnapshot, snapshotToCsvFiles, type BackupSnapshot } from '@/data/backup'
import { loadCurrentStock, loadMonthlyStockReport } from '@/data/stock'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { isOnOrBeforeDay } from '@/domain/financial-math'
import { BILL_PREVIEW_CARD_CLASS, BILL_PRINT_JPEG_QUALITY_DOWNLOAD } from '@/lib/bill-print-export'
import { formatCompanyName, formatCustomerDisplayName } from '@/lib/customer-display'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { BILL_JPEG_OUTPUT_WIDTH_PX, exportNodeAsJpgBlob } from '@/lib/image-export'
import { formatInQty, formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/export-reports')({
  component: ExportReportsPage,
})

type CsvFile = { filename: string; content: string }
type PBRecord = Record<string, unknown> & { id: string }
type ReportKind = 'party' | 'sales' | 'stock' | 'outstanding' | 'book' | 'backup'
type DatePreset = 'thisMonth' | 'lastMonth' | 'thisFy' | 'custom'

const REPORTS: Array<{ id: ReportKind; title: string; subtitle: string; icon: ReactNode }> = [
  { id: 'party', title: 'Party Statement', subtitle: 'Customer ledger with opening, bills, payments, and closing.', icon: <Users size={16} /> },
  { id: 'sales', title: 'Sales Register', subtitle: 'Bill-wise sales for a month, financial year, or date range.', icon: <ReceiptText size={16} /> },
  { id: 'stock', title: 'Gas Stock Report', subtitle: 'Gas-part stock movement and closing for selected month.', icon: <PackageCheck size={16} /> },
  { id: 'outstanding', title: 'Outstanding', subtitle: 'Receivable and advance summary as of a selected date.', icon: <FileText size={16} /> },
  { id: 'book', title: 'Book Download', subtitle: 'Download one whole bill book as a ZIP of PDFs.', icon: <BookOpen size={16} /> },
  { id: 'backup', title: 'Technical Backup', subtitle: 'Raw JSON and CSV bundle for safety and migration.', icon: <Archive size={16} /> },
]

function ExportReportsPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [reportKind, setReportKind] = useState<ReportKind>('party')
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [fromDate, setFromDate] = useState(monthBounds(today.slice(0, 7)).start)
  const [toDate, setToDate] = useState(today)
  const [asOfDate, setAsOfDate] = useState(today)
  const [partyId, setPartyId] = useState('')
  const [bookNoInput, setBookNoInput] = useState('')
  const [includeBillItems, setIncludeBillItems] = useState(true)
  const [statusText, setStatusText] = useState('')

  const reportsQuery = useQuery({
    queryKey: ['export-reports-data', month],
    queryFn: async () => {
      const [snapshot, stock, monthlyStock] = await Promise.all([buildBackupSnapshot(), loadCurrentStock(), loadMonthlyStockReport(month)])
      return { snapshot, stock, monthlyStock }
    },
  })

  const snapshot = reportsQuery.data?.snapshot
  const stock = reportsQuery.data?.stock ?? []
  const monthlyStock = reportsQuery.data?.monthlyStock ?? []
  const customers = useMemo(() => (snapshot?.data.customers ?? []).filter((row) => row.active !== false).sort((a, b) => displayCustomer(a).localeCompare(displayCustomer(b))), [snapshot])
  const bookOptions = useMemo(() => buildBookOptions(snapshot), [snapshot])
  const selectedParty = customers.find((row) => row.id === partyId)
  const dateRange = useMemo(() => resolveDateRange(datePreset, month, fromDate, toDate, today), [datePreset, month, fromDate, toDate, today])
  const preview = useMemo(() => (snapshot ? buildPreview(snapshot, reportKind, { partyId, bookNo: bookNoInput, dateRange, asOfDate, includeBillItems }, monthlyStock, stock) : null), [snapshot, reportKind, partyId, bookNoInput, dateRange, asOfDate, includeBillItems, monthlyStock, stock])

  function downloadBackupJson() {
    if (!snapshot) return
    downloadFile(`kapil-full-backup-${dateStamp()}.json`, JSON.stringify(snapshot, null, 2), 'application/json')
  }

  function downloadRawCsvBundle() {
    if (!snapshot) return
    for (const file of snapshotToCsvFiles(snapshot)) downloadCsv(file)
  }

  function downloadCsvReport() {
    if (!preview) return
    downloadCsv({ filename: `${preview.slug}.csv`, content: toCsv([preview.columns, ...preview.rows]) })
  }

  function downloadPdfReport() {
    if (!snapshot || !preview) return
    const doc = createReportPdf(preview.title, preview.subtitle, preview.columns, preview.rows, preview.summary)
    doc.save(`${preview.slug}.pdf`)
  }

  async function downloadPartyZip() {
    if (!snapshot || !selectedParty) return
    const packageData = buildPartyPackage(snapshot, selectedParty.id, dateRange, includeBillItems)
    if (!packageData) {
      setStatusText('Select a party with ledger data first.')
      return
    }

    setStatusText(`Preparing ZIP package: summaries, CSV, Excel, and ${packageData.bills.length} bill files...`)
    const zip = new JSZip()
    const billsFolder = zip.folder('Bills') ?? zip
    const billImagesFolder = billsFolder.folder('Images') ?? billsFolder
    const billPdfsFolder = billsFolder.folder('PDFs') ?? billsFolder
    const paymentsFolder = zip.folder('Payments') ?? zip
    zip.folder('Documents')

    billsFolder.file('Bills_Summary.pdf', createReportPdf('Bills Summary', packageData.subtitle, packageData.billSummaryColumns, packageData.billSummaryRows, packageData.billSummary).output('arraybuffer'))
    billsFolder.file('Bills_Data.csv', toCsv(packageData.billCsvRows))
    paymentsFolder.file('Payments_Summary.pdf', createReportPdf('Payments Received', packageData.subtitle, packageData.paymentSummaryColumns, packageData.paymentSummaryRows, packageData.paymentSummary).output('arraybuffer'))
    paymentsFolder.file('Payments_Data.csv', toCsv(packageData.paymentCsvRows))
    zip.file('Party_Statement.pdf', createReportPdf(packageData.statementTitle, packageData.subtitle, packageData.statementColumns, packageData.statementRows, packageData.statementSummary).output('arraybuffer'))
    zip.file('Complete_Report.xlsx', await createPartyWorkbook(packageData))
    zip.file('README.txt', buildPartyReadme(packageData))

    for (const [index, bill] of packageData.bills.entries()) {
      setStatusText(`Rendering bill ${index + 1} of ${packageData.bills.length}...`)
      const jpg = await createBillJpgBlob(snapshot, bill)
      const filename = partyBillFilename(bill)
      billImagesFolder.file(`${filename}.jpg`, jpg)
      billPdfsFolder.file(`${filename}.pdf`, await createBillPdfBlob(jpg))
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
    const zip = new JSZip()
    const billsFolder = zip.folder('Bills') ?? zip
    const imageFolder = billsFolder.folder('Images') ?? billsFolder
    const pdfFolder = billsFolder.folder('PDFs') ?? billsFolder
    zip.file(`Book_${bookNo}_Summary.xlsx`, await createSimpleWorkbook([
      { name: 'Overview', rows: buildBookOverviewRows(snapshot, bills, bookNo) },
      { name: 'Bill Details', rows: buildBookCsvRows(snapshot, bills) },
      { name: 'Party-wise', rows: buildBookPartyRows(snapshot, bills) },
    ]))
    zip.file(`Book_${bookNo}_Register.pdf`, createReportPdf(`Book ${bookNo} Register`, `${bills.length} bills`, ['Date', 'Bill', 'Party', 'Amount', 'Details'], buildBookRegisterRows(snapshot, bills), [{ label: 'Bills', value: String(bills.length) }]).output('arraybuffer'))
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

  return (
    <div className="w-full space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="border-b border-slate-200 bg-white px-1 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Business reports</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Exports</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">Choose a report, narrow it to a party, month, date range, or book, then export a clean PDF or data file.</p>
          </div>
          {snapshot && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="Bills" value={snapshot.counts.bills} />
              <Metric label="Parties" value={snapshot.counts.customers} />
              <Metric label="Gas Items" value={stock.length} />
            </div>
          )}
        </div>
      </section>

      {reportsQuery.isLoading && <section className="border border-slate-200 bg-white p-5 text-sm text-slate-500">Preparing reports...</section>}
      {reportsQuery.isError && <section className="border border-red-200 bg-red-50 p-5 text-sm text-red-700">Unable to prepare report exports.</section>}

      {!reportsQuery.isLoading && !reportsQuery.isError && (
        <>
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="border border-slate-200 bg-white p-2">
              {REPORTS.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  className={`flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition ${reportKind === report.id ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                  onClick={() => {
                    setReportKind(report.id)
                    setStatusText('')
                  }}
                >
                  <span className={`mt-0.5 ${reportKind === report.id ? 'text-white' : 'text-slate-500'}`}>{report.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{report.title}</span>
                    <span className={`mt-0.5 block text-xs leading-relaxed ${reportKind === report.id ? 'text-slate-200' : 'text-slate-500'}`}>{report.subtitle}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="border border-slate-200 bg-white p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {reportKind === 'party' && (
                  <Field label="Party">
                    <select className={inputClass} value={partyId} onChange={(event) => setPartyId(event.target.value)}>
                      <option value="">Select party</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>{displayCustomer(customer)}</option>
                      ))}
                    </select>
                  </Field>
                )}

                {(reportKind === 'party' || reportKind === 'sales') && (
                  <>
                    <Field label="Period">
                      <select className={inputClass} value={datePreset} onChange={(event) => setDatePreset(event.target.value as DatePreset)}>
                        <option value="thisMonth">This month</option>
                        <option value="lastMonth">Last month</option>
                        <option value="thisFy">This financial year</option>
                        <option value="custom">Custom range</option>
                      </select>
                    </Field>
                    {datePreset !== 'custom' && datePreset !== 'thisFy' && (
                      <Field label="Month">
                        <input className={inputClass} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
                      </Field>
                    )}
                    {datePreset === 'custom' && (
                      <>
                        <Field label="From">
                          <input className={inputClass} type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                        </Field>
                        <Field label="To">
                          <input className={inputClass} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                        </Field>
                      </>
                    )}
                    <label className="flex min-h-10 items-center gap-2 pt-5 text-sm text-slate-700">
                      <input type="checkbox" checked={includeBillItems} onChange={(event) => setIncludeBillItems(event.target.checked)} />
                      Include bill item details
                    </label>
                  </>
                )}

                {reportKind === 'stock' && (
                  <Field label="Stock Month">
                    <input className={inputClass} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
                  </Field>
                )}

                {reportKind === 'outstanding' && (
                  <Field label="As of Date">
                    <input className={inputClass} type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} />
                  </Field>
                )}

                {reportKind === 'book' && (
                  <Field label="Book No">
                    <select className={inputClass} value={bookNoInput} onChange={(event) => setBookNoInput(event.target.value)}>
                      <option value="">Select book</option>
                      {bookOptions.map((book) => (
                        <option key={book.bookNo} value={book.bookNo}>
                          Book {book.bookNo} - {book.count} bills ({book.fromDate} to {book.toDate})
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                {reportKind !== 'backup' && reportKind !== 'book' && (
                  <>
                    {reportKind === 'party' && (
                      <button type="button" className={primaryButtonClass} onClick={() => void downloadPartyZip()} disabled={!preview || (reportKind === 'party' && !selectedParty)}>
                        <FileArchive size={14} /> Download ZIP Package
                      </button>
                    )}
                    <button type="button" className={primaryButtonClass} onClick={downloadPdfReport} disabled={!preview || preview.rows.length === 0 || (reportKind === 'party' && !selectedParty)}>
                      <FileText size={14} /> Download PDF
                    </button>
                    <button type="button" className={secondaryButtonClass} onClick={downloadCsvReport} disabled={!preview || preview.rows.length === 0 || (reportKind === 'party' && !selectedParty)}>
                      <Download size={14} /> Download CSV
                    </button>
                  </>
                )}
                {reportKind === 'book' && (
                  <button type="button" className={primaryButtonClass} onClick={() => void downloadBookZip()} disabled={!bookNoInput.trim()}>
                    <FileArchive size={14} /> Download Book ZIP
                  </button>
                )}
                {reportKind === 'backup' && (
                  <>
                    <button type="button" className={primaryButtonClass} onClick={downloadBackupJson}>
                      <Download size={14} /> Full Backup JSON
                    </button>
                    <button type="button" className={secondaryButtonClass} onClick={downloadRawCsvBundle}>
                      <FileArchive size={14} /> Raw CSV Bundle
                    </button>
                  </>
                )}
                {statusText && <p className="text-xs text-slate-500" role="status">{statusText}</p>}
              </div>
            </div>
          </section>

          <section className="border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">{preview?.title ?? 'Report Preview'}</h3>
                <p className="mt-1 text-xs text-slate-500">{preview?.subtitle ?? 'Select report options to preview export data.'}</p>
              </div>
              {preview && preview.summary.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {preview.summary.slice(0, 4).map((row) => <SummaryPill key={row.label} label={row.label} value={row.value} />)}
                </div>
              )}
            </div>
            {reportKind === 'party' && !selectedParty && <p className="py-8 text-center text-sm text-slate-500">Select a party to preview a statement.</p>}
            {reportKind === 'book' && <BookPreview snapshot={snapshot} bookNo={bookNoInput} />}
            {reportKind === 'backup' && snapshot && <BackupPreview snapshot={snapshot} />}
            {preview && reportKind !== 'book' && reportKind !== 'backup' && !(reportKind === 'party' && !selectedParty) && <PreviewTable columns={preview.columns} rows={preview.rows} />}
          </section>
        </>
      )}
    </div>
  )
}

function buildPreview(
  snapshot: BackupSnapshot,
  kind: ReportKind,
  options: { partyId: string; bookNo: string; dateRange: { start: string; end: string; label: string }; asOfDate: string; includeBillItems: boolean },
  monthlyStock: Awaited<ReturnType<typeof loadMonthlyStockReport>>,
  currentStock: Awaited<ReturnType<typeof loadCurrentStock>>,
) {
  if (kind === 'party') return buildPartyStatement(snapshot, options.partyId, options.dateRange, options.includeBillItems)
  if (kind === 'sales') return buildSalesRegister(snapshot, options.dateRange, options.includeBillItems)
  if (kind === 'stock') return buildStockReport(monthlyStock, options.dateRange.label)
  if (kind === 'outstanding') return buildOutstandingReport(snapshot, options.asOfDate)
  if (kind === 'book') return buildBookSummary(snapshot, options.bookNo)
  if (kind === 'backup') return {
    title: 'Technical Backup',
    subtitle: 'Raw data exports for migration and safety.',
    slug: `kapil-technical-backup-${dateStamp()}`,
    columns: ['Collection', 'Records'],
    rows: [
      ['Customers', String(snapshot.counts.customers)],
      ['Items', String(snapshot.counts.items)],
      ['Bills', String(snapshot.counts.bills)],
      ['Bill Items', String(snapshot.counts.billItems)],
      ['Payments', String(snapshot.counts.payments)],
      ['Gas Stock Items', String(currentStock.length)],
    ],
    summary: [],
  }
}

function buildPartyStatement(snapshot: BackupSnapshot, partyId: string, range: { start: string; end: string; label: string }, includeBillItems: boolean) {
  const customer = snapshot.data.customers.find((row) => row.id === partyId)
  const customerName = customer ? displayCustomer(customer) : 'Party Statement'
  const itemBaseByBill = billItemBaseMap(snapshot.data.billItems)
  const billItemsByBill = groupBy(snapshot.data.billItems, (row) => String(row.bill ?? ''))
  let opening = num(customer?.opening_balance)

  const events = [
    ...snapshot.data.bills
      .filter((bill) => String(bill.customer ?? '') === partyId)
      .map((bill) => {
        const billId = bill.id
        const total = calculateBillTotalFromBase(itemBaseByBill.get(billId) ?? 0, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount))
        return { date: datePart(bill.date), type: 'Bill', ref: billRef(bill), debit: total, credit: 0, details: includeBillItems ? itemDetails(billItemsByBill.get(billId) ?? []) : String(bill.lr_no ?? '') }
      }),
    ...snapshot.data.payments
      .filter((payment) => String(payment.customer ?? '') === partyId)
      .map((payment) => ({ date: datePart(payment.date), type: 'Payment', ref: String(payment.mode ?? ''), debit: 0, credit: num(payment.amount), details: String(payment.note ?? '') })),
  ].sort(compareEvent)

  for (const event of events.filter((event) => event.date && event.date < range.start)) opening += event.debit - event.credit

  let balance = opening
  const rows = [['', 'Opening', 'Opening Balance', '', '', formatInrInteger(balance), 'Balance carried forward']]
  for (const event of events.filter((event) => event.date >= range.start && event.date <= range.end)) {
    balance += event.debit - event.credit
    rows.push([formatFullDate(event.date), event.type, event.ref, event.debit ? formatInrInteger(event.debit) : '', event.credit ? formatInrInteger(event.credit) : '', formatInrInteger(balance), event.details])
  }

  return {
    title: `${customerName} Statement`,
    subtitle: `${range.label} | Generated ${formatFullDate(getLocalIsoDate())}`,
    slug: `party-statement-${safeFilename(customerName)}-${range.start}-to-${range.end}`,
    columns: ['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance', 'Details'],
    rows,
    summary: [
      { label: 'Opening', value: formatInrInteger(opening) },
      { label: 'Closing', value: formatInrInteger(balance) },
      { label: 'Rows', value: String(rows.length - 1) },
    ],
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
      includeBillItems ? itemDetails(billItemsByBill.get(bill.id) ?? []) : String(bill.lr_no ?? ''),
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

function buildStockReport(rows: Awaited<ReturnType<typeof loadMonthlyStockReport>>, label: string) {
  return {
    title: 'Gas Stock Report',
    subtitle: label,
    slug: `gas-stock-report-${safeFilename(label)}`,
    columns: ['Item', 'Party', 'Opening', 'Stock In', 'Sold', 'Adjustment', 'Closing'],
    rows: rows.map((row) => [row.itemName, row.customerName, formatStockQty(row.opening, row), formatStockQty(row.stockIn, row), formatStockQty(row.sold, row), formatStockQty(row.adjustment, row), formatStockQty(row.closing, row)]),
    summary: [
      { label: 'Stock Buckets', value: String(rows.length) },
      { label: 'Closing Kg', value: formatInQty(rows.reduce((sum, row) => sum + row.closing, 0), 'kg') },
    ],
  }
}

function buildOutstandingReport(snapshot: BackupSnapshot, asOfDate: string) {
  const itemBaseByBill = billItemBaseMap(snapshot.data.billItems)
  const rows = snapshot.data.customers
    .map((customer) => {
      let balance = num(customer.opening_balance)
      for (const bill of snapshot.data.bills.filter((row) => String(row.customer ?? '') === customer.id && datePart(row.date) <= asOfDate)) {
        balance += calculateBillTotalFromBase(itemBaseByBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount))
      }
      for (const payment of snapshot.data.payments.filter((row) => String(row.customer ?? '') === customer.id && datePart(row.date) <= asOfDate)) balance -= num(payment.amount)
      return { customer: displayCustomer(customer), balance }
    })
    .filter((row) => row.balance !== 0)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))

  return {
    title: 'Outstanding Report',
    subtitle: `As of ${formatFullDate(asOfDate)}`,
    slug: `outstanding-as-of-${asOfDate}`,
    columns: ['Party', 'Receivable', 'Advance', 'Net'],
    rows: rows.map((row) => [row.customer, row.balance > 0 ? formatInrInteger(row.balance) : '', row.balance < 0 ? formatInrInteger(Math.abs(row.balance)) : '', formatInrInteger(row.balance)]),
    summary: [
      { label: 'Receivable', value: formatInrInteger(rows.filter((row) => row.balance > 0).reduce((sum, row) => sum + row.balance, 0)) },
      { label: 'Advance', value: formatInrInteger(rows.filter((row) => row.balance < 0).reduce((sum, row) => sum + Math.abs(row.balance), 0)) },
      { label: 'Parties', value: String(rows.length) },
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

function buildBookOptions(snapshot?: BackupSnapshot) {
  if (!snapshot) return []
  const byBook = new Map<number, { bookNo: number; count: number; fromDate: string; toDate: string }>()
  for (const bill of snapshot.data.bills) {
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
  workbookSheets: Array<{ name: string; rows: Array<Array<string | number>> }>
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
          details: includeBillItems ? itemDetails(billItemsByBill.get(bill.id) ?? []) : String(bill.lr_no ?? ''),
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
  ].sort(compareEvent)

  for (const event of allEvents.filter((event) => event.date && event.date < range.start)) opening += event.debit - event.credit

  let balance = opening
  const balanceAfterById = new Map<string, number>()
  const rangeEvents = allEvents.filter((event) => event.date >= range.start && event.date <= range.end)
  const statementRows = [['', 'Opening', 'Opening Balance', '', '', formatInrInteger(balance), 'Balance carried forward']]
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
  }

  const bills = snapshot.data.bills
    .filter((bill) => String(bill.customer ?? '') === partyId && datePart(bill.date) >= range.start && datePart(bill.date) <= range.end)
    .sort(compareBillDate)
  const payments = snapshot.data.payments
    .filter((payment) => String(payment.customer ?? '') === partyId && datePart(payment.date) >= range.start && datePart(payment.date) <= range.end)
    .sort((a, b) => datePart(a.date).localeCompare(datePart(b.date)))
  const totalBills = bills.reduce((sum, bill) => sum + billTotal(snapshot, bill), 0)
  const totalPayments = payments.reduce((sum, payment) => sum + num(payment.amount), 0)
  const totalQty = bills.reduce((sum, bill) => sum + (billItemsByBill.get(bill.id) ?? []).reduce((itemSum, item) => itemSum + num(item.qty), 0), 0)

  const billSummaryRows = bills.map((bill) => {
    const items = billItemsByBill.get(bill.id) ?? []
    const qty = items.reduce((sum, item) => sum + num(item.qty), 0)
    return [
      formatFullDate(datePart(bill.date)),
      billRef(bill),
      itemDetails(items) || '-',
      formatInQty(qty, 'kg'),
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
        itemDetails(items) || 'Items',
        String(qty),
        'kg',
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
  const workbookSheets = [
    {
      name: 'Summary',
      rows: [
        ['PARTY LEDGER SUMMARY'],
        [customerName],
        ['Period', periodLabel],
        [],
        ['Opening Balance', opening],
        ['Total Bills', totalBills, `${bills.length} bills`],
        ['Total Payments', totalPayments, `${payments.length} payments`],
        ['Net Change', totalBills - totalPayments],
        ['Closing Balance', balance],
        [],
        ['Total Quantity Sold', totalQty],
        ['Average Bill Size', bills.length ? Math.round(totalBills / bills.length) : 0],
        ['Average Payment', payments.length ? Math.round(totalPayments / payments.length) : 0],
      ],
    },
    { name: 'Bills', rows: billCsvRows },
    { name: 'Payments', rows: paymentCsvRows },
    { name: 'Statement', rows: [['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance', 'Details'], ...statementRows] },
    {
      name: 'Analytics',
      rows: [
        ['Metric', 'Value'],
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
      { label: 'Total Qty', value: formatInQty(totalQty, 'kg') },
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

function createReportPdf(title: string, subtitle: string, columns: string[], rows: string[][], summary: Array<{ label: string; value: string }>) {
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  addPdfHeader(doc, title, subtitle)
  let startY = 98
  if (summary.length > 0) {
    autoTable(doc, {
      startY,
      theme: 'plain',
      body: [summary.map((row) => `${row.label}\n${row.value}`)],
      styles: { fontSize: 9, cellPadding: 7, lineColor: [226, 232, 240], lineWidth: 0.5, valign: 'middle' },
      columnStyles: Object.fromEntries(summary.map((_, index) => [index, { fillColor: [248, 250, 252], halign: 'center' }])),
      margin: { left: 28, right: 28 },
    })
    startY = lastAutoTableY(doc) + 14
  }
  autoTable(doc, {
    startY,
    head: [columns],
    body: rows,
    styles: { fontSize: 8.2, cellPadding: 5, overflow: 'linebreak', valign: 'top', lineColor: [226, 232, 240], lineWidth: 0.3 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 28, right: 28 },
    columnStyles: reportColumnStyles(columns),
    didDrawPage: () => addPdfFooter(doc),
  })
  doc.setDrawColor(203, 213, 225)
  doc.line(28, 78, pageWidth - 28, 78)
  return doc
}

function addPdfHeader(doc: jsPDF, title: string, subtitle: string) {
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, pageWidth, 74, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.text(title, 28, 30)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(226, 232, 240)
  doc.setFontSize(9)
  doc.text(subtitle, 28, 48)
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - 28, 48, { align: 'right' })
  doc.setTextColor(15, 23, 42)
}

function addPdfFooter(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageNumber = doc.getNumberOfPages()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text('Kapil Products | Generated from Kapil Pro', 28, pageHeight - 18)
  doc.text(`Page ${pageNumber}`, pageWidth - 28, pageHeight - 18, { align: 'right' })
  doc.setTextColor(15, 23, 42)
}

function lastAutoTableY(doc: jsPDF) {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 90
}

function reportColumnStyles(columns: string[]) {
  const styles: Record<number, { halign?: 'left' | 'center' | 'right'; cellWidth?: number }> = {}
  columns.forEach((column, index) => {
    if (['Debit', 'Credit', 'Balance', 'Items', 'Transport', 'GST', 'Total', 'Opening', 'Stock In', 'Sold', 'Adjustment', 'Closing', 'Receivable', 'Advance', 'Net'].includes(column)) {
      styles[index] = { halign: 'right' }
    }
    if (column === 'Details') styles[index] = { ...(styles[index] ?? {}), cellWidth: 170 }
    if (column === 'Party') styles[index] = { ...(styles[index] ?? {}), cellWidth: 150 }
  })
  return styles
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

function buildBookOverviewRows(snapshot: BackupSnapshot, bills: PBRecord[], bookNo: number): Array<Array<string | number>> {
  const total = bills.reduce((sum, bill) => sum + billTotal(snapshot, bill), 0)
  const parties = new Set(bills.map((bill) => String(bill.customer ?? ''))).size
  return [
    [`Book ${bookNo} Summary`],
    ['Generated', new Date().toLocaleString()],
    [],
    ['Total Bills', bills.length],
    ['Total Amount', total],
    ['Parties', parties],
    ['From', bills[0] ? formatFullDate(datePart(bills[0].date)) : ''],
    ['To', bills.at(-1) ? formatFullDate(datePart(bills.at(-1)?.date)) : ''],
  ]
}

function buildBookRegisterRows(snapshot: BackupSnapshot, bills: PBRecord[]) {
  const billItemsByBill = groupBy(snapshot.data.billItems, (row) => String(row.bill ?? ''))
  return bills.map((bill) => [
    formatFullDate(datePart(bill.date)),
    billRef(bill),
    String(bill.customer_name ?? ''),
    formatInrInteger(billTotal(snapshot, bill)),
    itemDetails(billItemsByBill.get(bill.id) ?? []),
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
    .map((item) => ({
      itemName: String(item.item_name ?? ''),
      qty: num(item.qty),
      rate: num(item.rate),
      amount: num(item.amount),
      bags: num(item.bags),
    }))
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
  return createSimpleWorkbook(packageData.workbookSheets)
}

async function createSimpleWorkbook(workbookSheets: Array<{ name: string; rows: Array<Array<string | number>> }>) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', workbookContentTypes(workbookSheets.length))
  zip.folder('_rels')?.file('.rels', workbookRootRels())
  zip.folder('docProps')?.file('core.xml', workbookCoreXml(''))
  zip.folder('docProps')?.file('app.xml', workbookAppXml(workbookSheets.map((sheet) => sheet.name)))
  const xl = zip.folder('xl') ?? zip
  xl.file('workbook.xml', workbookXml(workbookSheets.map((sheet) => sheet.name)))
  xl.folder('_rels')?.file('workbook.xml.rels', workbookRels(workbookSheets.length))
  const sheets = xl.folder('worksheets') ?? xl
  workbookSheets.forEach((sheet, index) => {
    sheets.file(`sheet${index + 1}.xml`, worksheetXml(sheet.rows))
  })
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function workbookContentTypes(sheetCount: number) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
}

function workbookRootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
}

function workbookRels(sheetCount: number) {
  const rels = Array.from({ length: sheetCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
}

function workbookXml(sheetNames: string[]) {
  const sheets = sheetNames.map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`
}

function workbookCoreXml(_generatedLabel: string) {
  const now = new Date().toISOString()
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Kapil Pro</dc:creator><cp:lastModifiedBy>Kapil Pro</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
}

function workbookAppXml(sheetNames: string[]) {
  const vector = sheetNames.map((name) => `<vt:lpstr>${xmlEscape(name)}</vt:lpstr>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Kapil Pro</Application><TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${vector}</vt:vector></TitlesOfParts></Properties>`
}

function worksheetXml(rows: Array<Array<string | number>>) {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${columnName(columnIndex + 1)}${rowIndex + 1}`
          if (typeof cell === 'number' && Number.isFinite(cell)) return `<c r="${ref}"><v>${cell}</v></c>`
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(cell ?? ''))}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

function columnName(index: number) {
  let name = ''
  let current = index
  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }
  return name
}

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildPartyReadme(packageData: PartyPackage) {
  return [
    `PARTY LEDGER PACKAGE - ${packageData.customerName}`,
    '',
    `Period: ${packageData.periodLabel}`,
    `Generated: ${packageData.generatedLabel}`,
    'Company: Kapil Products',
    '',
    'PACKAGE CONTENTS:',
    '',
    `Bills/Images/ - ${packageData.bills.length} bill images in JPG format`,
    `Bills/PDFs/ - ${packageData.bills.length} bills in PDF format`,
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

function BackupPreview({ snapshot }: { snapshot: BackupSnapshot }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Metric label="Customers" value={snapshot.counts.customers} />
      <Metric label="Items" value={snapshot.counts.items} />
      <Metric label="Bills" value={snapshot.counts.bills} />
      <Metric label="Bill Items" value={snapshot.counts.billItems} />
      <Metric label="Payments" value={snapshot.counts.payments} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="font-mono text-lg font-bold text-slate-900">{value}</p>
    </div>
  )
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="font-mono text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{children}</th>
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
  if (display === 'General / Regular Stock') return display
  return company && company !== name ? `${company} (${name})` : name || company || row.id
}

function billRef(row: PBRecord) {
  return `${num(row.book_no)}/${num(row.bill_no)}`
}

function itemDetails(items: PBRecord[]) {
  return items.map((item) => `${String(item.item_name ?? '')} ${formatInQty(num(item.qty), 'kg')}`).join(' | ')
}

function datePart(value: unknown) {
  return String(value ?? '').slice(0, 10)
}

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10)
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

function compareEvent(a: { date: string; type: string }, b: { date: string; type: string }) {
  return a.date.localeCompare(b.date) || a.type.localeCompare(b.type)
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

function formatStockQty(value: number, item: { unit: string; bagWeight?: number }) {
  if (item.unit === 'kg') {
    const bagWeight = Number(item.bagWeight ?? 50) || 50
    const bags = value / bagWeight
    return `${formatInQty(value, 'kg')} / ${bags.toFixed(bags % 1 === 0 ? 0 : 1)} bags`
  }
  return formatInQty(value, item.unit || 'piece')
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
  'inline-flex h-10 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'

const secondaryButtonClass =
  'inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
