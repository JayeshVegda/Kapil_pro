import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export type DeltaChipProps = {
  delta?: number | null
  formattedDelta?: string
  unit?: string
  goodDirection?: 'up' | 'down' | 'neutral'
  className?: string
}

/**
 * Visual pill showing delta vs previous period.
 * Invariant: Hides completely when previous value is zero, missing, or null.
 */
export function DeltaChip({
  delta,
  formattedDelta,
  unit = '%',
  goodDirection = 'up',
  className,
}: DeltaChipProps) {
  if (delta == null && !formattedDelta) return null
  if (delta != null && (!Number.isFinite(delta) || isNaN(delta))) return null

  const isPositive = delta != null ? delta >= 0 : !formattedDelta?.startsWith('-')
  const absDelta = delta != null ? Math.abs(delta).toFixed(1).replace(/\.0$/, '') : null
  const displayText = formattedDelta ?? `${isPositive ? '+' : '-'}${absDelta}${unit}`

  let toneClasses = 'bg-slate-100 text-slate-700 border-slate-200'
  if (goodDirection === 'up') {
    toneClasses = isPositive
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-rose-50 text-rose-700 border-rose-200'
  } else if (goodDirection === 'down') {
    toneClasses = isPositive
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
        toneClasses,
        className,
      )}
    >
      {isPositive ? (
        <ArrowUpRight size={12} className="shrink-0" aria-hidden />
      ) : (
        <ArrowDownRight size={12} className="shrink-0" aria-hidden />
      )}
      <span>{displayText}</span>
    </span>
  )
}
