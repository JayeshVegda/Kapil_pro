import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One label pattern for every form: small semibold label, optional required marker, hint + error slot. */
export function FormField({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-[11px] font-semibold text-foreground">
        {label}
        {required && <span className="ml-0.5 text-rose-600">*</span>}
      </span>
      {children}
      {error ? <span className="block text-[11px] font-medium text-rose-600">{error}</span> : hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}
