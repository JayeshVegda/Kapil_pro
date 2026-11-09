import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, ArrowRight, Award, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { pb } from '@/data/pocketbase'
import { loadCastingSessions } from '@/data/casting'
import {
  summarizeCastingSessions,
  findBestWorstCastingSessions,
} from '@/domain/casting-calculations'
import {
  computeSafeRecoveryAndWastage,
  aggregateCastingMaterials,
  buildCastingMonthlyTrendPoints,
  computeOperationalAverages,
} from '@/domain/casting-dashboard-calculations'
import {
  buildPeriodRange,
  previousPeriod,
  deltaPct,
  type PeriodMode,
} from '@/domain/period-helpers'
import { DashboardToolbar } from '@/components/ui/dashboard-toolbar'
import { formatCompactInr, formatCompactKg } from '@/lib/inr-format'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { SectionCard, KpiCard } from '@/components/ui/business-kit'
import { Panel } from '@/components/ui/panel'
import { DeltaChip } from '@/components/charts/delta-chip'
import { Sparkline } from '@/components/charts/sparkline'
import { TrendChart } from '@/components/charts/trend-chart'
import { DonutSplit } from '@/components/charts/donut-split'

export const Route = createFileRoute('/casting/')({
  component: CastingDashboardPage,
})

const CASTING_SESSIONS_KEY = ['casting-sessions'] as const

function CastingDashboardPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [mode, setMode] = useState<PeriodMode>('month')
  const [selectedMonth, setSelectedMonth] = useState<string>(today.slice(0, 7))

  // 1. Period ranges (fair comparison rule: same days)
  const currentRange = useMemo(
    () => buildPeriodRange(mode, selectedMonth, today),
    [mode, selectedMonth, today],
  )
  const prevRange = useMemo(() => previousPeriod(currentRange), [currentRange])

  // Rolling 6-month timeline window ending at selectedMonth
  const past6Months = useMemo(() => {
    const months: string[] = []
    const [y, m] = selectedMonth.split('-').map(Number)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return months
  }, [selectedMonth])

  // 2. Data Queries
  const sessionsQuery = useQuery({
    queryKey: [...CASTING_SESSIONS_KEY],
    queryFn: () => loadCastingSessions(),
    staleTime: 60_000,
  })

  const brassRatesQuery = useQuery({
    queryKey: ['brass-rates-history'],
    queryFn: async () => {
      try {
        const records = await pb.collection('brass_rates').getFullList({
          sort: 'date',
          fields: 'date,vilaity',
        })
        return records.map((r) => ({
          date: String(r.date).slice(0, 10),
          vilaity: Number(r.vilaity || 0),
        }))
      } catch {
        return []
      }
    },
    staleTime: 60_000,
  })

  // Monthly average market rate lookup
  const monthlyMarketRates = useMemo(() => {
    const sumCount = new Map<string, { sum: number; count: number }>()
    for (const r of brassRatesQuery.data ?? []) {
      const m = r.date.slice(0, 7)
      const v = r.vilaity
      if (v > 0) {
        const curr = sumCount.get(m) ?? { sum: 0, count: 0 }
        curr.sum += v
        curr.count += 1
        sumCount.set(m, curr)
      }
    }
    const map: Record<string, number | null> = {}
    for (const [m, { sum, count }] of sumCount.entries()) {
      map[m] = count > 0 ? sum / count : null
    }
    return map
  }, [brassRatesQuery.data])

  // 3. Filtered Sessions
  const allSessions = sessionsQuery.data ?? []

  const periodSessions = useMemo(() => {
    return allSessions.filter(
      (s) => s.date && s.date >= currentRange.from && s.date <= currentRange.to,
    )
  }, [allSessions, currentRange.from, currentRange.to])

  const prevPeriodSessions = useMemo(() => {
    return allSessions.filter(
      (s) => s.date && s.date >= prevRange.from && s.date <= prevRange.to,
    )
  }, [allSessions, prevRange.from, prevRange.to])

  // 4. Summaries & KPIs
  const periodSummary = useMemo(() => summarizeCastingSessions(periodSessions), [periodSessions])
  const prevPeriodSummary = useMemo(
    () => summarizeCastingSessions(prevPeriodSessions),
    [prevPeriodSessions],
  )

  const wireOutDelta = useMemo(
    () => deltaPct(periodSummary.wire, prevPeriodSummary.wire),
    [periodSummary.wire, prevPeriodSummary.wire],
  )
  const metalInputDelta = useMemo(
    () => deltaPct(periodSummary.kg, prevPeriodSummary.kg),
    [periodSummary.kg, prevPeriodSummary.kg],
  )
  const costDelta = useMemo(() => {
    if (periodSummary.avgLoadedCostKg === 0 || prevPeriodSummary.avgLoadedCostKg === 0) return null
    return deltaPct(periodSummary.avgLoadedCostKg, prevPeriodSummary.avgLoadedCostKg)
  }, [periodSummary.avgLoadedCostKg, prevPeriodSummary.avgLoadedCostKg])

  const safeYield = useMemo(
    () =>
      computeSafeRecoveryAndWastage(
        periodSummary.wire,
        periodSummary.wastage,
        periodSummary.kg,
      ),
    [periodSummary.wire, periodSummary.wastage, periodSummary.kg],
  )

  const opAverages = useMemo(
    () => computeOperationalAverages(periodSummary),
    [periodSummary],
  )

  // 5. 6-Month Trends
  const trendPoints = useMemo(
    () => buildCastingMonthlyTrendPoints(allSessions, past6Months, monthlyMarketRates),
    [allSessions, past6Months, monthlyMarketRates],
  )

  const wireTrend6M = useMemo(() => trendPoints.map((p) => p.wireOutKg), [trendPoints])
  const metalTrend6M = useMemo(() => trendPoints.map((p) => p.metalInKg), [trendPoints])
  const costTrend6M = useMemo(() => trendPoints.map((p) => p.loadedCostKg), [trendPoints])

  // 6. Material Breakdown
  const materials = useMemo(
    () => aggregateCastingMaterials(periodSessions),
    [periodSessions],
  )

  const donutSlices = useMemo(() => {
    return materials.slice(0, 5).map((m) => ({
      key: m.name,
      label: m.name,
      value: m.qty,
    }))
  }, [materials])

  // 7. Signals & Recent Sessions
  const signals = useMemo(
    () => findBestWorstCastingSessions(periodSessions),
    [periodSessions],
  )

  const recentSessions = useMemo(() => {
    return [...allSessions]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 5)
  }, [allSessions])

  // Error handling
  if (sessionsQuery.isError) {
    return (
      <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
        <Panel role="alert" className="rounded-xl border-rose-200 bg-rose-50 p-6 text-center">
          <AlertCircle className="mx-auto mb-2 text-rose-600" size={24} />
          <h2 className="text-sm font-semibold text-rose-800">Unable to load casting dashboard</h2>
          <p className="mt-1 text-xs text-rose-600">Failed to fetch casting session data.</p>
        </Panel>
      </div>
    )
  }

  // Quick Action Buttons for DashboardToolbar
  const toolbarActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        to="/casting/new-session"
        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
      >
        <Plus size={14} /> New Casting Session
      </Link>
    </div>
  )

  return (
    <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {/* 1. Dashboard Toolbar (Cards Rule compliant) */}
      <DashboardToolbar
        mode={mode}
        onModeChange={setMode}
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        comparisonNote={prevRange.comparisonNote}
        actions={toolbarActions}
      />

      {/* 2. KPI Cards Row (5 Cards) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Wire Out */}
        <KpiCard
          label="Wire Out"
          hint={currentRange.label}
          value={formatCompactKg(periodSummary.wire)}
          delta={<DeltaChip delta={wireOutDelta} goodDirection="up" />}
          sparkline={
            <Sparkline
              values={wireTrend6M}
              trend={wireOutDelta != null ? (wireOutDelta < 0 ? 'down' : 'up') : undefined}
              width={90}
              height={32}
              showArea
              id="casting-kpi-wire"
            />
          }
          subtext={
            periodSummary.batches > 0
              ? `${periodSummary.batches} batches · ${periodSummary.daysRunning} days`
              : 'No casting runs'
          }
          href="/casting/log"
        />

        {/* Metal Input */}
        <KpiCard
          label="Metal Input"
          hint="Furnace charge"
          value={formatCompactKg(periodSummary.kg)}
          delta={<DeltaChip delta={metalInputDelta} goodDirection="up" />}
          sparkline={
            <Sparkline
              values={metalTrend6M}
              trend={metalInputDelta != null ? (metalInputDelta < 0 ? 'down' : 'up') : undefined}
              width={90}
              height={32}
              showArea
              id="casting-kpi-metal"
            />
          }
          subtext={
            periodSummary.totalCost > 0
              ? `${formatCompactInr(periodSummary.totalCost)} charged`
              : 'No metal charged'
          }
          href="/casting/log"
        />

        {/* Loaded Cost / kg */}
        <KpiCard
          label="Loaded Cost"
          hint="Per kg rod"
          value={periodSummary.avgLoadedCostKg > 0 ? `₹${periodSummary.avgLoadedCostKg.toFixed(2)}` : '—'}
          delta={<DeltaChip delta={costDelta} goodDirection="down" />}
          sparkline={
            <Sparkline
              values={costTrend6M}
              trend={costDelta != null ? (costDelta <= 0 ? 'up' : 'down') : undefined}
              width={90}
              height={32}
              showArea
              id="casting-kpi-cost"
            />
          }
          subtext={
            periodSummary.avgCostKg > 0
              ? `Avg metal: ₹${periodSummary.avgCostKg.toFixed(1)}/kg`
              : 'Weighted rod cost'
          }
          href="/casting/log"
        />

        {/* Wastage */}
        <KpiCard
          label="Wastage"
          hint="Melting loss"
          value={safeYield.wastagePct != null ? `${safeYield.wastagePct}%` : '—'}
          tone={safeYield.wastagePct != null && safeYield.wastagePct > 6 ? 'warning' : 'neutral'}
          subtext={
            periodSummary.wastage > 0
              ? `${formatCompactKg(periodSummary.wastage)} mel / burning loss`
              : 'No loss recorded'
          }
          href="/casting/log"
        />

        {/* Furnace Activity */}
        <KpiCard
          label="Heats Run"
          hint="Foundry"
          value={`${periodSummary.batches} batches`}
          tone={periodSummary.batches > 0 ? 'positive' : 'neutral'}
          subtext={
            periodSummary.daysRunning > 0
              ? `${periodSummary.daysRunning} operating days · ${(periodSummary.daysRunning > 0 ? periodSummary.batches / periodSummary.daysRunning : 0).toFixed(1)}/day`
              : 'Furnace idle'
          }
          href="/casting/log"
        />
      </div>

      {/* 3. Row 1: Production Output Trend & Loaded Cost vs Market */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard
          title="Production Output"
          subtitle="Monthly wire output vs metal charged (last 6 months)"
          className="xl:col-span-7"
        >
          <TrendChart
            data={trendPoints}
            xKey="month"
            height={230}
            series={[
              { dataKey: 'wireOutKg', name: 'Wire Out (kg)', type: 'bar', color: '#0f172a' },
              { dataKey: 'metalInKg', name: 'Metal Input (kg)', type: 'bar', color: '#059669' },
            ]}
            formatY={(v) => formatCompactKg(v)}
            formatTooltip={(v) => `${v.toLocaleString('en-IN')} kg`}
            ariaLabel="Production Output Trend"
          />
        </SectionCard>

        <SectionCard
          title="Cost vs Market Benchmark"
          subtitle="Foundry loaded cost vs Vilaity market rate (₹/kg)"
          className="xl:col-span-5"
        >
          <TrendChart
            data={trendPoints}
            xKey="month"
            height={230}
            series={[
              { dataKey: 'loadedCostKg', name: 'Loaded Cost (₹)', type: 'line', color: '#0f172a' },
              { dataKey: 'marketRate', name: 'Vilaity Mkt (₹)', type: 'line', dashed: true, color: '#94a3b8' },
            ]}
            formatY={(v) => `₹${v}`}
            formatTooltip={(v) => `₹${v.toFixed(2)}/kg`}
            ariaLabel="Cost vs Market Benchmark"
          />
        </SectionCard>
      </div>

      {/* 4. Row 2: Material Mix, Operational Averages & Signals */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          title="Material Charge Mix"
          subtitle={`Raw materials charged into furnace (${currentRange.label})`}
          className="lg:col-span-5"
        >
          <DonutSplit
            slices={donutSlices}
            centerLabel="Input"
            formatValue={(v) => formatCompactKg(v)}
            formatTotal={(v) => formatCompactKg(v)}
            emptyText="No material charge recorded this period."
          />
          {materials.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
              {materials.slice(0, 4).map((mat) => (
                <div key={mat.name} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{mat.name}</span>
                  <span className="font-mono text-slate-500">
                    {formatCompactKg(mat.qty)} ({mat.pct}%) · Avg ₹{Math.round(mat.avgRate)}/kg
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Operational Averages"
          subtitle="Per-batch efficiency"
          className="lg:col-span-3"
        >
          <div className="divide-y divide-slate-100 text-xs">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600">Avg Wire Output</span>
              <span className="font-mono font-bold text-slate-900">
                {periodSummary.batches > 0 ? formatCompactKg(opAverages.avgWirePerBatch) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600">Avg Melting Loss</span>
              <span className="font-mono font-bold text-amber-700">
                {periodSummary.batches > 0 ? formatCompactKg(opAverages.avgLossPerBatch) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600">Avg Coal Usage</span>
              <span className="font-mono font-bold text-slate-900">
                {periodSummary.batches > 0 ? `${opAverages.avgCoalPerBatch} kg` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600">Avg Labor Wage</span>
              <span className="font-mono font-bold text-slate-900">
                {periodSummary.batches > 0 ? `₹${opAverages.avgWagePerBatch.toLocaleString('en-IN')}` : '—'}
              </span>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Cost Threshold Signals"
          subtitle={`Heats efficiency benchmark (${currentRange.label})`}
          className="lg:col-span-4"
        >
          <div className="space-y-3">
            {/* Best Heat */}
            <div className="rounded-lg border border-slate-200 border-l-4 border-l-emerald-500 bg-emerald-50/30 p-3 transition hover:shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                  Lowest Cost Session (Best)
                </p>
                <Award size={14} className="text-emerald-600" />
              </div>
              <p className="mt-1 font-mono text-lg font-black tabular-nums text-emerald-700">
                {signals.best ? `₹${signals.best.costPerKg.toFixed(2)}/kg` : '—'}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-600">
                {signals.best
                  ? `${formatFullDate(signals.best.date)} · ${formatCompactKg(signals.best.totalWireOut || signals.best.wireOut)} output`
                  : 'No heat data recorded'}
              </p>
            </div>

            {/* Worst Heat */}
            <div className="rounded-lg border border-slate-200 border-l-4 border-l-rose-500 bg-rose-50/30 p-3 transition hover:shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-rose-800">
                  Highest Cost Session (Worst)
                </p>
                <AlertTriangle size={14} className="text-rose-600" />
              </div>
              <p className="mt-1 font-mono text-lg font-black tabular-nums text-rose-700">
                {signals.worst ? `₹${signals.worst.costPerKg.toFixed(2)}/kg` : '—'}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-600">
                {signals.worst
                  ? `${formatFullDate(signals.worst.date)} · ${formatCompactKg(signals.worst.totalWireOut || signals.worst.wireOut)} output`
                  : 'No heat data recorded'}
              </p>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* 5. Row 3: Recent Casting Sessions Table */}
      <SectionCard
        title="Recent Casting Sessions"
        subtitle="Last 5 recorded foundry production runs"
        actions={
          <Link
            to="/casting/log"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900"
          >
            View all in Casting Logs <ArrowRight size={13} />
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Heats / Batches</th>
                <th className="px-3 py-2 text-right">Metal In</th>
                <th className="px-3 py-2 text-right">Wire Out</th>
                <th className="px-3 py-2 text-right">Melting Loss</th>
                <th className="px-3 py-2 text-right">Loaded Cost</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentSessions.map((s) => {
                const wire = s.totalWireOut || s.wireOut || 0
                const wastage = s.totalMel || s.wastage || 0
                const inputKg = s.totalInputKg || 0
                return (
                  <tr key={s.id} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-900">
                      {formatFullDate(s.date)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {s.unit || s.batches?.length || 1}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {formatCompactKg(inputKg)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {formatCompactKg(wire)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-amber-700">
                      {formatCompactKg(wastage)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {s.costPerKg > 0 ? `₹${s.costPerKg.toFixed(2)}/kg` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        to="/casting/log"
                        className="font-medium text-slate-600 hover:text-slate-900 hover:underline"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                )
              })}
              {recentSessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-400">
                    No casting sessions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}
