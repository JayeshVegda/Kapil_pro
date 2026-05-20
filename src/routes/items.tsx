import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit3, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { DateInput } from '@/components/ui/date-input'
import { createItem, deleteItem, loadItemsWithUsage, updateItem } from '@/data/items'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/items')({
  component: ItemsPage,
})

const ITEMS_QUERY_KEY = ['items-master'] as const

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required'),
  defaultRate: z.number().nonnegative('Rate cannot be negative'),
  type: z.enum(['', 'electronic', 'gas']),
  unit: z.enum(['', 'piece', 'kg']),
  bagWeight: z.number().nonnegative('Bag weight cannot be negative'),
  openingStock: z.number().nonnegative('Opening stock cannot be negative'),
  openingStockDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/, 'Invalid opening stock date'),
}).refine((value) => !value.type || value.unit, {
  message: 'Unit is required',
  path: ['unit'],
}).refine((value) => value.type !== 'gas' || value.bagWeight > 0, {
  message: 'Bag weight is required for gas items',
  path: ['bagWeight'],
})

function ItemsPage() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [defaultRateInput, setDefaultRateInput] = useState('0')
  const [type, setType] = useState('')
  const [unit, setUnit] = useState('')
  const [bagWeightInput, setBagWeightInput] = useState('50')
  const [openingStockInput, setOpeningStockInput] = useState('0')
  const [openingStockDate, setOpeningStockDate] = useState(getLocalIsoDate())
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
        type,
        unit,
        bagWeight: type === 'gas' ? parseNonNegativeNumber(bagWeightInput || '50') : 0,
        openingStock: type === 'gas' ? parseNonNegativeNumber(openingStockInput) : 0,
        openingStockDate: type === 'gas' ? openingStockDate : '',
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
      await queryClient.invalidateQueries({ queryKey: ['current-stock'] })
    },
    onError: (error) => {
      setStatusText(toUserMessage(error))
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
      await queryClient.invalidateQueries({ queryKey: ['current-stock'] })
    },
    onError: (error) => {
      setStatusText(toUserMessage(error))
    },
  })

  function resetForm() {
    setEditingId(null)
    setName('')
    setDefaultRateInput('0')
    setType('')
    setUnit('')
    setBagWeightInput('50')
    setOpeningStockInput('0')
    setOpeningStockDate(getLocalIsoDate())
  }

  function startEdit(item: NonNullable<typeof itemsQuery.data>[number]) {
    setEditingId(item.id)
    setName(item.name)
    setDefaultRateInput(String(item.defaultRate))
    setType(item.type)
    setUnit(item.unit)
    setBagWeightInput(String(item.bagWeight || 50))
    setOpeningStockInput(String(item.openingStock))
    setOpeningStockDate(item.openingStockDate || getLocalIsoDate())
  }

  function updateType(nextType: string) {
    setType(nextType)
    setUnit(nextType === 'electronic' ? 'piece' : nextType === 'gas' ? 'kg' : '')
    if (nextType === 'gas' && !bagWeightInput) setBagWeightInput('50')
  }

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1fr_160px_170px_130px_160px_160px_auto]">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Item Name *</span>
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Default Rate</span>
            <input className={inputClass} type="number" value={defaultRateInput} onChange={(event) => setDefaultRateInput(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Type</span>
            <select className={inputClass} value={type} onChange={(event) => updateType(event.target.value)}>
              <option value="">Select type</option>
              <option value="electronic">Electronic Part</option>
              <option value="gas">Gas Part</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Unit</span>
            <input className={`${inputClass} bg-slate-50`} value={unit || '-'} readOnly />
          </label>
          {type === 'gas' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Bag Weight</span>
              <input className={inputClass} type="number" value={bagWeightInput} onChange={(event) => setBagWeightInput(event.target.value)} />
            </label>
          )}
          {type === 'gas' && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Opening Stock (kg)</span>
                <input className={inputClass} type="number" value={openingStockInput} onChange={(event) => setOpeningStockInput(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Opening Date</span>
                <DateInput className={inputClass} value={openingStockDate} onChange={setOpeningStockDate} />
              </label>
            </>
          )}
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
            <table className="w-full min-w-[1040px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Item</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Default Rate</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Unit</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Opening Date</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Usage Count</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Last Used</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {(itemsQuery.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
                      No items yet. Add your first item to speed up bill entry.
                    </td>
                  </tr>
                )}
                {(itemsQuery.data ?? []).map((item, index) => (
                  <tr key={item.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                    <td className="px-3 py-3 text-sm font-medium text-slate-800">{item.name}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-800">{formatInrInteger(item.defaultRate)}</td>
                    <td className="px-3 py-3 text-sm text-slate-700">{formatItemType(item.type)}</td>
                    <td className="px-3 py-3 text-sm text-slate-700">{item.unit || '-'}</td>
                    <td className="px-3 py-3 text-sm text-slate-700">{item.openingStockDate ? formatFullDate(item.openingStockDate) : '-'}</td>
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

function formatItemType(type: string) {
  if (type === 'electronic') return 'Electronic Part'
  if (type === 'gas') return 'Gas Part'
  return '-'
}
