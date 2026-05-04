import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Flame } from 'lucide-react'
import { useMemo } from 'react'
import { loadCastingSessions } from '@/data/casting'
import { getLocalIsoDate } from '@/lib/date'

export const Route = createFileRoute('/casting')({
  component: CastingOverviewPage,
})

const CASTING_SESSIONS_KEY = ['casting-sessions'] as const

function CastingOverviewPage() {
  const sessionsQuery = useQuery({
    queryKey: CASTING_SESSIONS_KEY,
    queryFn: loadCastingSessions,
  })

  const monthPrefix = useMemo(() => getLocalIsoDate().slice(0, 7), [])

  const monthSessions = useMemo(() => {
    const list = sessionsQuery.data ?? []
    return list.filter((s) => s.date.startsWith(monthPrefix))
  }, [sessionsQuery.data, monthPrefix])

  const monthStats = useMemo(() => {
    let kg = 0
    let wire = 0
    let costNum = 0
    let costDen = 0
    for (const s of monthSessions) {
      kg += s.totalInputKg
      wire += s.wireOut
      if (s.totalInputKg > 0) {
        costNum += s.totalInputCost
        costDen += s.totalInputKg
      }
    }
    const avgCostKg = costDen > 0 ? costNum / costDen : 0
    return {
      count: monthSessions.length,
      kg,
      wire,
      avgCostKg,
    }
  }, [monthSessions])

  const last4WeeksTrend = useMemo(() => {
    const list = sessionsQuery.data ?? []
    const labels: string[] = []
    const d = new Date()
    for (let i = 3; i >= 0; i -= 1) {
      const x = new Date(d)
      x.setDate(x.getDate() - i * 7)
      labels.push(weekKeyFromDate(x))
    }
    const uniq = [...new Set(labels)]
    const maxC = Math.max(
      1e-9,
      ...uniq.map((label) => {
        let kg = 0
        let cost = 0
        for (const s of list) {
          if (weekKeyFromIso(s.date) === label) {
            kg += s.totalInputKg
            cost += s.totalInputCost
          }
        }
        return kg > 0 ? cost / kg : 0
      }),
    )
    return uniq.map((label) => {
      let kg = 0
      let cost = 0
      for (const s of list) {
        if (weekKeyFromIso(s.date) === label) {
          kg += s.totalInputKg
          cost += s.totalInputCost
        }
      }
      const ckg = kg > 0 ? cost / kg : 0
      return { label, ckg, width: (ckg / maxC) * 100 }
    })
  }, [sessionsQuery.data])

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500">Casting overview — furnace sessions and cost/kg trends.</p>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">This month ({monthPrefix})</h2>
        {sessionsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {sessionsQuery.isError && <p className="text-sm text-red-600">Unable to load casting data.</p>}
        {!sessionsQuery.isLoading && !sessionsQuery.isError && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label="Sessions" value={String(monthStats.count)} />
            <Tile label="Total input kg" value={monthStats.kg.toFixed(3)} />
            <Tile label="Total wire out" value={monthStats.wire.toFixed(3)} />
            <Tile label="Avg cost/kg" value={monthStats.avgCostKg > 0 ? `₹${monthStats.avgCostKg.toFixed(2)}` : '—'} emphasized />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Last 4 weeks · cost/kg (weighted)</h2>
        <ul className="space-y-2">
          {last4WeeksTrend.map((t) => (
            <li key={t.label} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 truncate text-slate-600" title={t.label}>
                {t.label}
              </span>
              <div className="h-2 flex-1 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(100, t.width)}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right font-mono text-xs text-slate-800">{t.ckg > 0 ? `₹${t.ckg.toFixed(2)}` : '—'}</span>
            </li>
          ))}
        </ul>
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

function weekKeyFromIso(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1)
  return weekKeyFromDate(dt)
}

function weekKeyFromDate(dt: Date) {
  const start = new Date(dt.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((dt.getTime() - start.getTime()) / 86400000)
  const w = Math.ceil(dayOfYear / 7)
  return `${dt.getFullYear()}-W${String(w).padStart(2, '0')}`
}

function Tile({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-md border p-2.5 ${emphasized ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono tabular-nums ${emphasized ? 'text-lg font-bold text-amber-800' : 'text-base font-semibold text-slate-900'}`}>{value}</p>
    </div>
  )
}
