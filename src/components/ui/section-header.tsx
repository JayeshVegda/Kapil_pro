import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Uppercase section title + hint, trailing actions on the right. */
export function SectionHeader({
  title,
  hint,
  right,
  className,
}: {
  title: string
  hint?: string
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-end justify-between gap-2 border-b border-border pb-2', className)}>
      <div className="min-w-0">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{hint}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
    </div>
  )
}
