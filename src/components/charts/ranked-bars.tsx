import { type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

export type RankedBarRow = {
  id: string
  label: string
  value: number
  formattedValue?: string
  subLabel?: string
  ageDays?: number | null
  ageLevel?: 'watch' | 'due' | 'overdue'
  actionLabel?: string
  onAction?: () => void
  href?: string
}

export type RankedBarsProps = {
  rows: readonly RankedBarRow[]
  maxScale?: number
  tone?: 'slate' | 'emerald' | 'amber' | 'rose'
  emptyText?: string
  actionSlot?: (row: RankedBarRow) => ReactNode
  className?: string
}

/**
 * Ranked horizontal bar list for top parties, items, or spend distributions.
 * Displays value, proportional bar, optional sub-label, age chip, and action button.
 */
export function RankedBars({
  rows,
  maxScale,
  tone = 'slate',
  emptyText = 'No items to display',
  actionSlot,
  className,
}: RankedBarsProps) {
  if (!rows || rows.length === 0) {
    return <p className="py-6 text-center text-xs text-slate-400">{emptyText}</p>
  }

  const maxValue = maxScale ?? Math.max(1, ...rows.map((r) => Math.max(0, r.value)))

  const barColor =
    tone === 'emerald'
      ? 'bg-emerald-600'
      : tone === 'amber'
        ? 'bg-amber-500'
        : tone === 'rose'
          ? 'bg-rose-500'
          : 'bg-slate-700'

  return (
    <div className={cn('space-y-3', className)}>
      {rows.map((row) => {
        const pct = Math.max(4, Math.min(100, (Math.max(0, row.value) / maxValue) * 100))
        const displayVal = row.formattedValue ?? row.value.toLocaleString('en-IN')

        return (
          <div key={row.id} className="group min-w-0 space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-slate-800" title={row.label}>
                  {row.label}
                </span>

                {row.ageDays != null && (
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.2 font-mono text-[10px] font-semibold tabular-nums',
                      row.ageLevel === 'overdue' || row.ageDays > 45
                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : row.ageLevel === 'due' || row.ageDays > 21
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    {row.ageDays}d
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono font-semibold tabular-nums text-slate-900">
                  {displayVal}
                </span>

                {actionSlot ? (
                  actionSlot(row)
                ) : row.href ? (
                  <Link
                    to={row.href}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {row.actionLabel ?? 'View'}
                  </Link>
                ) : row.onAction ? (
                  <button
                    type="button"
                    onClick={row.onAction}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {row.actionLabel ?? 'Act'}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn('h-full rounded-full transition-all duration-300', barColor)}
                style={{ width: `${pct}%` }}
              />
            </div>

            {row.subLabel && (
              <p className="text-[11px] text-slate-400 truncate">{row.subLabel}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
