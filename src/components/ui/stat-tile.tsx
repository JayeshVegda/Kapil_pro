import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Tone = 'default' | 'success' | 'danger' | 'warning'

const valueTone: Record<Tone, string> = {
  default: 'text-foreground',
  success: 'text-emerald-700',
  danger: 'text-rose-600',
  warning: 'text-amber-700',
}

/** Uniform KPI tile: uppercase label, mono tabular value, optional delta/sub-line. */
export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
  delta,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  delta?: { value: string; up: boolean; positiveIsGood?: boolean }
  className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm', className)}>
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 truncate font-mono text-lg font-bold leading-tight tabular-nums', valueTone[tone])} title={typeof value === 'string' ? value : undefined}>
        {value}
      </p>
      {delta && (
        <p className={cn('mt-0.5 text-[11px] font-semibold tabular-nums', (delta.up === (delta.positiveIsGood ?? true)) ? 'text-emerald-700' : 'text-rose-600')}>
          {delta.up ? '▲' : '▼'} {delta.value}
        </p>
      )}
      {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}
