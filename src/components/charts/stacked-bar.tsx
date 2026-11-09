import { cn } from '@/lib/utils'

export type StackedBarSegment = {
  key: string
  label: string
  value: number
  color: string
  subText?: string
}

export type StackedBarProps = {
  segments: readonly StackedBarSegment[]
  formatValue?: (val: number) => string
  emptyText?: string
  className?: string
}

/**
 * Horizontal proportional bar with labelled segments and legend.
 * Handles all-zero or empty data gracefully without division by zero.
 */
export function StackedBar({
  segments,
  formatValue = (v) => v.toLocaleString('en-IN'),
  emptyText = 'No distribution data available',
  className,
}: StackedBarProps) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)

  if (total <= 0) {
    return (
      <div className={cn('space-y-2', className)}>
        <div className="h-3 w-full rounded-full bg-slate-100" />
        <p className="text-center text-xs text-slate-400">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {segments.map((seg) => {
          if (seg.value <= 0) return null
          const pct = ((seg.value / total) * 100).toFixed(1)
          return (
            <div
              key={seg.key}
              style={{ width: `${pct}%`, backgroundColor: seg.color }}
              title={`${seg.label}: ${formatValue(seg.value)} (${pct}%)`}
              className="transition-all duration-300"
            />
          )
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
        {segments.map((seg) => {
          const pct = total > 0 ? ((Math.max(0, seg.value) / total) * 100).toFixed(0) : '0'
          return (
            <div key={seg.key} className="inline-flex items-center gap-1.5 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: seg.color }}
                aria-hidden="true"
              />
              <span className="text-slate-600">{seg.label}:</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {formatValue(seg.value)}
              </span>
              <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                ({pct}%)
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
