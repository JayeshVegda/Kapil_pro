import type { ReactNode } from 'react'

export function MoreExportsPanel(props: {
  bookBlock: ReactNode
  salesBlock: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">More exports</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">Small tools</h3>
        </div>
        <p className="max-w-xl text-sm text-slate-500">Use these when you need a sales register or one complete bill book.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {props.bookBlock}
        {props.salesBlock}
      </div>
    </section>
  )
}

export function CompactExportCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h4 className="text-base font-semibold text-slate-900">{title}</h4>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      <div className="mt-3">{children}</div>
    </div>
  )
}
