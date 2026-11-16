import { buttonClass, inputClass as baseInputClass } from '@/components/ui/form-control-classes'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, isRedirect, redirect, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { loadModuleSettingsForGuard } from '@/data/module-settings'
import {
  Check,
  Download,
  Edit3,
  Flame,
  Package,
  Plus,
  Search,
  ShoppingBag,
  ToggleLeft,
  ToggleRight,
  X,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { CastingItemsView } from '@/components/items/casting-items-view'
import { ItemRowActions } from '@/components/items/item-row-actions'
import { useModuleSettings } from '@/lib/use-module-settings'
import {
  createItem,
  deleteItem,
  loadItemsWithUsage,
  setItemActive,
  suggestItemGroup,
  updateItem,
} from '@/data/items'
import {
  createPurchaseItem,
  deletePurchaseItem,
  listPurchaseItems,
  renamePurchaseItem,
  setPurchaseItemActive,
  type PurchaseItemView,
} from '@/data/suppliers'
import { purchaseBillsQueryOptions } from '@/data/purchase-queries'
import { itemNameKey } from '@/domain/purchase-item-name'
import { milliToRateText } from '@/domain/supplier-units'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

const searchSchema = z.object({
  tab: z.enum(['selling', 'purchase', 'casting']).optional(),
  q: z.string().optional(),
  type: z.enum(['all', 'electronic', 'gas']).optional(),
  purchaseFilter: z.enum(['all', 'active', 'inactive']).optional(),
})

export const Route = createFileRoute('/items')({
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    if (search.tab !== 'purchase' && search.tab !== 'casting') return
    try {
      const settings = await loadModuleSettingsForGuard()
      if ((search.tab === 'purchase' && !settings.purchaseEnabled) || (search.tab === 'casting' && !settings.castingEnabled)) {
        toast.info(`${search.tab === 'purchase' ? 'Purchase' : 'Casting'} is turned off in Settings`)
        throw redirect({ to: '/' })
      }
    } catch (error) { if (isRedirect(error)) throw error }
  },
  component: UnifiedItemsPage,
})

const ITEMS_QUERY_KEY = ['items-master'] as const

const sellingItemSchema = z
  .object({
    name: z.string().trim().min(1, 'Item name is required'),
    defaultRate: z.number().nonnegative('Rate cannot be negative'),
    type: z.enum(['electronic', 'gas'], { message: 'Item type is required' }),
    unit: z.enum(['', 'piece', 'kg']),
    bagWeight: z.number().nonnegative('Bag weight cannot be negative'),
    group: z.string().trim(),
  })
  .refine((value) => !value.type || value.unit, {
    message: 'Unit is required',
    path: ['unit'],
  })
  .refine((value) => value.type !== 'gas' || value.bagWeight > 0, {
    message: 'Bag weight is required for gas items',
    path: ['bagWeight'],
  })

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function toCsv(rows: Array<Array<unknown>>): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '')
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
        })
        .join(','),
    )
    .join('\n')
}

