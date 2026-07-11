import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Download, Search, User, AlertTriangle, CheckCircle2, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM, type BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { buildBackupSnapshot, type BackupSnapshot } from '@/data/backup'
import { loadPartyDashboard, loadPartyStatement } from '@/data/ledger'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { getBillingUnit, isGasBillingItem } from '@/domain/billing-modes'
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

  const maxTrendVal = useMemo(() => {
    let max = 1e-9
    for (const entry of analytics.monthlyTrend) {
      max = Math.max(max, entry.debit, entry.credit)
    }
    return max
  }, [analytics.monthlyTrend])

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
    <div className="w-full px-3 pb-10 pt-3 sm:px-4 lg:px-6 space-y-5">
      {/* Row 1: Party Selector & Actions */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <div className="w-full sm:w-72 relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              className={`${inputClass} pl-8 font-semibold text-xs`}
              value={selectedCustomerIdResolved}
              onChange={(event) => setSelectedCustomerId(event.target.value)}
            >
              <option value="" disabled>Choose a party...</option>
              {rows.map((row) => (
                <option key={row.customerId} value={row.customerId}>
                  {row.customerName}
                </option>
              ))}
            </select>
          </div>
          
          {selectedRow && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Status Badge */}
              {(() => {
                const isOverdue = selectedRow.status === 'Overdue' && selectedRow.dueAmount > 0
                const isAdvance = selectedRow.advanceAmount > 0
                return isOverdue ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700 border border-rose-100">
                    <AlertTriangle size={10} /> {selectedRow.overdueDays}d Overdue
                  </span>
                ) : isAdvance ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 border border-emerald-100">
                    <CheckCircle2 size={10} /> Advance Balance
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600 border border-slate-100">
                    Clear Account
                  </span>
                )
              })()}
              
              <span className="text-slate-300 font-light hidden sm:inline">|</span>
              <span className="text-xs text-slate-500 font-medium">
                Closing Balance: <strong className="font-mono text-slate-800">{formatInrInteger(selectedRow.dueAmount || selectedRow.advanceAmount || 0)}</strong>
              </span>
            </div>
          )}
        </div>

        {selectedRow && (
          <div className="flex items-center gap-2 print:hidden shrink-0">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 px-3.5 transition shadow-sm"
              onClick={printStatement}
            >
              <Printer size={13} /> Print Statement
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white px-3.5 transition shadow-sm disabled:opacity-60"
              onClick={() => void exportPartyPackage()}
              disabled={isExporting}
            >
              <Download size={13} /> {isExporting ? 'Exporting...' : 'Export ZIP'}
            </button>
          </div>
        )}
      </section>

      {exportStatus && <p className="text-[10px] text-slate-455 font-semibold px-1" role="status">{exportStatus}</p>}

      {!selectedRow && (
        <div className="grid min-h-[400px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center p-6 print:hidden">
          <div className="max-w-xs space-y-1">
            <User size={32} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-bold text-slate-750">Select a Party</p>
            <p className="text-xs text-slate-400">Choose a party from the selector dropdown in the top row to visualize billing trends, monthly gaps, and full ledger statements.</p>
          </div>
        </div>
      )}

      {selectedRow && (
        <div className="space-y-5">
          {/* Row 2: Customer Snapshot Cards */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Current Due Card */}
            {(() => {
              const isOverdue = selectedRow.status === 'Overdue' && selectedRow.dueAmount > 0
              const isAdvance = selectedRow.advanceAmount > 0
              const colorClass = isOverdue
                ? 'border-rose-200 bg-rose-50/40 text-rose-900'
                : isAdvance
                ? 'border-emerald-200 bg-emerald-50/40 text-emerald-900'
                : 'border-slate-200 bg-slate-50/40 text-slate-900'
              return (
                <div className={`rounded-xl border p-4 space-y-2.5 ${colorClass}`}>
                  <div className="flex justify-between items-center">
                    <span className={`text-[10px] uppercase font-bold tracking-wider ${isOverdue ? 'text-rose-500' : isAdvance ? 'text-emerald-500' : 'text-slate-400'}`}>
                      {isAdvance ? 'Advance Balance' : 'Current Due'}
                    </span>
                    {isOverdue && (
                      <span className="rounded bg-rose-100 px-2 py-0.5 text-[8px] font-black text-rose-700 uppercase">
                        Overdue
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xl font-bold tracking-tight">
                    {formatInrInteger(selectedRow.dueAmount || selectedRow.advanceAmount || 0)}
                  </p>
                  <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-dashed border-slate-200/50 text-[9px] font-semibold text-slate-500">
                    <SummaryLine label="Opening" value={formatInrInteger(selectedRow.openingBalance)} />
                    <SummaryLine label="Billed" value={formatInrInteger(selectedRow.billedTotal)} />
                    <SummaryLine label="Paid" value={formatInrInteger(selectedRow.paidTotal)} />
                  </div>
                </div>
              )
            })()}

            {/* Monthly Performance Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">This Month</span>
              <div className="space-y-1.5 text-[11px] font-medium text-slate-500">
                <SummaryLine label="Billing" value={formatInrInteger(analytics.monthDebit)} />
                <SummaryLine label="Collection" value={formatInrInteger(analytics.monthCredit)} />
                <div className="flex justify-between items-center py-1 border-t border-slate-100 text-xs font-bold text-slate-900">
                  <span>Net Difference</span>
                  <span className={analytics.monthCredit - analytics.monthDebit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                    {analytics.monthCredit - analytics.monthDebit >= 0 ? '+' : '-'}
                    {formatInrInteger(Math.abs(analytics.monthCredit - analytics.monthDebit))}
                  </span>
                </div>
              </div>
            </div>

            {/* Purchase Summary Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">Volume Summary</span>
              <span className="block text-[11px] font-bold text-slate-700 truncate">
                {statementQuery.data?.itemSummary?.[0]?.itemName ?? 'All Items'}
              </span>
              <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 text-[10px] font-medium text-slate-500 pt-0.5">
                <SummaryLine label="Total Bills" value={String(selectedRow.billCount)} />
                <SummaryLine label="Total Bags" value={String(Math.round(selectedRow.totalBags))} />
                <SummaryLine label="Gas Weight" value={`${Math.round(selectedRow.totalWeight)} kg`} />
                <SummaryLine label="Avg Rate" value={formatInrInteger(selectedRow.averageSellingRate)} />
              </div>
            </div>
          </section>

          {/* Row 3: Visualization & Insights */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Visual vertical grouped bar chart */}
            <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Billing vs Collection Trend</h3>
                <div className="flex items-center gap-3 text-[10px] font-bold">
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-blue-500 block" />
                    <span className="text-slate-500">Billed</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-emerald-500 block" />
                    <span className="text-slate-500">Received</span>
                  </div>
                </div>
              </div>

              {analytics.monthlyTrend.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-8 text-center">No trend data available.</p>
              ) : (
                <div className="space-y-4 pt-1">
                  {/* Vertical bars container */}
                  <div className="flex h-48 items-end gap-3 sm:gap-4 border-b border-slate-200 pb-2 pt-4 relative">
                    {/* Grid lines in background */}
                    <div className="absolute inset-x-0 top-0 bottom-2 flex flex-col justify-between pointer-events-none text-[8px] text-slate-350 font-bold select-none z-0">
                      <div className="border-b border-slate-100 w-full pb-0.5"></div>
                      <div className="border-b border-slate-100 w-full pb-0.5"></div>
                      <div className="border-b border-slate-100 w-full pb-0.5"></div>
                      <div className="border-b border-slate-100 w-full pb-0.5"></div>
                    </div>
                    
                    {/* Bars */}
                    {analytics.monthlyTrend.map((entry) => {
                      const billingHeight = (entry.debit / maxTrendVal) * 100
                      const collectionHeight = (entry.credit / maxTrendVal) * 100
                      return (
                        <div key={entry.month} className="flex-1 flex flex-col items-center h-full justify-end z-10 group">
                          <div className="flex items-end gap-1 w-full justify-center h-full">
                            {/* Billing bar */}
                            <div className="relative group/bar flex justify-center items-end h-full w-4 sm:w-5">
                              {/* Tooltip */}
                              <div className="absolute bottom-full mb-1 hidden group-hover/bar:block bg-slate-900 text-white text-[9px] px-1.5 py-0.5 rounded font-mono z-30 whitespace-nowrap shadow-md">
                                Billed: {formatInrInteger(entry.debit)}
                              </div>
                              <div
                                className="bg-blue-500 rounded-t w-full transition-all duration-500 hover:bg-blue-600 cursor-pointer"
                                style={{ height: `${billingHeight}%` }}
                              />
                            </div>
                            {/* Collection bar */}
                            <div className="relative group/bar flex justify-center items-end h-full w-4 sm:w-5">
                              {/* Tooltip */}
                              <div className="absolute bottom-full mb-1 hidden group-hover/bar:block bg-slate-900 text-white text-[9px] px-1.5 py-0.5 rounded font-mono z-30 whitespace-nowrap shadow-md">
                                Received: {formatInrInteger(entry.credit)}
                              </div>
                              <div
                                className="bg-emerald-500 rounded-t w-full transition-all duration-500 hover:bg-emerald-600 cursor-pointer"
                                style={{ height: `${collectionHeight}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-slate-500 mt-2 truncate max-w-full text-center">
                            {formatMonthYear(entry.month)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Insights Panel */}
            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent Insights</h3>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide font-bold space-y-1">
                <p>Peak Bill: <strong className="text-slate-800">{analytics.highestBillingMonth === '-' ? '—' : formatMonthYear(analytics.highestBillingMonth)}</strong></p>
                <p>Peak Recv: <strong className="text-slate-800">{analytics.highestCollectionMonth === '-' ? '—' : formatMonthYear(analytics.highestCollectionMonth)}</strong></p>
                {selectedRow.lastPaymentDate && (
                  <p>Days since last payment: <strong className="text-slate-800">{daysSinceDate(selectedRow.lastPaymentDate, asOfDate)}</strong></p>
                )}
              </div>
              <div className="space-y-2 pt-3 border-t border-slate-100">
                {analytics.insights.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No urgent insights or anomalies found for this party.</p>
                ) : (
                  analytics.insights.map((line, idx) => (
                    <div key={idx} className="flex gap-2 items-start text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-150">
                      <span className="text-blue-500 font-bold">•</span>
                      <span>{line}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* Row 4: Item-wise Purchase Summary */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Item-wise Purchase Summary</h3>
              <p className="text-[11px] text-slate-400 font-semibold">Compact purchase mix showing quantities, total values, and average rates.</p>
            </div>
            <div className="max-h-[300px] overflow-auto rounded-xl border border-slate-200 no-scrollbar">
              <table className="w-full min-w-[720px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider text-left bg-slate-50/50">
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Item Name</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600 w-20">Bills</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600 w-24">Bags</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600 w-28">Qty</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600 w-32">Amount</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600 w-28">Avg Rate</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600 w-28">Last Purchased</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {(statementQuery.data?.itemSummary ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-400 italic">No bill details recorded.</td>
                    </tr>
                  )}
                  {(statementQuery.data?.itemSummary ?? []).map((item, idx) => (
                    <tr key={`${item.itemName}-${idx}`} className="hover:bg-slate-50/20 transition">
                      <td className="px-3 py-2.5 font-medium text-slate-900">{item.itemName}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{item.billCount}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{Math.round(item.totalBags)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{Math.round(item.totalQty)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-slate-900">{formatInrInteger(item.totalAmount)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatInrInteger(item.averageRate)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600">{item.lastDate ? formatFullDate(item.lastDate) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Row 5: Party Statement Ledger Table */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Party Ledger Book</h3>
                <p className="text-[11px] text-slate-400 font-semibold">Ledger entries for bills and payments.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    className={`rounded-md px-2.5 py-1 transition ${statementFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    onClick={() => setStatementFilter('all')}
                  >
                    All Entries
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-2.5 py-1 transition ${statementFilter === 'bills' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    onClick={() => setStatementFilter('bills')}
                  >
                    Bills Only
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-2.5 py-1 transition ${statementFilter === 'payments' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    onClick={() => setStatementFilter('payments')}
                  >
                    Payments Only
                  </button>
                </div>
              </div>
            </div>

            {/* Statement Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 no-scrollbar">
              <table className="w-full min-w-[720px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider text-left bg-slate-50/50">
                    <th className="px-3 py-2 text-left font-bold text-slate-600 w-28">Date</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600 w-20">Type</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Details</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600 w-28">Debit (Bill)</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600 w-28">Credit (Recv)</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600 w-32">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {statementQuery.isLoading && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-400">Loading statement entries...</td>
                    </tr>
                  )}
                  {statementQuery.data && paginatedEvents.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-400 italic">No matching entries found.</td>
                    </tr>
                  )}
                  {paginatedEvents.map((event, idx) => {
                    const isBill = event.type === 'Bill'
                    const isPayment = event.type === 'Payment'
                    return (
                      <tr key={idx} className="hover:bg-slate-50/20 transition">
                        <td className="px-3 py-2.5 text-slate-650">{event.date === '-' ? '—' : formatFullDate(event.date)}</td>
                        <td className="px-3 py-2.5">
                          {isBill ? (
                            <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-700 border border-blue-100">
                              BILL
                            </span>
                          ) : isPayment ? (
                            <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 border border-emerald-100">
                              RECV
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-slate-50 px-2 py-0.5 text-[9px] font-semibold text-slate-600 border border-slate-100">
                              START
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-slate-800">{event.details}</div>
                          {event.compactDetails && (
                            <div className="text-[10px] text-slate-450 mt-0.5 font-semibold">{event.compactDetails}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800 font-medium">
                          {event.debit > 0 ? formatInrInteger(event.debit) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-600 font-bold">
                          {event.credit > 0 ? formatInrInteger(event.credit) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900 font-extrabold">
                          {formatInrInteger(event.balance)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Table Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 pt-2 border-t border-slate-100">
              <p className="font-semibold text-[10px] uppercase tracking-wider text-slate-400">
                Showing {filteredEvents.length === 0 ? 0 : (statementPage - 1) * statementPageSize + 1}-
                {Math.min(statementPage * statementPageSize, filteredEvents.length)} of {filteredEvents.length} entries
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStatementPage((current) => Math.max(1, current - 1))}
                  disabled={statementPage <= 1}
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold uppercase text-slate-700 px-3 py-1.5 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="font-mono text-slate-800 font-bold">
                  {statementPage} / {totalStatementPages}
                </span>
                <button
                  type="button"
                  onClick={() => setStatementPage((current) => Math.min(totalStatementPages, current + 1))}
                  disabled={statementPage >= totalStatementPages}
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold uppercase text-slate-700 px-3 py-1.5 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
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
