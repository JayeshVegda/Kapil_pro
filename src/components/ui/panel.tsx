import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** Single card surface for Kapil pages — white panel, slate divider, restrained shadow. */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-card="true" className={cn('min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm', className)} {...props} />
}
