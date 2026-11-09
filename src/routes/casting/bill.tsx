import { inputClass as baseInputClass } from '@/components/ui/form-control-classes'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Printer, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CastingTicket, formatKg, summarizeMaterials } from '@/components/casting/casting-ticket'
import { loadCastingSessions } from '@/data/casting'
import type { CastingSessionWithInputs } from '@/domain/casting-types'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

/**
 * Casting Bill (operational redesign Phase 4).
 *
 * Left card: search + date range + material filter feeding a compact selected
 * session list with kg/cost markers. Right side: calm cards over the same
 * ticket data — session header, output/yield, inputs by material, overhead,
 * and a print action. The printed output is the shared `CastingTicket`, so
 * the printed sheet always matches the on-screen cards without the route
 * recalculating any cost.
 */
export const Route = createFileRoute('/casting/bill')({
  component: CastingBillPage,
})

export function CastingBillPage() {
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [materialFilter, setMaterialFilter] = useState('all')
  const [selectedId, setSelectedId] = useState('')

  const sessionsQuery = useQuery({
    queryKey: ['casting-sessions'],
    queryFn: () => loadCastingSessions(),
  })

  const sessions = sessionsQuery.data ?? []

  const materialOptions = useMemo(() => {
    const names = new Set<string>()
    for (const session of sessions) {
      for (const row of summarizeMaterials(session)) names.add(row.name)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [sessions])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return sessions.filter((session) => {
      if (dateFrom && session.date < dateFrom) return false
      if (dateTo && session.date > dateTo) return false
      if (needle) {
        const haystack = `${session.date} ${session.note} ${session.inputs.map((input) => input.materialName).join(' ')}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      if (materialFilter !== 'all') {
        const names = session.inputs.map((input) => input.materialName.trim() || 'Unknown')
        if (!names.includes(materialFilter)) return false
      }
      return true
    })
  }, [sessions, search, dateFrom, dateTo, materialFilter])

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId, sessions],
  )

  return (
    <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left card: filters + compact session list */}
        <div className="space-y-4 lg:col-span-5 print:hidden">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Select casting session</h4>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-56">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  aria-label="Search sessions"
                  className={`${inputClass} h-9 pl-8 pr-2.5`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search date, note, material..."
                />
              </div>
              <div className="w-[150px]">
                <label className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-500">From</span>
                  <input aria-label="From date" className={`${inputClass} w-[104px]`} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </label>
              </div>
              <div className="w-[150px]">
                <label className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-500">To</span>
                  <input aria-label="To date" className={`${inputClass} w-[104px]`} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </label>
              </div>
              <div className="w-44">
                <label className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-500">Material</span>
                  <select
                    aria-label="Filter sessions by material"
                    value={materialFilter}
                    onChange={(event) => setMaterialFilter(event.target.value)}
                    className={`${inputClass} w-28`}
                  >
                    <option value="all">All materials</option>
                    {materialOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {sessionsQuery.isLoading && <p className="mt-3 text-xs text-slate-500">Loading sessions...</p>}
            {sessionsQuery.isError && <p role="alert" className="mt-3 text-xs text-rose-600 font-semibold">Unable to load casting sessions.</p>}

            <div className="mt-3 max-h-[520px] overflow-y-auto no-scrollbar space-y-1.5">
              {filtered.map((session) => {
                const isSelected = selected?.id === session.id
                return (
                  <button
                    key={session.id}
                    type="button"
                    aria-pressed={isSelected}
                    className={`w-full text-left p-3 rounded-lg border text-xs transition flex justify-between items-center ${isSelected ? 'border-slate-900 bg-slate-100/70 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                    onClick={() => setSelectedId(session.id)}
                  >
                    <div>
                      <span className="block font-bold text-slate-800">{formatFullDate(session.date)}</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        {session.unit} batches • {formatKg(session.totalInputKg)} in • {formatKg(session.totalWireOut)} out
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`block font-mono font-bold ${isSelected ? 'text-slate-900' : 'text-slate-750'}`}>
                        {session.metalCostPerKg > 0 ? `₹${session.metalCostPerKg.toFixed(2)}/kg` : '—'}
                      </span>
                      <span className="block text-[11px] uppercase font-bold text-slate-400">Metal cost</span>
                    </div>
                  </button>
                )
              })}
              {filtered.length === 0 && !sessionsQuery.isLoading && (
                <span className="text-xs text-slate-400 block py-4 text-center">No casting sessions match filters.</span>
              )}
            </div>
            <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
              Showing {filtered.length} of {sessions.length} sessions
            </p>
          </section>
        </div>

        {/* Right side: calm cards over the same ticket data */}
        <div className="lg:col-span-7">
          {sessionsQuery.isLoading && <p className="text-sm text-slate-500 py-6 print:hidden">Loading bill data...</p>}
          {sessionsQuery.isError && <p role="alert" className="text-sm text-rose-600 font-semibold py-6 print:hidden">Error loading details.</p>}
          {!sessionsQuery.isLoading && !selected && (
            <div className="grid min-h-[300px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center p-6 print:hidden">
              <span className="text-sm text-slate-500 italic">No casting sessions available for preview.</span>
            </div>
          )}
          {selected && (
            <>
              {/* Screen cards */}
              <div className="space-y-4 print:hidden">
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Cost sheet — {formatFullDate(selected.date)}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {selected.unit} batches • {formatKg(selected.totalInputKg)} in • {formatKg(selected.totalWireOut)} out
                        <span className="ml-2 font-mono text-slate-400">Session {selected.id.slice(0, 8)}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white px-4 py-2 transition shadow-sm"
                      onClick={() => window.print()}
                    >
                      <Printer size={14} /> Print ticket
                    </button>
                  </div>
                  {selected.note ? (
                    <p className="mt-2 rounded-lg bg-slate-50 border border-slate-150 px-3 py-2 text-xs text-slate-600 italic">
                      <strong>Note: </strong>{selected.note}
                    </p>
                  ) : null}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Output &amp; yield</h4>
                  <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <BillMetric label="Metal intake" value={formatKg(selected.totalInputKg)} />
                    <BillMetric label="Wire out" value={formatKg(selected.totalWireOut)} />
                    <BillMetric label="Wastage (mel)" value={formatKg(selected.totalMel)} />
                    <BillMetric label="Yield" value={yieldLabel(selected)} />
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Inputs by material</h4>
                  <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/60 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          <th className="px-3 py-2 text-left">Material</th>
                          <th className="px-3 py-2 text-right">Qty (kg)</th>
                          <th className="px-3 py-2 text-right">Avg rate</th>
                          <th className="px-3 py-2 text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {summarizeMaterials(selected).map((row) => (
                          <tr key={row.name}>
                            <td className="px-3 py-2 font-medium text-slate-800">{row.name}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatKg(row.qty)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{row.avgRate > 0 ? `₹${row.avgRate.toFixed(2)}` : '—'}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatInrInteger(row.amount)}</td>
                          </tr>
                        ))}
                        {selected.inputs.length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-400">No material inputs recorded.</td></tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-slate-50 font-bold text-slate-900">
                          <td className="px-3 py-2 text-xs">Total metal base</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{formatKg(selected.totalInputKg)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{selected.metalCostPerKg > 0 ? `₹${selected.metalCostPerKg.toFixed(2)}` : '—'}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{formatInrInteger(selected.totalInputCost)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Overhead &amp; final cost</h4>
                  <div className="mt-3 grid grid-cols-1 gap-x-6 md:grid-cols-2">
                    <div>
                      <BillLine label="Coal consumed" value={`${formatKg(selected.coalKg)} × ₹${selected.coalRate.toFixed(2)}`} />
                      <BillLine label="Coal cost / kg" value={selected.coalCostPerKg > 0 ? `₹${selected.coalCostPerKg.toFixed(2)}` : '—'} />
                      <BillLine label="Worker wage / kg" value={selected.workerCostPerKg > 0 ? `₹${selected.workerCostPerKg.toFixed(2)}` : '—'} />
                      <BillLine label="Casting cost / kg" value={selected.costPerKg > 0 ? `₹${selected.costPerKg.toFixed(2)}` : '—'} strong />
                    </div>
                    <div>
                      <BillLine label="Base metal cost" value={selected.metalCostPerKg > 0 ? `₹${selected.metalCostPerKg.toFixed(2)}/kg` : '—'} />
                      <BillLine label="Baravo 7.5% buffer" value={selected.metalCostPerKg > 0 ? `₹${(selected.metalCostPerKg * 0.075).toFixed(2)}/kg` : '—'} />
                      <BillLine label="Final product cost" value={selected.finalProductCostPerKg > 0 ? `₹${selected.finalProductCostPerKg.toFixed(2)}/kg` : '—'} strong />
                    </div>
                  </div>
                </section>
              </div>

              {/* Printed output: the shared ticket, identical values */}
              <div className="hidden print:block">
                <CastingTicket session={selected} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Display-only yield mark-up: kg wire per kg input. No cost recalculation. */
function yieldLabel(session: CastingSessionWithInputs) {
  if (session.totalInputKg <= 0) return '—'
  const ratio = session.totalWireOut / session.totalInputKg
  if (!Number.isFinite(ratio) || ratio <= 0) return '—'
  return `${Math.min(ratio * 100, 999).toFixed(1)}%`
}

function BillMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-150 bg-slate-50/40 p-3 text-center">
      <span className="block text-[11px] uppercase font-bold text-slate-400 tracking-wider">{label}</span>
      <span className="block mt-1 font-mono text-sm font-bold text-slate-800">{value}</span>
    </div>
  )
}

function BillLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-0.5 border-b border-dashed border-slate-100 last:border-0 ${strong ? 'font-bold text-slate-900 pt-1' : 'text-slate-600'}`}
    >
      <span className="text-xs">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  )
}

const inputClass = `${baseInputClass}`
