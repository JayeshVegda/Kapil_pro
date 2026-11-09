import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Calm centered empty state — dashed border, icon, title, hint, optional action. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-8 text-center', className)}>
      <Icon size={22} className="text-slate-300" aria-hidden />
      <p className="text-xs font-semibold text-foreground">{title}</p>
      {hint && <p className="max-w-56 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
