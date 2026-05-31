import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Flame } from 'lucide-react'
import { useMemo } from 'react'
import { loadCastingSessions, loadMonthlyAverageMarketRate } from '@/data/casting'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/casting/')({
  component: CastingOverviewPage,
})

const CASTING_SESSIONS_KEY = ['casting-sessions'] as const

function CastingOverviewPage() {
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

  const maxMonthWire = useMemo(() => Math.max(1e-9, ...monthlyTrend.map((m) => m.wire)), [monthlyTrend])

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">This month ({monthPrefix})</h2>
        {sessionsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {sessionsQuery.isError && <p className="text-sm text-red-600">Unable to load casting data.</p>}
        {!sessionsQuery.isLoading && !sessionsQuery.isError && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Total days running" value={String(monthStats.daysRunning)} />
            <Tile label="Total batches" value={monthStats.batches.toFixed(0)} />
            <Tile label="Total input" value={formatMass(monthStats.kg)} />
            <Tile label="Total wire out" value={formatMass(monthStats.wire)} />
            <Tile label="Total wastage" value={formatMass(monthStats.wastage)} />
            <Tile label="Chol recovered" value={formatMass(monthStats.cholIn)} />
            <Tile label="Total input cost" value={formatInrInteger(monthStats.totalCost)} />
            <Tile label="Primary KPI · Cost/kg (weighted)" value={monthStats.avgCostKg > 0 ? `₹${monthStats.avgCostKg.toFixed(2)}` : '—'} emphasized />
            <Tile label="Avg market rate" value={marketMonthQuery.data ? `₹${marketMonthQuery.data.toFixed(2)}` : '—'} />
            <Tile
              label="Cost/kg vs market"
              value={marketMonthQuery.data && monthStats.avgCostKg > 0 ? `${(monthStats.avgCostKg - marketMonthQuery.data) >= 0 ? '+' : ''}${(monthStats.avgCostKg - marketMonthQuery.data).toFixed(2)}` : '—'}
            />
            <Tile label="Yield %" value={monthStats.kg > 0 ? `${((monthStats.wire / monthStats.kg) * 100).toFixed(1)}%` : '—'} />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Month comparison ({monthPrefix} vs {previousMonthStats.prefix})</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <DeltaTile
            label="Running days"
            current={monthStats.daysRunning}
            previous={previousMonthStats.stats.daysRunning}
            valueFormatter={(v) => `${v}`}
          />
          <DeltaTile
            label="Wire out"
            current={monthStats.wire}
            previous={previousMonthStats.stats.wire}
            valueFormatter={formatMass}
          />
          <DeltaTile
            label="Input cost"
            current={monthStats.totalCost}
            previous={previousMonthStats.stats.totalCost}
            valueFormatter={formatInrInteger}
          />
          <DeltaTile
            label="Cost/kg (weighted)"
            current={monthStats.avgCostKg}
            previous={previousMonthStats.stats.avgCostKg}
            valueFormatter={(v) => (v > 0 ? `₹${v.toFixed(2)}` : '—')}
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Monthly trend</h2>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Month</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Days</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Wire (kg)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Input (kg)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Avg ₹/kg</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Yield</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Wire trend</th>
              </tr>
            </thead>
            <tbody>
              {monthlyTrend.map((m) => (
                <tr key={m.month} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{m.month}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.daysRunning}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMass(m.wire)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMass(m.kg)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{m.avgCostKg > 0 ? `₹${m.avgCostKg.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{m.kg > 0 ? `${((m.wire / m.kg) * 100).toFixed(1)}%` : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="h-2 w-full rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(100, (m.wire / maxMonthWire) * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
              {monthlyTrend.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    No monthly data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Quick links</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/casting/new-session"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
          >
            <Flame size={16} className="text-orange-600" />
            New session
            <ArrowRight size={14} className="text-slate-400" />
          </Link>
          <Link to="/casting/log" className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
            Casting log
            <ArrowRight size={14} className="text-slate-400" />
          </Link>
        </div>
      </section>
    </div>
  )
}

function Tile({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-md border p-2.5 ${emphasized ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono tabular-nums ${emphasized ? 'text-lg font-bold text-amber-800' : 'text-base font-semibold text-slate-900'}`}>{value}</p>
    </div>
  )
}

function DeltaTile({
  label,
  current,
  previous,
  valueFormatter,
}: {
  label: string
  current: number
  previous: number
  valueFormatter: (v: number) => string
}) {
  const delta = current - previous
  const isUp = delta >= 0
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-900">{valueFormatter(current)}</p>
      <p className={`mt-0.5 text-xs ${isUp ? 'text-emerald-700' : 'text-rose-700'}`}>
        {isUp ? '+' : '−'}
        {valueFormatter(Math.abs(delta))} vs previous month
      </p>
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
  }>,
) {
  const runningDays = new Set<string>()
  let batches = 0
  let kg = 0
  let wire = 0
  let wastage = 0
  let cholIn = 0
  let totalCost = 0
  for (const s of sessions) {
    runningDays.add(s.date)
    batches += s.unit
    kg += s.totalInputKg
    wire += s.wireOut
    wastage += s.wastage
    cholIn += s.cholIn
    totalCost += s.totalInputCost
  }
  return {
    daysRunning: runningDays.size,
    batches,
    count: sessions.length,
    kg,
    wire,
    wastage,
    cholIn,
    totalCost,
    avgCostKg: kg > 0 ? totalCost / kg : 0,
  }
}

