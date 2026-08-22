import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM, type BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { PartyListPanel } from '@/components/ledger/party-list-panel'
import { PartyTrendChart } from '@/components/ledger/party-trend-chart'
import { DateInput } from '@/components/ui/date-input'
import { buildBackupSnapshot, type BackupSnapshot } from '@/data/backup'
import { loadPartyDashboard, loadPartyStatement } from '@/data/ledger'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { getBillingUnit, isGasBillingItem } from '@/domain/billing-modes'
import { isOnOrBeforeDay } from '@/domain/financial-math'
import { BILL_PREVIEW_CARD_CLASS, BILL_PRINT_JPEG_QUALITY_DOWNLOAD } from '@/lib/bill-print-export'
import { formatCompanyName } from '@/lib/customer-display'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { exportNodeAsJpgBlob } from '@/lib/image-export'
import { BILL_JPEG_OUTPUT_WIDTH_PX } from '@/lib/image-export-config'
import { formatInQty, formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/ledger')({
  validateSearch: (search: Record<string, unknown>) => ({
    customerId: typeof search.customerId === 'string' ? search.customerId : '',
    focus: search.focus === 'overdue' ? 'overdue' : '',
  }),
  component: LedgerPage,
})

const actionButtonClass =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50'
const dateInputClass =
  'h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100'

