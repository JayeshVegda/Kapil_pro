import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  FileText,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import {
  createPurchaseBill,
  getNextPurchaseInNo,
  listPurchaseItems,
  listSuppliers,
  loadPurchaseBill,
  loadVilaityHistory,
  updatePurchaseBill,
  type PurchaseBillCreateInput,
  type PurchaseBillUpdateInput,
} from '@/data/suppliers'
import {
  computeBillNet,
  type PurchaseAdjustmentType,
  type PurchaseTaxMode,
} from '@/domain/supplier-purchases'
import {
  kgToGrams,
  lineAmountPaise,
  milliToRateText,
  percentToBasisPoints,
  rateToMilli,
  rupeesToPaise,
} from '@/domain/supplier-units'
import { getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

const searchSchema = z.object({
  supplierId: z.string().optional(),
  editBillId: z.string().optional(),
})

export const Route = createFileRoute('/purchase-bills/new')({
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

function findVilaityForDate(
  history: Array<{ date: string; vilaityMilli: number }>,
  targetDate: string,
): number | null {
  if (!history || history.length === 0) return null
  const exact = history.find((h) => h.date === targetDate)
  if (exact) return exact.vilaityMilli
  const earlier = history.filter((h) => h.date < targetDate)
  if (earlier.length > 0) return earlier[earlier.length - 1].vilaityMilli
  return history[0]?.vilaityMilli ?? null
}

function NewPurchaseBillPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { supplierId: initialSupplierId, editBillId } = Route.useSearch()

  const [supplierId, setSupplierId] = useState(initialSupplierId ?? '')
  const [date, setDate] = useState(() => getLocalIsoDate())
  const [pool, setPool] = useState<'kacha' | 'gst'>('kacha')
  const [taxMode, setTaxMode] = useState<PurchaseTaxMode>('none')
  const [gstRatePercent, setGstRatePercent] = useState<number>(18)
  const [supplierBillNo, setSupplierBillNo] = useState('')
  const [vehicleNo, setVehicleNo] = useState('')
  const [privateNote, setPrivateNote] = useState('')
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

  const vilaityQuery = useQuery({
    queryKey: ['vilaity-history'],
    queryFn: loadVilaityHistory,
  })

  const editBillQuery = useQuery({
    queryKey: ['purchase-bill-edit', editBillId],
    queryFn: () => (editBillId ? loadPurchaseBill(editBillId) : null),
    enabled: Boolean(editBillId),
  })

  // Pre-fill if editing
  useEffect(() => {
    if (!editBillQuery.data) return
    const { bill, lines: billLines, adjustments: billAdjs, allocations } = editBillQuery.data
    setSupplierId(bill.supplierId)
    setDate(bill.date)
    setPool(bill.pool)
    setTaxMode(bill.taxMode as PurchaseTaxMode)
    setGstRatePercent(bill.gstRateBp ? bill.gstRateBp / 100 : 18)
    setSupplierBillNo(bill.supplierBillNo ?? '')
    setVehicleNo(bill.vehicleNo ?? '')
    setPrivateNote(bill.privateNote ?? '')
    setInNoPreview(bill.inNo)

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

  // When switching pool, adjust taxMode default
  const handlePoolChange = (nextPool: 'kacha' | 'gst') => {
    setPool(nextPool)
    if (nextPool === 'kacha' && taxMode !== 'none') {
      setTaxMode('none')
    } else if (nextPool === 'gst' && taxMode === 'none') {
      setTaxMode('gst')
    }
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
  const currentVilaityMilli = useMemo(() => {
    return findVilaityForDate(vilaityQuery.data ?? [], date)
  }, [vilaityQuery.data, date])

  const supplierOptions = useMemo(() => {
    return (suppliersQuery.data ?? []).map((s) => ({
      id: s.id,
      name: s.companyName,
      suffix: s.city ? `(${s.city})` : undefined,
    }))
  }, [suppliersQuery.data])

  const itemOptions = useMemo(() => {
    return (itemsQuery.data ?? []).map((it) => ({
      id: it.id,
      name: it.name,
    }))
  }, [itemsQuery.data])

  // Line item manipulation
  const updateLine = (id: string, patch: Partial<LineFormItem>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  const addLine = () => {
    setLines((prev) => [...prev, defaultLine()])
  }

  const removeLine = (id: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev))
  }

  // Adjustment manipulation
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

  // Mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error('Please select a supplier.')
      const validLines = parsedLines.filter((l) => l.weightG > 0 && l.rateMilli > 0 && l.itemName.trim())
      if (validLines.length === 0) {
        throw new Error('At least one valid line item with weight and rate is required.')
      }

      const gstRateBp = taxMode === 'none' ? 0 : percentToBasisPoints(gstRatePercent)

      if (editBillId) {
        const payload: PurchaseBillUpdateInput = {
          supplierId,
          supplierBillNo: supplierBillNo.trim(),
          date,
          pool,
          taxMode,
          gstRateBp,
          vehicleNo: vehicleNo.trim(),
          privateNote: privateNote.trim(),
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
        return await updatePurchaseBill(editBillId, payload)
      } else {
        const payload: PurchaseBillCreateInput = {
          supplierId,
          inNo: inNoPreview,
          supplierBillNo: supplierBillNo.trim(),
          date,
          pool,
          taxMode,
          gstRateBp,
          vehicleNo: vehicleNo.trim(),
          privateNote: privateNote.trim(),
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
    onSuccess: async () => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
      await queryClient.invalidateQueries({ queryKey: ['purchase-bills'] })
      void navigate({
        to: '/supplier-ledger/$supplierId',
        params: { supplierId },
      })
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  // Keyboard shortcut Ctrl+Enter to save
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        saveMutation.mutate()
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
                className={`rounded-md py-1.5 transition ${
                  pool === 'kacha' ? 'bg-amber-100 text-amber-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => handlePoolChange('kacha')}
              >
                Kacha
              </button>
              <button
                type="button"
                className={`rounded-md py-1.5 transition ${
                  pool === 'gst' ? 'bg-blue-100 text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => handlePoolChange('gst')}
              >
                GST
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Tax Mode</label>
            <select
              value={taxMode}
              onChange={(e) => setTaxMode(e.target.value as PurchaseTaxMode)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="none">None (0%)</option>
              <option value="gst">GST (Forward Charge)</option>
              <option value="rcm">RCM (Reverse Charge)</option>
            </select>
          </div>

          {taxMode !== 'none' && (
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
        </div>
      </section>

      {/* Lines Table */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Raw Material Lines ({lines.length})
          </h2>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
          >
            <Plus size={13} /> Add Row
          </button>
        </div>

        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
              <tr>
                <th className="px-3 py-2 text-left w-10">#</th>
                <th className="px-3 py-2 text-left min-w-[200px]">Item Description</th>
                <th className="px-3 py-2 text-right w-36">Weight (kg)</th>
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
                      <div className="space-y-1">
                        <input
                          type="text"
                          placeholder="e.g. Brass Honey, Chol, Pata..."
                          value={l.itemName}
                          onChange={(e) => updateLine(l.id, { itemName: e.target.value })}
                          list="items-datalist"
                          className="h-8 w-full rounded border border-slate-300 px-2 text-xs font-medium text-slate-900 outline-none focus:border-blue-400"
                        />
                        <datalist id="items-datalist">
                          {itemOptions.map((it) => (
                            <option key={it.id} value={it.name} />
                          ))}
                        </datalist>

                        {currentVilaityMilli != null && diffMilli != null && parsed.rateMilli > 0 && (
                          <div className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 border border-amber-200/60">
                            <Lock size={10} />
                            <span>Vilaity ₹{milliToRateText(currentVilaityMilli)}</span>
                            <span>
                              ({diffMilli >= 0 ? '+' : '-'}₹{milliToRateText(Math.abs(diffMilli))})
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
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
                        className="text-slate-400 hover:text-rose-600"
                        title="Remove row"
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
      </section>

      {/* Adjustments & Live Preview Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Adjustments */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Adjustments</h2>
            <button
              type="button"
              onClick={addAdjustment}
              className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            >
              <Plus size={13} /> Add Adjustment
            </button>
          </div>

          {adjustments.length === 0 && (
            <p className="text-xs text-slate-400 italic">No adjustments (labour, transport, quality cut).</p>
          )}

          <div className="space-y-2">
            {adjustments.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <select
                  value={a.type}
                  onChange={(e) => updateAdjustment(a.id, { type: e.target.value as PurchaseAdjustmentType })}
                  className="h-8 rounded border border-slate-300 bg-white px-2 text-xs text-slate-800"
                >
                  <option value="labour">Labour (+)</option>
                  <option value="transport">Transport (+)</option>
                  <option value="quality_cut">Quality Cut (-)</option>
                  <option value="other">Other (+/-)</option>
                </select>

                <input
                  type="text"
                  placeholder="₹ amount"
                  value={a.amountRupeesStr}
                  onChange={(e) => updateAdjustment(a.id, { amountRupeesStr: e.target.value })}
                  className="h-8 w-28 rounded border border-slate-300 bg-white px-2 text-right font-mono text-xs text-slate-900"
                />

                <input
                  type="text"
                  placeholder="Note"
                  value={a.note}
                  onChange={(e) => updateAdjustment(a.id, { note: e.target.value })}
                  className="h-8 flex-1 rounded border border-slate-300 bg-white px-2 text-xs text-slate-900"
                />

                <button
                  type="button"
                  onClick={() => removeAdjustment(a.id)}
                  className="p-1 text-slate-400 hover:text-rose-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Live Calculation Preview */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Bill Live Preview</h2>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
            <div className="flex justify-between text-slate-600">
              <span>Lines Total:</span>
              <span className="font-mono font-semibold">{formatPaiseInr(billNet.linesTotalPaise)}</span>
            </div>

            {billNet.qualityCutPaise > 0 && (
              <div className="flex justify-between text-rose-700 font-medium">
                <span>Quality Cut (Deduction):</span>
                <span className="font-mono">-{formatPaiseInr(billNet.qualityCutPaise)}</span>
              </div>
            )}

            <div className="flex justify-between text-slate-700 font-semibold border-t border-slate-200 pt-1.5">
              <span>Taxable Value:</span>
              <span className="font-mono">{formatPaiseInr(billNet.taxablePaise)}</span>
            </div>

            {taxMode === 'gst' && (
              <div className="flex justify-between text-blue-700 font-medium">
                <span>GST Tax ({gstRatePercent}%):</span>
                <span className="font-mono">+{formatPaiseInr(billNet.taxPaise)}</span>
              </div>
            )}

            {taxMode === 'rcm' && (
              <div className="flex justify-between text-amber-700 font-medium">
                <span>
                  RCM Tax ({gstRatePercent}%):{' '}
                  <span className="text-[10px] text-amber-600">(our liability, not added)</span>
                </span>
                <span className="font-mono">{formatPaiseInr(billNet.taxPaise)}</span>
              </div>
            )}

            {billNet.otherAdjustmentsPaise !== 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Other Adjustments:</span>
                <span className="font-mono font-semibold">
                  {billNet.otherAdjustmentsPaise > 0 ? '+' : ''}
                  {formatPaiseInr(billNet.otherAdjustmentsPaise)}
                </span>
              </div>
            )}

            {billNet.roundOffPaise !== 0 && (
              <div className="flex justify-between text-slate-500 text-[11px]">
                <span>Auto Round-off (Domain):</span>
                <span className="font-mono">
                  {billNet.roundOffPaise > 0 ? '+' : ''}
                  {formatPaiseInr(billNet.roundOffPaise)}
                </span>
              </div>
            )}

            <div className="flex justify-between text-base font-bold text-slate-900 border-t-2 border-slate-300 pt-2">
              <span>Net Payable:</span>
              <span className="font-mono text-blue-700">{formatPaiseInr(billNet.netPaise)}</span>
            </div>
          </div>
        </section>
      </div>

      {/* Private Notes Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <Lock size={12} className="text-slate-400" />
          <span>Private Notes (Internal Only — never printed or exported)</span>
        </label>
        <textarea
          rows={2}
          placeholder="Private remark for internal record..."
          value={privateNote}
          onChange={(e) => setPrivateNote(e.target.value)}
          className="w-full rounded-md border border-slate-300 p-2 text-xs text-slate-900 outline-none focus:border-blue-400"
        />
      </section>
    </div>
  )
}
