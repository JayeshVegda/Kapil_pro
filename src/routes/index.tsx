import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { IndianRupee, Receipt, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useDashboardData } from '@/domain/dashboard'
import { formatFullDate } from '@/lib/date'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { data, isPending, isError, error } = useDashboardData()
  const navigate = useNavigate()

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
