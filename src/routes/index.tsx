import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, IndianRupee, Receipt, TrendingDown, TrendingUp, Users } from 'lucide-react'
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
      <div className="w-full px-4 pb-8 pt-4 md:px-6">
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
      <div className="w-full px-4 pb-8 pt-4 md:px-6">
        <section className="rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-base font-semibold text-red-700">Unable to load dashboard</h2>
          <p className="mt-2 text-sm text-red-600">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </section>
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="w-full px-4 pb-8 pt-4 md:px-6">
      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm xl:col-span-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-amber-700">Action Required</p>
            <AlertTriangle size={16} className="text-amber-600" />
          </div>
          <p className="mt-3 font-mono text-3xl font-bold tracking-tight text-amber-900">{fmtMoneyCompact(data.actionRequired.pendingAmount)}</p>
          <p className="mt-2 text-sm text-amber-800">{data.actionRequired.pendingParties} parties pending, {data.actionRequired.highRiskParties} high-risk accounts.</p>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
            onClick={() => navigate({ to: '/ledger', search: { customerId: '', focus: '' } })}
          >
            Open Party view <ArrowRight size={13} />
          </button>
        </div>
        <div className="rounded-xl bg-blue-700 p-5 text-white shadow-sm xl:col-span-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-100/85">Outstanding Balance</p>
          <p className="mt-3 font-mono text-4xl font-bold tracking-tight">{fmtMoneyCompact(data.kpis.outstanding)}</p>
          <p className="mt-3 text-sm text-blue-100/80">vs last month: <span className="font-semibold text-white">{trendText(data.kpis.salesVsLastMonth)}</span></p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">This Month Performance</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <MiniMetric label="Sales" value={fmtMoneyCompact(data.kpis.thisMonthSales)} trend={`${trendText(data.kpis.salesVsLastMonth)} vs last month`} icon={<IndianRupee size={13} />} />
            <MiniMetric label="Collection" value={fmtMoneyCompact(data.kpis.thisMonthCollection)} trend={`${trendText(data.kpis.collectionVsLastMonth)} vs last month`} icon={<Receipt size={13} />} />
          </div>
        </div>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <AnalyticsTile title="Collection Progress" value={`${data.kpis.collectionRate.toFixed(1)}%`} positive={data.kpis.collectionRate >= 70} hint="Overall collected vs billed" className="xl:col-span-4" progress={data.kpis.collectionRate} />
        <AnalyticsTile title="Avg Pending per Party" value={fmtMoneyCompact(data.kpis.pendingParties > 0 ? data.kpis.outstanding / data.kpis.pendingParties : 0)} positive={false} hint="Average pending among due parties" className="xl:col-span-4" />
        <AnalyticsTile title="Total Bills" value={String(data.kpis.totalBills)} positive hint={`${data.kpis.activeCustomers} active customers`} className="xl:col-span-4" />
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
                    <td className="px-4 py-2.5 text-sm text-slate-600">{formatFullDate(bill.date)}</td>
                    <td className="px-4 py-2.5 text-sm font-medium text-slate-800">{bill.customerName}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{bill.bookNo}/{bill.billNo}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={bill.status} /></td>
                    <td className="px-4 py-2.5 text-right text-sm font-semibold text-slate-900">{fmtMoney(bill.total)}</td>
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
                    <td className="px-4 py-2.5 text-sm text-slate-600">{formatFullDate(payment.date)}</td>
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

function MiniMetric({ label, value, trend, icon }: { label: string; value: string; trend: string; icon: ReactNode }) {
  return <div className="rounded-lg bg-slate-50 p-3"><div className="inline-flex items-center gap-1 text-xs text-slate-600">{icon}{label}</div><p className="mt-1 font-mono text-xl font-bold text-slate-900">{value}</p><p className="text-xs text-slate-500">{trend}</p></div>
}

function AnalyticsTile({ title, value, positive, hint, className, progress }: { title: string; value: string; positive: boolean; hint: string; className?: string; progress?: number }) {
  const safeProgress = Math.max(0, Math.min(100, progress ?? 0))
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className ?? ''}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{title}</p>
        <span className={positive ? 'text-emerald-600' : 'text-amber-600'}>{positive ? <TrendingUp size={15} /> : <TrendingDown size={15} />}</span>
      </div>
      <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      {progress !== undefined && <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${safeProgress}%` }} /></div>}
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
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
const trendText = (v: number) => `${v >= 0 ? '+' : '-'}${fmtMoneyCompact(Math.abs(v))}`
