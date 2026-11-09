import { type ReactNode } from 'react'
import type { PeriodMode } from '@/domain/period-helpers'
import { cn } from '@/lib/utils'

export type DashboardToolbarProps = {
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
 * and quick-action buttons. Carries data-card="true" per the Cards Rule.
 */
export function DashboardToolbar({
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
        'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:px-4 sm:py-3',
        className,
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: Period Segmented Tabs + Month jump */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Dashboard period"
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold"
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
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
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
              className="h-8 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
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
