import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { loadCastingSessions } from '@/data/casting'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/casting/materials')({
  component: CastingMaterialsPage,
})

const SESSIONS_KEY = ['casting-sessions'] as const

function CastingMaterialsPage() {
  const sessionsQuery = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => loadCastingSessions(),
  })

  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), [])
  const previousMonth = useMemo(() => {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date((y ?? 2000), (m ?? 1) - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [currentMonth])

  const report = useMemo(() => buildMaterialReport(sessionsQuery.data ?? [], currentMonth, previousMonth), [currentMonth, previousMonth, sessionsQuery.data])
  const maxKg = useMemo(() => Math.max(1e-9, ...report.rows.map((row) => row.totalKg)), [report.rows])

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Material usage report</h3>
            <p className="mt-1 text-xs text-slate-500">Based on casting logs. This shows what has actually gone into the furnace, not just material names.</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">{currentMonth}</span>
        </div>
        {sessionsQuery.isLoading && <p className="text-sm text-slate-500">Loading casting material usage...</p>}
        {sessionsQuery.isError && <p className="text-sm text-red-600">Unable to load casting sessions.</p>}
        {!sessionsQuery.isLoading && !sessionsQuery.isError && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="Materials used" value={String(report.rows.length)} />
            <Metric label="All-time kg" value={formatKg(report.totalKg)} />
            <Metric label="This month kg" value={formatKg(report.monthKg)} />
            <Metric label="All-time cost" value={formatInrInteger(report.totalCost)} emphasized />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-950">Material ledger</h3>
        {!sessionsQuery.isLoading && report.rows.length === 0 && <p className="text-sm text-slate-500">No casting material usage found.</p>}
        {report.rows.length > 0 && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Material</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">All-time kg</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">This month</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Last month</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Avg rate</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Total cost</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Share</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.name} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-medium text-slate-900">{row.name}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{formatKg(row.totalKg)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-blue-700">{formatKg(row.currentMonthKg)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{formatKg(row.previousMonthKg)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{row.avgRate > 0 ? `₹${row.avgRate.toFixed(2)}` : '-'}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{formatInrInteger(row.totalCost)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, (row.totalKg / maxKg) * 100)}%` }} />
                        </div>
                        <span className="w-12 text-right font-mono text-xs text-slate-500">{report.totalKg > 0 ? `${((row.totalKg / report.totalKg) * 100).toFixed(1)}%` : '0%'}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

type MaterialReportRow = {
  name: string
  totalKg: number
  totalCost: number
  currentMonthKg: number
  previousMonthKg: number
  avgRate: number
}

function buildMaterialReport(
  sessions: Array<{ date: string; inputs: Array<{ materialName: string; qty: number; amount: number }> }>,
  currentMonth: string,
  previousMonth: string,
) {
  const acc = new Map<string, MaterialReportRow>()
  for (const session of sessions) {
    for (const input of session.inputs) {
      const name = input.materialName.trim() || 'Unknown'
      const row = acc.get(name) ?? { name, totalKg: 0, totalCost: 0, currentMonthKg: 0, previousMonthKg: 0, avgRate: 0 }
      row.totalKg += input.qty
      row.totalCost += input.amount
      if (session.date.startsWith(currentMonth)) row.currentMonthKg += input.qty
      if (session.date.startsWith(previousMonth)) row.previousMonthKg += input.qty
      acc.set(name, row)
    }
  }

  const rows = [...acc.values()]
    .map((row) => ({ ...row, avgRate: row.totalKg > 0 ? row.totalCost / row.totalKg : 0 }))
    .sort((a, b) => b.totalKg - a.totalKg)

  return {
    rows,
    totalKg: rows.reduce((sum, row) => sum + row.totalKg, 0),
    monthKg: rows.reduce((sum, row) => sum + row.currentMonthKg, 0),
    totalCost: rows.reduce((sum, row) => sum + row.totalCost, 0),
  }
}

function Metric({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${emphasized ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-1 font-mono tabular-nums ${emphasized ? 'text-lg font-bold text-blue-900' : 'text-base font-semibold text-slate-900'}`}>{value}</p>
    </div>
  )
}

function formatKg(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)} kg`
}
