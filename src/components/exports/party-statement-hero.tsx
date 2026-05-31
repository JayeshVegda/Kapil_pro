import type { ReactNode } from 'react'

export function PartyStatementHero(props: {
  partySelect: ReactNode
  periodControls: ReactNode
  summary: Array<{ label: string; value: string }>
  primaryAction: ReactNode
  secondaryAction: ReactNode
  tertiaryAction?: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Statement workflow</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">Party statement</h2>
        <p className="mt-1 text-sm text-slate-500">Choose the party and period, then export the statement or a complete ZIP package.</p>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">1</span>
            <h3 className="text-sm font-semibold text-slate-900">Select statement details</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {props.partySelect}
            {props.periodControls}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">2</span>
            <h3 className="text-sm font-semibold text-slate-900">Check totals</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {props.summary.length === 0 ? (
              <div className="col-span-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
                Select a party to calculate statement totals.
              </div>
            ) : (
              props.summary.map((row) => (
                <div key={row.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{row.label}</p>
                  <p className="mt-1 font-mono text-base font-bold text-slate-900">{row.value}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">3</span>
            <h3 className="text-sm font-semibold text-slate-900">Export</h3>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            {props.primaryAction}
            {props.secondaryAction}
            {props.tertiaryAction}
          </div>
        </div>
      </div>
    </section>
  )
}
