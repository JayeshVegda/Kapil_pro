import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

type Tone = 'slate' | 'blue' | 'emerald' | 'amber' | 'rose'

const toneStyles: Record<Tone, { tile: string; icon: string; bar: string; text: string }> = {
  slate: {
    tile: 'border-slate-200 bg-white',
    icon: 'bg-slate-100 text-slate-700',
    bar: 'bg-slate-600',
    text: 'text-slate-700',
  },
  blue: {
    tile: 'border-blue-200 bg-blue-50/60',
    icon: 'bg-blue-100 text-blue-700',
    bar: 'bg-blue-600',
    text: 'text-blue-700',
  },
  emerald: {
    tile: 'border-emerald-200 bg-emerald-50/60',
    icon: 'bg-emerald-100 text-emerald-700',
    bar: 'bg-emerald-600',
    text: 'text-emerald-700',
  },
  amber: {
    tile: 'border-amber-200 bg-amber-50/60',
    icon: 'bg-amber-100 text-amber-700',
    bar: 'bg-amber-500',
    text: 'text-amber-700',
  },
  rose: {
    tile: 'border-rose-200 bg-rose-50/60',
    icon: 'bg-rose-100 text-rose-700',
    bar: 'bg-rose-600',
    text: 'text-rose-700',
  },
}

export function KpiTile({
  label,
  value,
  detail,
  icon,
  tone = 'slate',
  footer,
}: {
  label: string
  value: string
  detail: string
  icon: ReactNode
  tone?: Tone
  footer?: ReactNode
}) {
  const styles = toneStyles[tone]
  return (
    <div className={`min-h-[8rem] rounded-lg border p-3 shadow-sm ${styles.tile}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase text-slate-500">{label}</p>
          <p className="mt-1 font-mono text-2xl font-bold leading-tight text-slate-950">{value}</p>
        </div>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${styles.icon}`}>{icon}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-snug text-slate-600">{detail}</p>
      {footer ? <div className="mt-3 border-t border-black/5 pt-2 text-xs">{footer}</div> : null}
    </div>
  )
}

export function StatusPill({ children, tone = 'slate' }: { children: ReactNode; tone?: Tone }) {
  const styles = toneStyles[tone]
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles.icon}`}>
      {children}
    </span>
  )
}

export function RankedBarList({
  rows,
  emptyText,
  valueLabel,
  maxValue,
  tone = 'blue',
}: {
  rows: Array<{
    id: string
    label: string
    value: number
    subLabel?: string
    href?: { to: '/ledger' | '/casting'; search?: Record<string, string> }
  }>
  emptyText: string
  valueLabel: (value: number) => string
  maxValue?: number
  tone?: Tone
}) {
  const styles = toneStyles[tone]
  const max = Math.max(1, maxValue ?? Math.max(0, ...rows.map((row) => row.value)))

  if (rows.length === 0) return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">{emptyText}</p>

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const content = (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{row.label}</p>
                {row.subLabel ? <p className="truncate text-xs text-slate-500">{row.subLabel}</p> : null}
              </div>
              <p className="shrink-0 font-mono text-sm font-bold text-slate-900">{valueLabel(row.value)}</p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${styles.bar}`} style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} />
            </div>
          </>
        )

        const className = 'block rounded-lg border border-slate-100 bg-white p-3 transition hover:border-blue-200 hover:bg-blue-50/40'
        if (row.href) {
          return (
            <Link key={row.id} to={row.href.to} search={row.href.search} className={className}>
              {content}
            </Link>
          )
        }
        return (
          <div key={row.id} className={className}>
            {content}
          </div>
        )
      })}
    </div>
  )
}

export function SplitProgress({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  leftText,
  rightText,
}: {
  leftLabel: string
  leftValue: number
  rightLabel: string
  rightValue: number
  leftText: string
  rightText: string
}) {
  const total = Math.max(1, leftValue + rightValue)
  const leftPct = Math.max(0, Math.min(100, (leftValue / total) * 100))
  const rightPct = Math.max(0, Math.min(100, (rightValue / total) * 100))
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-200">
        <div className="bg-blue-600" style={{ width: `${leftPct}%` }} />
        <div className="bg-emerald-600" style={{ width: `${rightPct}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 font-mono text-xs font-semibold text-slate-900">
        <span>{leftText}</span>
        <span>{rightText}</span>
      </div>
    </div>
  )
}
