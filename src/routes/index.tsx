import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Flame,
  IndianRupee,
  Receipt,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { loadCastingSessions } from '@/data/casting'
import { useModuleSettings } from '@/lib/use-module-settings'
import { useDashboardData } from '@/domain/dashboard'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { RankedBarList, StatusPill } from '@/components/ui/business-dashboard'
import { SalesCollectionTrendChart } from '@/components/reports/company-charts'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { data, isPending, isError, error } = useDashboardData()
  const navigate = useNavigate()
  const today = useMemo(() => getLocalIsoDate(), [])

  const { castingEnabled } = useModuleSettings()

  const castingSessionsQuery = useQuery({
    queryKey: ['casting-sessions', today.slice(0, 4) + '-01-01', today],
    queryFn: () => loadCastingSessions({ from: today.slice(0, 4) + '-01-01', to: today }),
    // Skipping the query when casting is off also saves a PocketBase round trip.
    enabled: castingEnabled,
  })

  const castingStats = useMemo(() => {
    const list = castingSessionsQuery.data ?? []
    const currentMonthPrefix = today.slice(0, 7)

    let monthInputKg = 0
    let monthWireOut = 0
    let monthInputCost = 0
    let monthSessions = 0
    let latestCost = 0
    let latestDate = ''

    for (const session of list) {
      if (session.date.startsWith(currentMonthPrefix)) {
        monthInputKg += session.totalInputKg
        monthWireOut += session.totalWireOut
        monthInputCost += session.totalInputCost
        monthSessions++
      }
      if (!latestDate || session.date > latestDate) {
        latestDate = session.date
        latestCost = session.metalCostPerKg
      }
    }

    const avgMetalCost = monthInputKg > 0 ? monthInputCost / monthInputKg : 0

    return {
      inputKg: monthInputKg,
      wireOut: monthWireOut,
      avgMetalCost,
      sessions: monthSessions,
      latestCost,
      latestDate,
    }
  }, [castingSessionsQuery.data, today])

  if (isPending) {
    return (
      <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
        <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-32 animate-pulse rounded-lg border border-slate-200 bg-white" />
          ))}
        </section>
        <div className="h-[24rem] animate-pulse rounded-lg border border-slate-200 bg-white" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
        <section className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="text-base font-semibold text-red-700">Unable to load dashboard</h2>
          <p className="mt-2 text-sm text-red-600">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </section>
      </div>
    )
  }

  if (!data) return null

  const collectionGap = data.thisMonthSummary.sales - data.thisMonthSummary.collection
  const totalSoldBags = data.itemComparisons.spindle.bags + data.itemComparisons.tapperPlug.bags
  const totalSoldKg = data.itemComparisons.spindle.kg + data.itemComparisons.tapperPlug.kg
  const topSoldRows = data.thisMonthItemBags.slice(0, 5).map((row) => ({
    id: row.itemName,
    label: row.itemName,
    value: row.bags,
    subLabel: `${formatWhole(row.kg)} kg sold this month`,
  }))

  const agingBuckets = buildAgingBuckets(data.actionRequired.riskRows)
  const trendData = data.monthlyTrend.map((row) => ({ month: row.month, sales: row.sales, collections: row.collection }))

  return (
    <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
      {/* Receivables overview — the number that runs the business, split by age */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-1 divide-y divide-slate-100 lg:grid-cols-[1.25fr_1fr] lg:divide-x lg:divide-y-0">
          <div className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Total Receivables</p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                {formatInrInteger(data.kpis.outstanding)}
              </span>
              <span className="text-sm text-slate-500">
                from {data.actionRequired.pendingParties} parties
              </span>
            </div>
            <AgingBar buckets={agingBuckets} />
          </div>

          <div className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">This Month</p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <MonthStat label="Sales" value={fmtMoneyCompact(data.thisMonthSummary.sales)} delta={data.kpis.salesVsLastMonth} />
              <MonthStat label="Collections" value={fmtMoneyCompact(data.thisMonthSummary.collection)} delta={data.kpis.collectionVsLastMonth} />
              <MonthStat
                label="Net"
                value={`${data.kpis.thisMonthNet >= 0 ? '+' : '-'}${fmtMoneyCompact(Math.abs(data.kpis.thisMonthNet))}`}
                tone={data.kpis.thisMonthNet >= 0 ? 'emerald' : 'rose'}
              />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
              <MonthStat label="Bills" value={formatWhole(data.kpis.totalBills)} muted />
              <MonthStat label="Avg bill" value={fmtMoneyCompact(data.kpis.averageBillValue)} muted />
              <MonthStat label="Sold" value={`${formatWhole(totalSoldBags)} bags`} muted />
            </div>
          </div>
        </div>
      </section>

      {/* Trend + collections worklist */}
      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Sales vs Collections</h2>
              <p className="text-xs text-slate-500">Last 6 months · hover for exact amounts</p>
            </div>
            <StatusPill tone={collectionGap > 0 ? 'amber' : 'emerald'}>
              {collectionGap > 0 ? `${fmtMoneyCompact(collectionGap)} gap this month` : 'collections covered'}
            </StatusPill>
          </div>
          <SalesCollectionTrendChart data={trendData} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Collect Next</h2>
              <p className="text-xs text-slate-500">Largest pending balances, oldest first</p>
            </div>
            <StatusPill tone={data.actionRequired.highRiskParties > 0 ? 'amber' : 'emerald'}>
              {data.actionRequired.highRiskParties > 0 ? `${data.actionRequired.highRiskParties} high` : 'on track'}
            </StatusPill>
          </div>
          {data.actionRequired.riskRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nothing pending — all parties are clear.</p>
          ) : (
            <div className="space-y-1.5">
              {data.actionRequired.riskRows.slice(0, 6).map((row) => (
                <button
                  key={row.customerId}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50/50"
                  onClick={() => navigate({ to: '/ledger', search: { customerId: row.customerId, focus: '' } })}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-slate-800">{row.customerName}</span>
                    <span className={`text-[11px] font-semibold ${row.level === 'overdue' ? 'text-rose-600' : row.level === 'due' ? 'text-amber-600' : 'text-slate-500'}`}>
                      {row.dueDays}d pending
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-slate-900">{fmtMoneyCompact(row.amount)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Movement + operations */}
      <section className={`mb-4 grid grid-cols-1 gap-4 ${castingEnabled ? 'xl:grid-cols-3' : 'xl:grid-cols-2'}`}>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Sold This Month</h2>
              <p className="text-xs text-slate-500">Bags by item · {formatWhole(totalSoldKg)} kg total</p>
            </div>
          </div>
          <RankedBarList
            rows={topSoldRows}
            valueLabel={(value) => `${formatWhole(value)} bags`}
            emptyText="No sold item rows this month."
            tone="emerald"
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-950">Latest Activity</h2>
          <div className="mt-3 space-y-3">
            <SmallActivity
              title="Last bill"
              value={data.thisMonthSummary.lastSale ? fmtMoneyCompact(data.thisMonthSummary.lastSale.amount) : '—'}
              detail={data.thisMonthSummary.lastSale ? `${formatFullDate(data.thisMonthSummary.lastSale.date)} · ${data.thisMonthSummary.lastSale.customerName}` : 'No bill this month'}
              icon={<IndianRupee size={15} />}
            />
            <SmallActivity
              title="Last payment"
              value={data.thisMonthSummary.lastCollection ? fmtMoneyCompact(data.thisMonthSummary.lastCollection.amount) : '—'}
              detail={data.thisMonthSummary.lastCollection ? `${formatFullDate(data.thisMonthSummary.lastCollection.date)} · ${data.thisMonthSummary.lastCollection.customerName}` : 'No payment this month'}
              icon={<Receipt size={15} />}
            />
            <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
              <InfoMetric label="Active parties" value={formatWhole(data.kpis.activeCustomers)} />
              <InfoMetric label="Collection rate" value={`${Math.round(data.kpis.collectionRate)}%`} />
            </div>
          </div>
        </div>

        {castingEnabled && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Casting Cost Signal</h2>
              <p className="text-xs text-slate-500">Metal-cost view for pricing decisions</p>
            </div>
            <Link to="/casting" className="text-xs font-semibold text-blue-700 hover:text-blue-800">
              Casting
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CostMetric label="Metal Intake" value={`${formatWhole(castingStats.inputKg)} kg`} icon={<Flame size={15} />} />
            <CostMetric label="Wire Out" value={`${formatWhole(castingStats.wireOut)} kg`} icon={<Activity size={15} />} />
            <CostMetric label="Avg Cost" value={castingStats.avgMetalCost > 0 ? `₹${castingStats.avgMetalCost.toFixed(2)}` : '—'} icon={<IndianRupee size={15} />} />
            <CostMetric label="Runs" value={`${castingStats.sessions}`} icon={<TrendingUp size={15} />} />
          </div>
          <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-600">Latest casting cost</span>
              <span className="font-mono text-sm font-bold text-slate-950">
                {castingStats.latestCost > 0 ? `₹${castingStats.latestCost.toFixed(2)}/kg` : '—'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {castingStats.latestDate ? `Last session ${formatFullDate(castingStats.latestDate)}.` : 'No casting session logged yet.'}
            </p>
          </div>
        </div>
        )}
      </section>

      <section className="grid min-h-[42vh] grid-cols-1 gap-4 xl:grid-cols-2">
        <RecentBillsTable rows={data.recentBills} onOpen={(customerId) => navigate({ to: '/ledger', search: { customerId, focus: '' } })} />
        <RecentPaymentsTable rows={data.recentPayments} onOpen={(customerId) => navigate({ to: '/ledger', search: { customerId, focus: '' } })} />
      </section>
    </div>
  )
}

type AgingBucketRow = { label: string; amount: number; color: string; text: string }

function buildAgingBuckets(rows: Array<{ amount: number; dueDays: number }>): AgingBucketRow[] {
  const buckets: AgingBucketRow[] = [
    { label: '0-30d', amount: 0, color: 'bg-blue-400', text: 'text-blue-700' },
    { label: '31-60d', amount: 0, color: 'bg-amber-400', text: 'text-amber-700' },
    { label: '61-90d', amount: 0, color: 'bg-orange-400', text: 'text-orange-700' },
    { label: '90d+', amount: 0, color: 'bg-rose-500', text: 'text-rose-700' },
  ]
  for (const row of rows) {
    const index = row.dueDays <= 30 ? 0 : row.dueDays <= 60 ? 1 : row.dueDays <= 90 ? 2 : 3
    buckets[index].amount += row.amount
  }
  return buckets
}

function AgingBar({ buckets }: { buckets: AgingBucketRow[] }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.amount, 0)
  if (total <= 0) {
    return <p className="mt-4 text-xs text-slate-400">No pending receivables — everything is collected.</p>
  }
  return (
    <div className="mt-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {buckets.map((bucket) =>
          bucket.amount > 0 ? (
            <div
              key={bucket.label}
              className={bucket.color}
              style={{ width: `${(bucket.amount / total) * 100}%` }}
              title={`${bucket.label}: ${formatInrInteger(bucket.amount)}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {buckets.map((bucket) => (
          <span key={bucket.label} className="inline-flex items-center gap-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${bucket.color}`} />
            <span className="text-slate-500">{bucket.label}</span>
            <span className={`font-mono font-semibold tabular-nums ${bucket.amount > 0 ? bucket.text : 'text-slate-300'}`}>
              {bucket.amount > 0 ? fmtMoneyCompact(bucket.amount) : '—'}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

function MonthStat({ label, value, delta, tone, muted = false }: { label: string; value: string; delta?: number; tone?: 'emerald' | 'rose'; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-base font-bold tabular-nums ${muted ? 'text-slate-700' : tone === 'emerald' ? 'text-emerald-600' : tone === 'rose' ? 'text-rose-600' : 'text-slate-900'}`}>
        {value}
      </p>
      {delta !== undefined && delta !== 0 && (
        <p className={`text-[11px] font-semibold ${delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {delta > 0 ? '+' : '-'}
          {fmtMoneyCompact(Math.abs(delta))} vs last month
        </p>
      )}
    </div>
  )
}


function InfoMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold leading-tight text-slate-950">{value}</p>
    </div>
  )
}

function SmallActivity({ title, value, detail, icon }: { title: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-500">
        {icon}
        <span>{title}</span>
      </div>
      <p className="mt-1 font-mono text-lg font-bold leading-tight text-slate-950">{value}</p>
      <p className="mt-1 line-clamp-1 text-xs text-slate-500">{detail}</p>
    </div>
  )
}

function CostMetric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 font-mono text-lg font-bold leading-tight text-slate-950">{value}</p>
    </div>
  )
}



function RecentBillsTable({
  rows,
  onOpen,
}: {
  rows: Array<{
    id: string
    businessDate: string
    date?: string
    customerId: string
    customerName: string
    bookNo?: number
    billNo?: number
    status: string
    total: number
  }>
  onOpen: (customerId: string) => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-950">Recent Bills</h2>
        <span className="text-xs text-slate-500">Last 8</span>
      </div>
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="bg-slate-50">
              <TableHead>Date</TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Bill</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Amount</TableHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((bill) => (
              <ClickableRow key={bill.id} label={`Open bill ${bill.bookNo}/${bill.billNo}`} onOpen={() => onOpen(bill.customerId)}>
                <td className="px-4 py-2.5 text-sm text-slate-600">{formatFullDate(bill.businessDate ?? bill.date ?? '')}</td>
                <td className="px-4 py-2.5 text-sm font-medium text-slate-800">{bill.customerName}</td>
                <td className="px-4 py-2.5 text-sm text-slate-600">{bill.bookNo}/{bill.billNo}</td>
                <td className="px-4 py-2.5"><StatusBadge status={bill.status} /></td>
                <td className="px-4 py-2.5 text-right text-sm font-semibold text-slate-950">{fmtMoney(bill.total ?? 0)}</td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RecentPaymentsTable({
  rows,
  onOpen,
}: {
  rows: Array<{
    id: string
    businessDate: string
    date?: string
    customerId: string
    customerName: string
    mode?: string
    status: string
    amount: number
  }>
  onOpen: (customerId: string) => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-950">Recent Payments</h2>
        <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Users size={13} /> Party-wise</span>
      </div>
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="bg-slate-50">
              <TableHead>Date</TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead align="right">Amount</TableHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((payment) => (
              <ClickableRow key={payment.id} label={`Open payment from ${payment.customerName}`} onOpen={() => onOpen(payment.customerId)}>
                <td className="px-4 py-2.5 text-sm text-slate-600">{formatFullDate(payment.businessDate ?? payment.date ?? '')}</td>
                <td className="px-4 py-2.5 text-sm font-medium text-slate-800">{payment.customerName}</td>
                <td className="px-4 py-2.5 text-sm text-slate-600"><span className="mr-2">{payment.mode}</span><StatusBadge status={payment.status} /></td>
                <td className="px-4 py-2.5 text-right text-sm font-semibold text-slate-950">{fmtMoney(payment.amount)}</td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClickableRow({ children, label, onOpen }: { children: ReactNode; label: string; onOpen: () => void }) {
  return (
    <tr
      className="cursor-pointer border-t border-slate-100 transition hover:bg-blue-50/40"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={label}
    >
      {children}
    </tr>
  )
}

function TableHead({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-4 py-2 text-xs font-semibold uppercase text-slate-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === 'Pending'
      ? 'bg-amber-100 text-amber-700'
      : status === 'Partial'
        ? 'bg-blue-100 text-blue-700'
        : 'bg-emerald-100 text-emerald-700'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{status}</span>
}

const fmtMoney = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v)
const fmtMoneyCompact = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(v)
const formatWhole = (v: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(v))
