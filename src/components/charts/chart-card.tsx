import { type ReactNode } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
import { SectionCard } from '@/components/ui/business-kit'
import { cn } from '@/lib/utils'

export type ChartCardProps = {
  title: string
  question?: string
  actions?: ReactNode
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  empty?: boolean
  emptyText?: string
  ariaSummary?: string
  children: ReactNode
  className?: string
}

/**
 * Enclosed card container for dashboard charts and visual lists.
 * Invariant: Every chart answers exactly ONE question (written as subtitle).
 * Directly complies with the Cards Rule: carries data-card="true".
 */
export function ChartCard({
  title,
  question,
  actions,
  loading = false,
  error = null,
  onRetry,
  empty = false,
  emptyText = 'No data available for this selection',
  ariaSummary,
  children,
  className,
}: ChartCardProps) {
  return (
    <SectionCard
      title={title}
      subtitle={question}
      actions={actions}
      className={cn('flex flex-col', className)}
    >
      <div className="relative min-w-0 flex-1 pt-1" aria-label={ariaSummary ?? `${title}: ${question ?? ''}`}>
        {loading ? (
          <div className="flex h-52 w-full animate-pulse items-center justify-center rounded-lg bg-slate-50">
            <span className="text-xs text-slate-400">Loading chart data…</span>
          </div>
        ) : error ? (
          <div className="flex h-52 w-full flex-col items-center justify-center gap-2 rounded-lg border border-rose-100 bg-rose-50/50 p-4 text-center">
            <AlertCircle size={18} className="text-rose-600" aria-hidden />
            <p className="text-xs font-medium text-rose-700">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-1 inline-flex items-center gap-1 rounded border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-50"
              >
                <RotateCcw size={12} /> Retry
              </button>
            )}
          </div>
        ) : empty ? (
          <div className="flex h-52 w-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-xs text-slate-400">
            {emptyText}
          </div>
        ) : (
          children
        )}
      </div>
    </SectionCard>
  )
}
