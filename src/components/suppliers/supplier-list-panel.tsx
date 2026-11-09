import { ArrowDownWideNarrow, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SupplierSummary } from '@/data/suppliers'
import { formatPaiseInr } from '@/lib/inr-format'

type SortMode = 'due' | 'name' | 'recent'

const SORT_LABEL: Record<SortMode, string> = { due: 'Highest due', name: 'Name A-Z', recent: 'Recent activity' }
const SORT_ORDER: SortMode[] = ['due', 'name', 'recent']

/**
 * Master list for the supplier hub, mirroring the customer Party Ledger panel:
 * type-to-search, sortable, always visible on desktop so "who do we owe" is
 * scannable without opening anything.
 */
export function SupplierListPanel({
  rows,
  selectedId,
  onSelect,
  onCreateClick,
}: {
  rows: SupplierSummary[]
  selectedId: string
  onSelect: (supplierId: string) => void
  /** Optional "+ New supplier" affordance, opened by the host page. */
  onCreateClick?: () => void
}) {
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('due')

  const activeRows = useMemo(() => rows.filter((row) => row.supplier.active), [rows])

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? activeRows.filter(
          (row) =>
            `${row.supplier.companyName} ${row.supplier.city ?? ''} ${row.supplier.phone ?? ''}`
              .toLowerCase()
              .includes(needle),
        )
      : activeRows
    const sorted = [...filtered]
    if (sortMode === 'due') {
      sorted.sort((a, b) => b.outstandingPaise - a.outstandingPaise || a.supplier.companyName.localeCompare(b.supplier.companyName))
    } else if (sortMode === 'name') {
      sorted.sort((a, b) => a.supplier.companyName.localeCompare(b.supplier.companyName))
    } else {
      sorted.sort((a, b) => b.lastActivityDate.localeCompare(a.lastActivityDate))
    }
    return sorted
  }, [activeRows, query, sortMode])

  const kpis = useMemo(() => {
    let totalOwedPaise = 0
    let totalAdvancePaise = 0
    for (const row of activeRows) {
      if (row.outstandingPaise > 0) totalOwedPaise += row.outstandingPaise
      if (row.advancePaise > 0) totalAdvancePaise += row.advancePaise
    }
    return { totalOwedPaise, totalAdvancePaise }
  }, [activeRows])

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-3 xl:max-h-[calc(100dvh-1.5rem)]">
      <div className="space-y-2 border-b border-slate-100 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">We owe</p>
            <p className="mt-0.5 truncate font-mono text-sm font-bold text-rose-700">{formatPaiseInr(kpis.totalOwedPaise)}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 px-2.5 py-2 ring-1 ring-emerald-100">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-700">Advance</p>
            <p className="mt-0.5 truncate font-mono text-sm font-bold text-emerald-700">{formatPaiseInr(kpis.totalAdvancePaise)}</p>
          </div>
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search supplier..."
            className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-1 text-[11px] font-semibold text-slate-500 transition hover:text-slate-800"
          onClick={() => setSortMode((mode) => SORT_ORDER[(SORT_ORDER.indexOf(mode) + 1) % SORT_ORDER.length])}
        >
          <ArrowDownWideNarrow size={12} />
          {SORT_LABEL[sortMode]}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label="Suppliers">
        {visibleRows.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">No supplier matches “{query}”.</p>}
        {visibleRows.map((row) => {
          const isSelected = row.supplier.id === selectedId
          const amount = row.outstandingPaise > 0 ? row.outstandingPaise : row.advancePaise
          return (
            <button
              key={row.supplier.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(row.supplier.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border-l-2 px-2.5 py-2 text-left transition ${
                isSelected ? 'border-l-blue-500 bg-blue-50/70' : 'border-l-transparent hover:bg-slate-50'
              }`}
            >
              <span className="min-w-0">
                <span className={`block truncate text-[13px] ${isSelected ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                  {row.supplier.companyName}
                </span>
                {(row.bardanPendingCount > 0 || (row.oldestDueDays != null && row.oldestDueDays > 30) || !row.supplier.active) && (
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                    {row.bardanPendingCount > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">{row.bardanPendingCount} bardan pending</span>}
                    {row.oldestDueDays != null && row.oldestDueDays > 30 && <span className="text-rose-500">{row.oldestDueDays}d unpaid</span>}
                    {!row.supplier.active && <span className="text-slate-400">Inactive</span>}
                  </span>
                )}
              </span>
              <span
                className={`shrink-0 font-mono text-xs font-bold tabular-nums ${
                  row.outstandingPaise > 0 ? 'text-rose-600' : row.advancePaise > 0 ? 'text-emerald-600' : 'text-slate-400'
                }`}
              >
                {amount > 0 ? formatPaiseInr(amount) : '—'}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <p className="text-[11px] font-medium text-slate-400">
          {visibleRows.length} of {activeRows.length} suppliers
        </p>
        {onCreateClick && (
          <button
            type="button"
            onClick={onCreateClick}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            + New supplier
          </button>
        )}
      </div>
    </aside>
  )
}
