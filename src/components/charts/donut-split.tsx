import { CHART_THEME } from './chart-theme'
import { cn } from '@/lib/utils'

export type DonutSlice = {
  key: string
  label: string
  value: number
  color?: string
}

export type DonutSplitProps = {
  slices: readonly DonutSlice[]
  centerLabel?: string
  formatValue?: (val: number) => string
  formatTotal?: (total: number) => string
  emptyText?: string
  className?: string
}

/**
 * Clean SVG Donut chart for 6 or fewer composition parts (e.g. payment modes, material charge).
 * Zero runtime dependencies, center total readout, labelled legend beside.
 */
export function DonutSplit({
  slices,
  centerLabel = 'Total',
  formatValue = (v) => v.toLocaleString('en-IN'),
  formatTotal,
  emptyText = 'No composition data',
  className,
}: DonutSplitProps) {
  const validSlices = slices.filter((s) => s.value > 0).slice(0, 6)
  const total = validSlices.reduce((sum, s) => sum + s.value, 0)

  if (total <= 0) {
    return <p className="py-6 text-center text-xs text-slate-400">{emptyText}</p>
  }

  const radius = 38
  const circumference = 2 * Math.PI * radius
  let accumulatedPercent = 0

  const renderedSlices = validSlices.map((slice, index) => {
    const pct = slice.value / total
    const strokeDasharray = `${pct * circumference} ${circumference}`
    const strokeDashoffset = -accumulatedPercent * circumference
    accumulatedPercent += pct
    const color = slice.color ?? CHART_THEME.donut[index % CHART_THEME.donut.length]

    return {
      ...slice,
      pct: pct * 100,
      color,
      strokeDasharray,
      strokeDashoffset,
    }
  })

  const displayTotal = formatTotal ? formatTotal(total) : formatValue(total)

  return (
    <div className={cn('flex flex-col sm:flex-row items-center gap-6 py-2', className)}>
      {/* Donut SVG */}
      <div className="relative shrink-0 w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth="12"
          />
          {renderedSlices.map((s) => (
            <circle
              key={s.key}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth="12"
              strokeDasharray={s.strokeDasharray}
              strokeDashoffset={s.strokeDashoffset}
              strokeLinecap="butt"
              className="transition-all duration-500"
            />
          ))}
        </svg>

        {/* Center Total Readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {centerLabel}
          </span>
          <span className="font-mono text-xs font-bold text-slate-900 tabular-nums">
            {displayTotal}
          </span>
        </div>
      </div>

      {/* Legend Beside */}
      <div className="flex-1 min-w-0 space-y-1.5 w-full">
        {renderedSlices.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
                aria-hidden="true"
              />
              <span className="truncate text-slate-700" title={s.label}>
                {s.label}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2 font-mono tabular-nums">
              <span className="font-semibold text-slate-900">{formatValue(s.value)}</span>
              <span className="text-[11px] text-slate-400">({s.pct.toFixed(0)}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
