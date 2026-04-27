import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit3, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { createItem, deleteItem, loadItemsWithUsage, updateItem } from '@/data/items'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/items')({
  component: ItemsPage,
})

const ITEMS_QUERY_KEY = ['items-master'] as const

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required'),
  defaultRate: z.number().nonnegative('Rate cannot be negative'),
})

function ItemsPage() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [defaultRateInput, setDefaultRateInput] = useState('0')
  const [statusText, setStatusText] = useState('')

  const itemsQuery = useQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: loadItemsWithUsage,
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = itemSchema.safeParse({
        name,
        defaultRate: parseNonNegativeNumber(defaultRateInput),
      })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid item')
      if (editingId) {
        await updateItem(editingId, parsed.data)
      } else {
        await createItem(parsed.data)
      }
    },
    onSuccess: async () => {
      setStatusText(editingId ? 'Item updated.' : 'Item created.')
      resetForm()
      await queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ['items-options'] })
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : 'Failed to save item')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      await deleteItem(itemId)
    },
    onSuccess: async () => {
      setStatusText('Item deleted.')
      await queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ['items-options'] })
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : 'Failed to delete item')
    },
  })

  function resetForm() {
    setEditingId(null)
    setName('')
    setDefaultRateInput('0')
  }

  function startEdit(item: NonNullable<typeof itemsQuery.data>[number]) {
    setEditingId(item.id)
    setName(item.name)
    setDefaultRateInput(String(item.defaultRate))
  }

  return (
    <div className="w-full space-y-6 px-4 pb-10 pt-4 md:px-6">
      {statusText && (
        <p className="text-xs text-slate-500" role="status" aria-live="polite">
          {statusText}
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">{editingId ? 'Edit Item' : 'Add Item'}</h3>
          {editingId && (
            <button type="button" className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={resetForm}>
              Switch to New
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto]">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Item Name *</span>
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Default Rate</span>
            <input className={inputClass} type="number" value={defaultRateInput} onChange={(event) => setDefaultRateInput(event.target.value)} />
          </label>
          <div className="flex items-end gap-2">
            <button type="button" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50" onClick={resetForm}>
              Clear
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-1 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void saveMutation.mutateAsync()}
              disabled={!name.trim() || saveMutation.isPending}
            >
              <Plus size={14} />
              {saveMutation.isPending ? 'Saving...' : editingId ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Items Master</h3>
        {itemsQuery.isLoading && <p className="text-sm text-slate-500">Loading items...</p>}
        {itemsQuery.isError && <p className="text-sm text-red-600">Unable to load items.</p>}
        {!itemsQuery.isLoading && !itemsQuery.isError && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Item</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Default Rate</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Usage Count</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Last Used</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {(itemsQuery.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
                      No items yet. Add your first item to speed up bill entry.
                    </td>
                  </tr>
                )}
                {(itemsQuery.data ?? []).map((item, index) => (
                  <tr key={item.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                    <td className="px-3 py-3 text-sm font-medium text-slate-800">{item.name}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-800">{formatInrInteger(item.defaultRate)}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-800">{item.usageCount}</td>
                    <td className="px-3 py-3 text-sm text-slate-700">{item.lastUsedDate ? formatFullDate(item.lastUsedDate) : '-'}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100" onClick={() => startEdit(item)}>
                          <Edit3 size={12} />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void deleteMutation.mutateAsync(item.id)}
                          disabled={deleteMutation.isPending || item.usageCount > 0}
                          title={item.usageCount > 0 ? 'Cannot delete item used in bills' : 'Delete item'}
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
