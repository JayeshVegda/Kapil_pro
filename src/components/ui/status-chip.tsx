import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type StatusTone = 'neutral' | 'selection' | 'success' | 'warning' | 'danger'

export const statusToneClass: Record<StatusTone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  selection: 'border-blue-200 bg-blue-50 text-blue-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
}

export function StatusChip({ children, tone = 'neutral', className }: { children: ReactNode; tone?: StatusTone; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold', statusToneClass[tone], className)}>{children}</span>
}