function LedgerPage() {
  const search = Route.useSearch()
  const today = useMemo(() => getLocalIsoDate(), [])
  const [toDate, setToDate] = useState(today)
  const [fromDate, setFromDate] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [statementFilter, setStatementFilter] = useState<'all' | 'bills' | 'payments'>('all')
  const [statementPage, setStatementPage] = useState(1)
  const [exportStatus, setExportStatus] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const statementPageSize = 20
 
  const asOfDate = toDate || today

  const dashboardQuery = useQuery({
    queryKey: ['party-dashboard', asOfDate],
    queryFn: () => loadPartyDashboard(asOfDate, 30),
  })

  const rows = useMemo(() => dashboardQuery.data?.rows ?? [], [dashboardQuery.data?.rows])

  useEffect(() => {
    if (rows.length === 0) return
    if (search.customerId) {
      const exists = rows.some((row) => row.customerId === search.customerId)
      if (exists) {
        setSelectedCustomerId(search.customerId)
        return
      }
    }
    if (search.focus === 'overdue') {
      const mostOverdue = [...rows]
        .filter((row) => row.status === 'Overdue' && row.dueAmount > 0)
        .sort((a, b) => b.dueAmount - a.dueAmount)[0]
      if (mostOverdue) setSelectedCustomerId(mostOverdue.customerId)
    }
  }, [rows, search.customerId, search.focus])

  const selectedCustomerIdResolved = selectedCustomerId || rows[0]?.customerId || ''
  const statementQuery = useQuery({
    queryKey: ['party-statement', selectedCustomerIdResolved, asOfDate],
    enabled: Boolean(selectedCustomerIdResolved),
    queryFn: () => loadPartyStatement(selectedCustomerIdResolved, asOfDate),
  })

  const selectedRow = rows.find((row) => row.customerId === selectedCustomerIdResolved) ?? null

  function printStatement() {
    const statement = statementQuery.data
    if (!statement) return
    const htmlRows = statement.events
      .map(
        (event) => `<tr>
          <td>${escapeHtml(event.date === '-' ? '-' : formatFullDate(event.date))}</td>
          <td>${escapeHtml(event.type)}</td>
          <td>${escapeHtml(event.details)}${event.compactDetails ? `<br/><small>${escapeHtml(event.compactDetails)}</small>` : ''}</td>
          <td style="text-align:right">${Math.round(event.debit).toLocaleString('en-IN')}</td>
          <td style="text-align:right">${Math.round(event.credit).toLocaleString('en-IN')}</td>
          <td style="text-align:right">${Math.round(event.balance).toLocaleString('en-IN')}</td>
        </tr>`,
      )
      .join('')

    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=800')
    if (!printWindow) return
    printWindow.document.write(`
      <html>
        <head>
          <title>Party Statement - ${escapeHtml(statement.customerName)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 16px; }
            h1 { margin: 0 0 8px; font-size: 18px; }
            p { margin: 0 0 12px; color: #475569; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; }
            th { background: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(statement.customerName)} - Party Statement</h1>
          <p>As of ${escapeHtml(formatFullDate(asOfDate))}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Details</th><th>Debit</th><th>Credit</th><th>Balance</th>
              </tr>
            </thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  async function exportPartyPackage() {
    const partyId = selectedCustomerIdResolved
    if (!partyId || isExporting) return
    setIsExporting(true)
    setExportStatus('Preparing party export...')
    try {
      const snapshot = await buildBackupSnapshot()
      const packageData = buildLedgerPartyPackage(snapshot, partyId, asOfDate)
      if (!packageData) {
        setExportStatus('Select a valid party before exporting.')
        return
      }

      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      zip.file('Full_Statement.pdf', (await createLedgerReportPdf(packageData.statementTitle, packageData.subtitle, packageData.statementColumns, packageData.statementRows, packageData.statementSummary)).output('arraybuffer'))
      zip.file('Full_Statement.xlsx', await createSimpleWorkbook([{ name: 'Statement', rows: [packageData.statementColumns, ...packageData.statementRows] }]))
      zip.file('Quick_Summary.pdf', (await createLedgerReportPdf(`${packageData.customerName} Quick Summary`, packageData.subtitle, ['Metric', 'Value'], packageData.quickSummaryRows, [])).output('arraybuffer'))

      const billsFolder = zip.folder('Bills') ?? zip
      const billImagesFolder = billsFolder.folder('JPG') ?? billsFolder
      billsFolder.file('All_Bills.pdf', (await createLedgerReportPdf('All Bills', packageData.subtitle, packageData.billColumns, packageData.billRows, packageData.billSummary)).output('arraybuffer'))
      billsFolder.file('All_Bills.xlsx', await createSimpleWorkbook([{ name: 'Bills', rows: [packageData.billColumns, ...packageData.billRawRows] }]))

      const paymentsFolder = zip.folder('Payments') ?? zip
      paymentsFolder.file('All_Payments.pdf', (await createLedgerReportPdf('All Payments', packageData.subtitle, packageData.paymentColumns, packageData.paymentRows, packageData.paymentSummary)).output('arraybuffer'))
      paymentsFolder.file('All_Payments.xlsx', await createSimpleWorkbook([{ name: 'Payments', rows: [packageData.paymentColumns, ...packageData.paymentRawRows] }]))

      for (const bill of packageData.bills) {
        setExportStatus(`Rendering bill ${billRef(bill)}...`)
        const jpg = await createBillJpgBlob(snapshot, bill)
        billImagesFolder.file(`${partyBillFilename(bill)}.jpg`, jpg)
      }

      zip.file('Complete_Report.xlsx', await createSimpleWorkbook(packageData.workbookSheets))
      zip.file('README.txt', buildLedgerReadme(packageData))
      setExportStatus('Downloading party export...')
      downloadBlob(packageData.zipFilename, await zip.generateAsync({ type: 'blob' }))
      setExportStatus(`Export ready: ${packageData.bills.length} bills and ${packageData.payments.length} payments.`)
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : 'Unable to export party package.')
    } finally {
      setIsExporting(false)
    }
  }

  async function downloadStatementPdf() {
    const statement = statementQuery.data
    if (!statement) return
    const { createSimpleTablePdf } = await import('@/lib/exports/pdf-engine')
    const doc = await createSimpleTablePdf({
      title: `${statement.customerName} — Party Statement`,
      subtitle: `${fromDate ? `From ${formatFullDate(fromDate)} ` : ''}As of ${formatFullDate(asOfDate)} | Kapil Products`,
      columns: ['Date', 'Type', 'Details', 'Debit', 'Credit', 'Balance'],
      rows: [...filteredEvents].reverse().map((event) => [
        event.date === '-' ? '—' : formatFullDate(event.date),
        event.type,
        event.compactDetails ? `${event.details} — ${event.compactDetails}` : event.details,
        event.debit > 0 ? formatInrInteger(event.debit) : '',
        event.credit > 0 ? formatInrInteger(event.credit) : '',
        formatInrInteger(event.balance),
      ]),
      summary: [
        { label: 'Opening', value: formatInrInteger(selectedRow?.openingBalance ?? 0) },
        { label: 'Billed', value: formatInrInteger(selectedRow?.billedTotal ?? 0) },
        { label: 'Paid', value: formatInrInteger(selectedRow?.paidTotal ?? 0) },
        { label: 'Balance', value: formatInrInteger(selectedRow ? selectedRow.dueAmount || -selectedRow.advanceAmount : 0) },
      ],
    })
    doc.save(`${statement.customerName.replace(/[^\w]+/g, '_')}_statement.pdf`)
  }

  async function downloadStatementExcel() {
    const statement = statementQuery.data
    if (!statement) return
    const { createXlsxBlob } = await import('@/lib/exports/xlsx-workbook')
    const blob = await createXlsxBlob([
      {
        name: 'Statement',
        totalsLabel: 'Total',
        columns: [
          { header: 'Date', type: 'date' },
          { header: 'Type', type: 'text' },
          { header: 'Details', type: 'text' },
          { header: 'Debit', type: 'currency', total: true },
          { header: 'Credit', type: 'currency', total: true },
          { header: 'Balance', type: 'currency' },
        ],
        rows: [...filteredEvents].reverse().map((event) => [
          event.date === '-' ? '' : event.date,
          event.type,
          event.compactDetails ? `${event.details} — ${event.compactDetails}` : event.details,
          event.debit || null,
          event.credit || null,
          event.balance,
        ]),
      },
    ])
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${statement.customerName.replace(/[^\w]+/g, '_')}_statement.xlsx`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const analytics = useMemo(() => {
    const statement = statementQuery.data
    if (!statement) {
      return {
        monthDebit: 0,
        monthCredit: 0,
        yearDebit: 0,
        yearCredit: 0,
        highestBill: 0,
        highestPayment: 0,
        monthlyTrend: [] as Array<{ month: string; debit: number; credit: number }>,
        billingVsPrevMonthPct: 0,
        collectionVsPrevMonthPct: 0,
        averageMonthlyBilling: 0,
        averageMonthlyCollection: 0,
        highestBillingMonth: '-' as string,
        highestCollectionMonth: '-' as string,
        insights: [] as string[],
      }
    }

    const monthKey = toDate.slice(0, 7)
    const yearKey = toDate.slice(0, 4)
    let monthDebit = 0
    let monthCredit = 0
    let yearDebit = 0
    let yearCredit = 0
    let highestBill = 0
    let highestPayment = 0
    const monthlyMap = new Map<string, { debit: number; credit: number }>()

    for (const event of statement.events) {
      if (event.date === '-') continue
      const m = event.date.slice(0, 7)
      const y = event.date.slice(0, 4)
      const row = monthlyMap.get(m) ?? { debit: 0, credit: 0 }
      row.debit += event.debit
      row.credit += event.credit
      monthlyMap.set(m, row)
      if (m === monthKey) {
        monthDebit += event.debit
        monthCredit += event.credit
      }
      if (y === yearKey) {
        yearDebit += event.debit
        yearCredit += event.credit
      }
      highestBill = Math.max(highestBill, event.debit)
      highestPayment = Math.max(highestPayment, event.credit)
    }

    const monthlyTrend = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, vals]) => ({ month, debit: vals.debit, credit: vals.credit }))

    const currentMonth = monthlyTrend.at(-1)
    const previousMonth = monthlyTrend.at(-2)
    const billingVsPrevMonthPct =
      currentMonth && previousMonth && previousMonth.debit > 0 ? ((currentMonth.debit - previousMonth.debit) / previousMonth.debit) * 100 : 0
    const collectionVsPrevMonthPct =
      currentMonth && previousMonth && previousMonth.credit > 0 ? ((currentMonth.credit - previousMonth.credit) / previousMonth.credit) * 100 : 0
    const averageMonthlyBilling = monthlyTrend.length > 0 ? monthlyTrend.reduce((sum, entry) => sum + entry.debit, 0) / monthlyTrend.length : 0
    const averageMonthlyCollection = monthlyTrend.length > 0 ? monthlyTrend.reduce((sum, entry) => sum + entry.credit, 0) / monthlyTrend.length : 0
    const highestBillingMonth = monthlyTrend.reduce(
      (best, entry) => (entry.debit > best.value ? { label: entry.month, value: entry.debit } : best),
      { label: '-', value: 0 },
    ).label
    const highestCollectionMonth = monthlyTrend.reduce(
      (best, entry) => (entry.credit > best.value ? { label: entry.month, value: entry.credit } : best),
      { label: '-', value: 0 },
    ).label

    const insights: string[] = []
    if (selectedRow) {
      if (selectedRow.status === 'Overdue') insights.push(`Payment overdue by ${selectedRow.overdueDays} days`)
      if (billingVsPrevMonthPct > 0) insights.push(`Billing increased ${Math.round(billingVsPrevMonthPct)}% vs last month`)
      if (collectionVsPrevMonthPct < 0) insights.push(`Collection dropped ${Math.abs(Math.round(collectionVsPrevMonthPct))}% vs last month`)
      if (monthDebit > monthCredit && monthDebit > 0) insights.push('Collection is lagging behind billing this month')
      if (selectedRow.advanceAmount > 0) insights.push(`Customer carries advance of ${formatInrInteger(selectedRow.advanceAmount)}`)
    }

    return {
      monthDebit,
      monthCredit,
      yearDebit,
      yearCredit,
      highestBill,
      highestPayment,
      monthlyTrend,
      billingVsPrevMonthPct,
      collectionVsPrevMonthPct,
      averageMonthlyBilling,
      averageMonthlyCollection,
      highestBillingMonth,
      highestCollectionMonth,
      insights,
    }
  }, [statementQuery.data, selectedRow, toDate])


  const filteredEvents = useMemo(() => {
    let events = statementQuery.data?.events ?? []
    if (fromDate) {
      // Entries before the range collapse into one brought-forward row so the
      // running balance still reconciles.
      const before = events.filter((event) => event.date !== '-' && event.date < fromDate)
      const inRange = events.filter((event) => event.date === '-' ? false : event.date >= fromDate)
      const broughtForward = before.length > 0 ? before[before.length - 1].balance : (events[0]?.type === 'Opening' ? events[0].balance : 0)
      events = [
        {
          ...(events[0] ?? { id: 'bf', debit: 0, credit: 0, compactDetails: '' }),
          type: 'Opening',
          date: '-',
          details: `Brought forward (till ${formatFullDate(fromDate)})`,
          compactDetails: '',
          debit: 0,
          credit: 0,
          balance: broughtForward,
        },
        ...inRange,
      ]
    }
    if (statementFilter === 'bills') events = events.filter((event) => event.type === 'Bill')
    else if (statementFilter === 'payments') events = events.filter((event) => event.type === 'Payment')
    // Recent entries first — the balance was computed chronologically, so
    // reversing for display keeps every running balance correct.
    return [...events].reverse()
  }, [statementQuery.data?.events, statementFilter, fromDate])

  const totalStatementPages = Math.max(1, Math.ceil(filteredEvents.length / statementPageSize))
  const paginatedEvents = useMemo(() => {
    const start = (statementPage - 1) * statementPageSize
    return filteredEvents.slice(start, start + statementPageSize)
  }, [filteredEvents, statementPage])

  useEffect(() => {
    setStatementPage(1)
  }, [statementFilter, selectedCustomerIdResolved, fromDate, toDate])

  useEffect(() => {
    if (statementPage > totalStatementPages) setStatementPage(totalStatementPages)
  }, [statementPage, totalStatementPages])

  return (
    <div className="w-full px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
        <PartyListPanel
          rows={rows}
          kpis={dashboardQuery.data?.kpis ?? null}
          selectedId={selectedCustomerIdResolved}
          onSelect={setSelectedCustomerId}
        />

        <div className="min-w-0 space-y-4">
          {!selectedRow && (
            <div className="grid min-h-[360px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <div className="max-w-xs space-y-1">
                <p className="text-sm font-semibold text-slate-700">Select a party</p>
                <p className="text-xs text-slate-500">Pick a party from the list to see balances, trends, and the full statement.</p>
              </div>
            </div>
          )}

          {selectedRow && (
            <>
              {/* Party header: identity, balance, period, actions */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-slate-900">{selectedRow.customerName}</h2>
                      {selectedRow.status === 'Overdue' && selectedRow.dueAmount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">
                          <AlertTriangle size={11} /> {selectedRow.overdueDays}d overdue
                        </span>
                      ) : selectedRow.advanceAmount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          <CheckCircle2 size={11} /> Advance
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">Clear</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Closing balance{' '}
                      <strong className="font-mono text-sm text-slate-900">
                        {formatInrInteger(selectedRow.dueAmount || selectedRow.advanceAmount || 0)}
                      </strong>
                      {selectedRow.lastPaymentDate && <> · last payment {daysSinceDate(selectedRow.lastPaymentDate, asOfDate)}d ago</>}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={actionButtonClass} onClick={printStatement}>
                      <Printer size={13} /> Print
                    </button>
                    <button type="button" className={actionButtonClass} onClick={() => void downloadStatementPdf()}>
                      <FileText size={13} /> PDF
                    </button>
                    <button type="button" className={actionButtonClass} onClick={() => void downloadStatementExcel()}>
                      <FileSpreadsheet size={13} /> Excel
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                      onClick={() => void exportPartyPackage()}
                      disabled={isExporting}
                    >
                      <Download size={13} /> {isExporting ? 'Exporting...' : 'Full ZIP'}
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-slate-500">From (optional)</span>
                    <DateInput className={dateInputClass} value={fromDate} onChange={setFromDate} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-slate-500">As of</span>
                    <DateInput className={dateInputClass} value={toDate} onChange={(next) => setToDate(next || today)} />
                  </label>
                  {(fromDate || toDate !== today) && (
                    <button
                      type="button"
                      className="h-9 rounded-md px-2 text-xs font-semibold text-blue-700 hover:underline"
                      onClick={() => {
                        setFromDate('')
                        setToDate(today)
                      }}
                    >
                      Reset to today
                    </button>
                  )}
                  {exportStatus && <p className="text-xs font-medium text-slate-500" role="status">{exportStatus}</p>}
                </div>
              </section>

              {/* Snapshot cards */}
              <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div
                  className={`rounded-xl border p-4 ${
                    selectedRow.status === 'Overdue' && selectedRow.dueAmount > 0
                      ? 'border-rose-200 bg-rose-50/40'
                      : selectedRow.advanceAmount > 0
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    {selectedRow.advanceAmount > 0 ? 'Advance balance' : 'Current due'}
                  </p>
                  <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900">
                    {formatInrInteger(selectedRow.dueAmount || selectedRow.advanceAmount || 0)}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-dashed border-slate-200 pt-2">
                    <SummaryLine label="Opening" value={formatInrInteger(selectedRow.openingBalance)} />
                    <SummaryLine label="Billed" value={formatInrInteger(selectedRow.billedTotal)} />
                    <SummaryLine label="Paid" value={formatInrInteger(selectedRow.paidTotal)} />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">This month</p>
                  <div className="mt-2 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Billing</span>
                      <span className="font-mono tabular-nums text-slate-900">{formatInrInteger(analytics.monthDebit)}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Collection</span>
                      <span className="font-mono tabular-nums text-slate-900">{formatInrInteger(analytics.monthCredit)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-100 pt-1.5 font-semibold text-slate-900">
                      <span>Net</span>
                      <span className={`font-mono tabular-nums ${analytics.monthCredit - analytics.monthDebit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {analytics.monthCredit - analytics.monthDebit >= 0 ? '+' : '-'}
                        {formatInrInteger(Math.abs(analytics.monthCredit - analytics.monthDebit))}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Volume</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <SummaryLine label="Bills" value={String(selectedRow.billCount)} />
                    <SummaryLine label="Bags" value={String(Math.round(selectedRow.totalBags))} />
                    <SummaryLine label="Gas weight" value={formatInQty(Math.round(selectedRow.totalWeight))} />
                    <SummaryLine label="Avg rate" value={formatInrInteger(selectedRow.averageSellingRate)} />
                  </div>
                </div>
              </section>

              {/* Trend chart + insights */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Billing vs collection</h3>
                  <p className="text-xs text-slate-500">
                    Peak billing {analytics.highestBillingMonth === '-' ? '—' : formatMonthYear(analytics.highestBillingMonth)} · peak collection{' '}
                    {analytics.highestCollectionMonth === '-' ? '—' : formatMonthYear(analytics.highestCollectionMonth)}
                  </p>
                </div>
                <PartyTrendChart data={analytics.monthlyTrend} />
                {analytics.insights.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    {analytics.insights.slice(0, 3).map((line, index) => (
                      <span key={index} className="rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                        {line}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* Item-wise purchase summary */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">Item-wise purchases</h3>
                <div className="mt-3 max-h-[300px] overflow-auto rounded-lg border border-slate-200 no-scrollbar">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Bills</th>
                        <th className="px-3 py-2 text-right">Bags</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-right">Avg rate</th>
                        <th className="px-3 py-2 text-right">Last</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(statementQuery.data?.itemSummary ?? []).length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">No bill details recorded.</td>
                        </tr>
                      )}
                      {(statementQuery.data?.itemSummary ?? []).map((item, index) => (
                        <tr key={`${item.itemName}-${index}`} className="hover:bg-slate-50/60">
                          <td className="px-3 py-2 font-medium text-slate-900">{item.itemName}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">{item.billCount}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">{Math.round(item.totalBags)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">{Math.round(item.totalQty)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-slate-900">{formatInrInteger(item.totalAmount)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">{formatInrInteger(item.averageRate)}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-500">{item.lastDate ? formatFullDate(item.lastDate) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Statement */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-semibold text-slate-900">Statement</h3>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                    {([['all', 'All'], ['bills', 'Bills'], ['payments', 'Payments']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`rounded-md px-3 py-1 transition ${statementFilter === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                        onClick={() => setStatementFilter(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 no-scrollbar">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                        <th className="w-28 px-3 py-2">Date</th>
                        <th className="w-24 px-3 py-2">Type</th>
                        <th className="px-3 py-2">Details</th>
                        <th className="w-28 px-3 py-2 text-right">Debit</th>
                        <th className="w-28 px-3 py-2 text-right">Credit</th>
                        <th className="w-32 px-3 py-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {statementQuery.isLoading && (
                        <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">Loading statement…</td></tr>
                      )}
                      {statementQuery.data && paginatedEvents.length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">No matching entries.</td></tr>
                      )}
                      {paginatedEvents.map((event, index) => (
                        <tr key={index} className="hover:bg-slate-50/60">
                          <td className="px-3 py-2.5 text-slate-600">{event.date === '-' ? '—' : formatFullDate(event.date)}</td>
                          <td className="px-3 py-2.5">
                            {event.type === 'Bill' ? (
                              <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-100">Bill</span>
                            ) : event.type === 'Payment' ? (
                              <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">Received</span>
                            ) : (
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Opening</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-slate-800">{event.details}</div>
                            {event.compactDetails && <div className="mt-0.5 text-xs text-slate-500">{event.compactDetails}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800">
                            {event.debit > 0 ? formatInrInteger(event.debit) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-emerald-600">
                            {event.credit > 0 ? formatInrInteger(event.credit) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-slate-900">{formatInrInteger(event.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <p>
                    Showing {filteredEvents.length === 0 ? 0 : (statementPage - 1) * statementPageSize + 1}–
                    {Math.min(statementPage * statementPageSize, filteredEvents.length)} of {filteredEvents.length} entries
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStatementPage((current) => Math.max(1, current - 1))}
                      disabled={statementPage <= 1}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="font-mono font-semibold text-slate-800">{statementPage} / {totalStatementPages}</span>
                    <button
                      type="button"
                      onClick={() => setStatementPage((current) => Math.min(totalStatementPages, current + 1))}
                      disabled={statementPage >= totalStatementPages}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-mono tabular-nums ${strong ? 'text-base font-bold text-slate-950' : 'text-sm font-semibold text-slate-800'}`}>{value}</p>
    </div>
  )
}

function daysSinceDate(fromIsoDate: string, toIsoDate: string) {
  if (!fromIsoDate || !toIsoDate) return '-'
  const from = new Date(`${fromIsoDate}T00:00:00`)
  const to = new Date(`${toIsoDate}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '-'
  return String(Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))))
}

type PBRecord = Record<string, unknown> & { id: string }

type LedgerPartyPackage = {
  customerName: string
  subtitle: string
  zipFilename: string
  openingBalance: number
  closingBalance: number
  totalBills: number
  totalPayments: number
  bills: PBRecord[]
  payments: PBRecord[]
  statementTitle: string
  statementColumns: string[]
  statementRows: string[][]
  statementSummary: Array<{ label: string; value: string }>
  billColumns: string[]
  billRows: string[][]
  billRawRows: Array<Array<string | number>>
  billSummary: Array<{ label: string; value: string }>
  paymentColumns: string[]
  paymentRows: string[][]
  paymentRawRows: Array<Array<string | number>>
  paymentSummary: Array<{ label: string; value: string }>
  quickSummaryRows: string[][]
  workbookSheets: Array<{ name: string; rows: Array<Array<string | number>> }>
}

function buildLedgerPartyPackage(snapshot: BackupSnapshot, partyId: string, asOfDate: string): LedgerPartyPackage | null {
  const customer = snapshot.data.customers.find((row) => row.id === partyId)
  if (!customer) return null

  const customerName = formatCompanyName(customer.company_name, customer.name)
  const generatedLabel = new Date().toLocaleString()
  const billItemsByBill = groupBy(snapshot.data.billItems, (row) => String(row.bill ?? ''))
  const bills = snapshot.data.bills
    .filter((bill) => String(bill.customer ?? '') === partyId && datePart(bill.date) <= asOfDate)
    .sort(compareBillDate)
  const payments = snapshot.data.payments
    .filter((payment) => String(payment.customer ?? '') === partyId && datePart(payment.date) <= asOfDate)
    .sort((a, b) => datePart(a.date).localeCompare(datePart(b.date)))

  let balance = num(customer.opening_balance)
  const balanceAfterById = new Map<string, number>()
  const events = [
    ...bills.map((bill) => ({
      id: bill.id,
      date: datePart(bill.date),
      type: 'Bill',
      ref: billRef(bill),
      debit: billTotal(snapshot, bill),
      credit: 0,
      details: itemDetails(snapshot, billItemsByBill.get(bill.id) ?? []),
    })),
    ...payments.map((payment) => ({
      id: payment.id,
      date: datePart(payment.date),
      type: 'Payment',
      ref: String(payment.mode ?? 'Cash') || 'Cash',
      debit: 0,
      credit: num(payment.amount),
      details: String(payment.note ?? ''),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type))

  const statementRows = [['', 'Opening', 'Opening Balance', '', '', formatInrInteger(balance), 'Balance carried forward']]
  for (const event of events) {
    balance += event.debit - event.credit
    balanceAfterById.set(event.id, balance)
    statementRows.push([
      formatFullDate(event.date),
      event.type,
      event.ref,
      event.debit ? formatInrInteger(event.debit) : '',
      event.credit ? formatInrInteger(event.credit) : '',
      formatInrInteger(balance),
      event.details || '-',
    ])
  }

  const billColumns = ['Date', 'Bill No.', 'Items', 'Qty', 'Amount', 'Balance']
  const billRows = bills.map((bill) => {
    const items = billItemsByBill.get(bill.id) ?? []
    return [
      formatFullDate(datePart(bill.date)),
      billRef(bill),
      itemDetails(snapshot, items) || '-',
      formatExportQty(snapshot, items),
      formatInrInteger(billTotal(snapshot, bill)),
      formatInrInteger(balanceAfterById.get(bill.id) ?? 0),
    ]
  })
  const billRawRows = bills.map((bill) => {
    const items = billItemsByBill.get(bill.id) ?? []
    const qty = items.reduce((sum, item) => sum + num(item.qty), 0)
    return [
      datePart(bill.date),
      billRef(bill),
      itemDetails(snapshot, items) || '-',
      qty,
      billTotal(snapshot, bill),
      balanceAfterById.get(bill.id) ?? 0,
    ]
  })

  const paymentColumns = ['Date', 'Mode', 'Reference', 'Amount', 'Balance']
  const paymentRows = payments.map((payment) => [
    formatFullDate(datePart(payment.date)),
    String(payment.mode ?? 'Cash') || 'Cash',
    String(payment.note ?? ''),
    formatInrInteger(num(payment.amount)),
    formatInrInteger(balanceAfterById.get(payment.id) ?? 0),
  ])
  const paymentRawRows = payments.map((payment) => [
    datePart(payment.date),
    String(payment.mode ?? 'Cash') || 'Cash',
    String(payment.note ?? ''),
    num(payment.amount),
    balanceAfterById.get(payment.id) ?? 0,
  ])
  const totalBills = bills.reduce((sum, bill) => sum + billTotal(snapshot, bill), 0)
  const totalPayments = payments.reduce((sum, payment) => sum + num(payment.amount), 0)
  const openingBalance = num(customer.opening_balance)
  const periodLabel = `Full ledger to ${formatFullDate(asOfDate)}`
  const subtitle = `Party: ${customerName} | ${periodLabel} | Generated: ${generatedLabel}`
  const quickSummaryRows = [
    ['Party', customerName],
    ['Opening Balance', formatInrInteger(openingBalance)],
    ['Bills', `${formatInrInteger(totalBills)} (${bills.length})`],
    ['Payments', `${formatInrInteger(totalPayments)} (${payments.length})`],
    ['Closing Balance', formatInrInteger(balance)],
  ]

  return {
    customerName,
    subtitle,
    zipFilename: `${safeReadableFilename(customerName)}_party_export_${dateStamp()}.zip`,
    openingBalance,
    closingBalance: balance,
    totalBills,
    totalPayments,
    bills,
    payments,
    statementTitle: `${customerName} Full Statement`,
    statementColumns: ['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance', 'Details'],
    statementRows,
    statementSummary: [
      { label: 'Opening', value: formatInrInteger(openingBalance) },
      { label: 'Bills', value: formatInrInteger(totalBills) },
      { label: 'Payments', value: formatInrInteger(totalPayments) },
      { label: 'Closing', value: formatInrInteger(balance) },
    ],
    billColumns,
    billRows,
    billRawRows,
    billSummary: [
      { label: 'Bills', value: String(bills.length) },
      { label: 'Total', value: formatInrInteger(totalBills) },
    ],
    paymentColumns,
    paymentRows,
    paymentRawRows,
    paymentSummary: [
      { label: 'Payments', value: String(payments.length) },
      { label: 'Total', value: formatInrInteger(totalPayments) },
    ],
    quickSummaryRows,
    workbookSheets: [
      { name: 'Summary', rows: quickSummaryRows },
      { name: 'Statement', rows: [['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance', 'Details'], ...statementRows] },
      { name: 'Bills', rows: [billColumns, ...billRawRows] },
      { name: 'Payments', rows: [paymentColumns, ...paymentRawRows] },
    ],
  }
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
  const { createRoot } = await import('react-dom/client')
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
    .sort(compareBillDate)
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
  for (let index = 0; index < currentIdx; index += 1) previousBalance += billTotal(snapshot, allCustomerBills[index])
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
    lrList: String(selectedBill.lr_no ?? '').split(',').map((entry) => entry.trim()).filter(Boolean),
  }
}

async function createLedgerReportPdf(title: string, subtitle: string, columns: string[], rows: string[][], summary: Array<{ label: string; value: string }>) {
  const { createSimpleTablePdf } = await import('@/lib/exports/pdf-engine')
  return createSimpleTablePdf({ title, subtitle, columns, rows, summary })
}

function waitForRenderFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function createSimpleWorkbook(workbookSheets: Array<{ name: string; rows: Array<Array<string | number>> }>) {
  const { createXlsxBlob, inferSheetColumns } = await import('@/lib/exports/xlsx-workbook')
  return createXlsxBlob(
    workbookSheets.map((sheet) => {
      const [headers, ...rows] = sheet.rows
      const headerText = (headers ?? []).map((cell) => String(cell ?? ''))
      return { name: sheet.name, totalsLabel: 'Total', columns: inferSheetColumns(headerText, rows), rows }
    }),
  )
}










function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function buildLedgerReadme(packageData: LedgerPartyPackage) {
  return [
    `PARTY EXPORT - ${packageData.customerName}`,
    '',
    packageData.subtitle,
    '',
    'Full_Statement.pdf',
    'Full_Statement.xlsx',
    'Complete_Report.xlsx',
    'Quick_Summary.pdf',
    'Bills/All_Bills.pdf',
    'Bills/All_Bills.xlsx',
    'Bills/JPG/ - every bill as JPG',
    'Payments/All_Payments.pdf',
    'Payments/All_Payments.xlsx',
    '',
    `Opening Balance: ${formatInrInteger(packageData.openingBalance)}`,
    `Total Bills: ${formatInrInteger(packageData.totalBills)}`,
    `Total Payments: ${formatInrInteger(packageData.totalPayments)}`,
    `Closing Balance: ${formatInrInteger(packageData.closingBalance)}`,
  ].join('\n')
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
  if (gasQty > 0 && electronicQty > 0) return `${formatInQty(gasQty, 'kg')} / ${Math.round(electronicQty)} pcs`
  if (electronicQty > 0) return `${Math.round(electronicQty)} pcs`
  return formatInQty(gasQty, 'kg')
}

function findSnapshotItem(snapshot: BackupSnapshot, item: PBRecord) {
  const itemId = String(item.item ?? '')
  const itemName = String(item.item_name ?? '').trim().toLowerCase()
  return snapshot.data.items.find((row) => row.id === itemId || String(row.name ?? '').trim().toLowerCase() === itemName)
}

function compareBillDate(a: PBRecord, b: PBRecord) {
  return datePart(a.date).localeCompare(datePart(b.date)) || num(a.bill_no) - num(b.bill_no)
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

function safeReadableFilename(value: string) {
  return value.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_().-]/g, '').replace(/_+/g, '_').slice(0, 90) || 'Party'
}

function readableDate(value: string) {
  if (!value) return 'No-Date'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  const month = date.toLocaleString('en-US', { month: 'short' })
  return `${month}-${String(date.getDate()).padStart(2, '0')}-${date.getFullYear()}`
}

function partyBillFilename(bill: PBRecord) {
  return `Bill_${billRef(bill).replace(/\//g, '-')}_${readableDate(datePart(bill.date))}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
