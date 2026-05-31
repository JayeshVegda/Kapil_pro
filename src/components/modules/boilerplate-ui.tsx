import type { ReactNode } from 'react'

export const BOILERPLATE_INPUT_CLASS =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'

export function BoField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

export function BoSection({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {(title || action) && (
        <div className={`mb-3 flex items-center ${title ? 'justify-between' : 'justify-end'}`}>
          {title ? <h3 className="text-sm font-semibold text-slate-900">{title}</h3> : null}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function BoMetric({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-md border p-2.5 ${emphasized ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono tabular-nums ${emphasized ? 'text-lg font-bold text-amber-800' : 'text-base font-semibold text-slate-900'}`}>{value}</p>
    </div>
  )
}

export function EmptyTableHint({ entityLabel }: { entityLabel: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">No {entityLabel} yet — data will appear here after backend wiring.</p>
}
