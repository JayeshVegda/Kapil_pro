import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowUpRight, ArrowDownRight, Coins, Flame, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { loadCastingSessions, loadMonthlyAverageMarketRate } from '@/data/casting'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/casting/')({
  component: CastingOverviewPage,
})

const CASTING_SESSIONS_KEY = ['casting-sessions'] as const

function CastingOverviewPage() {
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const to = getLocalIsoDate()
  const from = useMemo(() => {
    const [y, m, d] = to.split('-').map(Number)
    const dt = new Date((y ?? 2000), (m ?? 1) - 13, d ?? 1)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  }, [to])

  const sessionsQuery = useQuery({
    queryKey: [...CASTING_SESSIONS_KEY, from, to],
    queryFn: () => loadCastingSessions({ from, to }),
  })

  // Compute monthly and yearly stats
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()

  const stats = useMemo(() => {
    const list = sessionsQuery.data ?? []
    let monthInputKg = 0
    let monthWireOut = 0
    let monthInputCost = 0
    let monthMel = 0

    let yearInputKg = 0
    let yearWireOut = 0
    let yearInputCost = 0
    let yearMel = 0

    const monthMaterials = new Map<string, number>()
    const yearMaterials = new Map<string, number>()

    for (const session of list) {
      const sDate = new Date(session.date)
      const sYear = sDate.getFullYear()
      const sMonth = sDate.getMonth()

      const isCurrentYear = sYear === currentYear
      const isCurrentMonth = isCurrentYear && sMonth === currentMonth

      const inputKg = session.totalInputKg
      const inputCost = session.totalInputCost
      const wire = session.totalWireOut
      const mel = session.totalMel

      if (isCurrentYear) {
        yearInputKg += inputKg
        yearWireOut += wire
        yearInputCost += inputCost
        yearMel += mel
        for (const input of session.inputs) {
          const name = input.materialName.trim() || 'Unknown'
          yearMaterials.set(name, (yearMaterials.get(name) ?? 0) + input.qty)
        }
      }

      if (isCurrentMonth) {
        monthInputKg += inputKg
        monthWireOut += wire
        monthInputCost += inputCost
        monthMel += mel
        for (const input of session.inputs) {
          const name = input.materialName.trim() || 'Unknown'
          monthMaterials.set(name, (monthMaterials.get(name) ?? 0) + input.qty)
        }
      }
    }

    const monthAvgMetalCost = monthInputKg > 0 ? monthInputCost / monthInputKg : 0
    const yearAvgMetalCost = yearInputKg > 0 ? yearInputCost / yearInputKg : 0

    return {
      month: {
        inputKg: monthInputKg,
        wireOut: monthWireOut,
        inputCost: monthInputCost,
        mel: monthMel,
        avgMetalCost: monthAvgMetalCost,
        materials: [...monthMaterials.entries()]
          .map(([name, qty]) => ({ name, qty }))
          .sort((a, b) => b.qty - a.qty),
      },
      year: {
        inputKg: yearInputKg,
        wireOut: yearWireOut,
        inputCost: yearInputCost,
        mel: yearMel,
        avgMetalCost: yearAvgMetalCost,
        materials: [...yearMaterials.entries()]
          .map(([name, qty]) => ({ name, qty }))
          .sort((a, b) => b.qty - a.qty),
      },
    }
  }, [sessionsQuery.data, currentYear, currentMonth])

  const monthPrefix = useMemo(() => {
    const list = sessionsQuery.data ?? []
    const current = getLocalIsoDate().slice(0, 7)
    if (list.some((s) => s.date.startsWith(current))) return current
    const latest = list
      .map((s) => s.date.slice(0, 7))
      .sort()
      .pop()
    return latest ?? current
  }, [sessionsQuery.data])

  const monthSessions = useMemo(() => {
    const list = sessionsQuery.data ?? []
    return list.filter((s) => s.date.startsWith(monthPrefix))
  }, [sessionsQuery.data, monthPrefix])

  const monthStats = useMemo(() => summarizeSessions(monthSessions), [monthSessions])

  const marketMonthQuery = useQuery({
    queryKey: ['casting-market-month', monthPrefix],
    queryFn: () => loadMonthlyAverageMarketRate(monthPrefix),
    enabled: Boolean(monthPrefix),
    staleTime: 60_000,
  })

  const previousMonthStats = useMemo(() => {
    const [y, m] = monthPrefix.split('-').map(Number)
    const prevMonthDate = new Date((y ?? 2000), (m ?? 1) - 2, 1)
    const prevPrefix = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`
    const list = sessionsQuery.data ?? []
    const prevSessions = list.filter((s) => s.date.startsWith(prevPrefix))
    return { prefix: prevPrefix, stats: summarizeSessions(prevSessions) }
  }, [monthPrefix, sessionsQuery.data])

  const monthlyTrend = useMemo(() => {
    const grouped = new Map<string, Array<(typeof monthSessions)[number]>>()
    for (const s of sessionsQuery.data ?? []) {
      const m = s.date.slice(0, 7)
      const prev = grouped.get(m) ?? []
      prev.push(s)
      grouped.set(m, prev)
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, items]) => ({ month, ...summarizeSessions(items) }))
  }, [sessionsQuery.data, monthStats])

  const sessionSignals = useMemo(() => {
    const usable = monthSessions.filter((session) => session.costPerKg > 0).sort((a, b) => a.costPerKg - b.costPerKg)
    return {
      best: usable[0] ?? null,
      worst: usable[usable.length - 1] ?? null,
    }
  }, [monthSessions])

  const costVsMarketDelta = useMemo(() => {
    if (!marketMonthQuery.data || !(monthStats.avgLoadedCostKg > 0)) return null
    return monthStats.avgLoadedCostKg - marketMonthQuery.data
  }, [marketMonthQuery.data, monthStats.avgLoadedCostKg])

  return (
    <div className="w-full space-y-5 px-3 pb-8 pt-3 sm:px-4 lg:px-6">
      {sessionsQuery.isLoading && <p className="text-sm text-slate-500">Loading workspace...</p>}
      {sessionsQuery.isError && <p className="text-sm text-red-600">Unable to load casting workspace stats.</p>}

      {!sessionsQuery.isLoading && !sessionsQuery.isError && (
        <>
          {/* Row 1: KPI Panels */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* KPI 1: Production Volume */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Production Volume</span>
                <Activity size={18} className="text-blue-500" />
              </div>
              <div className="mt-2.5">
                <span className="font-mono text-2xl font-black text-slate-900 tabular-nums">
                  {formatMass(monthStats.wire)}
                </span>
                <span className="ml-1.5 text-xs font-semibold text-emerald-600">
                  {monthStats.kg > 0 ? `${((monthStats.wire / monthStats.kg) * 100).toFixed(1)}% Yield` : ''}
                </span>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-50 pt-2 text-[11px] text-slate-500">
                <span>Total Input: <strong>{formatMass(monthStats.kg)}</strong></span>
                <span>Wastage: <strong>{formatMass(monthStats.wastage)}</strong></span>
              </div>
            </div>

            {/* KPI 2: Weighted Cost */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Avg Rod Cost / kg</span>
                <Coins size={18} className="text-amber-500" />
              </div>
              <div className="mt-2.5">
                <span className="font-mono text-2xl font-black text-slate-900 tabular-nums">
                  {monthStats.avgLoadedCostKg > 0 ? `₹${monthStats.avgLoadedCostKg.toFixed(2)}` : '—'}
                </span>
                <span className="ml-1.5 text-xs text-slate-400">weighted loaded</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-50 pt-2 text-[11px] text-slate-500">
                <span>Avg Metal: <strong>₹{monthStats.avgCostKg.toFixed(1)}</strong></span>
                <span>Total Cost: <strong>{formatInrInteger(monthStats.totalCost)}</strong></span>
              </div>
            </div>

            {/* KPI 3: Market Rate Comparison */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Brass Market Rate</span>
                <TrendingUp size={18} className="text-slate-400" />
              </div>
              <div className="mt-2.5 flex items-baseline">
                <span className="font-mono text-2xl font-black text-slate-900 tabular-nums">
                  {marketMonthQuery.data ? `₹${marketMonthQuery.data.toFixed(2)}` : '—'}
                </span>
                {costVsMarketDelta !== null && (
                  <span className={`ml-2 inline-flex items-center text-xs font-bold ${costVsMarketDelta <= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {costVsMarketDelta <= 0 ? (
                      <><ArrowDownRight size={14} className="mr-0.5" />-{Math.abs(costVsMarketDelta).toFixed(1)}</>
                    ) : (
                      <><ArrowUpRight size={14} className="mr-0.5" />+{costVsMarketDelta.toFixed(1)}</>
                    )}
                  </span>
                )}
              </div>
              <div className="mt-2 text-[11px] border-t border-slate-50 pt-2 text-slate-500">
                <span>Avg cost comparison vs monthly Vilaity market rate</span>
              </div>
            </div>

            {/* KPI 4: Operations Activity */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Furnace Activity</span>
                <Flame size={18} className="text-orange-500" />
              </div>
              <div className="mt-2.5">
                <span className="font-mono text-2xl font-black text-slate-900 tabular-nums">
                  {monthStats.daysRunning} Days
                </span>
                <span className="ml-2 text-xs text-slate-400">running logs</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-50 pt-2 text-[11px] text-slate-500">
                <span>Total Batches: <strong>{monthStats.batches}</strong></span>
                <span>Avg: <strong>{(monthStats.daysRunning > 0 ? monthStats.batches / monthStats.daysRunning : 0).toFixed(1)}/day</strong></span>
              </div>
            </div>
          </div>

          {/* Row 2: Unified Split Dashboard Layout */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            
            {/* Left Column (8/12 cols) - Operational Analytics & Trends */}
            <div className="lg:col-span-8 space-y-6">
              
              {/* Monthly Trend Table */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3.5">Monthly Trend (Last 6 Months)</h3>
                <div className="overflow-x-auto no-scrollbar">
                  <table className="w-full text-xs text-slate-700">
                    <thead>
                      <tr className="border-b border-slate-100 text-left font-bold uppercase text-slate-400">
                        <th className="pb-2.5">Month</th>
                        <th className="pb-2.5 text-right">Runs</th>
                        <th className="pb-2.5 text-right">Wire (kg)</th>
                        <th className="pb-2.5 text-right">Avg Metal</th>
                        <th className="pb-2.5 text-right">Avg Loaded</th>
                        <th className="pb-2.5 text-right">Yield</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthlyTrend.map((m) => (
                        <tr key={m.month} className="hover:bg-slate-50/50">
                          <td className="py-2.5 font-bold text-slate-900">{m.month}</td>
                          <td className="py-2.5 text-right font-mono tabular-nums">{m.daysRunning}</td>
                          <td className="py-2.5 text-right font-mono tabular-nums">{formatMass(m.wire)}</td>
                          <td className="py-2.5 text-right font-mono tabular-nums">₹{m.avgCostKg.toFixed(1)}</td>
                          <td className="py-2.5 text-right font-mono tabular-nums font-bold text-blue-600">₹{m.avgLoadedCostKg.toFixed(1)}</td>
                          <td className="py-2.5 text-right font-mono tabular-nums">{m.kg > 0 ? `${((m.wire / m.kg) * 100).toFixed(1)}%` : '—'}</td>
                        </tr>
                      ))}
                      {monthlyTrend.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-4 text-center text-slate-400">No monthly trend data available.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Side-by-Side: MoM & Operational Averages */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* MoM Performance Comparison */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">MoM Comparison</h3>
                  <div className="divide-y divide-slate-100 text-sm">
                    <CompactDeltaRow
                      label="Running Days"
                      current={monthStats.daysRunning}
                      previous={previousMonthStats.stats.daysRunning}
                      formatter={(v) => `${v} days`}
                    />
                    <CompactDeltaRow
                      label="Wire Output"
                      current={monthStats.wire}
                      previous={previousMonthStats.stats.wire}
                      formatter={formatMass}
                    />
                    <CompactDeltaRow
                      label="Input Cost"
                      current={monthStats.totalCost}
                      previous={previousMonthStats.stats.totalCost}
                      formatter={formatInrInteger}
                    />
                    <CompactDeltaRow
                      label="Weighted Cost/kg"
                      current={monthStats.avgLoadedCostKg}
                      previous={previousMonthStats.stats.avgLoadedCostKg}
                      formatter={(v) => v > 0 ? `₹${v.toFixed(2)}` : '—'}
                      isCost
                    />
                  </div>
                </div>

                {/* Operational Averages */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Operational Averages</h3>
                  <div className="divide-y divide-slate-100 text-sm">
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-600">Avg Wire per Batch</span>
                      <span className="font-mono text-slate-900 font-semibold">{monthStats.batches > 0 ? formatMass(monthStats.wire / monthStats.batches) : '—'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-600">Avg Loss per Batch</span>
                      <span className="font-mono text-slate-900 font-semibold text-amber-700">{monthStats.batches > 0 ? formatMass(monthStats.wastage / monthStats.batches) : '—'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-600">Avg Coal per Batch</span>
                      <span className="font-mono text-slate-900 font-semibold">{monthStats.batches > 0 ? `${(monthStats.totalCoalKg / monthStats.batches).toFixed(1)} kg` : '—'}</span>
                    </div>
                    <div className="py-2.5 flex justify-between">
                      <span className="text-slate-600">Avg Wage per Batch</span>
                      <span className="font-mono text-slate-900 font-semibold">{monthStats.batches > 0 ? `₹${Math.round(monthStats.totalWorkerSalary / monthStats.batches)}` : '—'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* High / Low Signals */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3.5">Cost Threshold Signals</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SignalCard label="Lowest Cost Session (Best)" session={sessionSignals.best} type="best" />
                  <SignalCard label="Highest Cost Session (Worst)" session={sessionSignals.worst} type="worst" />
                </div>
              </div>

            </div>

            {/* Right Column (4/12 cols) - Material Share Sidebar Dashboard */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* Material Dashboard Stats Card */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Material Dashboard</h3>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Casting Stats summary</span>
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                    <button
                      type="button"
                      className={`rounded-md px-2.5 py-1 transition ${period === 'monthly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                      onClick={() => setPeriod('monthly')}
                    >
                      This Month
                    </button>
                    <button
                      type="button"
                      className={`rounded-md px-2.5 py-1 transition ${period === 'yearly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                      onClick={() => setPeriod('yearly')}
                    >
                      This Year
                    </button>
                  </div>
                </div>

                <div className="space-y-3.5">
                  {/* Avg Metal / kg cost (Highlighted - Most Important) */}
                  <div className="rounded-xl bg-blue-50/60 border border-blue-150 p-4 shadow-sm text-center">
                    <span className="block text-[10px] uppercase font-bold text-blue-500 tracking-wider">Avg Metal Cost / kg</span>
                    <span className="font-mono text-3xl font-black text-blue-700 block mt-1">
                      {period === 'monthly'
                        ? (stats.month.avgMetalCost > 0 ? `₹${stats.month.avgMetalCost.toFixed(2)}/kg` : '—')
                        : (stats.year.avgMetalCost > 0 ? `₹${stats.year.avgMetalCost.toFixed(2)}/kg` : '—')
                      }
                    </span>
                    <span className="text-[9px] text-blue-600 font-bold uppercase tracking-wide mt-1 block">★ Most Important Metric</span>
                  </div>

                  {/* Total Metal Intake */}
                  <div className="rounded-xl border border-slate-150 bg-slate-50/30 p-3.5 text-center">
                    <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">Metal Intake</span>
                    <span className="font-mono text-base font-bold text-slate-850 block mt-1">
                      {period === 'monthly' ? formatMass(stats.month.inputKg) : formatMass(stats.year.inputKg)}
                    </span>
                  </div>

                  {/* Total Wire Out */}
                  <div className="rounded-xl border border-slate-150 bg-slate-50/30 p-3.5 text-center">
                    <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total Wire Out</span>
                    <span className="font-mono text-base font-bold text-slate-850 block mt-1">
                      {period === 'monthly' ? formatMass(stats.month.wireOut) : formatMass(stats.year.wireOut)}
                    </span>
                  </div>
                </div>

                {/* Material Breakdown Share */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">Material Share</span>
                  {(period === 'monthly' ? stats.month.materials : stats.year.materials).length === 0 ? (
                    <span className="text-xs text-slate-400 italic block py-1">No material usage in this period.</span>
                  ) : (
                    <div className="space-y-3">
                      {(period === 'monthly' ? stats.month.materials : stats.year.materials).map((mat) => {
                        const totalKg = period === 'monthly' ? stats.month.inputKg : stats.year.inputKg
                        const pct = totalKg > 0 ? (mat.qty / totalKg) * 100 : 0
                        return (
                          <div key={mat.name} className="space-y-1">
                            <div className="flex justify-between text-xs font-semibold text-slate-700">
                              <span>{mat.name}</span>
                              <span className="font-mono text-slate-500">
                                {formatMass(mat.qty)} ({pct.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-blue-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

            </div>

          </div>
        </>
      )}
    </div>
  )
}

function SignalCard({
  label,
  session,
  type,
}: {
  label: string
  session: {
    date: string
    costPerKg: number
    totalWireOut: number
    totalInputKg: number
  } | null
  type: 'best' | 'worst'
}) {
  const borderColor = type === 'best' ? 'border-l-emerald-500' : 'border-l-rose-500'
  const bgColor = type === 'best' ? 'bg-emerald-50/40' : 'bg-rose-50/40'
  const textColor = type === 'best' ? 'text-emerald-700 font-extrabold' : 'text-rose-700 font-extrabold'

  return (
    <div className={`rounded-lg border border-slate-200 border-l-4 ${borderColor} ${bgColor} p-3 transition hover:shadow-sm`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 font-mono text-lg tabular-nums ${textColor}`}>
        {session ? `₹${session.costPerKg.toFixed(2)}` : '—'}
      </p>
      <p className="mt-0.5 text-xs font-medium text-slate-600">
        {session ? `${session.date} · ${formatMass(session.totalWireOut)} output` : 'No session data yet'}
      </p>
    </div>
  )
}

function CompactDeltaRow({
  label,
  current,
  previous,
  formatter,
  isCost = false,
}: {
  label: string
  current: number
  previous: number
  formatter: (v: number) => string
  isCost?: boolean
}) {
  const delta = current - previous
  const isZero = delta === 0
  const isUp = delta > 0

  // For costs, lower is better. For others, higher is better.
  const isFavorable = isCost ? delta <= 0 : delta >= 0

  const statusColor = isZero
    ? 'text-slate-400'
    : isFavorable
    ? 'text-emerald-600'
    : 'text-rose-600'

  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-slate-600 font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono font-bold text-slate-900">{formatter(current)}</span>
        <span className={`inline-flex items-center text-xs font-bold font-mono ${statusColor}`}>
          {isZero ? (
            '—'
          ) : isUp ? (
            <><ArrowUpRight size={12} className="mr-0.5" />+{formatter(delta)}</>
          ) : (
            <><ArrowDownRight size={12} className="mr-0.5" />-{formatter(Math.abs(delta))}</>
          )}
        </span>
      </div>
    </div>
  )
}

function formatMass(kg: number) {
  if (!Number.isFinite(kg) || kg <= 0) return '0 kg'
  if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`
  return `${kg.toFixed(1)} kg`
}

function summarizeSessions(
  sessions: Array<{
    date: string
    unit: number
    totalInputKg: number
    totalInputCost: number
    wireOut: number
    wastage: number
    cholIn: number
    costPerKg: number
    coalKg: number
    coalRate: number
    workerSalary: number
  }>,
) {
  const runningDays = new Set<string>()
  let batches = 0
  let kg = 0
  let wire = 0
  let wastage = 0
  let cholIn = 0
  let totalCost = 0
  let totalCoalKg = 0
  let totalCoalCost = 0
  let totalWorkerSalary = 0
  let loadedCostSum = 0

  for (const s of sessions) {
    runningDays.add(s.date)
    batches += s.unit
    kg += s.totalInputKg
    wire += s.wireOut
    wastage += s.wastage
    cholIn += s.cholIn
    totalCost += s.totalInputCost
    totalCoalKg += s.coalKg
    totalCoalCost += (s.coalKg * s.coalRate)
    totalWorkerSalary += s.workerSalary
    loadedCostSum += (s.costPerKg * s.wireOut)
  }

  const avgCostKg = kg > 0 ? totalCost / kg : 0
  const avgLoadedCostKg = wire > 0 ? loadedCostSum / wire : 0

  return {
    daysRunning: runningDays.size,
    batches,
    count: sessions.length,
    kg,
    wire,
    wastage,
    cholIn,
    totalCost,
    totalCoalKg,
    totalCoalCost,
    totalWorkerSalary,
    avgCostKg,
    avgLoadedCostKg,
  }
}
