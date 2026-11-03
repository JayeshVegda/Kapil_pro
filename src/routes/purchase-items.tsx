import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Edit3, Plus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import {
  createPurchaseItem,
  listPurchaseItems,
  renamePurchaseItem,
  setPurchaseItemActive,
  type PurchaseItemView,
} from '@/data/suppliers'
import { formatFullDate } from '@/lib/date'

export const Route = createFileRoute('/purchase-items')({
  component: PurchaseItemsPage,
})

type FilterType = 'all' | 'active' | 'inactive'

function PurchaseItemsPage() {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [newItemName, setNewItemName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [statusText, setStatusText] = useState('')

  const itemsQuery = useQuery({
    queryKey: ['purchase-items'],
    queryFn: listPurchaseItems,
  })

  const allItems = itemsQuery.data ?? []

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    let list = allItems
    if (needle) {
      list = list.filter((i) => i.name.toLowerCase().includes(needle))
    }
    if (filter === 'active') list = list.filter((i) => i.active)
    if (filter === 'inactive') list = list.filter((i) => !i.active)
    return list
  }, [allItems, query, filter])

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Item name cannot be empty')
      return createPurchaseItem(trimmed)
    },
    onSuccess: async () => {
      setNewItemName('')
      setStatusText('Purchase item created.')
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Item name cannot be empty')
      return renamePurchaseItem(id, trimmed)
    },
    onSuccess: async () => {
      setEditingId(null)
      setEditingName('')
      setStatusText('Item renamed.')
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      return setPurchaseItemActive(id, active)
    },
    onSuccess: async () => {
      setStatusText('Item status updated.')
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  const startRenaming = (item: PurchaseItemView) => {
    setEditingId(item.id)
    setEditingName(item.name)
  }

  const cancelRenaming = () => {
    setEditingId(null)
    setEditingName('')
  }

  return (
    <div className="w-full max-w-4xl space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {/* Header and Add Item */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-900">Purchase Raw Materials</h1>
            <p className="text-xs text-slate-500">
              Scrap items catalog (brass scrap, chol, pata, marobol, sisu, coal, etc.)
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
            {allItems.length} Total ({allItems.filter((i) => i.active).length} active)
          </span>
        </div>

        {/* Add Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (newItemName.trim()) {
              void createMutation.mutateAsync(newItemName)
            }
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            placeholder="New raw material name (e.g. Honey Scrap, Brass Chol)..."
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="submit"
            disabled={!newItemName.trim() || createMutation.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={14} /> Add Item
          </button>
        </form>

        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          <div className="relative w-full sm:w-64">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search items..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-xs text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            {(['all', 'active', 'inactive'] as FilterType[]).map((ft) => (
              <button
                key={ft}
                type="button"
                className={`rounded-md px-2.5 py-1 transition capitalize ${
                  filter === ft ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setFilter(ft)}
              >
                {ft}
              </button>
            ))}
          </div>
          {statusText && (
            <span className="text-xs text-slate-500" role="status">
              {statusText}
            </span>
          )}
        </div>
      </section>

      {/* Items List */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {itemsQuery.isLoading && <p className="p-5 text-sm text-slate-500">Loading purchase items...</p>}
        {itemsQuery.isError && <p className="p-5 text-sm text-red-600">Unable to load purchase items.</p>}
        {!itemsQuery.isLoading && !itemsQuery.isError && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                <th className="px-4 py-2.5">Raw Material Name</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                    No purchase items found.
                  </td>
                </tr>
              )}
              {visibleItems.map((item) => (
                <tr key={item.id} className={`transition hover:bg-slate-50/60 ${item.active ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-2.5">
                    {editingId === item.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="h-8 w-60 rounded border border-blue-400 px-2 text-sm text-slate-900 outline-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              void renameMutation.mutateAsync({ id: item.id, name: editingName })
                            } else if (e.key === 'Escape') {
                              cancelRenaming()
                            }
                          }}
                        />
                        <button
                          type="button"
                          aria-label="Confirm rename"
                          onClick={() => void renameMutation.mutateAsync({ id: item.id, name: editingName })}
                          disabled={!editingName.trim() || renameMutation.isPending}
                          className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel rename"
                          onClick={cancelRenaming}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{item.name}</span>
                        <button
                          type="button"
                          aria-label={`Rename ${item.name}`}
                          onClick={() => startRenaming(item)}
                          className="rounded p-1 text-slate-400 opacity-60 hover:opacity-100 hover:bg-slate-100"
                        >
                          <Edit3 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                        item.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {item.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {item.created ? formatFullDate(item.created) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => void toggleActiveMutation.mutateAsync({ id: item.id, active: !item.active })}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {item.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
