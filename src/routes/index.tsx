import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { IndianRupee, Receipt, Users } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { buildStockInventorySummary, formatBagCount, formatPercent, formatStockQty, kgToBags, type StockInventorySummary } from '@/components/stock/stock-inventory-strip'
import { loadCurrentStock, loadMonthlyStockReport, type CurrentStockRecord } from '@/data/stock'
import { useDashboardData } from '@/domain/dashboard'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { data, isPending, isError, error } = useDashboardData()
  const navigate = useNavigate()
  const today = useMemo(() => getLocalIsoDate(), [])
  const currentMonth = today.slice(0, 7)
  const previousMonth = previousMonthKey(currentMonth)
  const financialYearMonths = useMemo(() => fiscalYearMonthKeys(today), [today])
  const currentStockQuery = useQuery({ queryKey: ['current-stock'], queryFn: loadCurrentStock })
  const currentMonthStockQuery = useQuery({
    queryKey: ['monthly-stock-report', currentMonth],
    queryFn: () => loadMonthlyStockReport(currentMonth),
  })
  const previousMonthStockQuery = useQuery({
    queryKey: ['monthly-stock-report', previousMonth],
    queryFn: () => loadMonthlyStockReport(previousMonth),
  })
  const financialYearStockQueries = useQueries({
    queries: financialYearMonths.map((month) => ({
      queryKey: ['monthly-stock-report', month],
      queryFn: () => loadMonthlyStockReport(month),
    })),
  })
  const stockRows = useMemo(
    () => [...(currentStockQuery.data ?? [])].sort((a, b) => a.itemName.localeCompare(b.itemName) || a.customerName.localeCompare(b.customerName)),
    [currentStockQuery.data],
  )
  const stockFiscalRows = financialYearStockQueries.flatMap((query) => query.data ?? [])
  const stockSummary = useMemo(
    () =>
      buildStockInventorySummary({
        stockItems: stockRows,
        currentRows: currentMonthStockQuery.data ?? [],
        previousRows: previousMonthStockQuery.data ?? [],
        fiscalRows: stockFiscalRows,
      }),
    [currentMonthStockQuery.data, previousMonthStockQuery.data, stockFiscalRows, stockRows],
  )

  if (isPending) {
    return (
      <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
        <section className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-[180px] animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </section>
      </div>
    )
  }
  if (isError) {
    return (
      <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
        <section className="rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-base font-semibold text-red-700">Unable to load dashboard</h2>
          <p className="mt-2 text-sm text-red-600">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </section>
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
      <section className="mb-4 grid grid-cols-1 gap-4 xl:flex xl:items-stretch">
        <div className="rounded-xl bg-blue-700 p-5 text-white shadow-sm xl:w-fit xl:min-w-[25rem] xl:flex-none">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-100/85">Outstanding Balance</p>
          <p className="mt-3 font-mono text-4xl font-bold tracking-tight">{fmtMoneyCompact(data.kpis.outstanding)}</p>
          <p className="mt-2 text-sm text-blue-100/85">
            Active Party: <span className="font-semibold text-white">{data.kpis.activeCustomers}</span>
            {' '}|{' '}
            Total Count bill: <span className="font-semibold text-white">{data.kpis.totalBills}</span>
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm xl:min-w-0 xl:flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">ALL Time Record</p>
          <div className="mt-2 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MiniMetric
              label="Sales"
              value={fmtMoneyCompact(data.kpis.allTimeSales)}
              trend="All time billed"
              icon={<IndianRupee size={12} className="shrink-0" />}
            />
            <MiniMetric
              label="Collection"
              value={fmtMoneyCompact(data.kpis.allTimeCollection)}
              trend="All time collected"
              icon={<Receipt size={12} className="shrink-0" />}
            />
            <MiniMetric
              label="Spindle Bags"
              value={String(Math.round(data.kpis.allTimeSpindleBags))}
              trend={`${Math.round(data.kpis.allTimeSpindleKg)} kg`}
              icon={<Receipt size={12} className="shrink-0" />}
            />
            <MiniMetric
              label="Tapper Plug Bags"
              value={String(Math.round(data.kpis.allTimeTapperPlugBags))}
              trend="All time"
              icon={<Receipt size={12} className="shrink-0" />}
            />
          </div>
        </div>
      </section>

      <section className="mb-4">
        {currentStockQuery.isLoading && (
          <div className="grid grid-cols-1 gap-4 xl:flex xl:items-stretch">
            <div className="h-[148px] animate-pulse rounded-xl bg-blue-100/70 xl:w-fit xl:min-w-[25rem] xl:flex-none" />
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm xl:min-w-0 xl:flex-1">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className="h-[124px] animate-pulse rounded-lg border border-slate-200 bg-white" />
                <div className="h-[124px] animate-pulse rounded-lg border border-slate-200 bg-white" />
                <div className="h-[124px] animate-pulse rounded-lg border border-slate-200 bg-white" />
              </div>
            </div>
          </div>
        )}
        {currentStockQuery.isError && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Unable to load stock summary.</p>}
        {!currentStockQuery.isLoading && !currentStockQuery.isError && (
          <DashboardStockPanel
            rows={stockRows}
            summary={stockSummary}
            item={stockRows[0]}
            onSelect={() => navigate({ to: '/stock' })}
          />
        )}
      </section>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">This Month Only</h2>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <MiniMetric
            label="Sales"
            value={fmtMoneyCompact(data.thisMonthSummary.sales)}
            trend={
              data.thisMonthSummary.lastSale
                ? `Last: ${formatFullDate(data.thisMonthSummary.lastSale.date)} · ${fmtMoneyCompact(data.thisMonthSummary.lastSale.amount)} · ${data.thisMonthSummary.lastSale.customerName}`
                : 'No sale yet this month'
            }
            icon={<IndianRupee size={12} className="shrink-0" />}
          />
          <MiniMetric
            label="Collection"
            value={fmtMoneyCompact(data.thisMonthSummary.collection)}
            trend={
              data.thisMonthSummary.lastCollection
                ? `Last: ${formatFullDate(data.thisMonthSummary.lastCollection.date)} · ${fmtMoneyCompact(data.thisMonthSummary.lastCollection.amount)} · ${data.thisMonthSummary.lastCollection.customerName}`
                : 'No collection yet this month'
            }
            icon={<Receipt size={12} className="shrink-0" />}
          />
          <MiniMetric
            label="Spindle Bags"
            value={String(Math.round(data.thisMonthSummary.spindleBags))}
            trend={`${Math.round(data.thisMonthSummary.spindleKg)} kg`}
            icon={<Receipt size={12} className="shrink-0" />}
          />
          <MiniMetric
            label="Tapper Plug Bags"
            value={String(Math.round(data.thisMonthSummary.tapperPlugBags))}
            trend={`${Math.round(data.thisMonthSummary.tapperPlugKg)} kg`}
            icon={<Receipt size={12} className="shrink-0" />}
          />
          <MiniMetric
            label="Avg Market Rate"
            value={data.thisMonthSummary.avgMarketRate > 0 ? `₹${data.thisMonthSummary.avgMarketRate.toFixed(2)}` : '—'}
            trend={
              data.thisMonthSummary.avgMarketRateVsLastMonth !== 0
                ? `${data.thisMonthSummary.avgMarketRateVsLastMonth > 0 ? '+' : ''}₹${data.thisMonthSummary.avgMarketRateVsLastMonth.toFixed(2)} vs last month`
                : 'No last-month comparison'
            }
            icon={<IndianRupee size={12} className="shrink-0" />}
          />
          <div className="block min-h-[4.75rem] min-w-[10rem] rounded-lg border border-transparent bg-slate-50/95 p-2 transition">
            <div className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
              <Users size={12} className="shrink-0" />
              <span>Top Buyer</span>
            </div>
            {data.thisMonthSummary.topBuyer ? (
              <>
                <p className="mt-0.5 truncate font-mono text-base font-bold leading-tight tracking-tight text-slate-900" title={data.thisMonthSummary.topBuyer.customerName}>
                  {data.thisMonthSummary.topBuyer.customerName}
                </p>
                <p className="line-clamp-2 text-[10px] leading-snug text-slate-500">
                  {fmtMoneyCompact(data.thisMonthSummary.topBuyer.sales)} | {data.thisMonthSummary.topBuyer.bills} bills | avg {fmtMoneyCompact(data.thisMonthSummary.topBuyer.avgBillValue)} | {data.thisMonthSummary.topBuyer.sharePct.toFixed(1)}% share
                </p>
              </>
            ) : (
              <p className="line-clamp-2 text-[10px] leading-snug text-slate-500">No buyer data this month.</p>
            )}
          </div>
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Sales vs Collection Trend</h2>
          <span className="text-xs text-slate-500">Recent months</span>
        </div>
        <TrendChart months={data.monthlyTrend} />
      </section>

      <section className="grid min-h-[52vh] grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Recent Bills</h2>
          </div>
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Party</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Bill</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Status</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.recentBills.map((bill) => (
                  <tr
                    key={bill.id}
                    className="cursor-pointer border-t border-slate-100 transition hover:bg-blue-50/40"
                    onClick={() => navigate({ to: '/ledger', search: { customerId: bill.customerId, focus: '' } })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        navigate({ to: '/ledger', search: { customerId: bill.customerId, focus: '' } })
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open bill ${bill.bookNo}/${bill.billNo}`}
                  >
                    <td className="px-4 py-2.5 text-sm text-slate-600">{formatFullDate(bill.businessDate ?? bill.date ?? '')}</td>
                    <td className="px-4 py-2.5 text-sm font-medium text-slate-800">{bill.customerName}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{bill.bookNo}/{bill.billNo}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={bill.status} /></td>
                    <td className="px-4 py-2.5 text-right text-sm font-semibold text-slate-900">{fmtMoney(bill.total ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Recent Payments</h2>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Users size={13} /> Party-wise collection</span>
          </div>
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Party</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Mode</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.recentPayments.map((payment) => (
                  <tr
                    key={payment.id}
                    className="cursor-pointer border-t border-slate-100 transition hover:bg-blue-50/40"
                    onClick={() => navigate({ to: '/ledger', search: { customerId: payment.customerId, focus: '' } })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        navigate({ to: '/ledger', search: { customerId: payment.customerId, focus: '' } })
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open payment from ${payment.customerName}`}
                  >
                    <td className="px-4 py-2.5 text-sm text-slate-600">{formatFullDate(payment.businessDate ?? payment.date ?? '')}</td>
                    <td className="px-4 py-2.5 text-sm font-medium text-slate-800">{payment.customerName}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600"><span className="mr-2">{payment.mode}</span><StatusBadge status={payment.status} /></td>
                    <td className="px-4 py-2.5 text-right text-sm font-semibold text-slate-900">{fmtMoney(payment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}

function MiniMetric({
  label,
  value,
  trend,
  icon,
  to,
}: {
  label: string
  value: string
  trend: string
  icon: ReactNode
  /** When set, the whole tile is clickable (e.g. Sales → Print bill). */
  to?: '/print-bill'
}) {
  const body = (
    <>
      <div className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1 font-mono text-xl font-bold leading-tight tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-500">{trend}</p>
    </>
  )

  const tileClass =
    'block h-full min-h-[5.5rem] min-w-0 rounded-lg border border-slate-200 bg-white p-3 transition ' +
    (to != null
      ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'
      : '')

  if (to != null) {
    return (
      <Link to={to} search={{ billId: '', billRef: '' }} className={tileClass} aria-label={`${label}: open print bill`}
      >
        {body}
      </Link>
    )
  }

  return <div className={tileClass}>{body}</div>
}

function DashboardStockPanel({
  rows,
  summary,
  item,
  onSelect,
}: {
  rows: CurrentStockRecord[]
  summary: StockInventorySummary
  item?: CurrentStockRecord
  onSelect: (item: CurrentStockRecord) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:flex xl:items-stretch">
      <DashboardInventoryTile summary={summary} item={item} />
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm xl:min-w-0 xl:flex-1">
        <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.length === 0 && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500 md:col-span-2 xl:col-span-3">No stock buckets found.</p>}
        {rows.map((row) => (
          <DashboardStockBucket key={row.id} item={row} onClick={() => onSelect(row)} />
        ))}
        </div>
      </div>
    </div>
  )
}

function DashboardInventoryTile({ summary, item }: { summary: StockInventorySummary; item?: CurrentStockRecord }) {
  const changeBags = Math.abs(kgToBags(summary.netChange, item))

  return (
    <div className="rounded-xl bg-blue-700 p-5 text-left text-white shadow-sm xl:w-fit xl:min-w-[25rem] xl:flex-none">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-blue-100/85">Total Inventory</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3">
        <p className="font-mono text-4xl font-bold leading-tight tracking-tight">{formatBagCount(summary.stock, item)}</p>
        <p className="font-mono text-sm font-semibold text-blue-100/85">{formatStockQty(summary.stock, item)}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-white/15 pt-3 text-xs leading-snug text-blue-100/90">
        <p>In <span className="font-mono font-semibold text-white">{formatBagCount(summary.currentReceived, item)}</span></p>
        <p>Sold <span className="font-mono font-semibold text-white">{formatBagCount(summary.currentSold, item)}</span></p>
        <p className="col-span-2 truncate">{changeBags.toFixed(changeBags >= 10 ? 0 : 1)} bags vs last month ({formatPercent(summary.percentage)})</p>
      </div>
    </div>
  )
}

function DashboardStockBucket({ item, onClick }: { item: CurrentStockRecord; onClick: () => void }) {
  const net = item.stockInThisMonth + item.adjustmentThisMonth - item.soldThisMonth

  return (
    <button
      type="button"
      className="min-h-[7.75rem] min-w-0 rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      onClick={onClick}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold uppercase tracking-[0.06em] text-slate-500" title={item.itemName}>{item.itemName}</p>
        <p className="truncate text-xs text-slate-500" title={item.customerName}>{item.customerName}</p>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <p className={`font-mono text-xl font-bold leading-tight tracking-tight ${item.currentStock < 0 ? 'text-red-700' : 'text-slate-900'}`}>{formatBagCount(item.currentStock, item)}</p>
        <p className="font-mono text-xs text-slate-500">{formatStockQty(item.currentStock, item)}</p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 border-t border-slate-100 pt-2 text-[10px] uppercase tracking-[0.06em] text-slate-500">
        <DashboardStockMove label="In" value={formatBagCount(item.stockInThisMonth, item)} tone="green" />
        <DashboardStockMove label="Sold" value={formatBagCount(item.soldThisMonth, item)} tone="red" />
        <DashboardStockMove label="Net" value={formatBagCount(net, item)} tone={net < 0 ? 'red' : 'green'} />
      </div>
    </button>
  )
}

function DashboardStockMove({ label, value, tone }: { label: string; value: string; tone: 'green' | 'red' }) {
  return (
    <div className="min-w-0 border-l border-slate-100 px-1 first:border-l-0 first:pl-0">
      <p>{label}</p>
      <p className={`mt-0.5 truncate font-mono font-semibold tracking-normal ${tone === 'green' ? 'text-emerald-700' : 'text-red-700'}`}>{value}</p>
    </div>
  )
}

function TrendChart({ months }: { months: Array<{ month: string; sales: number; collection: number }> }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.sales, m.collection)))
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {months.map((item) => {
        const salesPct = (item.sales / max) * 100
        const collPct = (item.collection / max) * 100
        return (
          <div key={item.month} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">{item.month}</p>
            <div className="space-y-2">
              <div><div className="mb-1 flex items-center justify-between text-[11px] text-slate-500"><span>Sales</span><span>{fmtMoneyCompact(item.sales)}</span></div><div className="h-1.5 rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600" style={{ width: `${salesPct}%` }} /></div></div>
              <div><div className="mb-1 flex items-center justify-between text-[11px] text-slate-500"><span>Collection</span><span>{fmtMoneyCompact(item.collection)}</span></div><div className="h-1.5 rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${collPct}%` }} /></div></div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles = status === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{status}</span>
}

const fmtMoney = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v)
const fmtMoneyCompact = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(v)

function fiscalYearMonthKeys(today: string) {
  const [yearRaw, monthRaw] = today.slice(0, 7).split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const startYear = month >= 4 ? year : year - 1
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(startYear, 3 + index, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
}

function previousMonthKey(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const date = new Date(Number(yearRaw), Number(monthRaw) - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
