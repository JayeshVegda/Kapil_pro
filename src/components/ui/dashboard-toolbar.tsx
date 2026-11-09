import { type ReactNode } from 'react'
import type { PeriodMode } from '@/domain/period-helpers'
import { cn } from '@/lib/utils'

export type DashboardToolbarProps = {
  title?: string
  subtitle?: string
  icon?: ReactNode
  mode: PeriodMode
  onModeChange: (mode: PeriodMode) => void
  selectedMonth?: string
  onMonthChange?: (month: string) => void
  comparisonNote?: string
  actions?: ReactNode
  className?: string
}

const PERIOD_OPTIONS: Array<{ value: PeriodMode; label: string }> = [
  { value: 'month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'fy', label: 'FY to Date' },
]

/**
 * Top dashboard toolbar card enclosing period selection, fair comparison note,
 * optional executive title badge, and quick-action buttons.
 * Styled in the application's signature executive blue theme.
 * Carries data-card="true" per the Cards Rule.
 */
export function DashboardToolbar({
  title,
  subtitle,
  icon,
  mode,
  onModeChange,
  selectedMonth,
  onMonthChange,
  comparisonNote,
  actions,
  className,
}: DashboardToolbarProps) {
  return (
    <div
      data-card="true"
      className={cn(
        'rounded-xl border border-blue-100/80 bg-gradient-to-r from-blue-50/40 via-white to-slate-50/40 p-3 shadow-sm sm:px-4 sm:py-3.5',
        className,
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: Optional Title + Period Segmented Tabs + Month jump */}
        <div className="flex flex-wrap items-center gap-3">
          {title && (
            <div className="flex items-center gap-2.5 mr-1">
              {icon && (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
                  {icon}
                </span>
              )}
              <div>
                <h1 className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">{title}</h1>
                {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
              </div>
            </div>
          )}

          <div
            role="tablist"
            aria-label="Dashboard period"
            className="inline-flex rounded-lg border border-blue-200/60 bg-blue-50/40 p-0.5 text-xs font-semibold"
          >
            {PERIOD_OPTIONS.map((opt) => {
              const active = mode === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onModeChange(opt.value)}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 transition-all text-xs font-medium',
                    active
                      ? 'bg-blue-600 text-white shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-blue-900 hover:bg-white/80',
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>

          {mode === 'month' && selectedMonth && onMonthChange && (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              aria-label="Select month"
              className="h-8 rounded-md border border-blue-200 bg-white px-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
            />
          )}

          {comparisonNote && (
            <span className="text-xs text-slate-500 italic pl-1">
              ({comparisonNote})
            </span>
          )}
        </div>

        {/* Right: Quick Action Buttons */}
        {actions && (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
