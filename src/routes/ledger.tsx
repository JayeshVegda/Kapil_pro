import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM, type BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { buildBackupSnapshot, type BackupSnapshot } from '@/data/backup'
import { loadPartyDashboard, loadPartyStatement } from '@/data/ledger'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { isOnOrBeforeDay } from '@/domain/financial-math'
import { BILL_PREVIEW_CARD_CLASS, BILL_PRINT_JPEG_QUALITY_DOWNLOAD } from '@/lib/bill-print-export'
import { formatCompanyName } from '@/lib/customer-display'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { BILL_JPEG_OUTPUT_WIDTH_PX, exportNodeAsJpgBlob } from '@/lib/image-export'
import { formatInQty, formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/ledger')({
  validateSearch: (search: Record<string, unknown>) => ({
    customerId: typeof search.customerId === 'string' ? search.customerId : '',
    focus: search.focus === 'overdue' ? 'overdue' : '',
  }),
  component: LedgerPage,
})

function LedgerPage() {
  const search = Route.useSearch()
  const today = useMemo(() => getLocalIsoDate(), [])
  const toDate = today
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

      const zip = new JSZip()
      zip.file('Full_Statement.pdf', createLedgerReportPdf(packageData.statementTitle, packageData.subtitle, packageData.statementColumns, packageData.statementRows, packageData.statementSummary).output('arraybuffer'))
      zip.file('Full_Statement.xlsx', await createSimpleWorkbook([{ name: 'Statement', rows: [packageData.statementColumns, ...packageData.statementRows] }]))
      zip.file('Quick_Summary.pdf', createLedgerReportPdf(`${packageData.customerName} Quick Summary`, packageData.subtitle, ['Metric', 'Value'], packageData.quickSummaryRows, []).output('arraybuffer'))

      const billsFolder = zip.folder('Bills') ?? zip
      const billImagesFolder = billsFolder.folder('JPG') ?? billsFolder
      billsFolder.file('All_Bills.pdf', createLedgerReportPdf('All Bills', packageData.subtitle, packageData.billColumns, packageData.billRows, packageData.billSummary).output('arraybuffer'))
      billsFolder.file('All_Bills.xlsx', await createSimpleWorkbook([{ name: 'Bills', rows: [packageData.billColumns, ...packageData.billRawRows] }]))

      const paymentsFolder = zip.folder('Payments') ?? zip
      paymentsFolder.file('All_Payments.pdf', createLedgerReportPdf('All Payments', packageData.subtitle, packageData.paymentColumns, packageData.paymentRows, packageData.paymentSummary).output('arraybuffer'))
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
    const events = statementQuery.data?.events ?? []
    if (statementFilter === 'all') return events
    if (statementFilter === 'bills') return events.filter((event) => event.type === 'Bill')
    return events.filter((event) => event.type === 'Payment')
  }, [statementQuery.data?.events, statementFilter])

  const totalStatementPages = Math.max(1, Math.ceil(filteredEvents.length / statementPageSize))
  const paginatedEvents = useMemo(() => {
    const start = (statementPage - 1) * statementPageSize
    return filteredEvents.slice(start, start + statementPageSize)
  }, [filteredEvents, statementPage])

  useEffect(() => {
    setStatementPage(1)
  }, [statementFilter, selectedCustomerIdResolved])

  useEffect(() => {
    if (statementPage > totalStatementPages) setStatementPage(totalStatementPages)
  }, [statementPage, totalStatementPages])

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Party Analytics Dashboard</h2>
          <p className="text-xs text-slate-500">As of {formatFullDate(asOfDate)}</p>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className={inputClass} value={selectedCustomerIdResolved} onChange={(event) => setSelectedCustomerId(event.target.value)}>
              {rows.map((row) => (
                <option key={row.customerId} value={row.customerId}>
                  {row.customerName}
                </option>
              ))}
            </select>
            <button type="button" className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => void exportPartyPackage()} disabled={!selectedCustomerIdResolved || isExporting}>
              <Download size={14} />
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
          </div>
          {exportStatus && <p className="text-xs text-slate-500" role="status" aria-live="polite">{exportStatus}</p>}
          {dashboardQuery.isSuccess && rows.length === 0 && (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              No party data yet. Add customer bills/payments to see analytics.
            </p>
          )}
        </div>
      </section>

      {selectedRow && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Party snapshot</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-950">{selectedRow.customerName}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Last bill: {selectedRow.lastBillDate ? formatFullDate(selectedRow.lastBillDate) : '-'} | Last payment: {selectedRow.lastPaymentDate ? formatFullDate(selectedRow.lastPaymentDate) : '-'}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Days since payment</p>
                <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900">{daysSinceDate(selectedRow.lastPaymentDate, asOfDate)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.15fr_1fr_1fr]">
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-rose-700">Current Due</p>
                <p className="mt-2 font-mono text-3xl font-bold tracking-normal text-rose-900">{formatInrInteger(selectedRow.dueAmount)}</p>
                {selectedRow.advanceAmount > 0 && <p className="mt-1 text-sm font-medium text-emerald-700">Advance: {formatInrInteger(selectedRow.advanceAmount)}</p>}
                <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                  <SummaryLine label="Opening" value={formatInrInteger(selectedRow.openingBalance)} />
                  <SummaryLine label="Billed" value={formatInrInteger(selectedRow.billedTotal)} />
                  <SummaryLine label="Paid" value={formatInrInteger(selectedRow.paidTotal)} />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Monthly Performance</p>
                <div className="mt-3 space-y-2">
                  <SummaryLine label="This Month Billing" value={formatInrInteger(analytics.monthDebit)} />
                  <SummaryLine label="This Month Collection" value={formatInrInteger(analytics.monthCredit)} />
                  <SummaryLine label="Net Gap" value={`${analytics.monthCredit - analytics.monthDebit >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(analytics.monthCredit - analytics.monthDebit))}`} strong />
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Highest bill {formatInrInteger(analytics.highestBill)} | highest payment {formatInrInteger(analytics.highestPayment)}
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Purchase Summary</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{statementQuery.data?.itemSummary?.[0]?.itemName ?? 'All items'}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <SummaryLine label="Bills" value={String(selectedRow.billCount)} />
                  <SummaryLine label="Bags" value={String(Math.round(selectedRow.totalBags))} />
                  <SummaryLine label="Weight" value={`${Math.round(selectedRow.totalWeight)} kg`} />
                  <SummaryLine label="Avg Rate" value={formatInrInteger(selectedRow.averageSellingRate)} />
                  <SummaryLine label="Avg Weight" value={`${Math.round(selectedRow.averageSellingWeight)} kg`} />
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Billing vs Collection</p>
                <div className="space-y-2">
                  {analytics.monthlyTrend.length === 0 && <p className="text-sm text-slate-500">No monthly trend data yet.</p>}
                  {analytics.monthlyTrend.map((entry) => (
                    <div key={entry.month} className="grid grid-cols-[70px_1fr_1fr_1fr] items-center gap-2 text-xs">
                      <span className="font-medium text-slate-700">{formatMonthYear(entry.month)}</span>
                      <span className="rounded bg-blue-100 px-2 py-1 text-right font-mono text-blue-700">{formatInrInteger(entry.debit)}</span>
                      <span className="rounded bg-emerald-100 px-2 py-1 text-right font-mono text-emerald-700">{formatInrInteger(entry.credit)}</span>
                      <span className={`rounded px-2 py-1 text-right font-mono ${entry.debit - entry.credit > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {formatInrInteger(Math.abs(entry.debit - entry.credit))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Recent Insight</p>
                <p className="mb-2 text-xs text-slate-600">
                  Peak billing month: <span className="font-semibold text-slate-900">{analytics.highestBillingMonth === '-' ? '-' : formatMonthYear(analytics.highestBillingMonth)}</span> | Peak collection month:{' '}
                  <span className="font-semibold text-slate-900">{analytics.highestCollectionMonth === '-' ? '-' : formatMonthYear(analytics.highestCollectionMonth)}</span>
                </p>
                <ul className="space-y-1 text-sm text-slate-700">
                  {analytics.insights.length === 0 && <li>No urgent insight for selected period.</li>}
                  {analytics.insights.map((line, idx) => (
                    <li key={idx}>- {line}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-900">Item-wise Purchase Summary</h3>
              <p className="text-xs text-slate-500">Compact purchase mix with quantity, amount, and average rate.</p>
            </div>
            <div className="max-h-[320px] overflow-auto rounded-md border border-slate-100 no-scrollbar">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Item</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Bills</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Bags</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Qty (kg)</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Avg Rate</th>
                    <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Last Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(statementQuery.data?.itemSummary ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                        No item-level bill details found for this party.
                      </td>
                    </tr>
                  )}
                  {(statementQuery.data?.itemSummary ?? []).map((item, index) => (
                    <tr key={`${item.itemName}-${index}`} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                      <td className="px-3 py-2.5 text-sm font-medium text-slate-800">{item.itemName}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-slate-700">{item.billCount}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-slate-700">{Math.round(item.totalBags)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-slate-700">{Math.round(item.totalQty)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm font-semibold text-slate-900">{formatInrInteger(item.totalAmount)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-slate-700">{formatInrInteger(item.averageRate)}</td>
                      <td className="px-3 py-2.5 text-sm text-slate-700">{item.lastDate ? formatFullDate(item.lastDate) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Party Statement</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`rounded-md border px-2.5 py-1 text-xs ${statementFilter === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700'}`} onClick={() => setStatementFilter('all')}>All</button>
            <button type="button" className={`rounded-md border px-2.5 py-1 text-xs ${statementFilter === 'bills' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700'}`} onClick={() => setStatementFilter('bills')}>Bills</button>
            <button type="button" className={`rounded-md border px-2.5 py-1 text-xs ${statementFilter === 'payments' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700'}`} onClick={() => setStatementFilter('payments')}>Payments</button>
            <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50" onClick={printStatement}>
              Print / Export
            </button>
          </div>
        </div>
        {selectedRow && (
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatementFact label="Last payment" value={selectedRow.lastPaymentDate ? formatFullDate(selectedRow.lastPaymentDate) : '-'} />
            <StatementFact label="Last bill" value={selectedRow.lastBillDate ? formatFullDate(selectedRow.lastBillDate) : '-'} />
            <StatementFact label="Highest bill" value={formatInrInteger(analytics.highestBill)} />
            <StatementFact label="Days since payment" value={String(daysSinceDate(selectedRow.lastPaymentDate, asOfDate))} />
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <p>
            Showing {filteredEvents.length === 0 ? 0 : (statementPage - 1) * statementPageSize + 1}-
            {Math.min(statementPage * statementPageSize, filteredEvents.length)} of {filteredEvents.length} entries
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStatementPage((current) => Math.max(1, current - 1))}
              disabled={statementPage <= 1}
              className="rounded-md border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Prev
            </button>
            <span>
              Page {statementPage} / {totalStatementPages}
            </span>
            <button
              type="button"
              onClick={() => setStatementPage((current) => Math.min(totalStatementPages, current + 1))}
              disabled={statementPage >= totalStatementPages}
              className="rounded-md border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
        {statementQuery.isLoading && <p className="text-sm text-slate-500">Loading statement...</p>}
        {statementQuery.isError && <p className="text-sm text-red-600">Unable to load statement.</p>}
        {statementQuery.data && (
          <div className="max-h-[480px] overflow-auto rounded-md border border-slate-100 no-scrollbar">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Date</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Type</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Details</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Debit</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Credit</th>
                  <th className="sticky right-0 top-0 z-20 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 shadow-[-8px_0_12px_-14px_rgba(15,23,42,0.8)]">Balance</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEvents.map((event, index) => (
                  <tr
                    key={event.id}
                    className={`border-t border-slate-100 bg-white transition hover:bg-slate-50 ${index % 2 === 0 ? '' : 'bg-slate-50/30'}`}
                  >
                    <td className="px-3 py-3 text-sm text-slate-700">{event.date === '-' ? '-' : formatShortDate(event.date)}</td>
                    <td className="px-3 py-3 text-sm text-slate-700"><TypeBadge type={event.type} /></td>
                    <td className="px-3 py-3 text-sm text-slate-700">
                      <p>{event.details}</p>
                      {event.compactDetails ? <p className="mt-0.5 text-xs text-slate-500">{event.compactDetails}</p> : null}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-800">{event.debit > 0 ? formatInrInteger(event.debit) : '-'}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-800">{event.credit > 0 ? formatInrInteger(event.credit) : '-'}</td>
                    <td className="sticky right-0 bg-inherit px-3 py-3 text-right font-mono text-sm font-semibold text-slate-900 shadow-[-8px_0_12px_-14px_rgba(15,23,42,0.8)]">{formatSignedBalance(event.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {statementQuery.data && filteredEvents.length === 0 && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No statement rows for selected filter.</p>
        )}
      </section>
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

function StatementFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-0.5 truncate font-mono text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function TypeBadge({ type }: { type: 'Opening' | 'Bill' | 'Payment' }) {
  const className =
    type === 'Bill'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : type === 'Payment'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-slate-100 text-slate-700'
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>{type}</span>
}

function formatSignedBalance(balance: number) {
  if (balance > 0) return `${formatInrInteger(balance)} Due`
  if (balance < 0) return `${formatInrInteger(Math.abs(balance))} Advance`
  return formatInrInteger(0)
}

function daysSinceDate(fromIsoDate: string, toIsoDate: string) {
  if (!fromIsoDate || !toIsoDate) return '-'
  const from = new Date(`${fromIsoDate}T00:00:00`)
  const to = new Date(`${toIsoDate}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '-'
  return String(Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))))
}

function formatShortDate(dateText: string) {
  if (!dateText) return '-'
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateText
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
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
      details: itemDetails(billItemsByBill.get(bill.id) ?? []),
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
    const qty = items.reduce((sum, item) => sum + num(item.qty), 0)
    return [
      formatFullDate(datePart(bill.date)),
      billRef(bill),
      itemDetails(items) || '-',
      formatInQty(qty, 'kg'),
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
      itemDetails(items) || '-',
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

function createLedgerReportPdf(title: string, subtitle: string, columns: string[], rows: string[][], summary: Array<{ label: string; value: string }>) {
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
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
  doc.text(subtitle.slice(0, 130), 28, 48)
  doc.setTextColor(15, 23, 42)

  let startY = 92
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
    didDrawPage: () => addLedgerPdfFooter(doc),
  })
  return doc
}

function addLedgerPdfFooter(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text('Kapil Products | Generated from Kapil Pro', 28, pageHeight - 18)
  doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - 28, pageHeight - 18, { align: 'right' })
  doc.setTextColor(15, 23, 42)
}

function lastAutoTableY(doc: jsPDF) {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 90
}

function reportColumnStyles(columns: string[]) {
  const styles: Record<number, { halign?: 'left' | 'center' | 'right'; cellWidth?: number }> = {}
  columns.forEach((column, index) => {
    if (['Debit', 'Credit', 'Balance', 'Amount', 'Qty', 'Value'].includes(column)) styles[index] = { halign: 'right' }
    if (column === 'Details' || column === 'Items') styles[index] = { ...(styles[index] ?? {}), cellWidth: 170 }
  })
  return styles
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
    .sort(compareBillDate)
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

function waitForRenderFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function createSimpleWorkbook(workbookSheets: Array<{ name: string; rows: Array<Array<string | number>> }>) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', workbookContentTypes(workbookSheets.length))
  zip.folder('_rels')?.file('.rels', workbookRootRels())
  zip.folder('docProps')?.file('core.xml', workbookCoreXml())
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

function workbookCoreXml() {
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

function itemDetails(items: PBRecord[]) {
  return items.map((item) => `${String(item.item_name ?? '')} ${formatInQty(num(item.qty), 'kg')}`).join(' | ')
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

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
