import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ReportTable } from '@/components/reports/report-table'
import { loadCastingSessions } from '@/data/casting'
import { getLocalIsoDate } from '@/lib/date'
import { useMemo } from 'react'
import { KpiCard } from '@/components/ui/business-kit'

export const Route = createFileRoute('/reports/casting')({ beforeLoad: () => { throw redirect({ to: '/module-report', search: { module: 'casting', asOf: undefined } }) } })
export function CastingReportPage({ asOfDate }: { asOfDate?: string }) {
  const currentDate = useMemo(() => getLocalIsoDate(), [])
  const today = asOfDate ?? currentDate
  const sessions = useQuery({ queryKey: ['casting-report', today], queryFn: () => loadCastingSessions({ to: today }) })
  if (sessions.isLoading) return <p className="p-6 text-sm text-slate-500">Loading Casting report…</p>
  if (sessions.isError) return <p role="alert" className="p-6 text-sm text-rose-700">Casting report could not load.</p>
  const rows = sessions.data ?? []
  const materials = new Map<string, { kg: number; cost: number }>()
  const monthly = new Map<string, { input: number; output: number; cost: number; chol: number }>()
  for (const session of rows) {
    const month = session.date.slice(0, 7)
    const sum = monthly.get(month) ?? { input: 0, output: 0, cost: 0, chol: 0 }
    sum.input += session.totalInputKg; sum.output += session.totalWireOut; sum.cost += session.totalInputCost; sum.chol += session.cholIn
    monthly.set(month, sum)
    for (const input of session.inputs) { const item = materials.get(input.materialName) ?? { kg: 0, cost: 0 }; item.kg += input.qty; item.cost += input.amount; materials.set(input.materialName, item) }
  }
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3"><KpiCard label="Sessions · to selected date" value={rows.length} /><KpiCard label="Wire out" value={`${rows.reduce((sum, row) => sum + row.totalWireOut, 0).toFixed(2)} kg`} /><KpiCard label="Chol in" value={`${rows.reduce((sum, row) => sum + row.cholIn, 0).toFixed(2)} kg`} /></div>
    <ReportTable title="Sessions" headers={['Date', 'Wire out kg', 'Input kg', 'Wastage', 'Cost/kg']} rows={rows.map((row) => [<Link to="/casting/log" className="text-blue-700 hover:underline">{row.date}</Link>, row.totalWireOut.toFixed(2), row.totalInputKg.toFixed(2), row.totalInputKg ? `${((row.totalInputKg - row.totalWireOut) / row.totalInputKg * 100).toFixed(1)}%` : '—', `₹${row.finalProductCostPerKg.toFixed(2)}`])} />
    <ReportTable title="Monthly wastage, chol input and cost" headers={['Month', 'Wastage %', 'Chol in kg', 'Cost/kg']} rows={[...monthly].sort((a, b) => b[0].localeCompare(a[0])).map(([month, row]) => [month, row.input ? `${((row.input - row.output) / row.input * 100).toFixed(1)}%` : '—', row.chol.toFixed(2), row.output ? `₹${(row.cost / row.output).toFixed(2)}` : '—'])} />
    <ReportTable title="Inputs by material" headers={['Material', 'Kg', 'Cost']} rows={[...materials].sort((a, b) => b[1].kg - a[1].kg).map(([name, row]) => [name, row.kg.toFixed(2), `₹${row.cost.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`])} />
  </div>
}
