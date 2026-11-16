import { inputClass as baseInputClass } from '@/components/ui/form-control-classes'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Printer, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CastingTicket, formatKg, summarizeMaterials } from '@/components/casting/casting-ticket'
import { loadCastingSessions } from '@/data/casting'
import { formatFullDate } from '@/lib/date'

/**
 * Casting Bill (operational redesign Phase 4).
 *
 * Left card filters and selects a session. The right pane renders the same
 * physical chitty used by print and Casting Log View. Costs come from the
 * stored session; this route does not recalculate them.
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
    () => filtered.find((session) => session.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  )

  return (
    <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 print:block">
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

        {/* The same chitty is shown here, in the log View dialog, and on paper. */}
        <div className="min-w-0 lg:col-span-7 print:w-full">
          {sessionsQuery.isLoading && <p className="py-6 text-sm text-slate-500 print:hidden">Loading casting chitty...</p>}
          {sessionsQuery.isError && <p role="alert" className="py-6 text-sm font-semibold text-rose-700 print:hidden">Unable to load casting sessions.</p>}
          {!sessionsQuery.isLoading && !selected && (
            <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500 print:hidden">
              No casting sessions match these filters.
            </div>
          )}
          {selected && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 print:hidden">
                <p className="text-xs text-slate-500">Casting chitty · {formatFullDate(selected.date)}</p>
                <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white"><Printer size={14} /> Print chitty</button>
              </div>
              <CastingTicket session={selected} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const inputClass = `${baseInputClass}`
