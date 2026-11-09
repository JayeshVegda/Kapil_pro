import type { CastingSessionWithInputs } from '@/domain/casting-types'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

/**
 * CastingTicket (operational redesign Phase 4).
 *
 * The one furnace-session cost sheet, shared by the Casting Log "View" modal
 * and the print output of the Casting Bill page. It renders only what the
 * session already stores — every cost column comes straight from the saved
 * record, so the on-screen ticket and the printed ticket can never disagree.
 * No route may recalculate costs around it.
 */

export type CastingMaterialSummaryRow = {
  name: string
  qty: number
  amount: number
  avgRate: number
}

/** Aggregate the session's inputs by material name for display. */
export function summarizeMaterials(session: CastingSessionWithInputs | null): CastingMaterialSummaryRow[] {
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

export function formatKg(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)} kg`
}

export function CastingTicket({ session }: { session: CastingSessionWithInputs }) {
  const materialRows = summarizeMaterials(session)

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mx-auto max-w-[21cm] print:border-0 print:shadow-none print:p-0">
      <div className="border-b-2 border-slate-900 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Casting report</span>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Kapil Products</h2>
            <p className="mt-0.5 text-xs text-slate-500">Furnace session cost sheet</p>
          </div>
          <div className="text-right text-xs">
            <span className="block font-bold text-slate-800">{formatFullDate(session.date)}</span>
            <span className="block font-mono text-slate-400 mt-0.5">Session ID: {session.id.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <TicketMetric label="Batches" value={`${session.unit} runs`} />
        <TicketMetric label="Metal Intake" value={formatKg(session.totalInputKg)} />
        <TicketMetric label="Total Wire Out" value={formatKg(session.totalWireOut)} />
        <TicketMetric label="Wastage (Mel)" value={formatKg(session.totalMel)} />
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
              <tr key={row.name} className="text-slate-800">
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
              <td className="px-3 py-2.5 text-right font-mono">{formatKg(session.totalInputKg)}</td>
              <td className="px-3 py-2.5 text-right font-mono">
                {session.metalCostPerKg > 0 ? `₹${session.metalCostPerKg.toFixed(2)}` : '-'}
              </td>
              <td className="px-3 py-2.5 text-right font-mono">{formatInrInteger(session.totalInputCost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Furnace Overhead Costs</h3>
          <TicketLine label="Coal Consumed" value={`${formatKg(session.coalKg)} × ₹${session.coalRate.toFixed(2)}`} />
          <TicketLine label="Coal Cost / kg" value={session.coalCostPerKg > 0 ? `₹${session.coalCostPerKg.toFixed(2)}` : '-'} />
          <TicketLine label="Worker Wage / kg" value={session.workerCostPerKg > 0 ? `₹${session.workerCostPerKg.toFixed(2)}` : '-'} />
          <TicketLine label="Casting Cost / kg" value={session.costPerKg > 0 ? `₹${session.costPerKg.toFixed(2)}/kg` : '-'} strong />
        </div>
        <div className="rounded-xl border border-slate-200 p-4 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Ready Material Estimate</h3>
          <TicketLine label="Base Metal Cost" value={session.metalCostPerKg > 0 ? `₹${session.metalCostPerKg.toFixed(2)}/kg` : '-'} />
          <TicketLine label="Baravo 7.5% Buffer" value={session.metalCostPerKg > 0 ? `₹${(session.metalCostPerKg * 0.075).toFixed(2)}/kg` : '-'} />
          <TicketLine label="Final Product Cost" value={session.finalProductCostPerKg > 0 ? `₹${session.finalProductCostPerKg.toFixed(2)}/kg` : '-'} strong />
        </div>
      </div>

      {session.note ? (
        <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-150 text-xs text-slate-600 italic">
          <strong>Note: </strong> {session.note}
        </div>
      ) : null}
    </div>
  )
}

function TicketMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-150 bg-slate-50/40 p-3 text-center">
      <span className="block text-[11px] uppercase font-bold text-slate-400 tracking-wider">{label}</span>
      <span className="block mt-1 font-mono text-sm font-bold text-slate-800">{value}</span>
    </div>
  )
}

function TicketLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-0.5 border-b border-dashed border-slate-100 last:border-0 ${strong ? 'font-bold text-slate-900 pt-1 border-t border-solid border-slate-200' : 'text-slate-600'}`}
    >
      <span className="text-xs">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  )
}
