import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { loadPartyDashboard, loadPartyStatement } from '@/data/ledger'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

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
  const statementPageSize = 20

  const asOfDate = toDate || today

  const dashboardQuery = useQuery({
    queryKey: ['party-dashboard', asOfDate],
    queryFn: () => loadPartyDashboard(asOfDate, 30),
  })

  const rows = dashboardQuery.data?.rows ?? []

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
          <td>${escapeHtml(event.details)}</td>
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

  const decisionModel = useMemo(() => {
    if (!selectedRow) {
      return {
        healthStatus: 'Good' as const,
        overdueAmount: 0,
        lastPaymentAgo: '-',
        paymentBehavior: 'Irregular',
        riskSignals: [] as string[],
      }
    }
    const overdueAmount = selectedRow.status === 'Overdue' ? selectedRow.dueAmount : 0
    const hasLastPayment = Boolean(selectedRow.lastPaymentDate)
    const lastPaymentDays = daysAgo(selectedRow.lastPaymentDate, asOfDate)
    const healthStatus: 'Good' | 'Risk' | 'Overdue' =
      selectedRow.status === 'Overdue' ? 'Overdue' : selectedRow.dueAmount > 50000 || lastPaymentDays > 45 ? 'Risk' : 'Good'
    const paymentBehavior =
      !hasLastPayment ? 'Irregular' : selectedRow.status === 'Overdue' ? 'Late' : lastPaymentDays <= 30 ? 'On-time' : lastPaymentDays <= 60 ? 'Irregular' : 'Late'
    const riskSignals: string[] = []
    if (selectedRow.dueAmount >= 100000) riskSignals.push(`Large unpaid amount: ${formatInrInteger(selectedRow.dueAmount)}`)
    if (lastPaymentDays > 45) riskSignals.push(`No payment in ${lastPaymentDays} days`)
    if (analytics.monthDebit > analytics.monthCredit * 1.3 && analytics.monthDebit > 0) {
      riskSignals.push('Billing is rising faster than collection')
    }

    return {
      healthStatus,
      overdueAmount,
      lastPaymentAgo: hasLastPayment ? `${lastPaymentDays} days ago` : 'No payment yet',
      paymentBehavior,
      riskSignals,
    }
  }, [selectedRow, asOfDate, analytics.monthDebit, analytics.monthCredit])

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
    <div className="w-full space-y-6 px-4 pb-10 pt-4 md:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Party Analytics Dashboard</h2>
          <p className="text-xs text-slate-500">As of {asOfDate}</p>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          <select className={inputClass} value={selectedCustomerIdResolved} onChange={(event) => setSelectedCustomerId(event.target.value)}>
            {rows.map((row) => (
              <option key={row.customerId} value={row.customerId}>
                {row.customerName}
              </option>
            ))}
          </select>
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
            <div className="mb-3">
              <h3 className="text-base font-semibold text-slate-900">{selectedRow.customerName} - Core Matrix</h3>
              <p className="text-xs text-slate-500">Complete billing and sales snapshot</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
              <Metric label="Opening Balance" value={formatInrInteger(selectedRow.openingBalance)} />
              <Metric label="Bill Count" value={String(selectedRow.billCount)} />
              <Metric label="Bill Amount" value={formatInrInteger(selectedRow.billedTotal)} />
              <Metric label="Total Paid" value={formatInrInteger(selectedRow.paidTotal)} />
              <Metric label="Current Due" value={formatInrInteger(selectedRow.dueAmount)} emphasized />
              <Metric label="Current Advance" value={formatInrInteger(selectedRow.advanceAmount)} />
              <Metric label="Total Bags" value={String(Math.round(selectedRow.totalBags))} />
              <Metric label="Total Weight" value={String(Math.round(selectedRow.totalWeight))} />
              <Metric label="Transport Cost" value={formatInrInteger(selectedRow.totalTransport)} />
              <Metric label="GST Total" value={formatInrInteger(selectedRow.totalGst)} />
              <Metric label="Avg Selling Rate" value={formatInrInteger(selectedRow.averageSellingRate)} />
              <Metric label="Avg Selling Weight" value={String(Math.round(selectedRow.averageSellingWeight))} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3">
              <h3 className="text-base font-semibold text-slate-900">{selectedRow.customerName} - Quick Health Summary</h3>
              <p className="text-xs text-slate-500">As of {asOfDate}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
              <Metric label="Status" value={decisionModel.healthStatus} emphasized={decisionModel.healthStatus !== 'Good'} />
              <Metric label="Total Due" value={formatInrInteger(selectedRow.dueAmount)} emphasized />
              <Metric label="Overdue Amount" value={formatInrInteger(decisionModel.overdueAmount)} />
              <Metric label="Last Payment" value={decisionModel.lastPaymentAgo} />
              <Metric label="Payment Behavior" value={decisionModel.paymentBehavior} />
            </div>
            {decisionModel.riskSignals.length > 0 && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-rose-700">Risk Signals</p>
                <ul className="mt-1 space-y-0.5 text-sm text-rose-800">
                  {decisionModel.riskSignals.map((signal, idx) => (
                    <li key={idx}>- {signal}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Compact Monthly Report</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
              <Metric label="This Month Billing" value={formatInrInteger(analytics.monthDebit)} />
              <Metric label="This Month Collection" value={formatInrInteger(analytics.monthCredit)} />
              <Metric label="Avg Month Billing" value={formatInrInteger(analytics.averageMonthlyBilling)} />
              <Metric label="Avg Month Collection" value={formatInrInteger(analytics.averageMonthlyCollection)} />
              <Metric label="This Month Gap" value={formatInrInteger(Math.abs(analytics.monthDebit - analytics.monthCredit))} emphasized={analytics.monthDebit > analytics.monthCredit} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
              <Metric label="This Year Billing" value={formatInrInteger(analytics.yearDebit)} />
              <Metric label="This Year Collection" value={formatInrInteger(analytics.yearCredit)} />
              <Metric label="Highest Bill" value={formatInrInteger(analytics.highestBill)} />
              <Metric label="Highest Payment" value={formatInrInteger(analytics.highestPayment)} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">6-Month Trend (Compact)</p>
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
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Monthly Insights</p>
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
                  <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Balance</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEvents.map((event, index) => (
                  <tr
                    key={event.id}
                    className={`border-t border-slate-100 ${event.type === 'Bill' ? 'bg-rose-50/40' : event.type === 'Payment' ? 'bg-emerald-50/40' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                  >
                    <td className="px-3 py-3 text-sm text-slate-700">{event.date === '-' ? '-' : formatFullDate(event.date)}</td>
                    <td className="px-3 py-3 text-sm text-slate-700">{event.type}</td>
                    <td className="px-3 py-3 text-sm text-slate-700">{event.details}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-800">{formatInrInteger(event.debit)}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-800">{formatInrInteger(event.credit)}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-slate-900">{formatSignedBalance(event.balance)}</td>
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

function Metric({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-md border p-2.5 ${emphasized ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono tabular-nums ${emphasized ? 'text-lg font-bold text-rose-800' : 'text-base font-semibold text-slate-900'}`}>{value}</p>
    </div>
  )
}

function daysAgo(fromIsoDate: string, toIsoDate: string) {
  if (!fromIsoDate || !toIsoDate) return 0
  const from = new Date(`${fromIsoDate}T00:00:00`)
  const to = new Date(`${toIsoDate}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)))
}

function formatSignedBalance(balance: number) {
  if (balance > 0) return `${formatInrInteger(balance)} Due`
  if (balance < 0) return `${formatInrInteger(Math.abs(balance))} Advance`
  return formatInrInteger(0)
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
