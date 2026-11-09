import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Standard page header: back arrow → uppercase eyebrow title → accessory pill
 * (e.g. IN no), with page actions pinned right. One pattern for every screen.
 */
export function PageHeader({
  eyebrow,
  accessory,
  onBack,
  backLabel = 'Back',
  actions,
  className,
  compact = false,
}: {
  eyebrow?: string
  accessory?: ReactNode
  onBack?: () => void
  backLabel?: string
  actions?: ReactNode
  className?: string
  compact?: boolean
}) {
  if (compact) {
    return (
      <div className={cn('flex min-w-0 items-center justify-between gap-3 px-1', className)}>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft size={17} />
          </button>
        ) : (
          <span />
        )}
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : <span />}
      </div>
    )
  }
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-1 min-w-0', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <h1 className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow ?? 'Kapil Billing'}</h1>
        {accessory && <span className="shrink-0">{accessory}</span>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  )
}
