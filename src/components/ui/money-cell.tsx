import { formatInrInteger, formatPaiseInr } from '@/lib/inr-format'
import { cn } from '@/lib/utils'

export function MoneyCell({ valuePaise, valueRupees, tone = 'neutral', className }: {
  valuePaise?: number
  valueRupees?: number
  tone?: 'neutral' | 'positive' | 'negative'
  className?: string
}) {
  const value = valuePaise !== undefined ? formatPaiseInr(valuePaise) : formatInrInteger(valueRupees ?? 0)
  const toneClass = tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-rose-700' : 'text-slate-900'
  return <span className={cn('font-mono tabular-nums whitespace-nowrap', toneClass, className)}>{value}</span>
}
