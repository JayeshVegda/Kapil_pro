import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Clock,
  FileText,
  Image as ImageIcon,
  Lock,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import {
  bundleToSettlementInput,
  createPurchaseBill,
  createPurchaseItem,
  getNextPurchaseInNo,
  listPurchaseItems,
  listSuppliers,
  loadPurchaseBill,
  loadSupplierBundle,
  loadVilaityHistory,
  updatePurchaseBill,
  type PurchaseBillCreateInput,
  type PurchaseBillUpdateInput,
  type PurchaseItemView,
  type SupplierBundle,
} from '@/data/suppliers'
import {
  computeBillNet,
  extractUserNote,
  formatPrivateNoteWithBags,
  parseBagsAtReceiptKg,
  resolveTaxModeForPool,
  type PurchaseAdjustmentType,
  type PurchaseTaxMode,
  type SupplierPool,
} from '@/domain/supplier-purchases'
import { computeSupplierSettlement } from '@/domain/supplier-settlement'
import {
  gramsToKgText,
  kgToGrams,
  lineAmountPaise,
  milliToRateText,
  percentToBasisPoints,
  rateToMilli,
  rupeesToPaise,
} from '@/domain/supplier-units'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

const searchSchema = z.object({
  supplierId: z.string().optional(),
  editBillId: z.string().optional(),
})

export const Route = createFileRoute('/new-purchase-bill')({
  validateSearch: searchSchema,
  component: NewPurchaseBillPage,
})

type LineFormItem = {
  id: string
  itemId?: string
  itemName: string
  weightKgStr: string
  rateRupeesStr: string
}

type AdjustmentFormItem = {
  id: string
  type: PurchaseAdjustmentType
  amountRupeesStr: string
  note: string
}

function generateLineId() {
  return `line-${Math.random().toString(36).slice(2, 9)}`
}

function defaultLine(): LineFormItem {
  return {
    id: generateLineId(),
    itemId: '',
    itemName: '',
    weightKgStr: '',
    rateRupeesStr: '',
  }
}

function findVilaityBenchmark(
  history: Array<{ date: string; vilaityMilli: number }>,
  targetDate: string,
): { milli: number | null; date: string; isFallback: boolean } {
  if (!history || history.length === 0) return { milli: null, date: targetDate, isFallback: false }
  const exact = history.find((h) => h.date === targetDate)
  if (exact) return { milli: exact.vilaityMilli, date: exact.date, isFallback: false }
  const earlier = history.filter((h) => h.date < targetDate)
  if (earlier.length > 0) {
    const prev = earlier[earlier.length - 1]
    return { milli: prev.vilaityMilli, date: prev.date, isFallback: true }
  }
  const first = history[0]
  return { milli: first?.vilaityMilli ?? null, date: first?.date ?? targetDate, isFallback: true }
}

