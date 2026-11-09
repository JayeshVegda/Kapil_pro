import { ArrowDownWideNarrow, Edit3, Plus, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/**
 * PartyManagerShell (operational redesign Phase 3).
 *
 * One shared frame for the customer and supplier "manage parties" tables:
 * search, active/inactive filter, adapter filter groups, sorting, create,
 * edit, and a centered confirm dialog around deactivate/reactivate. The shell
 * owns no financial logic and never touches money rendering — every row cell,
 * sort comparator, and write is supplied by the adapter page (customers float
 * rupees; suppliers integer paise). Tables and forms stay side-specific, in
 * line with the three-module isolation rules.
 */

export type PartyManagerColumn<T> = {
  key: string
  header: string
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
}

export type PartyManagerSort<T> = {
  key: string
  label: string
  compare: (a: T, b: T) => number
}

export type PartyManagerFilterGroup<T> = {
  key: string
  ariaLabel: string
  options: Array<{ key: string; label: string; matches: (row: T) => boolean }>
}

type PendingToggle<T> = { row: T; nextActive: boolean } | null

export function PartyManagerShell<T>({
  objectLabel,
  pluralLabel,
  rows,
  isLoading,
  isError,
  getRowId,
  searchText,
  isActive,
  sorts,
  filterGroups = [],
  columns,
  createLabel,
  onCreateClick,
  onEdit,
  onToggleActive,
  togglePending = false,
  tableMinWidth = '760px',
  heading,
  headingBadges,
  statusLine,
  emptyHint,
}: {
  /** Singular label, e.g. "customer" / "supplier" — used for strings & aria. */
  objectLabel: string
  pluralLabel: string
  rows: T[] | undefined
  isLoading: boolean
  isError: boolean
  getRowId: (row: T) => string
  searchText: (row: T) => string
  isActive: (row: T) => boolean
  sorts: Array<PartyManagerSort<T>>
  filterGroups?: Array<PartyManagerFilterGroup<T>>
  columns: Array<PartyManagerColumn<T>>
  createLabel: string
  onCreateClick: () => void
  onEdit: (row: T) => void
  /** Adapter performs the write; the shell only confirms it first. */
  onToggleActive: (row: T, nextActive: boolean) => void
  togglePending?: boolean
  tableMinWidth?: string
  /** Section heading, e.g. "Customers" / "Suppliers". */
  heading: string
  /** KPI-style chips next to the heading (adapter-rendered). */
  headingBadges?: ReactNode
  /** Mutation feedback line (adapter-rendered). */
  statusLine?: ReactNode
  emptyHint?: string
}) {
  const [query, setQuery] = useState('')
  const [statusKey, setStatusKey] = useState<'all' | 'active' | 'inactive'>('all')
  const [groupKeys, setGroupKeys] = useState<Record<string, string>>(() =>
    Object.fromEntries(filterGroups.map((group) => [group.key, group.options[0]?.key ?? 'all'])),
  )
  const [sortIndex, setSortIndex] = useState(0)
  const [pendingToggle, setPendingToggle] = useState<PendingToggle<T>>(null)

  const visibleRows = useMemo(() => {
    let result = rows ?? []
    const needle = query.trim().toLowerCase()
    if (needle) result = result.filter((row) => searchText(row).toLowerCase().includes(needle))
    if (statusKey === 'active') result = result.filter((row) => isActive(row))
    else if (statusKey === 'inactive') result = result.filter((row) => !isActive(row))
    for (const group of filterGroups) {
      const chosen = groupKeys[group.key] ?? group.options[0]?.key ?? 'all'
      const option = group.options.find((candidate) => candidate.key === chosen)
      if (option && option.key !== 'all') result = result.filter((row) => option.matches(row))
    }
    const sort = sorts[sortIndex % sorts.length]
    if (sort) result = [...result].sort(sort.compare)
    return result
    // searchText/isActive/compare callbacks are assumed stable per adapter render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, statusKey, groupKeys, sortIndex, searchText, isActive, filterGroups, sorts])

  const activeSort = sorts[sortIndex % sorts.length]

  const statusFilterOptions: Array<{ key: 'all' | 'active' | 'inactive'; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'inactive', label: 'Inactive' },
  ]

  return (
    <div className="w-full space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Heading + create */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{heading}</h2>
            {headingBadges}
          </div>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
            onClick={onCreateClick}
          >
            <Plus size={14} /> {createLabel}
          </button>
        </div>

        {/* Search / filters / sort */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <div className="relative w-full sm:w-72">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              aria-label={`Search ${pluralLabel}`}
              placeholder={`Search ${objectLabel}, company, or phone...`}
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold" role="group" aria-label={`${objectLabel} status filter`}>
            {statusFilterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`rounded-md px-3 py-1.5 transition ${statusKey === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                onClick={() => setStatusKey(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {filterGroups.map((group) => (
            <div key={group.key} className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold" role="group" aria-label={group.ariaLabel}>
              {group.options.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`rounded-md px-3 py-1.5 transition ${(groupKeys[group.key] ?? 'all') === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  onClick={() => setGroupKeys((current) => ({ ...current, [group.key]: option.key }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {statusLine}
            <button
              type="button"
              title="Change sorting"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              onClick={() => setSortIndex((index) => index + 1)}
            >
              <ArrowDownWideNarrow size={13} /> {activeSort?.label ?? 'Sort'}
            </button>
          </div>
        </div>

        {/* Table */}
        {isLoading && <p className="border-t border-slate-100 p-5 text-sm text-slate-500">Loading {pluralLabel}...</p>}
        {isError && <p role="alert" className="border-t border-slate-100 p-5 text-sm text-rose-600">Unable to load {pluralLabel}.</p>}
        {!isLoading && !isError && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-sm" style={tableMinWidth ? { minWidth: tableMinWidth } : undefined}>
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                  {columns.map((column) => (
                    <th key={column.key} className={`px-3 py-2.5 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                      {column.header}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.length === 0 && (
                  <tr>
                    <td className="px-3 py-10 text-center text-sm text-slate-500" colSpan={columns.length + 1}>
                      {(rows ?? []).length === 0 ? (emptyHint ?? `No ${pluralLabel} yet.`) : <>No {objectLabel} matches this search or filter.</>}
                    </td>
                  </tr>
                )}
                {visibleRows.map((row) => {
                  const rowActive = isActive(row)
                  return (
                    <tr key={getRowId(row)} className={`transition hover:bg-slate-50/60 ${rowActive ? '' : 'opacity-60'}`}>
                      {columns.map((column) => (
                        <td key={column.key} className={`px-3 py-2.5 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                          {column.render(row)}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() => onEdit(row)}
                          >
                            <Edit3 size={12} /> Edit
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() => setPendingToggle({ row, nextActive: !rowActive })}
                          >
                            {rowActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          Showing {visibleRows.length} of {(rows ?? []).length} {pluralLabel}
        </p>
      </section>

      <ConfirmDialog
        open={pendingToggle !== null}
        onOpenChange={(open) => {
          if (!open) setPendingToggle(null)
        }}
        title={pendingToggle?.nextActive ? `Reactivate this ${objectLabel}?` : `Deactivate this ${objectLabel}?`}
        description={
          pendingToggle?.nextActive
            ? `${objectLabel === 'customer' ? 'They' : 'The supplier'} returns to the active lists and new entries can pick them again. Ledger history is untouched.`
            : `${objectLabel === 'customer' ? 'They' : 'The supplier'} disappears from the active lists but stays in every ledger, bill, and report for the record.`
        }
        confirmLabel={pendingToggle?.nextActive ? 'Reactivate' : 'Deactivate'}
        tone={pendingToggle?.nextActive ? 'primary' : 'danger'}
        pending={togglePending}
        onConfirm={() => {
          if (!pendingToggle) return
          onToggleActive(pendingToggle.row, pendingToggle.nextActive)
          setPendingToggle(null)
        }}
      />
    </div>
  )
}
