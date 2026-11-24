import type { CastingSessionWithInputs } from '@/domain/casting-types'
import { calculateCastingReadyCost } from '@/domain/casting-calculations'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

/**
 * CastingTicket, the shared on-screen and printed furnace chitty.
 *
 * Shared by Casting Log View, Casting Bill and print.
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

const moneyPerKg = (value: number) => `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function formatCastingWeekday(date: string) {
  const day = new Date(`${date.slice(0, 10)}T12:00:00`)
  return Number.isNaN(day.getTime()) ? '' : day.toLocaleDateString('en-IN', { weekday: 'long' })
}

export function CastingTicket({ session }: { session: CastingSessionWithInputs }) {
  const materials = summarizeMaterials(session)
  const brass = materials.filter((material) => material.name.toLowerCase() === 'brass')
  const brassKg = brass.reduce((sum, material) => sum + material.qty, 0)
  const brassRate = brassKg > 0 ? brass.reduce((sum, material) => sum + material.amount, 0) / brassKg : 0
  const ready = calculateCastingReadyCost(session.metalCostPerKg, brassRate, session.coalCostPerKg, session.workerCostPerKg)

  return (
    <article aria-label="Casting chitti" className="mx-auto w-full min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm sm:p-6 print:space-y-2 print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 print:bg-white">
        <div>
          <p className="text-xs font-semibold text-slate-600">Kapil Products</p>
          <h2 className="mt-0.5 text-xl font-semibold text-slate-950">Kapil Product Casting</h2>
        </div>
        <div className="sm:text-right">
          <p className="text-sm font-semibold tabular-nums">{formatFullDate(session.date)}</p>
          <p className="text-xs text-slate-600">{formatCastingWeekday(session.date)}</p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
        <ChittyFact label="Batches" value={String(session.unit)} />
        <ChittyFact label="Metal in" value={formatKg(session.totalInputKg)} />
        <ChittyFact label="Metal out" value={formatKg(session.totalWireOut)} />
        <ChittyFact label="Wastage" value={formatKg(session.totalMel)} />
      </div>

      <section className="rounded-lg border border-slate-200">
        <h3 className="border-b border-slate-200 px-3 py-2.5 text-sm font-semibold">Materials</h3>
        <table className="hidden w-full table-fixed border-collapse text-xs sm:table print:table">
          <thead>
            <tr className="bg-slate-50 text-left text-slate-600">
              <th scope="col" className="w-[34%] px-3 py-2">Material</th>
              <th scope="col" className="w-[20%] px-2 py-2 text-right">Weight</th>
              <th scope="col" className="w-[24%] px-2 py-2 text-right">Avg rate/kg</th>
              <th scope="col" className="w-[22%] px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {materials.map((row) => (
              <tr key={row.name}>
                <th scope="row" className="break-words px-3 py-2.5 text-left font-medium">{row.name}</th>
                <td className="px-2 py-2.5 text-right tabular-nums">{formatKg(row.qty)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{moneyPerKg(row.avgRate)}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatInrInteger(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="divide-y divide-slate-100 sm:hidden print:hidden">
          {materials.map((row) => (
            <li key={row.name} className="px-3 py-2.5 text-xs">
              <div className="flex justify-between gap-2 font-semibold"><span className="break-words">{row.name}</span><span>{formatInrInteger(row.amount)}</span></div>
              <p className="mt-0.5 tabular-nums text-slate-600">{formatKg(row.qty)} · {moneyPerKg(row.avgRate)}/kg</p>
            </li>
          ))}
        </ul>
        {materials.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No materials recorded.</p>}
        <div className="flex justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold"><span>Total material cost</span><span className="tabular-nums">{formatInrInteger(session.totalInputCost)}</span></div>
      </section>

      <section className="rounded-lg border border-slate-200 px-3 py-2.5">
        <h3 className="mb-1 text-sm font-semibold">Cost per kg</h3>
        <dl className="divide-y divide-slate-100 text-xs">
          <ChittyLine label="Metal/kg" value={moneyPerKg(session.metalCostPerKg)} />
          <ChittyLine label={brassKg > 0 ? `Baravo · Chitti Brass ${moneyPerKg(brassRate)}/kg × 7% × 2` : 'Baravo · No Brass line on chitti'} value={moneyPerKg(ready.baravoCostPerKg * 2)} />
          <ChittyLine label="Coal × 2 + worker × 2" value={moneyPerKg((session.coalCostPerKg + session.workerCostPerKg) * 2)} />
        </dl>
      </section>

      <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 print:bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-emerald-950">Final ready cost</h3>
          <strong className="text-xl tabular-nums text-emerald-950">{moneyPerKg(ready.finalProductCostPerKg)}<span className="text-xs font-medium"> / kg</span></strong>
        </div>
        {session.costFormulaVersion === 1 && (
          <p className="mt-1 text-xs text-slate-600">Recalculated above. Original saved cost {moneyPerKg(session.finalProductCostPerKg)}/kg · 7.5% of metal rate × 2</p>
        )}
      </section>
    </article>
  )
}

function ChittyFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5"><p className="text-xs text-slate-600">{label}</p><p className="mt-0.5 break-words text-base font-semibold tabular-nums">{value}</p></div>
}

function ChittyLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-3 py-2"><dt className="text-slate-600">{label}</dt><dd className="shrink-0 font-semibold tabular-nums">{value}</dd></div>
}