function ItemDropdownCell({
  items,
  selectedItemName,
  onSelect,
  onNext,
  onCreateItem,
}: {
  items: PurchaseItemView[]
  selectedItemName: string
  onSelect: (item: { id: string; name: string }) => void
  onNext: () => void
  onCreateItem: (name: string) => Promise<{ id: string; name: string }>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState(selectedItemName)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const [showInlineAdd, setShowInlineAdd] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQuery(selectedItemName)
  }, [selectedItemName])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => it.name.toLowerCase().includes(q))
  }, [items, query])

  const exactMatchExists = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.some((it) => it.name.toLowerCase() === q)
  }, [items, query])

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setShowInlineAdd(false)
        // Reset query to selectedItemName to enforce no free text
        setQuery(selectedItemName)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [selectedItemName])

  const handlePick = (item: { id: string; name: string }) => {
    onSelect(item)
    setQuery(item.name)
    setIsOpen(false)
    setShowInlineAdd(false)
    onNext()
  }

  const handleCreateNew = async (name: string) => {
    const clean = name.trim()
    if (!clean || isCreating) return
    try {
      setIsCreating(true)
      const created = await onCreateItem(clean)
      handlePick(created)
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true)
        e.preventDefault()
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredItems.length > 0 && highlightIndex >= 0 && highlightIndex < filteredItems.length) {
        handlePick(filteredItems[highlightIndex])
      } else if (query.trim() && !exactMatchExists) {
        void handleCreateNew(query)
      }
    } else if (e.key === 'Tab') {
      if (filteredItems.length > 0 && highlightIndex >= 0 && highlightIndex < filteredItems.length) {
        onSelect(filteredItems[highlightIndex])
        setQuery(filteredItems[highlightIndex].name)
      } else {
        setQuery(selectedItemName)
      }
      setIsOpen(false)
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setQuery(selectedItemName)
    }
  }

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          placeholder="Select or search item..."
          value={query}
          onFocus={() => {
            setIsOpen(true)
            setHighlightIndex(0)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
            setHighlightIndex(0)
          }}
          onKeyDown={handleKeyDown}
          className="h-8 w-full rounded border border-slate-300 px-2 text-xs font-medium text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setShowInlineAdd((p) => !p)
            setIsOpen(true)
          }}
          title="Add new purchase item"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-600 hover:bg-blue-50 hover:text-blue-600"
        >
          <Plus size={13} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 z-50 mt-1 max-h-56 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {showInlineAdd && (
            <div className="border-b border-slate-100 bg-blue-50/70 p-2">
              <label className="text-[11px] font-semibold text-blue-900">Add New Purchase Item</label>
              <div className="mt-1 flex gap-1">
                <input
                  type="text"
                  autoFocus
                  placeholder="Item name (e.g. Brass Honey)"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleCreateNew(newItemName)
                    }
                  }}
                  className="h-7 flex-1 rounded border border-blue-300 bg-white px-2 text-xs outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  disabled={isCreating || !newItemName.trim()}
                  onClick={() => void handleCreateNew(newItemName)}
                  className="rounded bg-blue-600 px-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isCreating ? '...' : 'Add'}
                </button>
              </div>
            </div>
          )}

          {filteredItems.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-400">
              No matching item found.
              {query.trim() && !exactMatchExists && (
                <button
                  type="button"
                  onClick={() => void handleCreateNew(query)}
                  className="mt-1.5 block w-full rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  + Add "{query.trim()}"
                </button>
              )}
            </div>
          ) : (
            <>
              {filteredItems.map((it, idx) => (
                <button
                  key={it.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handlePick(it)
                  }}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  className={`w-full px-3 py-1.5 text-left text-xs font-medium transition ${
                    idx === highlightIndex ? 'bg-blue-50 text-blue-900' : 'text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  {it.name}
                </button>
              ))}
              {query.trim() && !exactMatchExists && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    void handleCreateNew(query)
                  }}
                  className="w-full border-t border-slate-100 px-3 py-1.5 text-left text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  + Add "{query.trim()}" as new item
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function NewPurchaseBillPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { supplierId: initialSupplierId, editBillId } = Route.useSearch()

  const [supplierId, setSupplierId] = useState(initialSupplierId ?? '')
  const [date, setDate] = useState(() => getLocalIsoDate())
  const [pool, setPool] = useState<SupplierPool>('kacha')
  const [taxMode, setTaxMode] = useState<PurchaseTaxMode>('none')
  const [gstRatePercent, setGstRatePercent] = useState<number>(18)
  const [supplierBillNo, setSupplierBillNo] = useState('')
  const [vehicleNo, setVehicleNo] = useState('')
  const [bagsAtReceiptStr, setBagsAtReceiptStr] = useState('')
  const [privateNote, setPrivateNote] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [inNoPreview, setInNoPreview] = useState<string>('')
  const [hasManualAllocationsWarning, setHasManualAllocationsWarning] = useState(false)

  const [lines, setLines] = useState<LineFormItem[]>([defaultLine()])
  const [adjustments, setAdjustments] = useState<AdjustmentFormItem[]>([])
  const [statusText, setStatusText] = useState('')

  const suppliersQuery = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => listSuppliers({ includeInactive: false }),
  })

  const itemsQuery = useQuery({
    queryKey: ['purchase-items'],
    queryFn: listPurchaseItems,
  })

  const activeItems = useMemo(() => {
    return (itemsQuery.data ?? []).filter((it) => it.active !== false)
  }, [itemsQuery.data])

  const vilaityQuery = useQuery({
    queryKey: ['vilaity-history'],
    queryFn: loadVilaityHistory,
  })

  const editBillQuery = useQuery({
    queryKey: ['purchase-bill-edit', editBillId],
    queryFn: () => (editBillId ? loadPurchaseBill(editBillId) : null),
    enabled: Boolean(editBillId),
  })

  // Supplier context side panel bundle query
  const supplierBundleQuery = useQuery({
    queryKey: ['supplier-bundle-context', supplierId],
    queryFn: () => (supplierId ? loadSupplierBundle(supplierId) : null),
    enabled: Boolean(supplierId),
  })

  // Pre-fill if editing
  useEffect(() => {
    if (!editBillQuery.data) return
    const { bill, lines: billLines, adjustments: billAdjs, allocations } = editBillQuery.data
    setSupplierId(bill.supplierId)
    setDate(bill.date)
    setPool(bill.pool)
    setTaxMode(resolveTaxModeForPool(bill.pool, bill.taxMode))
    setGstRatePercent(bill.gstRateBp ? bill.gstRateBp / 100 : 18)
    setSupplierBillNo(bill.supplierBillNo ?? '')
    setVehicleNo(bill.vehicleNo ?? '')
    setInNoPreview(bill.inNo)

    const parsedBags = parseBagsAtReceiptKg(bill.privateNote)
    if (parsedBags != null) setBagsAtReceiptStr(parsedBags.toString())
    setPrivateNote(extractUserNote(bill.privateNote))

    if (allocations && allocations.length > 0) {
      setHasManualAllocationsWarning(true)
    }

    if (billLines.length > 0) {
      setLines(
        billLines.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          itemName: l.itemName,
          weightKgStr: (l.weightG / 1000).toFixed(3),
          rateRupeesStr: (l.rateMilli / 1000).toFixed(3),
        })),
      )
    }

    if (billAdjs.length > 0) {
      setAdjustments(
        billAdjs.map((a) => ({
          id: a.id,
          type: a.type as PurchaseAdjustmentType,
          amountRupeesStr: (a.amountPaise / 100).toString(),
          note: a.note ?? '',
        })),
      )
    }
  }, [editBillQuery.data])

  // IN number preview for new bills
  useEffect(() => {
    if (editBillId) return
    let cancelled = false
    void getNextPurchaseInNo(date).then((nextNo) => {
      if (!cancelled) setInNoPreview(nextNo)
    })
    return () => {
      cancelled = true
    }
  }, [date, editBillId])

  // Pool drives tax
  const handlePoolChange = (nextPool: SupplierPool) => {
    setPool(nextPool)
    setTaxMode(resolveTaxModeForPool(nextPool, taxMode))
  }

  // Prepared domain calculations
  const parsedLines = useMemo(() => {
    return lines.map((l) => {
      const weightG = kgToGrams(parseFloat(l.weightKgStr) || 0)
      const rateMilli = rateToMilli(parseFloat(l.rateRupeesStr) || 0)
      const amountPaise = lineAmountPaise(weightG, rateMilli)
      return {
        ...l,
        weightG,
        rateMilli,
        amountPaise,
      }
    })
  }, [lines])

  const parsedAdjustments = useMemo(() => {
    return adjustments.map((a) => {
      const amountPaise = rupeesToPaise(parseFloat(a.amountRupeesStr) || 0)
      return {
        ...a,
        amountPaise,
      }
    })
  }, [adjustments])

  const billNet = useMemo(() => {
    const gstRateBp = taxMode === 'none' ? 0 : percentToBasisPoints(gstRatePercent)
    return computeBillNet(
      parsedLines.map((l) => ({ amountPaise: l.amountPaise })),
      parsedAdjustments.map((a) => ({ type: a.type, amountPaise: a.amountPaise })),
      [],
      taxMode,
      gstRateBp,
    )
  }, [parsedLines, parsedAdjustments, taxMode, gstRatePercent])

  // Vilaity benchmark rate for the current date
  const vilaityBenchmark = useMemo(() => {
    return findVilaityBenchmark(vilaityQuery.data ?? [], date)
  }, [vilaityQuery.data, date])

  const currentVilaityMilli = vilaityBenchmark.milli

  // Total kg and average rate
  const totalWeightG = useMemo(() => parsedLines.reduce((s, l) => s + l.weightG, 0), [parsedLines])
  const totalKg = totalWeightG / 1000
  const avgRateRupees = useMemo(() => {
    if (totalKg <= 0) return 0
    return (billNet.linesTotalPaise / 100) / totalKg
  }, [totalKg, billNet.linesTotalPaise])

  // Total premium over vilaity
  const totalPremiumPaise = useMemo(() => {
    if (currentVilaityMilli == null) return null
    let total = 0
    for (const l of parsedLines) {
      if (l.weightG > 0 && l.rateMilli > 0) {
        const diffMilli = l.rateMilli - currentVilaityMilli
        const premiumLine = Math.round((l.weightG * diffMilli) / 10000)
        total += premiumLine
      }
    }
    return total
  }, [parsedLines, currentVilaityMilli])

  const supplierOptions = useMemo(() => {
    return (suppliersQuery.data ?? []).map((s) => ({
      id: s.id,
      name: s.companyName,
      suffix: s.city ? `(${s.city})` : undefined,
    }))
  }, [suppliersQuery.data])

  // Supplier context panel computation
  const supplierContext = useMemo(() => {
    if (!supplierBundleQuery.data) return null
    const bundle: SupplierBundle = supplierBundleQuery.data
    const settlement = computeSupplierSettlement(bundleToSettlementInput(bundle))
    const poolBills = [...settlement.pools.kacha.bills, ...settlement.pools.gst.bills]
    const bardanPendingCount = poolBills.filter((b) => b.bardanPending).length

    // Last 3 rates per item for this supplier
    const validBills = new Map(bundle.bills.filter((b) => !b.cancelled).map((b) => [b.id, b]))
    const itemRatesMap = new Map<string, Array<{ date: string; rateMilli: number }>>()

    const sortedLines = [...bundle.lines].sort((a, b) => {
      const dateA = validBills.get(a.billId)?.date ?? ''
      const dateB = validBills.get(b.billId)?.date ?? ''
      return dateB.localeCompare(dateA)
    })

    for (const l of sortedLines) {
      const b = validBills.get(l.billId)
      if (!b) continue
      const list = itemRatesMap.get(l.itemName) ?? []
      if (list.length < 3) {
        list.push({ date: b.date, rateMilli: l.rateMilli })
        itemRatesMap.set(l.itemName, list)
      }
    }

    return {
      kachaDuePaise: settlement.pools.kacha.outstandingPaise,
      gstDuePaise: settlement.pools.gst.outstandingPaise,
      advancePaise: settlement.combined.advancePaise,
      bardanPendingCount,
      itemRates: Array.from(itemRatesMap.entries()).map(([itemName, rates]) => ({
        itemName,
        rates,
      })),
    }
  }, [supplierBundleQuery.data])

  // Bardan "advance" entries mint a supplier payment in the bill's pool; moving
  // the bill to the other pool would strand that payment, so the pool is locked.
  const poolLocked = Boolean(editBillId) && (editBillQuery.data?.bardan.some((b) => b.method === 'advance') ?? false)

  const addLine = () => setLines((prev) => [...prev, defaultLine()])

  const removeLine = (id: string) => {
    if (lines.length === 1) return
    setLines((prev) => prev.filter((l) => l.id !== id))
  }
  const updateLine = (id: string, patch: Partial<LineFormItem>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  const addAdjustment = () => {
    setAdjustments((prev) => [
      ...prev,
      {
        id: generateLineId(),
        type: 'labour',
        amountRupeesStr: '',
        note: '',
      },
    ])
  }
  const removeAdjustment = (id: string) => {
    setAdjustments((prev) => prev.filter((a) => a.id !== id))
  }
  const updateAdjustment = (id: string, patch: Partial<AdjustmentFormItem>) => {
    setAdjustments((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  const handleCreateNewItem = async (name: string) => {
    const created = await createPurchaseItem(name)
    await queryClient.invalidateQueries({ queryKey: ['purchase-items'] })
    return { id: created.id, name: created.name }
  }

  // Mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      setStatusText('')
      if (!supplierId) throw new Error('Please select a supplier.')
      if (!date) throw new Error('Bill date is required.')

      const validLines = parsedLines.filter((l) => l.itemName.trim() && l.weightG > 0 && l.rateMilli > 0)
      if (validLines.length === 0) {
        throw new Error('Enter at least one item line with valid weight and rate.')
      }

      const memoBagsKg = parseFloat(bagsAtReceiptStr)
      const fullNote = formatPrivateNoteWithBags(privateNote, !isNaN(memoBagsKg) && memoBagsKg > 0 ? memoBagsKg : null)

      if (editBillId) {
        const payload: PurchaseBillUpdateInput = {
          supplierId,
          supplierBillNo: supplierBillNo.trim(),
          date,
          pool,
          taxMode,
          gstRateBp: taxMode === 'none' ? 0 : percentToBasisPoints(gstRatePercent),
          vehicleNo: vehicleNo.trim(),
          privateNote: fullNote,
          photos: photos.length > 0 ? photos : undefined,
          lines: validLines.map((l) => ({
            id: l.id,
            itemId: l.itemId || undefined,
            itemName: l.itemName.trim(),
            weightG: l.weightG,
            rateMilli: l.rateMilli,
            amountPaise: l.amountPaise,
          })),
          adjustments: parsedAdjustments
            .filter((a) => a.amountPaise !== 0)
            .map((a) => ({
              type: a.type,
              amountPaise: a.amountPaise,
              note: a.note.trim(),
            })),
        }
        return await updatePurchaseBill(editBillId, payload)
      } else {
        const payload: PurchaseBillCreateInput = {
          supplierId,
          inNo: inNoPreview,
          supplierBillNo: supplierBillNo.trim(),
          date,
          pool,
          taxMode,
          gstRateBp: taxMode === 'none' ? 0 : percentToBasisPoints(gstRatePercent),
          vehicleNo: vehicleNo.trim(),
          privateNote: fullNote,
          photos: photos.length > 0 ? photos : undefined,
          lines: validLines.map((l) => ({
            itemId: l.itemId || undefined,
            itemName: l.itemName.trim(),
            weightG: l.weightG,
            rateMilli: l.rateMilli,
            amountPaise: l.amountPaise,
          })),
          adjustments: parsedAdjustments
            .filter((a) => a.amountPaise !== 0)
            .map((a) => ({
              type: a.type,
              amountPaise: a.amountPaise,
              note: a.note.trim(),
            })),
        }
        return await createPurchaseBill(payload)
      }
    },
    onSuccess: async (savedBill) => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
      await queryClient.invalidateQueries({ queryKey: ['purchase-bills'] })
      void navigate({
        to: '/supplier-ledger/$supplierId',
        params: { supplierId },
        search: { highlightBill: savedBill.id },
      })
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  // Keyboard shortcut Ctrl+Enter to save
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!saveMutation.isPending) {
          saveMutation.mutate()
        }
      }
    },
    [saveMutation],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="w-full space-y-4 px-3 pb-16 pt-3 sm:px-4 lg:px-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <h1 className="text-base font-bold text-slate-900">
            {editBillId ? `Edit Purchase Bill (${inNoPreview})` : 'New Purchase Bill'}
          </h1>
          {inNoPreview && (
            <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 font-mono text-xs font-bold text-blue-700 ring-1 ring-blue-100">
              <FileText size={12} /> {inNoPreview}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-slate-400 sm:inline">Press Ctrl+Enter to save</span>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving...' : editBillId ? 'Update Bill' : 'Save Bill'}
          </button>
        </div>
      </div>

      {hasManualAllocationsWarning && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertCircle size={16} className="shrink-0 text-amber-600" />
          <span>
            <strong>Warning:</strong> This bill has manual payment allocations assigned. Editing quantities or totals
            will modify remaining dues.
          </span>
        </div>
      )}

      {statusText && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {statusText}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Main Entry Lane (2 cols on large screen) */}
        <div className="space-y-4 lg:col-span-2">
          {/* Bill Meta Form */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-semibold text-slate-700">
                  Supplier <span className="text-rose-600">*</span>
                </label>
                <SearchableCombobox
                  options={supplierOptions}
                  value={supplierId}
                  onChange={setSupplierId}
                  inputClassName="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  placeholder="Search supplier..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Bill Date</label>
                <DateInput
                  value={date}
                  onChange={setDate}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Pool</label>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    disabled={poolLocked}
                    title={poolLocked ? 'Pool is locked: this bill has bardan advance entries tied to its pool.' : undefined}
                    className={`rounded-md py-1.5 transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      pool === 'kacha' ? 'bg-amber-100 text-amber-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                    onClick={() => handlePoolChange('kacha')}
                  >
                    Kacha
                  </button>
                  <button
                    type="button"
                    disabled={poolLocked}
                    title={poolLocked ? 'Pool is locked: this bill has bardan advance entries tied to its pool.' : undefined}
                    className={`rounded-md py-1.5 transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      pool === 'gst' ? 'bg-blue-100 text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                    onClick={() => handlePoolChange('gst')}
                  >
                    GST
                  </button>
                </div>
                {poolLocked && (
                  <p className="text-[10px] text-amber-700">Locked: bardan advance entries are tied to this pool.</p>
                )}
              </div>
            </div>

            {/* Tax Mode and GST Fields (only for GST pool) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {pool === 'gst' ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">Tax Mode</label>
                    <select
                      value={taxMode}
                      onChange={(e) => setTaxMode(e.target.value as PurchaseTaxMode)}
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="gst">GST (Forward Charge)</option>
                      <option value="rcm">RCM (Reverse Charge)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">GST Rate (%)</label>
                    <select
                      value={gstRatePercent}
                      onChange={(e) => setGstRatePercent(Number(e.target.value))}
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    >
                      <option value={5}>5%</option>
                      <option value={12}>12%</option>
                      <option value={18}>18% (Standard Brass)</option>
                      <option value={28}>28%</option>
                    </select>
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-400">Tax Mode</label>
                  <div className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    None (Kacha pool has 0% tax)
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Supplier Invoice No</label>
                <input
                  type="text"
                  placeholder="e.g. INV-1049"
                  value={supplierBillNo}
                  onChange={(e) => setSupplierBillNo(e.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Vehicle No</label>
                <input
                  type="text"
                  placeholder="GJ-10-XX-0000"
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Bags at Receipt (kg memo)</label>
                <input
                  type="text"
                  placeholder="e.g. 15.500"
                  value={bagsAtReceiptStr}
                  onChange={(e) => setBagsAtReceiptStr(e.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
          </section>

          {/* Line Items Table */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Material Items</h2>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                <Plus size={14} /> Add Row
              </button>
            </div>

            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="px-3 py-2 text-left w-10">#</th>
                    <th className="px-3 py-2 text-left min-w-[220px]">Item</th>
                    <th className="px-3 py-2 text-right w-32">Weight (kg)</th>
                    <th className="px-3 py-2 text-right w-36">Rate (₹/kg)</th>
                    <th className="px-3 py-2 text-right w-44">Amount</th>
                    <th className="px-3 py-2 text-center w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, index) => {
                    const parsed = parsedLines[index]
                    const diffMilli = currentVilaityMilli ? parsed.rateMilli - currentVilaityMilli : null

                    return (
                      <tr key={l.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2 text-slate-400 font-mono">{index + 1}</td>
                        <td className="px-3 py-2">
                          <ItemDropdownCell
                            items={activeItems}
                            selectedItemName={l.itemName}
                            onSelect={(item) => updateLine(l.id, { itemId: item.id, itemName: item.name })}
                            onNext={() => {
                              const nextInput = document.getElementById(`weight-${l.id}`)
                              if (nextInput) (nextInput as HTMLInputElement).focus()
                            }}
                            onCreateItem={handleCreateNewItem}
                          />

                          {currentVilaityMilli != null && diffMilli != null && parsed.rateMilli > 0 && (
                            <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 border border-amber-200/60">
                              <Lock size={10} />
                              <span>Vilaity ₹{milliToRateText(currentVilaityMilli)}</span>
                              <span>
                                ({diffMilli >= 0 ? '+' : '-'}₹{milliToRateText(Math.abs(diffMilli))})
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            id={`weight-${l.id}`}
                            type="text"
                            placeholder="0.000"
                            value={l.weightKgStr}
                            onChange={(e) => updateLine(l.id, { weightKgStr: e.target.value })}
                            className="h-8 w-full rounded border border-slate-300 px-2 text-right font-mono text-xs text-slate-900 outline-none focus:border-blue-400"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="text"
                            placeholder="0.000"
                            value={l.rateRupeesStr}
                            onChange={(e) => updateLine(l.id, { rateRupeesStr: e.target.value })}
                            className="h-8 w-full rounded border border-slate-300 px-2 text-right font-mono text-xs text-slate-900 outline-none focus:border-blue-400"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-800">
                          {formatPaiseInr(parsed.amountPaise)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(l.id)}
                            disabled={lines.length === 1}
                            className="text-slate-400 hover:text-rose-600 disabled:opacity-20"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600"
              >
                <Plus size={13} /> Add Another Material Line
              </button>
            </div>
          </section>

          {/* Adjustments */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Adjustments</h2>
                <p className="text-[11px] text-slate-400">Labour, transport, quality deductions, or other adjustments</p>
              </div>
              <button
                type="button"
                onClick={addAdjustment}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                <Plus size={14} /> Add Adjustment
              </button>
            </div>

            {adjustments.length === 0 ? (
              <p className="py-2 text-xs italic text-slate-400">No adjustments added for this bill.</p>
            ) : (
              <div className="space-y-2">
                {adjustments.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2 text-xs">
                    <select
                      value={a.type}
                      onChange={(e) => updateAdjustment(a.id, { type: e.target.value as PurchaseAdjustmentType })}
                      className="h-8 rounded border border-slate-300 bg-white px-2 font-medium text-slate-800 outline-none"
                    >
                      <option value="labour">Labour (+)</option>
                      <option value="transport">Transport (+)</option>
                      <option value="quality_cut">Quality Cut (Deduction -)</option>
                      <option value="other">Other (+ / -)</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Amount ₹ (e.g. 500 or -200)"
                      value={a.amountRupeesStr}
                      onChange={(e) => updateAdjustment(a.id, { amountRupeesStr: e.target.value })}
                      className="h-8 w-32 rounded border border-slate-300 bg-white px-2 font-mono text-slate-900 outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Note / remark"
                      value={a.note}
                      onChange={(e) => updateAdjustment(a.id, { note: e.target.value })}
                      className="h-8 flex-1 min-w-[140px] rounded border border-slate-300 bg-white px-2 text-slate-900 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeAdjustment(a.id)}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Private Notes & Photo Attach */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Internal Slip & Notes</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Private Note (Never Printed)</label>
                <textarea
                  rows={3}
                  placeholder="Internal memo, delivery instructions, quality notes..."
                  value={privateNote}
                  onChange={(e) => setPrivateNote(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs text-slate-900 outline-none focus:border-blue-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Attach Photos / Slips (Internal)</label>
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-center">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50">
                    <Upload size={13} />
                    <span>Choose Photos</span>
                    <input
                      type="file"
                      multiple
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? [])
                        if (files.length > 0) setPhotos((prev) => [...prev, ...files])
                      }}
                    />
                  </label>
                  <p className="mt-1 text-[10px] text-slate-400">Slips, weighbridge receipts, or brass photos</p>
                </div>

                {photos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {photos.map((f, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                      >
                        <ImageIcon size={11} /> {f.name}
                        <button
                          type="button"
                          onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-slate-400 hover:text-rose-600"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Right Lane: Supplier Context Side Panel & Calculation Card */}
        <div className="space-y-4">
          {/* Live Preview Summary Card */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Payable Summary</h2>

            <div className="space-y-2 border-b border-slate-100 pb-3 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Total Weight</span>
                <span className="font-mono font-bold text-slate-900">{gramsToKgText(totalWeightG)} kg</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Average Rate</span>
                <span className="font-mono font-medium text-slate-800">
                  {avgRateRupees > 0 ? `₹${avgRateRupees.toFixed(2)}/kg` : '—'}
                </span>
              </div>

              {totalPremiumPaise != null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-800">
                    <Lock size={11} /> Premium vs Vilaity (internal):
                  </span>
                  <span
                    className={`font-mono font-semibold ${
                      totalPremiumPaise >= 0 ? 'text-amber-800' : 'text-blue-800'
                    }`}
                  >
                    {totalPremiumPaise >= 0 ? '+' : '-'}
                    {formatPaiseInr(Math.abs(totalPremiumPaise))}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-slate-600">
                <span>Taxable Material</span>
                <span className="font-mono tabular-nums text-slate-900">{formatPaiseInr(billNet.taxablePaise)}</span>
              </div>

              {taxMode === 'gst' && (
                <div className="flex justify-between text-slate-600">
                  <span>GST ({gstRatePercent}%)</span>
                  <span className="font-mono tabular-nums text-blue-700">+{formatPaiseInr(billNet.taxPaise)}</span>
                </div>
              )}

              {taxMode === 'rcm' && (
                <div className="rounded bg-amber-50 p-1.5 text-[11px] text-amber-800">
                  <div className="flex justify-between font-medium">
                    <span>RCM Liability ({gstRatePercent}%)</span>
                    <span className="font-mono">{formatPaiseInr(billNet.rcmLiabilityPaise)}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-amber-700">Our liability — not added to supplier payable.</p>
                </div>
              )}

              {billNet.qualityCutPaise > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Quality Cut (Deduction)</span>
                  <span className="font-mono tabular-nums text-rose-700">
                    -{formatPaiseInr(billNet.qualityCutPaise)}
                  </span>
                </div>
              )}

              {billNet.otherAdjustmentsPaise !== 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Other Adjustments Net</span>
                  <span className="font-mono tabular-nums">
                    {billNet.otherAdjustmentsPaise > 0 ? '+' : ''}
                    {formatPaiseInr(billNet.otherAdjustmentsPaise)}
                  </span>
                </div>
              )}

              {billNet.roundOffPaise !== 0 && (
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Auto Round-off</span>
                  <span className="font-mono tabular-nums">
                    {billNet.roundOffPaise > 0 ? '+' : ''}
                    {formatPaiseInr(billNet.roundOffPaise)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-baseline justify-between pt-1">
              <span className="text-xs font-bold uppercase text-slate-700">Net Payable</span>
              <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                {formatPaiseInr(billNet.netPaise)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="mt-2 w-full rounded-lg bg-blue-600 py-2.5 text-center text-xs font-bold text-white shadow hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving...' : editBillId ? 'Update Bill' : 'Save Bill (Ctrl+Enter)'}
            </button>
          </section>

          {/* Supplier Context Side Panel */}
          {supplierId ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <Building2 size={14} className="text-blue-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Supplier Context</h3>
              </div>

              {supplierBundleQuery.isLoading ? (
                <p className="text-xs text-slate-400">Loading supplier data...</p>
              ) : supplierContext ? (
                <div className="space-y-3 text-xs">
                  {/* Account position */}
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2.5">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Kacha Due</span>
                      <p className="font-mono font-bold text-amber-700">
                        {formatPaiseInr(supplierContext.kachaDuePaise)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">GST Due</span>
                      <p className="font-mono font-bold text-blue-700">
                        {formatPaiseInr(supplierContext.gstDuePaise)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Advance</span>
                      <p className="font-mono font-bold text-emerald-700">
                        {formatPaiseInr(supplierContext.advancePaise)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Bardan Pending</span>
                      <p className="font-mono font-bold text-slate-800">
                        {supplierContext.bardanPendingCount} bills
                      </p>
                    </div>
                  </div>

                  {/* Benchmark Vilaity rate */}
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-amber-900">Today's Vilaity</span>
                      <span className="font-mono font-bold text-amber-950">
                        {currentVilaityMilli != null ? `₹${milliToRateText(currentVilaityMilli)}/kg` : '—'}
                      </span>
                    </div>
                    <p className="text-[10px] text-amber-700">
                      {vilaityBenchmark.isFallback ? (
                        <>Fallback date: {formatFullDate(vilaityBenchmark.date)}</>
                      ) : (
                        <>Exact benchmark for {formatFullDate(date)}</>
                      )}
                    </p>
                  </div>

                  {/* Last 3 rates per item for this supplier */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
                      <Clock size={12} />
                      <span>Last 3 Rates Paid (This Supplier)</span>
                    </div>

                    {supplierContext.itemRates.length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">No previous purchase lines found.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {supplierContext.itemRates.map((it) => (
                          <div key={it.itemName} className="rounded border border-slate-100 bg-slate-50/80 p-1.5">
                            <span className="font-semibold text-slate-800">{it.itemName}</span>
                            <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                              {it.rates.map((r, i) => (
                                <span key={i} className="rounded bg-white px-1.5 py-0.5 font-mono text-slate-700 ring-1 ring-slate-200">
                                  ₹{milliToRateText(r.rateMilli)} ({r.date.slice(5)})
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
              Select a supplier to see their current dues, advance, and historical rates.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
