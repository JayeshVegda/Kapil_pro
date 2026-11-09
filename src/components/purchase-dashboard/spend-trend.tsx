import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import type { CadenceRow } from './types'

const MONTHS_SHOWN = 6

/**
 * The decision view of months: procurement spend vs settled payments, each
 * month as two thin bars. CSS only — no chart dependency, rows stay scannable
 * and each label anchors to the cadence audit table below.
 */
export function SpendTrend({ rows }: { rows: CadenceRow[] }) {
  const months = [...rows].slice(0, MONTHS_SHOWN).reverse()
  const scaleMax = Math.max(1, ...months.map((m) => Math.max(m.procuredSpend, m.paidRupees)))
  const pct = (v: number) => `${Math.max(v > 0 ? 4 : 0, Math.min(100, (v / scaleMax) * 100))}%`

  return (
    <Panel className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground">Spend vs Paid Out</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Monthly procurement spend against payments settled</p>
        </div>
        <Link
          to="/purchase-logs"
          className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
        >
          Full log <ArrowRight size={12} aria-hidden />
        </Link>
      </div>

      {months.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          No purchase or payment months recorded yet.
        </p>
      ) : (
        <div className="mt-3 space-y-2.5">
          {months.map((m) => (
            <div key={m.monthKey} className="flex items-center gap-3" title={`${m.billCount} bills`}>
              <span className={`w-14 shrink-0 text-[11px] font-semibold ${m.monthKey === months[months.length - 1].monthKey ? 'text-blue-800' : 'text-slate-600'}`}>
                {m.monthLabel}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: pct(m.procuredSpend) }} />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-[11px] font-bold text-slate-700 tabular-nums">
                    {m.procuredSpend > 0 ? shortInrRupees(m.procuredSpend) : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500/80" style={{ width: pct(m.paidRupees) }} />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-[11px] font-semibold text-emerald-700 tabular-nums">
                    {m.paidRupees > 0 ? shortInrRupees(m.paidRupees) : '—'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
        <span className="mr-2 inline-flex items-center gap-1"><span aria-hidden className="inline-block h-1.5 w-3 rounded-full bg-blue-500" /> bought</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-1.5 w-3 rounded-full bg-emerald-500/80" /> paid out</span>
      </p>
    </Panel>
  )
}

function shortInrRupees(rupees: number): string {
  if (rupees >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(2)}cr`
  if (rupees >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(2)}L`
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees)}`
}
