import { Link } from '@tanstack/react-router'
import { AlertTriangle, CalendarCheck2 } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import { fmtKg } from './format'

const DIVIDER = <span aria-hidden className="hidden h-3.5 w-px bg-slate-200 sm:inline-block" />

/**
 * Slim lead row: what landed today and what left today. Every number drills
 * into its source screen so the strip is a launchpad, not a dead readout.
 */
export function TodayStrip({
  dateLabel,
  billsToday,
  kgToday,
  paidTodayCount,
  paidTodayPaise,
  bardanPending,
}: {
  dateLabel: string
  billsToday: number
  kgToday: number
  paidTodayCount: number
  paidTodayPaise: number
  bardanPending: number
}) {
  const linkClass =
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60'
  const idleClass = 'inline-flex items-center text-[11px] text-muted-foreground'

  return (
    <Panel className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:gap-x-4">
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-foreground">
        <CalendarCheck2 size={14} className="text-blue-600" aria-hidden />
        Today · {dateLabel}
      </span>

      {DIVIDER}

      {billsToday > 0 ? (
        <Link to="/purchase-bills" className={`${linkClass} bg-blue-50/70 text-blue-800 hover:bg-blue-50`}>
          {billsToday} bill{billsToday === 1 ? '' : 's'} · {fmtKg(kgToday)} kg bought
        </Link>
      ) : (
        <span className={idleClass}>No bills registered yet</span>
      )}

      {DIVIDER}

      {paidTodayPaise > 0 ? (
        <Link
          to="/purchase-logs"
          search={{ type: 'payments' }}
          className={`${linkClass} bg-emerald-50 text-emerald-800 hover:bg-emerald-50/80`}
        >
          {paidTodayCount} payment{paidTodayCount === 1 ? '' : 's'} ·{' '}
          <span className="font-mono font-bold">₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(paidTodayPaise / 100)}</span>{' '}
          paid out
        </Link>
      ) : (
        <span className={idleClass}>Nothing paid out yet</span>
      )}

      {bardanPending > 0 && (
        <>
          {DIVIDER}
          <Link
            to="/purchase-bills"
            search={{ tab: 'bardan' }}
            title="Bills waiting for empty bags back (bardan)"
            className={`${linkClass} border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}
          >
            <AlertTriangle size={11} aria-hidden />
            {bardanPending} bardan pending
          </Link>
        </>
      )}
    </Panel>
  )
}
