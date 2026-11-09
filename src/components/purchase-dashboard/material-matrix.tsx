import { useState } from 'react'
import { Panel } from '@/components/ui/panel'
import { fmtKg, fmtRate } from './format'
import type { CadenceRow, GradeRow, MatrixTotals } from '@/domain/purchase-dashboard'

export function MaterialMatrix({ gradeRows, cadenceRows, totals }: { gradeRows: GradeRow[]; cadenceRows: CadenceRow[]; totals: MatrixTotals }) {
  const [view, setView] = useState<'grades' | 'cadence'>('grades')
  return <Panel className="overflow-hidden p-0">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
      <div><h2 className="text-sm font-semibold text-slate-900">Raw Material Purchases</h2><p className="text-xs text-slate-500">Purchase records only; casting materials are tracked separately.</p></div>
      <div className="flex rounded-lg bg-slate-50 p-1 text-xs">
        <button type="button" className={`rounded-md px-3 py-1.5 ${view === 'grades' ? 'bg-white shadow-sm' : ''}`} onClick={() => setView('grades')}>By item</button>
        <button type="button" className={`rounded-md px-3 py-1.5 ${view === 'cadence' ? 'bg-white shadow-sm' : ''}`} onClick={() => setView('cadence')}>By month</button>
      </div>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-xs">
      <thead className="bg-slate-50 text-left uppercase text-slate-500"><tr>{(view === 'grades' ? ['Item', 'Bought kg', 'Average rate', 'Latest rate', 'Spend', 'Volume share'] : ['Month', 'Bills', 'Bought kg', 'Average rate', 'Spend', 'Paid out']).map((label) => <th key={label} className="px-3 py-2 text-right first:text-left">{label}</th>)}</tr></thead>
      <tbody>{view === 'grades' ? gradeRows.map((row) => <tr key={row.name} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{row.name}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{fmtKg(row.totalKg)}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{fmtRate(row.avgRate)}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{fmtRate(row.latestRate)}</td><td className="px-3 py-2 text-right font-mono tabular-nums">₹{Math.round(row.totalSpendRupees).toLocaleString('en-IN')}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{row.volumeShare.toFixed(1)}%</td></tr>) : cadenceRows.map((row) => <tr key={row.monthKey} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{row.monthLabel}</td><td className="px-3 py-2 text-right">{row.billCount}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{fmtKg(row.procuredKg)}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{fmtRate(row.procuredAvgRate)}</td><td className="px-3 py-2 text-right font-mono tabular-nums">₹{Math.round(row.procuredSpend).toLocaleString('en-IN')}</td><td className="px-3 py-2 text-right font-mono tabular-nums">₹{Math.round(row.paidRupees).toLocaleString('en-IN')}</td></tr>)}
      {(view === 'grades' ? gradeRows.length : cadenceRows.length) === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No purchase records yet.</td></tr>}</tbody>
      <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold"><tr><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right font-mono">{view === 'grades' ? `${fmtKg(totals.totalProcuredKg)} kg` : cadenceRows.reduce((sum, row) => sum + row.billCount, 0)}</td><td className="px-3 py-2 text-right font-mono">{view === 'grades' ? fmtRate(totals.avgProcuredRate) : `${fmtKg(totals.totalProcuredKg)} kg`}</td><td className="px-3 py-2 text-right" /><td className="px-3 py-2 text-right font-mono">₹{Math.round(totals.totalProcuredSpendRupees).toLocaleString('en-IN')}</td><td className="px-3 py-2 text-right font-mono">{view === 'grades' ? '100%' : `₹${Math.round(totals.totalPaidRupees).toLocaleString('en-IN')}`}</td></tr></tfoot>
    </table></div>
  </Panel>
}
