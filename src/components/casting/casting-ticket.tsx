import type { CastingSessionWithInputs } from '@/domain/casting-types'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

/**
 * CastingTicket, the shared on-screen and printed furnace chitty.
 *
 * Shared by Casting Log View, Casting Bill and print. The final figure comes
 * from the versioned saved session; the breakdown uses its saved material lines.
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
  const materials = summarizeMaterials(session)
  const rate = (value: number) => value > 0 ? `₹${value.toFixed(2)}` : '—'
  const brassRate = materials.find((material) => material.name.toLowerCase() === 'brass')?.avgRate ?? 0
  const originalFormula = session.costFormulaVersion === 1
  const baravoPerKg = originalFormula ? session.metalCostPerKg * 0.075 : brassRate * 0.07

  return (
    <article aria-label="Casting chitty" className="mx-auto w-full max-w-[21cm] min-w-0 bg-white p-4 text-slate-900 shadow-sm ring-1 ring-slate-300 sm:p-6 print:max-w-none print:p-0 print:shadow-none print:ring-0">
      <header className="border-b-2 border-slate-900 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600">Kapil Products · Foundry</p><h2 className="mt-1 text-xl font-black uppercase tracking-tight sm:text-2xl">Casting Chitty</h2></div>
          <div className="text-left text-xs sm:text-right"><p className="font-semibold">{formatFullDate(session.date)}</p><p className="mt-1 font-mono text-[11px] text-slate-600">Session {session.id.slice(0, 8)}</p></div>
        </div>
      </header>

      <div className="grid grid-cols-2 border-b border-slate-300 text-xs sm:grid-cols-4">
        <ChittyFact label="Batches" value={String(session.unit)} />
        <ChittyFact label="Metal in" value={formatKg(session.totalInputKg)} />
        <ChittyFact label="Wire out" value={formatKg(session.totalWireOut)} />
        <ChittyFact label="Mel / wastage" value={formatKg(session.totalMel)} />
      </div>

      <section className="py-4">
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Material charged</h3>
        <table className="hidden w-full table-fixed border-collapse text-xs sm:table print:table">
          <thead><tr className="border-y border-slate-900 text-left text-[11px] uppercase text-slate-600"><th className="w-[38%] py-2 pr-2">Material</th><th className="w-[20%] py-2 text-right">Weight</th><th className="w-[20%] py-2 text-right">Avg rate / kg</th><th className="w-[22%] py-2 text-right">Amount</th></tr></thead>
          <tbody>{materials.map((row) => <tr key={row.name} className="border-b border-slate-200"><td className="break-words py-2 pr-2 font-medium">{row.name}</td><td className="py-2 text-right font-mono tabular-nums">{formatKg(row.qty)}</td><td className="py-2 text-right font-mono tabular-nums">{rate(row.avgRate)}</td><td className="py-2 text-right font-mono tabular-nums">{formatInrInteger(row.amount)}</td></tr>)}</tbody>
          <tfoot><tr className="border-y-2 border-slate-900 font-bold"><td className="py-2">Total metal</td><td className="py-2 text-right font-mono">{formatKg(session.totalInputKg)}</td><td className="py-2 text-right font-mono">{rate(session.metalCostPerKg)}</td><td className="py-2 text-right font-mono">{formatInrInteger(session.totalInputCost)}</td></tr></tfoot>
        </table>
        <div className="divide-y divide-slate-200 border-y border-slate-900 sm:hidden print:hidden">{materials.map((row) => <div key={row.name} className="py-2 text-xs"><div className="flex justify-between gap-2"><strong className="min-w-0 break-words">{row.name}</strong><span className="shrink-0 font-mono">{formatInrInteger(row.amount)}</span></div><p className="mt-0.5 font-mono text-slate-600">{formatKg(row.qty)} · {rate(row.avgRate)}/kg</p></div>)}<div className="flex justify-between gap-2 py-2 font-bold"><span>Total metal · {formatKg(session.totalInputKg)}</span><span className="font-mono">{formatInrInteger(session.totalInputCost)}</span></div></div>
        {materials.length === 0 && <p className="py-3 text-xs text-slate-500">No material inputs recorded.</p>}
      </section>

      <section className="grid gap-x-6 gap-y-3 border-b border-slate-300 pb-4 text-xs sm:grid-cols-2 print:grid-cols-2">
        <div><h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Furnace and labour</h3><ChittyLine label="Coal consumed" value={formatKg(session.coalKg)} /><ChittyLine label="Coal rate / kg" value={rate(session.coalRate)} /><ChittyLine label="Coal cost / wire kg" value={rate(session.coalCostPerKg)} /><ChittyLine label="Worker wages" value={formatInrInteger(session.workerSalary)} /><ChittyLine label="Wages / wire kg" value={rate(session.workerCostPerKg)} /></div>
        <div><h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Output and cost</h3><ChittyLine label="Wire out" value={formatKg(session.totalWireOut)} /><ChittyLine label="Mel / wastage" value={formatKg(session.totalMel)} /><ChittyLine label="Chol in" value={formatKg(session.cholIn)} /><ChittyLine label="Metal cost / kg" value={rate(session.metalCostPerKg)} /><ChittyLine label="Casting cost / kg" value={rate(session.costPerKg)} /></div>
      </section>

      <section className="border-b border-slate-300 py-3 text-xs">
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Ready cost per kg</h3>
        <ChittyLine label="A · Metal / kg" value={rate(session.metalCostPerKg)} />
        <ChittyLine label={originalFormula ? 'B · Original Baravo 7.5% × 2' : `B · Chitty Brass ${rate(brassRate)}/kg × 7% × 2`} value={rate(baravoPerKg * 2)} />
        <ChittyLine label="C · Coal / wire kg × 2" value={rate(session.coalCostPerKg * 2)} />
        <ChittyLine label="C · Worker / wire kg × 2" value={rate(session.workerCostPerKg * 2)} />
      </section>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-y-2 border-slate-900 py-3">
        <div><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Final ready cost</p><p className="mt-1 text-xs text-slate-500">{originalFormula ? 'Original session formula' : 'A + B + C from this chitty'}</p></div>
        <strong className="font-mono text-xl tabular-nums">{rate(session.finalProductCostPerKg)}<span className="text-xs"> / kg</span></strong>
      </div>
      {session.note && <p className="mt-4 whitespace-pre-wrap break-words border-b border-slate-200 pb-3 text-xs"><strong>Remarks: </strong>{session.note}</p>}
      <p className="mt-4 text-[11px] text-slate-500">Internal foundry cost record · Session {session.id}</p>
    </article>
  )
}

function ChittyFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-r border-slate-200 px-2 py-2 last:border-r-0"><p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p><p className="mt-0.5 break-words font-mono text-sm font-bold tabular-nums">{value}</p></div>
}

function ChittyLine({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-2 border-b border-dotted border-slate-200 py-1 last:border-b-0"><span className="text-slate-600">{label}</span><span className="shrink-0 font-mono font-semibold tabular-nums">{value}</span></div>
}
