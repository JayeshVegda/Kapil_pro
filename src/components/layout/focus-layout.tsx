import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Focus-mode chrome for full-bleed working screens.
 * Direct split-pane layout without naked header rows.
 */
export function FocusLayout({
  children,
  className,
}: {
  children: ReactNode
  onBack?: () => void
  backLabel?: string
  showMarketRate?: boolean
  isDirty?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex h-dvh w-full flex-col overflow-hidden bg-background p-3 sm:p-4 lg:p-6', className)}>
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:gap-6 max-lg:overflow-y-auto lg:grid-cols-[minmax(0,1fr)_540px] xl:grid-cols-[minmax(0,1fr)_560px]">
        {children}
      </main>
    </div>
  )
}
