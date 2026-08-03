import { AlertTriangle, ArrowDownWideNarrow, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PartyKpis, PartyRow } from '@/domain/ledger'
import { formatInrInteger } from '@/lib/inr-format'

type SortMode = 'due' | 'name' | 'recent'

const SORT_LABEL: Record<SortMode, string> = { due: 'Highest due', name: 'Name A-Z', recent: 'Recent activity' }
const SORT_ORDER: SortMode[] = ['due', 'name', 'recent']

/**
 * Master list for the Party Ledger: type-to-search, sortable, always visible on
 * desktop so "who owes me" is scannable without opening anything.
 */
export function PartyListPanel({
  rows,
  kpis,
  selectedId,
  onSelect,
}: {
  rows: PartyRow[]
  kpis: PartyKpis | null
  selectedId: string
  onSelect: (customerId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('due')

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle ? rows.filter((row) => row.customerName.toLowerCase().includes(needle)) : rows
    const sorted = [...filtered]
    if (sortMode === 'due') {
      sorted.sort((a, b) => b.dueAmount - a.dueAmount || a.customerName.localeCompare(b.customerName))
    } else if (sortMode === 'name') {
      sorted.sort((a, b) => a.customerName.localeCompare(b.customerName))
    } else {
      sorted.sort((a, b) => b.latestActivityDate.localeCompare(a.latestActivityDate))
    }
    return sorted
  }, [query, rows, sortMode])

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-3 xl:max-h-[calc(100dvh-1.5rem)]">
      <div className="space-y-2 border-b border-slate-100 p-3">
        {kpis && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Receivable</p>
              <p className="mt-0.5 truncate font-mono text-sm font-bold text-slate-900">{formatInrInteger(kpis.totalDue)}</p>
            </div>
            <div className="rounded-lg bg-rose-50 px-2.5 py-2 ring-1 ring-rose-100">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-500">Overdue</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-rose-700">{kpis.overdueParties} parties</p>
            </div>
          </div>
        )}
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search party..."
            className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label="Parties">
        {visibleRows.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">No party matches “{query}”.</p>}
        {visibleRows.map((row) => {
          const isSelected = row.customerId === selectedId
          const isOverdue = row.status === 'Overdue' && row.dueAmount > 0
          const amount = row.dueAmount > 0 ? row.dueAmount : row.advanceAmount
          return (
            <button
              key={row.customerId}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(row.customerId)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border-l-2 px-2.5 py-2 text-left transition ${
                isSelected ? 'border-l-blue-500 bg-blue-50/70' : 'border-l-transparent hover:bg-slate-50'
              }`}
            >
              <span className="min-w-0">
                <span className={`block truncate text-[13px] ${isSelected ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                  {row.customerName}
                </span>
                {isOverdue && (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600">
                    <AlertTriangle size={10} /> {row.overdueDays}d overdue
                  </span>
                )}
              </span>
              <span
                className={`shrink-0 font-mono text-xs font-bold tabular-nums ${
                  row.dueAmount > 0 ? (isOverdue ? 'text-rose-600' : 'text-slate-900') : row.advanceAmount > 0 ? 'text-emerald-600' : 'text-slate-400'
                }`}
              >
                {amount > 0 ? formatInrInteger(amount) : '—'}
              </span>
            </button>
          )
        })}
      </div>

      <p className="border-t border-slate-100 px-3 py-2 text-[11px] font-medium text-slate-400">
        {visibleRows.length} of {rows.length} parties
      </p>
    </aside>
  )
}
