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
import { useDashboardData } from '@/domain/dashboard'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { RankedBarList, SplitProgress, StatusPill } from '@/components/ui/business-dashboard'

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
  const topSoldRows = data.thisMonthItemBags.slice(0, 5).map((row) => ({
    id: row.itemName,
    label: row.itemName,
    value: row.bags,
    subLabel: `${formatWhole(row.kg)} kg sold this month`,
  }))

  return (
    <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
      <section className="mb-4 rounded-lg border border-blue-200 bg-blue-700 p-4 text-white shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase text-blue-100">Today Snapshot</p>
            <h1 className="mt-2 font-mono text-4xl font-bold leading-none tracking-tight sm:text-5xl">
              {fmtMoneyCompact(data.kpis.outstanding)}
            </h1>
            <p className="mt-2 text-sm text-blue-50">
              Total receivable. {data.actionRequired.pendingParties} parties pending. Month collection cover {collectionCoverPct.toFixed(0)}%.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:w-[42rem]">
            <HeroStat label="Sales" value={fmtMoneyCompact(data.thisMonthSummary.sales)} detail="this month" />
            <HeroStat label="Collection" value={fmtMoneyCompact(data.thisMonthSummary.collection)} detail="this month" />
            <HeroStat label="Sold" value={`${formatWhole(totalSoldBags)} bags`} detail={`${formatWhole(totalSoldKg)} kg`} />
            <HeroStat label="Metal" value={castingStats.avgMetalCost > 0 ? `₹${castingStats.avgMetalCost.toFixed(0)}` : '—'} detail="per kg" />
          </div>
        </div>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Sales vs Collection</h2>
              <p className="text-xs text-slate-500">
                This month gap {collectionGap > 0 ? fmtMoneyCompact(collectionGap) : 'covered'} · {collectionCoverPct.toFixed(0)}% collected
              </p>
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
              <h2 className="text-sm font-semibold text-slate-950">Sold Bags / Kg</h2>
              <p className="text-xs text-slate-500">Selling movement only, no stock-in management</p>
            </div>
            <StatusPill tone="emerald">{formatWhole(totalSoldKg)} kg</StatusPill>
          </div>
          <RankedBarList
            rows={topSoldRows}
            valueLabel={(value) => `${formatWhole(value)} bags`}
            emptyText="No sold item rows this month."
            tone="emerald"
          />
        </div>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(24rem,0.72fr)_minmax(0,1.28fr)]">
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

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <InfoMetric label="Active parties" value={formatWhole(data.kpis.activeCustomers)} />
            <InfoMetric label="Bills made" value={formatWhole(data.kpis.totalBills)} />
            <InfoMetric label="Avg bill value" value={fmtMoneyCompact(data.kpis.averageBillValue)} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
