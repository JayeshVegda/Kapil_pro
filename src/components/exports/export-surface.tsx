import type { ReactNode } from 'react'

export function ExportSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`.trim()}>{children}</section>
}
