import { Link } from '@tanstack/react-router'
import { fmtKg, fmtRate } from './format'

import type { DashboardSnapshot } from '@/domain/purchase-dashboard'
export type { DashboardSnapshot } from '@/domain/purchase-dashboard'

/** Compact ₹ with L/cr shorthand for tile values (e.g. ₹4.2L). */
function shortInr(paise: number): string {
  const rupees = paise / 100
  if (rupees >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(2)}cr`
  if (rupees >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(2)}L`
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees)}`
}

const tileShell =
  'group relative overflow-hidden rounded-lg border border-border bg-card p-3.5 shadow-sm transition hover:border-blue-300'

/**
 * Overhead money view: four tiles, each fully clickable into its source
 * screen. Interactive children opt back into pointer events.
 */
export function SnapshotTiles({ data }: { data: DashboardSnapshot }) {
  const s = data
  const overlay =
    'absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
  const chipBase =
    'pointer-events-auto inline-flex rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <section aria-label="Money snapshot" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {/* Tile 1 · We Owe + aging */}
      <div className={tileShell}>
        <Link to="/suppliers" search={{ focus: 'overdue' }} className={overlay} aria-label="Open supplier ledgers" />
        <div className="relative pointer-events-none">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Total We Owe</p>
          <p className="mt-1 font-mono text-xl font-extrabold tabular-nums leading-tight text-foreground">
            {shortInr(s.totalWeOwePaise)}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border/70 text-center" aria-hidden>
            <span className="bg-secondary/40 px-1 py-0.5">
              <span className="block text-[8.5px] font-bold uppercase text-muted-foreground">0–30d</span>
              <span className="font-mono text-[10.5px] font-bold text-foreground">{shortInr(s.aging.bucket0to30)}</span>
            </span>
            <span className="bg-amber-50/70 px-1 py-0.5">
              <span className="block text-[8.5px] font-bold uppercase text-amber-700">31–60d</span>
              <span className="font-mono text-[10.5px] font-bold text-amber-700">{shortInr(s.aging.bucket31to60)}</span>
            </span>
            <span className="bg-rose-50/70 px-1 py-0.5">
              <span className="block text-[8.5px] font-bold uppercase text-rose-600">60d+</span>
              <span className="font-mono text-[10.5px] font-bold text-rose-600">{shortInr(s.aging.bucket60plus)}</span>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            {s.totalAdvancePaise > 0 && (
              <span className="font-mono font-semibold text-emerald-700">+ {shortInr(s.totalAdvancePaise)} advance</span>
            )}
            {s.bardanPendingBills > 0 ? (
              <Link
                to="/purchase-bills"
                search={{ tab: 'bardan' }}
                className={`${chipBase} border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}
              >
                {s.bardanPendingBills} bardan
              </Link>
            ) : (
              <span className="pointer-events-none text-muted-foreground">{s.suppliersDueCount} suppliers owe</span>
            )}
          </div>
        </div>
      </div>

      {/* Tile 2 · Material procured */}
      <div className={tileShell}>
        <Link to="/purchase-logs" search={{ type: 'bills' }} className={overlay} aria-label="Open purchase bills log" />
        <div className="relative pointer-events-none">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Material Bought</p>
          <p className="mt-1 font-mono text-xl font-extrabold tabular-nums leading-tight text-foreground">
            {fmtKg(s.totalProcuredKg)} <span className="text-xs font-semibold text-muted-foreground">kg</span>
          </p>
          <p className="mt-1 flex items-baseline gap-2 text-[11px]">
            <span className="font-mono font-bold tabular-nums text-blue-700">{fmtRate(s.avgProcuredRate)}/kg avg</span>
            <span className="text-muted-foreground tabular-nums">{shortInr(s.totalProcuredPaise)} all-time</span>
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {s.recentKg > 0 ? (
              <span className="tabular-nums">
                <strong className="font-mono text-foreground">{fmtKg(s.recentKg)}</strong> kg {s.recentKgLabel} ·{' '}
                <span className="font-mono">{s.billCount}</span> bills
              </span>
            ) : (
              'No bills yet'
            )}
          </p>
        </div>
      </div>

      {/* Tile 4 · Paid out */}
      <div className={tileShell}>
        <Link to="/purchase-logs" search={{ type: 'payments' }} className={overlay} aria-label="Open payments log" />
        <div className="relative pointer-events-none">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Total Paid Out</p>
          <p className="mt-1 font-mono text-xl font-extrabold tabular-nums leading-tight text-foreground">
            {shortInr(s.totalPaidPaise)}
          </p>
          <p className="mt-2 flex items-center justify-between gap-2">
            <Link to="/new-supplier-payment" className="pointer-events-auto inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              New payment
            </Link>
            <span className="text-[11px] text-muted-foreground">
              <strong className="font-mono text-foreground">{s.suppliersDueCount}</strong> suppliers due
            </span>
          </p>
        </div>
      </div>
    </section>
  )
}
