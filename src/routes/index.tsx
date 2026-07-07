import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Flame,
  IndianRupee,
  PackageCheck,
  Receipt,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { loadCastingSessions } from '@/data/casting'
import { useDashboardData } from '@/domain/dashboard'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { KpiTile, RankedBarList, SplitProgress, StatusPill } from '@/components/ui/business-dashboard'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { data, isPending, isError, error } = useDashboardData()
  const navigate = useNavigate()
  const today = useMemo(() => getLocalIsoDate(), [])

  const castingSessionsQuery = useQuery({
    queryKey: ['casting-sessions', today.slice(0, 4) + '-01-01', today],
    queryFn: () => loadCastingSessions({ from: today.slice(0, 4) + '-01-01', to: today }),
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
  const collectionCoverPct =
    data.thisMonthSummary.sales > 0 ? (data.thisMonthSummary.collection / data.thisMonthSummary.sales) * 100 : 0
  const totalSoldBags = data.itemComparisons.spindle.bags + data.itemComparisons.tapperPlug.bags
  const totalSoldKg = data.itemComparisons.spindle.kg + data.itemComparisons.tapperPlug.kg
  const riskRows = data.actionRequired.riskRows.slice(0, 5)
  const topSoldRows = data.thisMonthItemBags.slice(0, 5).map((row) => ({
    id: row.itemName,
    label: row.itemName,
    value: row.bags,
    subLabel: `${formatWhole(row.kg)} kg sold this month`,
  }))
  const highestPending = data.actionRequired.highestPending

  return (
    <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
      <section className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.55fr)]">
        <div className="rounded-lg border border-blue-200 bg-blue-700 p-4 text-white shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase text-blue-100">Today Snapshot</p>
              <h1 className="mt-2 font-mono text-4xl font-bold leading-none tracking-tight sm:text-5xl">
                {fmtMoneyCompact(data.kpis.outstanding)}
              </h1>
              <p className="mt-2 text-sm text-blue-50">
                Receivable across {data.actionRequired.pendingParties} parties. Collection cover this month is{' '}
                <span className="font-semibold text-white">{collectionCoverPct.toFixed(0)}%</span>.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[31rem]">
              <HeroStat label="Sales" value={fmtMoneyCompact(data.thisMonthSummary.sales)} />
              <HeroStat label="Collection" value={fmtMoneyCompact(data.thisMonthSummary.collection)} />
              <HeroStat label="Sold" value={`${formatWhole(totalSoldBags)} bags`} detail={`${formatWhole(totalSoldKg)} kg`} />
              <HeroStat label="Metal" value={castingStats.avgMetalCost > 0 ? `₹${castingStats.avgMetalCost.toFixed(0)}` : '—'} detail="per kg" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase text-slate-500">Needs Action</p>
              <h2 className="mt-1 text-base font-semibold text-slate-950">Party follow-up</h2>
            </div>
            <StatusPill tone={data.actionRequired.highRiskParties > 0 ? 'rose' : 'emerald'}>
              {data.actionRequired.highRiskParties} high risk
            </StatusPill>
          </div>
          {highestPending ? (
            <Link
              to="/ledger"
              search={{ customerId: highestPending.customerId, focus: '' }}
              className="mt-3 block rounded-lg border border-slate-100 bg-slate-50 p-3 transition hover:border-blue-200 hover:bg-blue-50/60"
            >
              <p className="truncate text-sm font-semibold text-slate-950">{highestPending.customerName}</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="font-mono text-xl font-bold text-slate-950">{fmtMoneyCompact(highestPending.amount)}</span>
                <StatusPill tone={riskTone(highestPending.level)}>{formatDueDays(highestPending.dueDays)}</StatusPill>
              </div>
            </Link>
          ) : (
            <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-700">No party is pending right now.</p>
          )}
        </div>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Receivable Risk"
          value={fmtMoneyCompact(data.actionRequired.pendingAmount)}
          detail={`${data.actionRequired.pendingParties} parties pending. Biggest follow-up is shown above.`}
          icon={<AlertTriangle size={17} />}
          tone={data.actionRequired.highRiskParties > 0 ? 'rose' : 'blue'}
          footer={<span className="font-medium text-slate-600">All-time collection rate: {data.kpis.collectionRate.toFixed(0)}%</span>}
        />
        <KpiTile
          label="Month Sales"
          value={fmtMoneyCompact(data.thisMonthSummary.sales)}
          detail={data.thisMonthSummary.lastSale ? `Last bill: ${formatFullDate(data.thisMonthSummary.lastSale.date)} to ${data.thisMonthSummary.lastSale.customerName}` : 'No bill created this month.'}
          icon={<IndianRupee size={17} />}
          tone="blue"
          footer={<TrendNote value={data.kpis.salesVsLastMonth} label="vs last month" />}
        />
        <KpiTile
          label="Month Collection"
          value={fmtMoneyCompact(data.thisMonthSummary.collection)}
          detail={collectionGap > 0 ? `${fmtMoneyCompact(collectionGap)} still uncovered this month.` : 'Collection is equal or ahead of month sales.'}
          icon={<Receipt size={17} />}
          tone={collectionGap > 0 ? 'amber' : 'emerald'}
          footer={<span className="font-medium text-slate-600">{collectionCoverPct.toFixed(0)}% of month sales collected</span>}
        />
        <KpiTile
          label="Sold Movement"
          value={`${formatWhole(totalSoldBags)} bags`}
          detail={`${formatWhole(totalSoldKg)} kg sold. Spindle ${formatWhole(data.itemComparisons.spindle.bags)} bags, Tapper ${formatWhole(data.itemComparisons.tapperPlug.bags)} bags.`}
          icon={<PackageCheck size={17} />}
          tone="emerald"
          footer={<span className="font-medium text-slate-600">{formatBagVsLastMonth(totalSoldBags, data.itemComparisons.spindle.previousBags + data.itemComparisons.tapperPlug.previousBags)}</span>}
        />
      </section>

      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Sales vs Collection</h2>
              <p className="text-xs text-slate-500">Recent months, built for quick comparison</p>
            </div>
            <StatusPill tone={collectionGap > 0 ? 'amber' : 'emerald'}>
              {collectionGap > 0 ? `${fmtMoneyCompact(collectionGap)} gap` : 'covered'}
            </StatusPill>
          </div>
          <SplitProgress
            leftLabel="Month sales"
            leftValue={data.thisMonthSummary.sales}
            rightLabel="Month collection"
            rightValue={data.thisMonthSummary.collection}
            leftText={fmtMoneyCompact(data.thisMonthSummary.sales)}
            rightText={fmtMoneyCompact(data.thisMonthSummary.collection)}
          />
          <div className="mt-4">
            <TrendChart months={data.monthlyTrend} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Parties Needing Action</h2>
              <p className="text-xs text-slate-500">Sorted by oldest bill first, then amount</p>
            </div>
            <Link to="/ledger" search={{ customerId: '', focus: '' }} className="text-xs font-semibold text-blue-700 hover:text-blue-800">
              Ledger
            </Link>
          </div>
          <RankedBarList
            rows={riskRows.map((row) => ({
              id: row.customerId,
              label: row.customerName,
              value: row.amount,
              subLabel: `${formatDueDays(row.dueDays)}${row.lastBillDate ? ` · Last bill ${formatFullDate(row.lastBillDate)}` : ''}`,
              href: { to: '/ledger', search: { customerId: row.customerId, focus: '' } },
            }))}
            valueLabel={fmtMoneyCompact}
            emptyText="No pending parties. Clean board."
            tone="rose"
          />
        </div>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Sold Bags / Kg</h2>
              <p className="text-xs text-slate-500">Selling movement only, no stock-in management</p>
            </div>
            <StatusPill tone="emerald">{formatWhole(totalSoldKg)} kg</StatusPill>
          </div>
          <RankedBarList rows={topSoldRows} valueLabel={(value) => `${formatWhole(value)} bags`} emptyText="No sold item rows this month." tone="emerald" />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Casting Cost Signal</h2>
              <p className="text-xs text-slate-500">Metal-cost view for one-glance pricing decisions</p>
            </div>
            <Link to="/casting" className="text-xs font-semibold text-blue-700 hover:text-blue-800">
              Casting
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
      </section>

      <section className="grid min-h-[42vh] grid-cols-1 gap-4 xl:grid-cols-2">
        <RecentBillsTable rows={data.recentBills} onOpen={(customerId) => navigate({ to: '/ledger', search: { customerId, focus: '' } })} />
        <RecentPaymentsTable rows={data.recentPayments} onOpen={(customerId) => navigate({ to: '/ledger', search: { customerId, focus: '' } })} />
      </section>
    </div>
  )
}

function HeroStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg bg-white/10 p-3 ring-1 ring-white/15">
      <p className="text-[10px] font-semibold uppercase text-blue-100">{label}</p>
      <p className="mt-1 truncate font-mono text-lg font-bold leading-tight text-white">{value}</p>
      {detail ? <p className="truncate text-[11px] font-medium text-blue-100">{detail}</p> : null}
    </div>
  )
}

function TrendNote({ value, label }: { value: number; label: string }) {
  const positive = value >= 0
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>
      {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {positive ? '+' : '-'}
      {fmtMoneyCompact(Math.abs(value))} {label}
    </span>
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

function TrendChart({ months }: { months: Array<{ month: string; sales: number; collection: number }> }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.sales, m.collection)))
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {months.map((item) => {
        const salesPct = (item.sales / max) * 100
        const collPct = (item.collection / max) * 100
        return (
          <div key={item.month} className="rounded-lg border border-slate-100 bg-white p-3">
            <p className="mb-2 truncate text-xs font-semibold text-slate-600">{item.month}</p>
            <div className="space-y-2">
              <MiniBar label="Sales" value={fmtMoneyCompact(item.sales)} pct={salesPct} color="bg-blue-600" />
              <MiniBar label="Collection" value={fmtMoneyCompact(item.collection)} pct={collPct} color="bg-emerald-600" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MiniBar({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{label}</span>
        <span className="font-mono font-semibold text-slate-700">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
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

function riskTone(level: 'watch' | 'due' | 'overdue') {
  if (level === 'overdue') return 'rose'
  if (level === 'due') return 'amber'
  return 'blue'
}

function formatDueDays(days: number) {
  if (days <= 0) return 'new'
  return `${days}d due`
}

function formatBagVsLastMonth(current: number, previous: number) {
  const delta = Math.round(current - previous)
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '±'
  return `vs ${sign}${formatWhole(Math.abs(delta))} bags (${formatWhole(previous)} last month)`
}
