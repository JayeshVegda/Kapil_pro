import { useMemo, useState, type ReactNode } from 'react'

export function LogsToolbarCard({ children }: { children: ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">{children}</section>
}

export function LogsTableCard({ children }: { children: ReactNode }) {
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">{children}</section>
}

export function defaultLogFromDate(today: string, days = 90) {
  const date = new Date(`${today}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

export function useLogsPager<T>(rows: readonly T[]) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const pageRows = useMemo(() => rows.slice((current - 1) * pageSize, current * pageSize), [rows, current, pageSize])
  return { page: current, pageSize, pages, pageRows, total: rows.length, setPage, setPageSize: (size: number) => { setPageSize(size); setPage(1) } }
}

export function LogsPager({ page, pages, pageSize, total, setPage, setPageSize }: { page: number; pages: number; pageSize: number; total: number; setPage: (page: number) => void; setPageSize: (size: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-600"><span>{total.toLocaleString('en-IN')} records · Page {page} of {pages}</span><div className="flex items-center gap-2"><label htmlFor="logs-page-size">Rows</label><select id="logs-page-size" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-8 rounded-md border border-slate-300 bg-white px-2"><option>25</option><option>50</option><option>100</option></select><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 rounded-md border border-slate-300 px-2 disabled:opacity-40">Previous</button><button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="h-8 rounded-md border border-slate-300 px-2 disabled:opacity-40">Next</button></div></div>
}

export function LogsDateWindow({ from, onFromChange }: { from: string; onFromChange: (date: string) => void }) {
  return <label className="inline-flex items-center gap-2 text-xs text-slate-600">From <input type="date" value={from} onChange={(event) => onFromChange(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" /></label>
}
