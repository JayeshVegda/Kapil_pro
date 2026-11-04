import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Edit3, Plus, Search, ToggleLeft, ToggleRight, X } from 'lucide-react'
 import { useMemo, useState } from 'react'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { RowMenu } from '@/components/ui/row-menu'
import {
  createPurchaseItem,
  listPurchaseItems,
  loadAllPurchaseBills,
  renamePurchaseItem,
  setPurchaseItemActive,
  type PurchaseItemView,
} from '@/data/suppliers'
import { itemNameKey } from '@/domain/purchase-item-name'
import { milliToRateText } from '@/domain/supplier-units'
import { getLocalIsoDate } from '@/lib/date'

export const Route = createFileRoute('/purchase-items')({
  component: PurchaseItemsPage,
})

type ItemStats = { billCount: number; kgLast30d: number; lastRateMilli: number | null; lastRateDate: string }

function PurchaseItemsPage() {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [statusText, setStatusText] = useState('')
  const [rowError, setRowError] = useState('')

  const itemsQuery = useQuery({ queryKey: ['purchase-items'], queryFn: listPurchaseItems })
  const billsQuery = useQuery({ queryKey: ['purchase-bills'], queryFn: loadAllPurchaseBills, staleTime: 30_000 })

  const allItems = itemsQuery.data ?? []

  const statsByNameKey = useMemo(() => {
    const bills30dCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const stats = new Map<string, ItemStats>()
    for (const bill of billsQuery.data ?? []) {
      if (bill.cancelled) continue
      const seenKeys = new Set<string>()
      for (const line of bill.lines) {
        const key = line.itemId ? `id:${line.itemId}` : `name:${itemNameKey(line.itemName)}`
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        const entry = stats.get(key) ?? { billCount: 0, kgLast30d: 0, lastRateMilli: null, lastRateDate: '' }
        entry.billCount += 1
        if (bill.date >= bills30dCutoff) entry.kgLast30d += line.weightG / 1000
        if (bill.date > entry.lastRateDate) {
          entry.lastRateDate = bill.date
          entry.lastRateMilli = line.rateMilli
        }
        stats.set(key, entry)
      }
    }
    return stats
  }, [billsQuery.data])

  const statsFor = (item: PurchaseItemView): ItemStats => {
    return (
      statsByNameKey.get(`id:${item.id}`) ??
      statsByNameKey.get(`name:${itemNameKey(item.name)}`) ?? { billCount: 0, kgLast30d: 0, lastRateMilli: null, lastRateDate: '' }
    )
  }

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allItems.filter((item) => !needle || item.name.toLowerCase().includes(needle))
  }, [allItems, query])

  const createMutation = useMutation({
    mutationFn: async (name: string) => createPurchaseItem(name),
    onSuccess: async () => {
      setNewItemName('')
      setStatusText('Item added.')
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => renamePurchaseItem(id, name),
    onSuccess: async () => {
      setEditingId(null)
      setEditingName('')
      setRowError('')
      setStatusText('Item renamed.')
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (err) => setRowError(toUserMessage(err)),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => setPurchaseItemActive(id, active),
    onSuccess: async () => {
      setStatusText('Item updated.')
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  const commitRename = (id: string) => {
    const trimmed = editingName.trim()
    if (!trimmed) {
      setEditingId(null)
      setRowError('')
      return
    }
    setRowError('')
    renameMutation.mutate({ id, name: trimmed })
  }

  return (
    <div className="min-w-0 px-3 pb-10 pt-2 sm:px-4">
      {/* Slim toolbar (top bar owns the title) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{allItems.length}</span> items ({allItems.filter((i) => i.active).length} active)
          {' · '}
          {getLocalIsoDate()}
          {statusText && <span className="ml-2 text-slate-400">{statusText}</span>}
        </span>
        <div className="relative w-56">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items..."
            className="h-8 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2 text-xs outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      {/* Add-item row */}
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = newItemName.trim()
          if (trimmed) createMutation.mutate(trimmed)
        }}
      >
        <input
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          placeholder="Add item — type a name and press Enter"
          className="h-8 flex-1 rounded-md border border-dashed border-slate-300 bg-slate-50/60 px-2.5 text-[13px] outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
        <button
          type="submit"
          disabled={!newItemName.trim() || createMutation.isPending}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus size={13} /> Add
        </button>
      </form>

      {/* Dense table */}
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5">Name</th>
              <th className="px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5 text-right">Bills</th>
              <th className="px-2 py-1.5 text-right">kg (30d)</th>
              <th className="px-2 py-1.5 text-right">Last Rate</th>
              <th className="w-10 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleItems.map((item) => {
              const stats = statsFor(item)
              const isEditing = editingId === item.id
              return (
                <tr key={item.id} className={`h-[34px] transition ${item.active ? '' : 'opacity-60'}`}>
                  <td className="sticky left-0 z-10 bg-white px-2 py-0 shadow-[1px_0_0_0_#e2e8f0]">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(item.id)
                            if (e.key === 'Escape') {
                              setEditingId(null)
                              setRowError('')
                            }
                          }}
                          onBlur={() => commitRename(item.id)}
                          className="h-7 w-48 rounded border border-blue-400 px-2 text-[13px] outline-none"
                        />
                        <button type="button" aria-label="Confirm rename" className="rounded p-1 text-emerald-600 hover:bg-emerald-50" onMouseDown={(e) => e.preventDefault()} onClick={() => commitRename(item.id)}>
                          <Check size={13} />
                        </button>
                        <button type="button" aria-label="Cancel rename" className="rounded p-1 text-slate-400 hover:bg-slate-100" onMouseDown={(e) => e.preventDefault()} onClick={() => { setEditingId(null); setRowError('') }}>
                          <X size={13} />
                        </button>
                        {rowError && <span className="text-[11px] text-rose-600">{rowError}</span>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-800">{item.name}</span>
                        <button
                          type="button"
                          aria-label={`Rename ${item.name}`}
                          onClick={() => {
                            setEditingId(item.id)
                            setEditingName(item.name)
                            setRowError('')
                          }}
                          className="rounded p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                        >
                          <Edit3 size={12} />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-0">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.active}
                      aria-label={item.active ? `Deactivate ${item.name}` : `Activate ${item.name}`}
                      onClick={() => toggleActiveMutation.mutate({ id: item.id, active: !item.active })}
                      className="inline-flex items-center gap-1 text-xs font-medium"
                    >
                      {item.active ? (
                        <>
                          <ToggleRight size={20} className="text-emerald-600" />
                          <span className="text-emerald-700">Active</span>
                        </>
                      ) : (
                        <>
                          <ToggleLeft size={20} className="text-slate-400" />
                          <span className="text-slate-500">Inactive</span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-2 py-0 text-right font-mono tabular-nums text-slate-600">{stats.billCount > 0 ? stats.billCount : '—'}</td>
                  <td className="px-2 py-0 text-right font-mono tabular-nums text-slate-600">{stats.kgLast30d > 0 ? stats.kgLast30d.toFixed(3) : '—'}</td>
                  <td className="px-2 py-0 text-right font-mono tabular-nums text-slate-800">{stats.lastRateMilli != null ? `₹${milliToRateText(stats.lastRateMilli)}` : '—'}</td>
                  <td className="px-2 py-0 text-right">
                    <RowMenu
                      label="Item actions"
                      items={[
                        { label: 'Rename', onSelect: () => { setEditingId(item.id); setEditingName(item.name); setRowError('') } },
                        { label: item.active ? 'Deactivate' : 'Activate', danger: item.active, onSelect: () => toggleActiveMutation.mutate({ id: item.id, active: !item.active }) },
                      ]}
                    />
                  </td>
                </tr>
              )
            })}
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs italic text-slate-400">
                  {query ? 'No items match the search.' : 'No items yet — add one above.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rowError && !editingId && <p className="mt-1 text-xs text-rose-600">{rowError}</p>}
    </div>
  )
}