function fmtKg(kg: number): string {
  if (kg <= 0) return '—'
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(kg)} kg`
}

function fmtRate(rate: number): string {
  if (rate <= 0) return '—'
  return `₹${rate.toFixed(2)}/kg`
}

function formatItemType(type: string) {
  if (type === 'electronic') return 'Electronic Part'
  if (type === 'gas') return 'Gas Part'
  return 'General'
}

const inputClass = `${baseInputClass} text-xs`

function UnifiedItemsPage() {
  const navigate = useNavigate()
  const { purchaseEnabled, castingEnabled } = useModuleSettings()
  const searchParams = Route.useSearch()

  const activeTab = searchParams.tab === 'purchase' && purchaseEnabled ? 'purchase' : searchParams.tab === 'casting' && castingEnabled ? 'casting' : 'selling'

  const updateSearch = (patch: Partial<z.infer<typeof searchSchema>>) => {
    const nextTab = 'tab' in patch ? patch.tab : activeTab
    const nextQ = 'q' in patch ? patch.q : searchParams.q
    const nextType = 'type' in patch ? patch.type : searchParams.type
    const nextPurchaseFilter = 'purchaseFilter' in patch ? patch.purchaseFilter : searchParams.purchaseFilter

    void navigate({
      to: '/items',
      search: {
        tab: nextTab && nextTab !== 'selling' ? nextTab : undefined,
        q: nextQ ? nextQ : undefined,
        type: nextType && nextType !== 'all' ? nextType : undefined,
        purchaseFilter: nextPurchaseFilter && nextPurchaseFilter !== 'all' ? nextPurchaseFilter : undefined,
      },
      replace: true,
    })
  }

  // Pre-fetch counts for badge displays on the switcher tabs
  const sellingItemsQuery = useQuery({ queryKey: ITEMS_QUERY_KEY, queryFn: loadItemsWithUsage })
  const purchaseItemsQuery = useQuery({ queryKey: ['purchase-items'], queryFn: listPurchaseItems, enabled: purchaseEnabled })

  const sellingCount = (sellingItemsQuery.data ?? []).length
  const purchaseCount = (purchaseItemsQuery.data ?? []).length
  const sellingActiveCount = (sellingItemsQuery.data ?? []).filter((item) => item.active).length
  const purchaseActiveCount = (purchaseItemsQuery.data ?? []).filter((item) => item.active).length
  const sellingUsageCount = (sellingItemsQuery.data ?? []).reduce((total, item) => total + item.usageCount, 0)

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-3 p-3 sm:p-4">
      <section className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs">
            <button
              type="button"
              onClick={() => updateSearch({ tab: 'selling', q: undefined })}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                activeTab === 'selling'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShoppingBag size={14} className={activeTab === 'selling' ? 'text-primary' : 'text-muted-foreground'} />
              <span>Sale Items</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                  activeTab === 'selling' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {sellingCount}
              </span>
            </button>

            {purchaseEnabled && <button
              type="button"
              onClick={() => updateSearch({ tab: 'purchase', q: undefined })}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                activeTab === 'purchase'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Package size={14} className={activeTab === 'purchase' ? 'text-blue-600' : 'text-muted-foreground'} />
              <span>Purchase Items</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                  activeTab === 'purchase' ? 'bg-blue-100 text-blue-800' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {purchaseCount}
              </span>
            </button>}
            {castingEnabled && <button type="button" onClick={() => updateSearch({ tab: 'casting', q: undefined })} className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${activeTab === 'casting' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><Flame size={14} /><span>Casting</span></button>}
          </div>
          <p className="font-mono text-xs tabular-nums text-slate-500">
            {activeTab === 'selling' ? `${sellingActiveCount} active · ${sellingUsageCount} bill lines` : activeTab === 'purchase' ? `${purchaseActiveCount} active · ${purchaseCount} total` : 'Casting materials'}
          </p>
        </div>
      </section>

      {/* 2. ACTIVE VIEW CONTAINER */}
      {activeTab === 'selling' ? (
        <SellingItemsView />
      ) : activeTab === 'purchase' ? (
        <PurchaseItemsView />
      ) : (
        <CastingItemsView />
      )}
    </div>
  )
}

/* ==========================================================================
   VIEW 1: SELLING ITEMS (Products Master: Electronic, Gas, Parts)
   ========================================================================== */

function SellingItemsView() {
  const queryClient = useQueryClient()
  const searchParams = Route.useSearch()

  const [search, setSearch] = useState(searchParams.q ?? '')
  const [typeFilter, setTypeFilter] = useState<'all' | 'electronic' | 'gas'>('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string; usageCount: number } | null>(null)
  const [name, setName] = useState('')
  const [defaultRateInput, setDefaultRateInput] = useState('0')
  const [type, setType] = useState('')
  const [groupInput, setGroupInput] = useState('')
  const groupManuallyEditedRef = useRef(false)
  const [unit, setUnit] = useState('')
  const [bagWeightInput, setBagWeightInput] = useState('50')
  const [statusText, setStatusText] = useState('')

  const itemsQuery = useQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: loadItemsWithUsage,
  })

  const allItems = itemsQuery.data ?? []

  const kpis = useMemo(() => {
    let electronicCount = 0
    let gasCount = 0
    let totalUsage = 0

    for (const it of allItems) {
      if (it.type === 'electronic') electronicCount++
      if (it.type === 'gas') gasCount++
      totalUsage += it.usageCount
    }

    return {
      total: allItems.length,
      electronicCount,
      gasCount,
      totalUsage,
    }
  }, [allItems])

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allItems
      .filter((it) => {
        if (activeFilter === 'active' && !it.active) return false
        if (activeFilter === 'inactive' && it.active) return false
        if (typeFilter !== 'all' && it.type !== typeFilter) return false
        if (!needle) return true
        const hay = `${it.name} ${it.group} ${it.type} ${it.unit}`.toLowerCase()
        return hay.includes(needle)
      })
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
  }, [allItems, search, typeFilter, activeFilter])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = sellingItemSchema.safeParse({
        name,
        defaultRate: parseNonNegativeNumber(defaultRateInput),
        type: type as 'electronic' | 'gas' | '',
        unit,
        bagWeight: type === 'gas' ? parseNonNegativeNumber(bagWeightInput || '50') : 0,
        group: groupInput,
      })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid item')
      if (editingId) {
        await updateItem(editingId, parsed.data)
      } else {
        await createItem(parsed.data)
      }
    },
    onSuccess: async () => {
      setStatusText(editingId ? 'Product item updated.' : 'Product item created.')
      resetForm()
      setFormOpen(false)
      await queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ['items-options'] })
    },
    onError: (error) => {
      setStatusText(toUserMessage(error))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (item: { id: string; usageCount: number }) => {
      if (item.usageCount > 0) await setItemActive(item.id, false)
      else await deleteItem(item.id)
    },
    onSuccess: async () => {
      setItemToDelete(null)
      setStatusText('Product item updated.')
      await queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ['items-options'] })
    },
    onError: (error) => {
      setItemToDelete(null)
      setStatusText(toUserMessage(error))
    },
  })

  const toggleSaleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setItemActive(id, active),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ['items-options'] })
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  function resetForm() {
    setEditingId(null)
    setName('')
    setDefaultRateInput('0')
    setType('')
    setGroupInput('')
    groupManuallyEditedRef.current = false
    setUnit('')
    setBagWeightInput('50')
  }

  function startEdit(item: NonNullable<typeof itemsQuery.data>[number]) {
    setEditingId(item.id)
    setName(item.name)
    setDefaultRateInput(String(item.defaultRate))
    setType(item.type)
    setGroupInput(item.group || suggestItemGroup(item.name))
    groupManuallyEditedRef.current = true
    setUnit(item.unit)
    setBagWeightInput(String(item.bagWeight || 50))
    setFormOpen(true)
  }

  function updateType(nextType: string) {
    setType(nextType)
    setUnit(nextType === 'electronic' ? 'piece' : nextType === 'gas' ? 'kg' : '')
    if (nextType === 'gas' && !bagWeightInput) setBagWeightInput('50')
  }

  const handleExportCsv = () => {
    const headers = ['Item Name', 'Group', 'Default Rate', 'Type', 'Unit', 'Bag Weight', 'Usage Count', 'Last Used Date']
    const body = filteredItems.map((it) => [
      it.name,
      it.group || '',
      it.defaultRate,
      it.type,
      it.unit,
      it.bagWeight || 0,
      it.usageCount,
      it.lastUsedDate || '',
    ])
    downloadCsv(`selling-items-${getLocalIsoDate()}.csv`, toCsv([headers, ...body]))
  }

  return (
    <div className="space-y-3">
      <Dialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) resetForm() }}>
        <DialogContent className="sm:max-w-xl">
          <DialogTitle className="text-base font-semibold text-slate-900">{editingId ? 'Edit Sale Item' : 'Add Sale Item'}</DialogTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Item Name */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Item Name *</span>
            <input
              className={inputClass}
              value={name}
              placeholder="e.g. Spindle 7.5GM"
              onChange={(event) => {
                setName(event.target.value)
                if (!groupManuallyEditedRef.current) setGroupInput(suggestItemGroup(event.target.value))
              }}
            />
          </label>

          {/* Default Rate */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Default Rate (₹)</span>
            <input
              className={inputClass}
              type="number"
              value={defaultRateInput}
              onChange={(event) => setDefaultRateInput(event.target.value)}
            />
          </label>

          {/* Type */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Part Type *</span>
            <select className={inputClass} value={type} onChange={(event) => updateType(event.target.value)}>
              <option value="">Select type</option>
              <option value="electronic">Electronic Part</option>
              <option value="gas">Gas Part</option>
            </select>
          </label>

          {/* Report Group */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Report Group</span>
            <input
              className={inputClass}
              value={groupInput}
              onChange={(event) => {
                groupManuallyEditedRef.current = true
                setGroupInput(event.target.value)
              }}
              placeholder="e.g. Spindle"
            />
          </label>

          {/* Unit */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Unit</span>
            <input className={`${inputClass} bg-secondary/50`} value={unit || '—'} readOnly />
          </label>

          {/* Bag Weight */}
          {type === 'gas' ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted-foreground">Bag Wt (kg)</span>
              <input
                className={inputClass}
                type="number"
                value={bagWeightInput}
                onChange={(event) => setBagWeightInput(event.target.value)}
              />
            </label>
          ) : (
            <div className="hidden sm:block" />
          )}

          {/* Form Actions */}
          <div className="flex items-end justify-end gap-1.5 pt-1 sm:col-span-2">
            <button
              type="button"
              className="h-9 rounded-md border border-border bg-card px-3 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition"
              onClick={() => { setFormOpen(false); resetForm() }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition disabled:opacity-50"
              onClick={() => void saveMutation.mutateAsync()}
              disabled={!name.trim() || saveMutation.isPending}
            >
              <Plus size={14} />
              {saveMutation.isPending ? 'Saving…' : editingId ? 'Update' : 'Save'}
            </button>
          </div>
        </div>

          {statusText && <p className="text-xs text-muted-foreground" role="status">{statusText}</p>}
        </DialogContent>
      </Dialog>

      {/* 3. TOOLBAR CARD (Search, Type Filter & CSV) */}
      <section className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-[240px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
              placeholder="Search product items by name, group, unit, type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="inline-flex flex-none rounded-md border border-border bg-secondary/50 p-0.5 text-xs">
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                typeFilter === 'all'
                  ? 'bg-card text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTypeFilter('all')}
            >
              All ({allItems.length})
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                typeFilter === 'electronic'
                  ? 'bg-card text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTypeFilter('electronic')}
            >
              Electronic ({kpis.electronicCount})
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                typeFilter === 'gas'
                  ? 'bg-card text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTypeFilter('gas')}
            >
              Gas ({kpis.gasCount})
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredItems.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-2xs hover:bg-secondary transition disabled:opacity-50 shrink-0"
            aria-label="Export items as CSV" title="Export items as CSV"
          >
            <Download size={13} /> CSV
          </button>
          <button type="button" onClick={() => { resetForm(); setFormOpen(true) }} className={`${buttonClass('primary')} h-9 shrink-0 text-xs`}>
            <Plus size={14} /> Add item
          </button>
        </div>
        {statusText && !formOpen && <p role="status" className="text-xs text-slate-600">{statusText}</p>}
      </section>

      {/* 4. MAIN SELLING PRODUCTS TABLE CARD */}
      <section className="rounded-xl border border-border bg-card p-3 shadow-xs overflow-hidden">
        <div className="mb-3 flex justify-end"><select aria-label="Filter Sale items by status" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        {itemsQuery.isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">
            Loading products catalog…
          </div>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[940px] text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2">Report Group</th>
                  <th className="px-3 py-2 text-right">Default Rate</th>
                  <th className="px-3 py-2">Part Type</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2 text-right">Usage Count</th>
                  <th className="px-3 py-2 text-left">Last Billed</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-xs text-muted-foreground">
                      {search ? `No products matching "${search}".` : 'No product items registered yet.'}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="transition hover:bg-secondary/30">
                      <td className="px-3 py-2 font-bold text-sm text-foreground">
                        {item.name}
                      </td>
                      <td className="px-3 py-2 font-medium text-muted-foreground">
                        {item.group || '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums text-foreground">
                        ₹{formatInrInteger(item.defaultRate)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${
                            item.type === 'electronic'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {formatItemType(item.type)}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        {item.unit || '—'}
                        {item.type === 'gas' && item.bagWeight ? ` (${item.bagWeight}kg/bag)` : ''}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-foreground">
                        {item.usageCount > 0 ? (
                          <span className="font-semibold">{item.usageCount} bills</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {item.lastUsedDate ? formatFullDate(item.lastUsedDate) : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">{item.active ? 'Active' : 'Inactive'}</td>
                      <td className="px-3 py-2 text-right">
                        <ItemRowActions
                          name={item.name}
                          active={item.active}
                          onEdit={() => startEdit(item)}
                          onToggleActive={() => toggleSaleActive.mutate({ id: item.id, active: !item.active })}
                          onDelete={() => setItemToDelete({ id: item.id, name: item.name, usageCount: item.usageCount })}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 border-t border-border pt-3 flex flex-wrap items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing <strong className="text-foreground">{filteredItems.length}</strong> of{' '}
            {allItems.length} product items
          </span>
          <span className="font-mono text-[11px]">
            Master synchronized with sales billing
          </span>
        </div>
      </section>

      {/* DELETE DIALOG FOR SELLING ITEM */}
      {itemToDelete && (
        <ConfirmDialog
          open={Boolean(itemToDelete)}
          onOpenChange={(open) => {
            if (!open) setItemToDelete(null)
          }}
          title={<span>Delete Selling Product: <strong className="text-foreground">{itemToDelete.name}</strong></span>}
          description={
            itemToDelete.usageCount > 0 ? (
              <div className="space-y-2">
                <p>
                  This product item is currently linked to{' '}
                  <strong className="text-foreground">{itemToDelete.usageCount} sales bill(s)</strong>.
                </p>
                <p className="text-muted-foreground">
                  This item will be deactivated for new bills. Historical bills stay intact.
                </p>
                <p className="font-semibold text-destructive">
                  Deactivate this item?
                </p>
              </div>
            ) : (
              <p>
                Are you sure you want to delete &ldquo;{itemToDelete.name}&rdquo;? It has not been used in any bills and will be permanently removed.
              </p>
            )
          }
          confirmLabel={itemToDelete.usageCount > 0 ? 'Deactivate' : 'Delete Product'}
          tone={itemToDelete.usageCount > 0 ? 'primary' : 'danger'}
          pending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(itemToDelete)}
        />
      )}
    </div>
  )
}

/* ==========================================================================
   VIEW 2: RAW SCRAP PURCHASES CATALOG
   ========================================================================== */

type PurchaseItemFilter = 'all' | 'active' | 'inactive'

type ScrapItemStats = {
  billCount: number
  allTimeKg: number
  kgLast30d: number
  totalSpendPaise: number
  lastRateMilli: number | null
  lastRateDate: string
}

function PurchaseItemsView() {
  const queryClient = useQueryClient()
  const searchParams = Route.useSearch()

  const [query, setQuery] = useState(searchParams.q ?? '')
  const [filter, setFilter] = useState<PurchaseItemFilter>(searchParams.purchaseFilter ?? 'all')
  const [newItemName, setNewItemName] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingAliases, setEditingAliases] = useState('')
  const [statusText, setStatusText] = useState('')
  const [rowError, setRowError] = useState('')
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string; billCount: number } | null>(null)

  const itemsQuery = useQuery({ queryKey: ['purchase-items'], queryFn: listPurchaseItems })
  const billsQuery = useQuery(purchaseBillsQueryOptions())

  const allItems = itemsQuery.data ?? []

  // Aggregate item usage stats across purchase bills
  const statsByNameKey = useMemo(() => {
    const bills30dCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const stats = new Map<string, ScrapItemStats>()

    for (const bill of billsQuery.data ?? []) {
      if (bill.cancelled) continue
      const seenKeys = new Set<string>()

      for (const line of bill.lines) {
        const key = line.itemId ? `id:${line.itemId}` : `name:${itemNameKey(line.itemName)}`
        const entry = stats.get(key) ?? {
          billCount: 0,
          allTimeKg: 0,
          kgLast30d: 0,
          totalSpendPaise: 0,
          lastRateMilli: null,
          lastRateDate: '',
        }

        if (!seenKeys.has(key)) {
          seenKeys.add(key)
          entry.billCount += 1
        }

        const netKg = line.weightG / 1000
        entry.allTimeKg += netKg
        entry.totalSpendPaise += line.amountPaise

        if (bill.date >= bills30dCutoff) {
          entry.kgLast30d += netKg
        }

        if (bill.date > entry.lastRateDate) {
          entry.lastRateDate = bill.date
          entry.lastRateMilli = line.rateMilli
        }

        stats.set(key, entry)
      }
    }
    return stats
  }, [billsQuery.data])

  const statsFor = (item: PurchaseItemView): ScrapItemStats => {
    return (
      statsByNameKey.get(`id:${item.id}`) ??
      statsByNameKey.get(`name:${itemNameKey(item.name)}`) ?? {
        billCount: 0,
        allTimeKg: 0,
        kgLast30d: 0,
        totalSpendPaise: 0,
        lastRateMilli: null,
        lastRateDate: '',
      }
    )
  }

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allItems.filter((item) => {
      if (filter === 'active' && !item.active) return false
      if (filter === 'inactive' && item.active) return false
      if (!needle) return true
      return `${item.name} ${item.aliases}`.toLowerCase().includes(needle)
    })
  }, [allItems, query, filter])

  const kpis = useMemo(() => {
    const activeCount = allItems.filter((i) => i.active).length
    const inactiveCount = allItems.length - activeCount
    let totalKg = 0
    let totalSpendPaise = 0
    let totalBills = 0

    for (const item of allItems) {
      const s = statsFor(item)
      totalKg += s.allTimeKg
      totalSpendPaise += s.totalSpendPaise
      totalBills += s.billCount
    }

    return {
      totalItems: allItems.length,
      activeCount,
      inactiveCount,
      totalKg,
      totalSpendPaise,
      totalBills,
    }
  }, [allItems, statsByNameKey])

  const createMutation = useMutation({
    mutationFn: async (name: string) => createPurchaseItem(name),
    onSuccess: async () => {
      setNewItemName('')
      setAddOpen(false)
      setStatusText('Scrap item created successfully.')
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  const renameMutation = useMutation({
    mutationFn: async ({ id, name, aliases }: { id: string; name: string; aliases: string }) => renamePurchaseItem(id, name, aliases),
    onSuccess: async () => {
      setEditingId(null)
      setEditingName('')
      setEditingAliases('')
      setRowError('')
      setStatusText('Scrap item renamed successfully.')
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (err) => setRowError(toUserMessage(err)),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => setPurchaseItemActive(id, active),
    onSuccess: async () => {
      setStatusText('Scrap item status updated.')
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: async (item: { id: string; billCount: number }) => item.billCount > 0 ? setPurchaseItemActive(item.id, false) : deletePurchaseItem(item.id),
    onSuccess: async () => {
      setItemToDelete(null)
      setStatusText('Scrap item deleted successfully.')
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (err) => {
      setItemToDelete(null)
      setStatusText(toUserMessage(err))
    },
  })

  const commitRename = (id: string) => {
    const trimmed = editingName.trim()
    if (!trimmed) {
      setEditingId(null)
      setRowError('')
      return
    }
    setRowError('')
    renameMutation.mutate({ id, name: trimmed, aliases: editingAliases })
  }

  const isLoading = itemsQuery.isLoading || billsQuery.isLoading

  return (
    <div className="space-y-3">
      {/* 2. FILTER & ADD TOOLBAR CARD (Strictly Enclosed Inside Card) */}
      <section className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-3">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-[240px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-xs text-foreground shadow-2xs outline-none transition placeholder:text-muted-foreground focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
              placeholder="Search scrap item by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="inline-flex flex-none rounded-md border border-border bg-secondary/50 p-0.5 text-xs">
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                filter === 'all'
                  ? 'bg-card text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setFilter('all')}
            >
              All ({allItems.length})
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                filter === 'active'
                  ? 'bg-card text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setFilter('active')}
            >
              Active ({kpis.activeCount})
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                filter === 'inactive'
                  ? 'bg-card text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setFilter('inactive')}
            >
              Inactive ({kpis.inactiveCount})
            </button>
          </div>

          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-secondary/50 px-2.5 text-xs font-medium text-foreground hover:bg-secondary transition shrink-0"
              title="Clear search query"
            >
              <X size={13} /> Clear
            </button>
          )}
          <button type="button" onClick={() => setAddOpen(true)} className={`${buttonClass('primary')} h-9 shrink-0 text-xs`}>
            <Plus size={14} /> Add item
          </button>
        </div>
        {statusText && <p className="text-xs text-slate-600" role="status">{statusText}</p>}
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-base font-semibold text-slate-900">Add Purchase Item</DialogTitle>
          <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = newItemName.trim()
            if (trimmed) createMutation.mutate(trimmed)
          }}
        >
          <label className="block text-xs font-medium text-slate-600">Item name
          <input
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="e.g. Brass Scrap"
            className={`${inputClass} mt-1`}
          />
          </label>
          <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setAddOpen(false)} className={`${buttonClass('secondary')} h-9 text-xs`}>Cancel</button>
          <button
            type="submit"
            disabled={!newItemName.trim() || createMutation.isPending}
            className={`${buttonClass('primary')} h-9 text-xs`}
          >
            <Plus size={14} /> Add Item
          </button>
          </div>
        </form>
        </DialogContent>
      </Dialog>

      {/* 3. MAIN TABLE CARD */}
      <section className="rounded-xl border border-border bg-card p-3 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">
            Loading scrap items catalog…
          </div>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[840px] text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Scrap Item Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Bills Used</th>
                  <th className="px-3 py-2 text-right">30D Weight</th>
                  <th className="px-3 py-2 text-right">Total Weight</th>
                  <th className="px-3 py-2 text-right">Avg Buy Rate</th>
                  <th className="px-3 py-2 text-right">Last Purchase Rate</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-xs text-muted-foreground">
                      {query
                        ? `No items matching "${query}".`
                        : filter !== 'all'
                          ? `No ${filter} items found.`
                          : 'No scrap items found in catalog.'}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const stats = statsFor(item)
                    const isEditing = editingId === item.id
                    const avgRate = stats.allTimeKg > 0 ? (stats.totalSpendPaise / 100) / stats.allTimeKg : 0

                    return (
                      <tr
                        key={item.id}
                        className={`transition hover:bg-secondary/30 ${item.active ? '' : 'opacity-70 bg-secondary/10'}`}
                      >
                        {/* Item Name & Quick Rename */}
                        <td className="px-3 py-2 font-medium text-foreground">
                          {isEditing ? (
                            <div className="flex flex-wrap items-center gap-1.5">
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
                                className="h-7 w-52 rounded-md border border-primary bg-background px-2 text-xs font-semibold text-foreground outline-none ring-2 ring-primary/20"
                              />
                              <input value={editingAliases} onChange={(e) => setEditingAliases(e.target.value)} placeholder="Other names, comma separated" aria-label="Purchase item aliases" className={`${inputClass} h-7 w-52 text-xs`} />
                              <button
                                type="button"
                                aria-label="Confirm rename"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => commitRename(item.id)}
                              >
                                <Check size={13} />
                              </button>
                              <button
                                type="button"
                                aria-label="Cancel rename"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-muted-foreground hover:bg-secondary/80 transition"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setEditingId(null)
                                  setRowError('')
                                }}
                              >
                                <X size={13} />
                              </button>
                              {rowError && <span className="text-[11px] text-destructive ml-1">{rowError}</span>}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-foreground">{item.name}</span>
                              {item.aliases && <span className="max-w-48 truncate text-xs text-muted-foreground" title={item.aliases}>· {item.aliases.replace(/\n/g, ', ')}</span>}
                              <button
                                type="button"
                                aria-label={`Rename ${item.name}`}
                                onClick={() => {
                                  setEditingId(item.id)
                                  setEditingName(item.name)
                                  setEditingAliases(item.aliases ?? '')
                                  setRowError('')
                                }}
                                className="rounded p-1 text-muted-foreground/60 transition hover:bg-secondary hover:text-foreground"
                                title="Rename item"
                              >
                                <Edit3 size={13} />
                              </button>
                            </div>
                          )}
                        </td>

                        {/* Status Toggle Switch Badge */}
                        <td className="whitespace-nowrap px-3 py-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={item.active}
                            aria-label={item.active ? `Deactivate ${item.name}` : `Activate ${item.name}`}
                            onClick={() => toggleActiveMutation.mutate({ id: item.id, active: !item.active })}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                              item.active
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                                : 'bg-secondary text-muted-foreground border border-border hover:bg-secondary/80'
                            }`}
                            title={item.active ? 'Click to deactivate item' : 'Click to activate item'}
                          >
                            {item.active ? (
                              <>
                                <ToggleRight size={16} className="text-emerald-600" />
                                <span>Active</span>
                              </>
                            ) : (
                              <>
                                <ToggleLeft size={16} className="text-muted-foreground" />
                                <span>Inactive</span>
                              </>
                            )}
                          </button>
                        </td>

                        {/* Bills Count */}
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-foreground">
                          {stats.billCount > 0 ? (
                            <span className="font-semibold">{stats.billCount} bills</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* 30D Weight */}
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-foreground">
                          {fmtKg(stats.kgLast30d)}
                        </td>

                        {/* Total Weight */}
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums text-foreground">
                          {fmtKg(stats.allTimeKg)}
                        </td>

                        {/* Avg Buy Rate */}
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums">
                          {avgRate > 0 ? (
                            <span className="rounded bg-blue-50 px-2 py-0.5 font-bold text-blue-700 border border-blue-200">
                              {fmtRate(avgRate)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* Last Rate */}
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums">
                          {stats.lastRateMilli != null ? (
                            <div>
                              <span className="font-bold text-foreground">
                                ₹{milliToRateText(stats.lastRateMilli)}
                              </span>
                              {stats.lastRateDate && (
                                <span className="block text-[11px] text-muted-foreground font-sans">
                                  {formatFullDate(stats.lastRateDate)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* Row Actions */}
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <ItemRowActions
                            name={item.name}
                            active={item.active}
                            onEdit={() => { setEditingId(item.id); setEditingName(item.name); setRowError('') }}
                            onToggleActive={() => toggleActiveMutation.mutate({ id: item.id, active: !item.active })}
                            onDelete={() => setItemToDelete({ id: item.id, name: item.name, billCount: stats.billCount })}
                          />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 border-t border-border pt-3 flex flex-wrap items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing <strong className="text-foreground">{filteredItems.length}</strong> of{' '}
            {allItems.length} scrap items
          </span>
          <span className="font-mono text-[11px]">
            Catalog synchronized with purchase billing
          </span>
        </div>
      </section>

      {/* DELETE DIALOG FOR SCRAP ITEM */}
      {itemToDelete && (
        <ConfirmDialog
          open={Boolean(itemToDelete)}
          onOpenChange={(open) => {
            if (!open) setItemToDelete(null)
          }}
          title={<span>Delete Scrap Item: <strong className="text-foreground">{itemToDelete.name}</strong></span>}
          description={
            itemToDelete.billCount > 0 ? (
              <div className="space-y-2">
                <p>
                  This scrap item is currently referenced in{' '}
                  <strong className="text-foreground">{itemToDelete.billCount} purchase bill(s)</strong>.
                </p>
                <p className="text-muted-foreground">
                  This item will be deactivated for new purchase bills. Historical bills stay intact.
                </p>
                <p className="font-semibold text-destructive">
                  Deactivate this item?
                </p>
              </div>
            ) : (
              <p>
                Are you sure you want to delete &ldquo;{itemToDelete.name}&rdquo;? It has no recorded bills and will be permanently removed from the catalog.
              </p>
            )
          }
          confirmLabel={itemToDelete.billCount > 0 ? 'Deactivate' : 'Delete Item'}
          tone={itemToDelete.billCount > 0 ? 'primary' : 'danger'}
          pending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(itemToDelete)}
        />
      )}
    </div>
  )
}
