import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Printer, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { loadCastingSessions } from '@/data/casting'
import type { CastingSessionWithInputs } from '@/domain/casting-types'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/casting/bill')({
  component: CastingBillPage,
})

function CastingBillPage() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')

  const sessionsQuery = useQuery({
    queryKey: ['casting-sessions'],
    queryFn: () => loadCastingSessions(),
  })

  const sessions = sessionsQuery.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((session) =>
      `${session.date} ${session.note} ${session.inputs.map((input) => input.materialName).join(' ')}`
        .toLowerCase()
        .includes(q),
    )
  }, [search, sessions])

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId, sessions],
  )
  const materialRows = useMemo(() => summarizeMaterials(selected), [selected])

  return (
    <div className="w-full px-3 pb-8 pt-3 sm:px-4 lg:px-6">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Column: Session selector (5 cols) */}
        <div className="space-y-4 lg:col-span-5 print:hidden">
          {/* Session Selector List */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Select Casting Session</h4>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className={inputClass}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search date, note, material..."
              />
            </div>
            {sessionsQuery.isLoading && <p className="text-xs text-slate-500">Loading sessions...</p>}
            {sessionsQuery.isError && <p className="text-xs text-rose-600 font-semibold">Unable to load casting sessions.</p>}
            <div className="max-h-[500px] overflow-y-auto no-scrollbar space-y-1.5">
              {filtered.map((session) => {
                const isSelected = selected?.id === session.id
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`w-full text-left p-3 rounded-lg border text-xs transition flex justify-between items-center ${isSelected ? 'border-blue-500 bg-blue-50/50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                    onClick={() => setSelectedId(session.id)}
                  >
                    <div>
                      <span className="block font-bold text-slate-800">{formatFullDate(session.date)}</span>
                      <span className="block text-[10px] text-slate-500 mt-0.5">
                        {session.unit} batches • {formatKg(session.totalWireOut)} out
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="block font-mono font-bold text-slate-750">₹{session.metalCostPerKg.toFixed(2)}/kg</span>
                      <span className="block text-[9px] uppercase font-bold text-slate-400">Metal Cost</span>
                    </div>
                  </button>
                )
              })}
              {filtered.length === 0 && !sessionsQuery.isLoading && (
                <span className="text-xs text-slate-400 block py-4 text-center">No casting sessions match filters.</span>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Print preview receipt (7 cols) */}
        <div className="lg:col-span-7">
          {sessionsQuery.isLoading && <p className="text-sm text-slate-500 py-6 print:hidden">Loading bill data...</p>}
          {sessionsQuery.isError && <p className="text-sm text-rose-600 font-semibold py-6 print:hidden">Error loading details.</p>}
          {!sessionsQuery.isLoading && !selected && (
            <div className="grid min-h-[300px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center p-6 print:hidden">
              <span className="text-sm text-slate-500 italic">No casting sessions available for preview.</span>
            </div>
          )}
          {selected && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Cost Sheet Preview</h3>
                  <p className="text-xs text-slate-500">Kapil Products furnace session print receipt.</p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 px-4 py-2 transition shadow-sm"
                  onClick={() => window.print()}
                >
                  <Printer size={14} /> Print Session Receipt
                </button>
              </div>

              {/* Printable Cost Sheet Paper container */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mx-auto max-w-[21cm] print:border-0 print:shadow-none print:p-0">
                <div className="border-b-2 border-slate-900 pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Casting report</span>
                      <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Kapil Products</h2>
                      <p className="mt-0.5 text-xs text-slate-500">Furnace session cost sheet</p>
                    </div>
                    <div className="text-right text-xs">
                      <span className="block font-bold text-slate-800">{formatFullDate(selected.date)}</span>
                      <span className="block font-mono text-slate-400 mt-0.5">Session ID: {selected.id.slice(0, 8)}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <BillMetric label="Batches" value={`${selected.unit} runs`} />
                  <BillMetric label="Metal Intake" value={formatKg(selected.totalInputKg)} />
                  <BillMetric label="Total Wire Out" value={formatKg(selected.totalWireOut)} />
                  <BillMetric label="Wastage (Mel)" value={formatKg(selected.totalMel)} />
                </div>

                <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider text-left bg-slate-50/50">
                        <th className="px-3 py-2.5 text-left font-bold text-slate-600">Material Name</th>
                        <th className="px-3 py-2.5 text-right font-bold text-slate-600">Qty (kg)</th>
                        <th className="px-3 py-2.5 text-right font-bold text-slate-600">Avg Rate</th>
                        <th className="px-3 py-2.5 text-right font-bold text-slate-600">Total Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {materialRows.map((row) => (
                        <tr key={row.name} className="hover:bg-slate-50/20 transition text-slate-800">
                          <td className="px-3 py-2 font-medium text-slate-800">{row.name}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{formatKg(row.qty)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {row.avgRate > 0 ? `₹${row.avgRate.toFixed(2)}` : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{formatInrInteger(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-900 bg-slate-50 text-slate-900 font-bold">
                        <td className="px-3 py-2.5">Total Metal Base</td>
                        <td className="px-3 py-2.5 text-right font-mono">{formatKg(selected.totalInputKg)}</td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {selected.metalCostPerKg > 0 ? `₹${selected.metalCostPerKg.toFixed(2)}` : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">{formatInrInteger(selected.totalInputCost)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Furnace Overhead Costs</h3>
                    <BillLine label="Coal Consumed" value={`${formatKg(selected.coalKg)} × ₹${selected.coalRate.toFixed(2)}`} />
                    <BillLine label="Coal Cost / kg" value={selected.coalCostPerKg > 0 ? `₹${selected.coalCostPerKg.toFixed(2)}` : '-'} />
                    <BillLine label="Worker Wage / kg" value={selected.workerCostPerKg > 0 ? `₹${selected.workerCostPerKg.toFixed(2)}` : '-'} />
                    <BillLine label="Casting Cost / kg" value={selected.costPerKg > 0 ? `₹${selected.costPerKg.toFixed(2)}/kg` : '-'} strong />
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Ready Material Estimate</h3>
                    <BillLine label="Base Metal Cost" value={selected.metalCostPerKg > 0 ? `₹${selected.metalCostPerKg.toFixed(2)}/kg` : '-'} />
                    <BillLine label="Baravo 7.5% Buffer" value={selected.metalCostPerKg > 0 ? `₹${(selected.metalCostPerKg * 0.075).toFixed(2)}/kg` : '-'} />
                    <BillLine label="Final Product Cost" value={selected.finalProductCostPerKg > 0 ? `₹${selected.finalProductCostPerKg.toFixed(2)}/kg` : '-'} strong />
                  </div>
                </div>

                {selected.note ? (
                  <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-150 text-xs text-slate-600 italic">
                    <strong>Note: </strong> {selected.note}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function summarizeMaterials(session: CastingSessionWithInputs | null) {
  if (!session) return []
  const map = new Map<string, { name: string; qty: number; amount: number; avgRate: number }>()
  for (const input of session.inputs) {
    const name = input.materialName.trim() || 'Unknown'
    const row = map.get(name) ?? { name, qty: 0, amount: 0, avgRate: 0 }
    row.qty += input.qty
    row.amount += input.amount
    map.set(name, row)
  }
  return [...map.values()]
    .map((row) => ({ ...row, avgRate: row.qty > 0 ? row.amount / row.qty : 0 }))
    .sort((a, b) => b.amount - a.amount)
}

function BillMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-150 bg-slate-50/40 p-3 text-center">
      <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">{label}</span>
      <span className="block mt-1 font-mono text-sm font-bold text-slate-800">{value}</span>
    </div>
  )
}

function BillLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-0.5 border-b border-dashed border-slate-100 last:border-0 ${strong ? 'font-bold text-slate-900 pt-1 border-t border-solid border-slate-200' : 'text-slate-600'}`}
    >
      <span className="text-xs">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  )
}

function formatKg(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)} kg`
}

const inputClass =
  'h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white pl-8 pr-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'

