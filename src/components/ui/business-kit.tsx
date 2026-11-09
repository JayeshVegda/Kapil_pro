import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Panel } from './panel'
import { MoneyCell } from './money-cell'
import { StatusChip } from './status-chip'
import { ConfirmDialog } from './confirm-dialog'

export { MoneyCell, StatusChip, ConfirmDialog as ConfirmModal }

export function PageShell({ toolbar, badge, actions, children }: { toolbar?: ReactNode; badge?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <main className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
    {(toolbar || badge || actions) && <div className="flex flex-wrap items-center justify-between gap-3">{toolbar && <div className="min-w-0 flex-1">{toolbar}</div>}{badge}{actions}</div>}
    {children}
  </main>
}

export function SectionCard({ title, subtitle, actions, children, className }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <Panel className={cn('rounded-xl border-slate-200 bg-white p-4 shadow-sm sm:p-5', className)}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-sm font-semibold text-slate-950">{title}</h2>{subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}</div>{actions}</div>
    {children}
  </Panel>
}

export function FilterBar({ search, onSearchChange, from, to, onFromChange, onToChange, chips, actions }: {
  search?: string; onSearchChange?: (value: string) => void
  from?: string; to?: string; onFromChange?: (value: string) => void; onToChange?: (value: string) => void
  chips?: ReactNode; actions?: ReactNode
}) {
  return <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    {onSearchChange && <input aria-label="Search" type="search" value={search ?? ''} onChange={(event) => onSearchChange(event.target.value)} className="h-9 min-w-48 flex-1 rounded-lg border border-slate-300 px-2.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/30" />}
    {onFromChange && <input aria-label="From date" type="date" value={from ?? ''} onChange={(event) => onFromChange(event.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm" />}
    {onToChange && <input aria-label="To date" type="date" value={to ?? ''} onChange={(event) => onToChange(event.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm" />}
    {chips}{actions && <div className="ml-auto">{actions}</div>}
  </div>
}

export function TabBar<T extends string>({ options, value, onChange, label = 'View' }: { options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; label?: string }) {
  return <div role="tablist" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-50 p-1">
    {options.map((option) => <button key={option.value} type="button" role="tab" aria-selected={value === option.value} onClick={() => onChange(option.value)} className={cn('rounded-md px-3 py-1.5 text-xs font-semibold text-slate-600', value === option.value && 'bg-white text-slate-900 ring-1 ring-slate-200')}>{option.label}</button>)}
  </div>
}
export { TabBar as SegmentedToggle }

export function MonthPicker({ value, onChange, label = 'Month' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">{label}<input type="month" value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" /></label>
}

export function KpiCard({
  label,
  value,
  subtext,
  delta,
  sparkline,
  hint,
  tone = 'neutral',
  icon,
  href,
}: {
  label: string
  value: ReactNode
  subtext?: ReactNode
  delta?: ReactNode
  sparkline?: ReactNode
  hint?: string
  tone?: 'neutral' | 'positive' | 'warning'
  icon?: ReactNode
  href?: string
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{label}</span>
          {hint && (
            <span className="shrink-0 text-[10px] font-mono text-slate-400">
              ({hint})
            </span>
          )}
        </div>
        {icon}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <strong
          className={cn(
            'block font-mono text-xl font-bold tracking-tight tabular-nums sm:text-2xl',
            tone === 'positive'
              ? 'text-emerald-700'
              : tone === 'warning'
                ? 'text-amber-800'
                : 'text-slate-900',
          )}
        >
          {value}
        </strong>
        {sparkline && <div className="shrink-0">{sparkline}</div>}
      </div>
      {subtext && <p className="mt-1 text-xs text-slate-500">{subtext}</p>}
      {delta && <div className="mt-1.5 flex items-center gap-1">{delta}</div>}
    </>
  )
  const className = 'block rounded-xl border border-slate-200 bg-white p-4 shadow-sm'
  return href ? (
    <a
      href={href}
      data-card="true"
      className={cn(
        className,
        'hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
      )}
    >
      {content}
    </a>
  ) : (
    <div data-card="true" className={className}>
      {content}
    </div>
  )
}

export { DashboardToolbar } from './dashboard-toolbar'

