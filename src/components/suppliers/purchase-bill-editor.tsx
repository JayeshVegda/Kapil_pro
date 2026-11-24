/**
 * PurchaseBillEditor — the single full purchase bill editor (create and edit).
 * Page variant (used by `/new-purchase-bill`): form pane + live chitty preview pane.
 * Modal variant (used by Purchase Bills and Purchase Logs): the same form, centered
 * in a dialog, without the preview pane. This is the only implementation of purchase
 * bill entry; the do-not-drift rules are the integer paise/milli/grams calculations
 * and the day-payment flow, which live here and nowhere else.
 */
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Building2,
  ChevronDown,
  Image as ImageIcon,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Panel } from '@/components/ui/panel'
import { PaymentAmountInput } from '@/components/ui/payment-amount-input'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { BillChitty, formatChittyRate, type BillChittyData } from '@/components/suppliers/bill-chitty'
import { hasPurchasePaymentNote, purchaseChittyAdvance, purchaseChittyCreditLabel } from '@/components/suppliers/purchase-bill-presentation'
import {
  bundleToSettlementInput,
  createPurchaseBill,
  createPurchaseItem,
  getNextPurchaseInNo,
  listPurchaseItems,
  loadVilaityHistory,
  updatePurchaseBill,
  type PurchaseBillCreateInput,
  type PurchaseBillUpdateInput,
  type PurchaseItemView,
  type SupplierBundle,
} from '@/data/suppliers'
import { purchaseBillQueryOptions, purchaseBillsQueryOptions, supplierBundleQueryOptions, supplierListQueryOptions } from '@/data/purchase-queries'
import { isBrassBenchmarkItem } from '@/domain/purchase-market-benchmark'
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
import { SUPPLIER_PAYMENT_MODES, supplierPaymentNeedsReference, type SupplierPaymentMode } from '@/domain/supplier-payment-modes'
import { purchaseReceiptBagCount, purchaseReceiptMemoText } from '@/domain/purchase-receipt-memos'
import {
  gramsToKgText,
  milliToRateText,
  paiseToRupeesText,
  percentToBasisPoints,
} from '@/domain/supplier-units'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'
import { buttonClass, inputClass } from '@/components/ui/form-control-classes'
import { loadPurchaseBillDraft, requireEditablePurchaseBillDraft } from '@/data/purchase-bill-drafts'
import { calculateDraftLinePaise, matchPurchaseMaster, parsePurchaseDecimal } from '@/domain/purchase-bill-draft'

type LineFormItem = {
  id: string
  itemId?: string
  itemName: string
  bardanStr: string
  weightKgStr: string
  rateRupeesStr: string
}

type AdjustmentFormItem = {
  id: string
  type: PurchaseAdjustmentType
  amountRupeesStr: string
  note: string
}

type DraftBardanFormItem = {
  id: string
  weightKgStr: string
  rateRupeesStr: string
  rateLineIndex?: number
  rateLineKey?: string
  method: 'deduct' | 'in_kind' | 'cash_back' | 'advance'
  creditRupeesStr: string
  cashRupeesStr: string
  date: string
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
    bardanStr: '',
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
  return { milli: null, date: targetDate, isFallback: false }
}

function ItemDropdownCell({
  items,
  selectedItemName,
  onSelect,
  onNext,
  onCreateItem,
  inputId,
}: {
  items: PurchaseItemView[]
  selectedItemName: string
  onSelect: (item: { id: string; name: string }) => void
  onNext: () => void
  onCreateItem?: (name: string) => Promise<{ id: string; name: string }>
  inputId?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState(selectedItemName)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQuery(selectedItemName)
  }, [selectedItemName])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    // When query is empty or matches the already-selected item, show all items so the user can easily pick/switch
    if (!q || q === selectedItemName.trim().toLowerCase()) return items
    return items.filter((it) => it.name.toLowerCase().includes(q))
  }, [items, query, selectedItemName])

  const exactMatchExists = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.some((it) => it.name.toLowerCase() === q)
  }, [items, query])

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
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
    onNext()
  }

  const handleCreateNew = async (name: string) => {
    const clean = name.trim()
    if (!clean || isCreating || !onCreateItem) return
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
      } else if (query.trim() && !exactMatchExists && onCreateItem) {
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
          id={inputId}
          name={inputId}
          placeholder="Select or search item…"
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
          className="h-8 w-full rounded border border-slate-300 px-2 text-xs font-medium text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
        />
      </div>

      {isOpen && (
        <div className="absolute left-0 z-50 mt-1 max-h-56 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">

          {filteredItems.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-400">
              No matching item found.
              {query.trim() && !exactMatchExists && onCreateItem && (
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

type DraftSnapshot = {
  supplierId: string
  date: string
  pool: SupplierPool
  taxMode: PurchaseTaxMode
  gstRatePercent: number
  supplierBillNo: string
  vehicleNo: string
  bagsAtReceiptStr: string
  privateNote: string
  lines: LineFormItem[]
  adjustments: AdjustmentFormItem[]
}

function blankLine(): LineFormItem {
  return { id: 'blank', itemId: '', itemName: '', bardanStr: '', weightKgStr: '', rateRupeesStr: '' }
}

/** Serialise only user-entered content — ids are ignored so editing keystrokes are the only signal. */
function snapshotDraft(d: DraftSnapshot): string {
  return JSON.stringify({
    s: d.supplierId,
    d: d.date,
    p: d.pool,
    tm: d.taxMode,
    g: d.gstRatePercent,
    sb: d.supplierBillNo.trim(),
    v: d.vehicleNo.trim(),
    b: d.bagsAtReceiptStr.trim(),
    n: d.privateNote.trim(),
    l: d.lines.map((l) => [l.itemId ?? '', l.itemName.trim(), l.bardanStr ?? '', l.weightKgStr, l.rateRupeesStr]),
    a: d.adjustments.map((a) => [a.type, a.amountRupeesStr, a.note.trim()]),
  })
}

/** Rate vs Jamnagar market: red above, green below, grey equal. Milli-rupees in, two-decimal ₹/kg out. */
function MktDeltaBadge({ rateMilli, marketMilli }: { rateMilli: number; marketMilli: number | null | undefined }) {
  if (marketMilli == null || rateMilli <= 0) {
    return null
  }
  const diffMilli = rateMilli - marketMilli
  const EPS = 5 // below half a paisa of the market rate counts as equal for display
  const equal = Math.abs(diffMilli) < EPS
  const tone = equal
    ? 'border-slate-200 bg-slate-100 text-slate-500'
    : diffMilli > 0
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  const text = equal ? '0.00' : `${diffMilli > 0 ? '+' : ''}${(diffMilli / 1000).toFixed(2)}`
  const title = `Rate ${formatChittyRate(rateMilli)}/kg vs Brass market ${formatChittyRate(marketMilli)}/kg`
  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex w-16 items-center justify-center rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${tone}`}
    >
      {text}
    </span>
  )
}

function findLastRateForItem(
  bundle: SupplierBundle | null | undefined,
  itemId?: string,
  itemName?: string,
): { rateRupees: number; date: string } | null {
  if (!bundle || (!itemId && !itemName)) return null
  const itemNeedle = itemName?.trim().toLowerCase()
  const matching = bundle.lines.filter(
    (l) => (itemId && l.itemId === itemId) || (itemNeedle && l.itemName.trim().toLowerCase() === itemNeedle),
  )
  if (matching.length === 0) return null
  const billMap = new Map(bundle.bills.map((b) => [b.id, b]))
  const sorted = [...matching].sort((a, b) => {
    const billA = billMap.get(a.billId)
    const billB = billMap.get(b.billId)
    const dateA = billA ? `${billA.date}|${billA.created}` : ''
    const dateB = billB ? `${billB.date}|${billB.created}` : ''
    return dateB.localeCompare(dateA)
  })
  const latest = sorted[0]
  if (!latest || latest.rateMilli <= 0) return null
  const bill = billMap.get(latest.billId)
  return {
    rateRupees: latest.rateMilli / 1000,
    date: bill?.date ?? '',
  }
}

type RecentPurchaseBill = {
  id: string
  inNo: string
  supplierName: string
  totalKg: number
  netPaise: number
  date: string
}

function LaunchpadCard({
  recentBills,
}: {
  recentBills: RecentPurchaseBill[]
}) {
  return (
    <section aria-label="Recent purchases" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2"><h2 className="text-sm font-semibold text-slate-900">Recent purchases</h2><span className="text-xs text-slate-500">Use the latest weight and spend as a reference</span></div>
      {recentBills.length > 0 ? (
        <div className="mt-2">
          <ul className="mt-1.5 divide-y divide-border/60 text-xs">
            {recentBills.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-1">
                <span className="min-w-0 truncate">
                  <span className="font-mono font-bold text-blue-700">{b.inNo}</span>
                  <span className="mx-1 text-muted-foreground">·</span>
                  <span className="text-foreground">{b.supplierName}</span>
                  {b.date && (
                    <>
                      <span className="mx-1 text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{formatFullDate(b.date)}</span>
                    </>
                  )}
                </span>
                <span className="ml-2 shrink-0 text-right font-mono text-[11px] tabular-nums text-foreground">
                  {b.totalKg.toFixed(1)} kg · {formatPaiseInr(b.netPaise)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="mt-2 text-xs text-slate-500">Choose a supplier and enter the first bill.</p>}
    </section>
  )
}

export type PurchaseBillEditorProps = {
  variant?: 'page' | 'modal'
  initialSupplierId?: string
  editBillId?: string
  draftId?: string
  onSaved?: (saved: { id: string; inNo: string }) => void
  onDiscard?: () => void
  onDirtyChange?: (dirty: boolean) => void
}

export function PurchaseBillEditor({ variant = 'page', initialSupplierId = '', editBillId, draftId, onSaved, onDiscard, onDirtyChange }: PurchaseBillEditorProps) {
  const isPage = variant === 'page'
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [supplierId, setSupplierId] = useState(initialSupplierId)
  const [date, setDate] = useState(() => getLocalIsoDate())
  const [pool, setPool] = useState<SupplierPool>('kacha')
  const [taxMode, setTaxMode] = useState<PurchaseTaxMode>('none')
  const [gstRatePercent, setGstRatePercent] = useState<number>(18)
  const [supplierBillNo, setSupplierBillNo] = useState('')
  const [vehicleNo, setVehicleNo] = useState('')
  const [bagsAtReceiptStr, setBagsAtReceiptStr] = useState('')
  const [privateNote, setPrivateNote] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [paymentAmountRupees, setPaymentAmountRupees] = useState<number>(0)
  const [draftPaymentStr, setDraftPaymentStr] = useState('')
  const [paymentMode, setPaymentMode] = useState<SupplierPaymentMode>('cash')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [paymentDateOverride, setPaymentDateOverride] = useState<string | null>(null)
  const paymentDate = paymentDateOverride ?? date
  const [inNoPreview, setInNoPreview] = useState<string>('')
  const [hasManualAllocationsWarning, setHasManualAllocationsWarning] = useState(false)

  const [lines, setLines] = useState<LineFormItem[]>([defaultLine()])
  const [adjustments, setAdjustments] = useState<AdjustmentFormItem[]>([])
  const [draftBardan, setDraftBardan] = useState<DraftBardanFormItem[]>([])
  const [draftBardanBaseline, setDraftBardanBaseline] = useState('[]')
  const [statusText, setStatusText] = useState('')
  const [convertedBillId, setConvertedBillId] = useState('')
  const draftAppliedRef = useRef('')

  const todayIso = useMemo(() => getLocalIsoDate(), [])
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false)
  const [adjustedOpen, setAdjustedOpen] = useState(false)
  const [bardanOpen, setBardanOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  const saveConfirmButtonRef = useRef<HTMLButtonElement>(null)
  const [briefOpen, setBriefOpen] = useState(true)
  const [baselineReady, setBaselineReady] = useState(() => !editBillId)
  const [discardOpen, setDiscardOpen] = useState(false)
  const moreTouchedRef = useRef(false)
  const adjustmentsTouchedRef = useRef(false)
  const notesTouchedRef = useRef(false)
  const paymentTouchedRef = useRef(false)
  const [baselineDraft, setBaselineDraft] = useState(() =>
    snapshotDraft({
      supplierId: initialSupplierId ?? '',
      date: todayIso,
      pool: 'kacha',
      taxMode: 'none',
      gstRatePercent: 18,
      supplierBillNo: '',
      vehicleNo: '',
      bagsAtReceiptStr: '',
      privateNote: '',
      lines: [blankLine()],
      adjustments: [],
    }),
  )


  const suppliersQuery = useQuery(supplierListQueryOptions())

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

  const editBillQuery = useQuery(purchaseBillQueryOptions(editBillId ?? ''))
  const convertedBillQuery = useQuery(purchaseBillQueryOptions(convertedBillId))
  const draftQuery = useQuery({ queryKey: ['purchase-bill-draft', draftId], queryFn: () => loadPurchaseBillDraft(draftId!), enabled: Boolean(draftId), refetchOnWindowFocus: true })

  // Supplier context strip bundle query
  const supplierBundleQuery = useQuery(supplierBundleQueryOptions(supplierId))

  const supplierName = useMemo(
    () => (suppliersQuery.data ?? []).find((s) => s.id === supplierId)?.companyName ?? '',
    [suppliersQuery.data, supplierId],
  )
  const selectedSupplier = useMemo(
    () => (suppliersQuery.data ?? []).find((s) => s.id === supplierId) ?? null,
    [suppliersQuery.data, supplierId],
  )

  const supplierOptions = useMemo(
    () =>
      (suppliersQuery.data ?? [])
        .filter((s) => s.active !== false)
        .map((s) => ({ id: s.id, name: s.companyName })),
    [suppliersQuery.data],
  )

  useEffect(() => {
    if (!draftId || !draftQuery.data || draftAppliedRef.current === draftId || !suppliersQuery.data || !itemsQuery.data) return
    if (draftQuery.data.status !== 'pending_review' || draftQuery.data.parsed.kind === 'invalid') return
    const p = requireEditablePurchaseBillDraft(draftQuery.data)
    const supplier = matchPurchaseMaster(p.supplier_name, p.supplier_id, suppliersQuery.data.map((s) => ({ ...s, name: s.companyName })))
    const mappedLines: LineFormItem[] = p.lines.map((line) => {
      const item = matchPurchaseMaster(line.item_name, line.item_id, itemsQuery.data ?? [])
      return { id: generateLineId(), itemId: item?.id ?? '', itemName: item?.name ?? line.item_name,
        bardanStr: line.receipt_memo ?? '', weightKgStr: gramsToKgText(line.weight_g), rateRupeesStr: milliToRateText(line.rate_milli) }
    })
    const mappedAdjustments: AdjustmentFormItem[] = (p.adjustments ?? []).map((a) => ({ id: generateLineId(), type: a.type, amountRupeesStr: paiseToRupeesText(a.amount_paise), note: a.note ?? '' }))
    const nextSupplierId = supplier?.id ?? ''
    const nextTaxMode = resolveTaxModeForPool(p.pool, p.tax_mode)
    const nextGstRate = (p.gst_rate_bp ?? (p.pool === 'gst' ? 1800 : 0)) / 100
    setSupplierId(nextSupplierId)
    setDate(p.date)
    setPaymentDateOverride(null)
    setPool(p.pool)
    setTaxMode(nextTaxMode)
    setGstRatePercent(nextGstRate)
    setSupplierBillNo(p.supplier_bill_no ?? '')
    setVehicleNo(p.vehicle_no ?? '')
    setBagsAtReceiptStr(p.bags_at_receipt_g == null ? '' : gramsToKgText(p.bags_at_receipt_g))
    if (p.vehicle_no || p.bags_at_receipt_g != null || p.supplier_bill_no) setMoreDetailsOpen(true)
    setPrivateNote(p.private_note ?? '')
    setLines(mappedLines)
    setAdjustments(mappedAdjustments)
    const mappedBardan: DraftBardanFormItem[] = (p.bardan ?? []).map((b) => ({
      id: generateLineId(), weightKgStr: gramsToKgText(b.bardan_g), rateRupeesStr: milliToRateText(b.rate_milli),
      rateLineIndex: b.rate_line_index, method: b.method,
      creditRupeesStr: b.credit_paise == null ? '' : paiseToRupeesText(b.credit_paise),
      cashRupeesStr: b.cash_amount_paise == null ? '' : paiseToRupeesText(b.cash_amount_paise),
      date: b.date ?? p.date, note: b.note ?? '',
    }))
    setDraftBardan(mappedBardan)
    setDraftBardanBaseline(JSON.stringify(mappedBardan))
    if (mappedAdjustments.length) setAdjustedOpen(true)
    if (p.payment) {
      setDraftPaymentStr(paiseToRupeesText(p.payment.amount_paise))
      setPaymentMode(p.payment.mode)
      setPaymentReference(p.payment.reference ?? '')
      setPaymentNote(p.payment.note ?? '')
      setPaymentOpen(true)
    }
    setBaselineDraft(snapshotDraft({ supplierId: nextSupplierId, date: p.date, pool: p.pool, taxMode: nextTaxMode,
      gstRatePercent: nextGstRate, supplierBillNo: p.supplier_bill_no ?? '', vehicleNo: p.vehicle_no ?? '',
      bagsAtReceiptStr: p.bags_at_receipt_g == null ? '' : gramsToKgText(p.bags_at_receipt_g), privateNote: p.private_note ?? '',
      lines: mappedLines, adjustments: mappedAdjustments }))
    setBaselineReady(true)
    draftAppliedRef.current = draftId
  }, [draftId, draftQuery.data, suppliersQuery.data, itemsQuery.data])


  const recentBillsQuery = useQuery(purchaseBillsQueryOptions())

  const cachedRecentBills = useMemo(() => {
    const cached = recentBillsQuery.data ?? []
    return cached
      .filter((b) => !b.cancelled)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3)
      .map((b) => ({
        id: b.id,
        inNo: b.inNo,
        supplierName:
          b.supplierName ||
          (suppliersQuery.data ?? []).find((s) => s.id === b.supplierId)?.companyName ||
          'Supplier',
        totalKg: b.totalWeightG ? b.totalWeightG / 1000 : 0,
        netPaise: b.netPaise || 0,
        date: b.date,
      }))
  }, [recentBillsQuery.data, suppliersQuery.data])

  // Pre-fill if editing; also anchors the dirty baseline for the discard guard.
  useEffect(() => {
    if (!editBillQuery.data) return
    const { bill, lines: billLines, adjustments: billAdjs, allocations } = editBillQuery.data
    const resolvedTax = resolveTaxModeForPool(bill.pool, bill.taxMode)
    const resolvedGst = bill.gstRateBp ? bill.gstRateBp / 100 : 18
    const parsedBags = parseBagsAtReceiptKg(bill.privateNote)
    const memoBags = parsedBags != null ? parsedBags.toString() : ''
    const userNote = extractUserNote(bill.privateNote)
    const mappedLines = billLines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      itemName: l.itemName,
      bardanStr: l.receiptMemo ?? '',
      weightKgStr: (l.weightG / 1000).toFixed(3),
      rateRupeesStr: (l.rateMilli / 1000).toFixed(3),
    }))
    const mappedAdjustments = billAdjs.map((a) => ({
      id: a.id,
      type: a.type as PurchaseAdjustmentType,
      amountRupeesStr: (a.amountPaise / 100).toString(),
      note: a.note ?? '',
    }))

    setSupplierId(bill.supplierId)
    setDate(bill.date)
    setPool(bill.pool)
    setTaxMode(resolvedTax)
    setGstRatePercent(resolvedGst)
    setSupplierBillNo(bill.supplierBillNo ?? '')
    setVehicleNo(bill.vehicleNo ?? '')
    setInNoPreview(bill.inNo)
    setBagsAtReceiptStr(memoBags)
    setPrivateNote(userNote)
    setLines(mappedLines)
    setAdjustments(mappedAdjustments)

    if (allocations && allocations.length > 0) {
      setHasManualAllocationsWarning(true)
    }
    if (mappedAdjustments.length > 0 && !adjustmentsTouchedRef.current) {
      setAdjustedOpen(true)
    }
    if ((userNote.trim() !== '' || (bill.photos && bill.photos.length > 0)) && !notesTouchedRef.current) {
      setNotesOpen(true)
    }
    if ((bill.supplierBillNo?.trim() || bill.vehicleNo?.trim() || memoBags.trim() || bill.pool === 'gst') && !moreTouchedRef.current) {
      setMoreDetailsOpen(true)
    }
    setBaselineDraft(snapshotDraft({
      supplierId: bill.supplierId,
      date: bill.date,
      pool: bill.pool,
      taxMode: resolvedTax,
      gstRatePercent: resolvedGst,
      supplierBillNo: bill.supplierBillNo ?? '',
      vehicleNo: bill.vehicleNo ?? '',
      bagsAtReceiptStr: memoBags,
      privateNote: userNote,
      lines: mappedLines,
      adjustments: mappedAdjustments,
    }))
    setBaselineReady(true)
  }, [editBillQuery.data])

  const serializedDraft = useMemo(
    () =>
      snapshotDraft({
        supplierId,
        date,
        pool,
        taxMode,
        gstRatePercent,
        supplierBillNo,
        vehicleNo,
        bagsAtReceiptStr,
        privateNote,
        lines,
        adjustments,
      }),
    [supplierId, date, pool, taxMode, gstRatePercent, supplierBillNo, vehicleNo, bagsAtReceiptStr, privateNote, lines, adjustments],
  )
  const isDirty = baselineReady && (serializedDraft !== baselineDraft || (!editBillId && JSON.stringify(draftBardan) !== draftBardanBaseline) || photos.length > 0 || (!editBillId && ((draftId ? draftPaymentStr.trim() !== '' : paymentAmountRupees > 0) || paymentNote.trim() !== '' || Boolean(paymentReference.trim()))))
  const requestBack = () => (isDirty ? setDiscardOpen(true) : onDiscard ? onDiscard() : window.history.back())

  useEffect(() => {
    onDirtyChange?.(Boolean(isDirty))
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // IN number preview for new bills
  useEffect(() => {
    if (editBillId) return
    let cancelled = false
    void getNextPurchaseInNo(date).then((nextNo) => {
      if (!cancelled) setInNoPreview(nextNo)
    }).catch((error) => {
      if (!cancelled) setStatusText(toUserMessage(error))
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
      let weightG = 0
      let rateMilli = 0
      let amountPaise = 0
      try {
        weightG = parsePurchaseDecimal(l.weightKgStr, 3, 'Weight')
        rateMilli = parsePurchaseDecimal(l.rateRupeesStr, 3, 'Rate')
        amountPaise = calculateDraftLinePaise(weightG, rateMilli)
      } catch { /* incomplete typed values are handled by form validation */ }
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
      let amountPaise = 0
      try { amountPaise = parsePurchaseDecimal(a.amountRupeesStr, 2, 'Adjustment') } catch { /* incomplete field */ }
      return {
        ...a,
        amountPaise,
      }
    })
  }, [adjustments])

  const parsedDraftBardan = useMemo(() => {
    try {
      const manualLines = new Set<string>()
      return draftBardan.map((b, index) => {
        const bardanG = parsePurchaseDecimal(b.weightKgStr, 3, `Bardan ${index + 1} weight`)
        const target = draftId
          ? b.rateLineIndex === undefined ? undefined : parsedLines[b.rateLineIndex]
          : parsedLines.find((line) => line.id === b.rateLineKey)
        const rateMilli = draftId ? parsePurchaseDecimal(b.rateRupeesStr, 3, `Bardan ${index + 1} rate`) : target?.rateMilli ?? 0
        const creditPaise = b.creditRupeesStr.trim() ? parsePurchaseDecimal(b.creditRupeesStr, 2, `Bardan ${index + 1} credit`) :
          b.method === 'deduct' ? calculateDraftLinePaise(bardanG, rateMilli) : 0
        const cashAmountPaise = b.cashRupeesStr.trim() ? parsePurchaseDecimal(b.cashRupeesStr, 2, `Bardan ${index + 1} cash`) : 0
        if (bardanG <= 0 || (!draftId && rateMilli <= 0)) throw new Error('Enter bardan weight and choose a bill line with a rate.')
        if (!draftId && target) {
          if (manualLines.has(target.id)) throw new Error('Use one bardan entry per bill line.')
          manualLines.add(target.id)
        }
        const rateLineIndex = target ? parsedLines.filter((line) => line.itemName.trim() && line.weightG > 0 && line.rateMilli > 0).indexOf(target) : undefined
        if (rateLineIndex === -1) throw new Error('Complete the line used for the bardan rate.')
        return { bardanG, bagCount: !draftId && target ? purchaseReceiptBagCount(target.bardanStr) || undefined : undefined, rateMilli, rateLineIndex, method: b.method, creditPaise, cashAmountPaise, date: draftId ? b.date : date, note: b.note }
      })
    } catch { return null }
  }, [draftBardan, parsedLines, date, draftId])

  const billNet = useMemo(() => {
    const gstRateBp = taxMode === 'none' ? 0 : percentToBasisPoints(gstRatePercent)
    return computeBillNet(
      parsedLines.map((l) => ({ amountPaise: l.amountPaise })),
      parsedAdjustments.map((a) => ({ type: a.type, amountPaise: a.amountPaise })),
      editBillId ? (editBillQuery.data?.bardan ?? []) : (parsedDraftBardan ?? []),
      taxMode,
      gstRateBp,
    )
  }, [parsedLines, parsedAdjustments, taxMode, gstRatePercent, editBillQuery.data, editBillId, parsedDraftBardan])

  // Vilaity benchmark rate for the current date
  const vilaityBenchmark = useMemo(() => {
    return findVilaityBenchmark(vilaityQuery.data ?? [], date)
  }, [vilaityQuery.data, date])

  const currentVilaityMilli = vilaityBenchmark.milli

  // Supplier brief card (right pane, bottom): dues, advance, counts, last bill/rate.
  const supplierContext = useMemo(() => {
    if (!supplierBundleQuery.data) return null
    const bundle: SupplierBundle = supplierBundleQuery.data
    const settlement = computeSupplierSettlement(bundleToSettlementInput(bundle))
    const poolBills = [...settlement.pools.kacha.bills, ...settlement.pools.gst.bills]
    const bardanPendingCount = poolBills.filter((b) => b.bardanPending).length
    const openCount = poolBills.filter((b) => b.status === 'open' || b.status === 'partial').length

    const activeBills = bundle.bills.filter((b) => !b.cancelled)
    const lastBill = [...activeBills].sort((a, b) => `${b.date}|${b.created}`.localeCompare(`${a.date}|${a.created}`))[0] ?? null
    const lastRateMilli = lastBill
      ? (bundle.lines.find((line) => line.billId === lastBill.id)?.rateMilli ?? null)
      : null

    return {
      kachaDuePaise: settlement.pools.kacha.outstandingPaise,
      gstDuePaise: settlement.pools.gst.outstandingPaise,
      advancePaise: settlement.combined.advancePaise,
      outstandingPaise: settlement.combined.outstandingPaise,
      bardanPendingCount,
      billsCount: bundle.bills.length,
      openCount,
      lastBillDate: lastBill?.date ?? '',
      lastRateMilli,
    }
  }, [supplierBundleQuery.data])

  const billDayPaymentPaise = (() => { try { return parsePurchaseDecimal(draftId ? draftPaymentStr || '0' : String(paymentAmountRupees), 2, 'Payment') } catch { return 0 } })()
  const projectedSettlement = useMemo(() => {
    if (!supplierBundleQuery.data) return null
    const input = bundleToSettlementInput(supplierBundleQuery.data)
    const previewBillId = editBillId || 'billpreview'
    const previewPaymentId = 'paymentpreview'
    const paidPaise = editBillId ? 0 : billDayPaymentPaise
    const oldBill = input.bills.find((bill) => bill.id === previewBillId)
    const simulated = computeSupplierSettlement({
      ...input,
      bills: [...input.bills.filter((bill) => bill.id !== previewBillId), { ...oldBill, id: previewBillId, date, created: oldBill?.created ?? '9999-12-31 23:59:59', pool, taxMode, gstRateBp: taxMode === 'none' ? 0 : percentToBasisPoints(gstRatePercent) }],
      lines: [...input.lines.filter((line) => line.billId !== previewBillId), ...parsedLines.filter((line) => line.itemName.trim() && line.weightG > 0 && line.rateMilli > 0).map((line) => ({ billId: previewBillId, amountPaise: line.amountPaise }))],
      adjustments: [...input.adjustments.filter((adjustment) => adjustment.billId !== previewBillId), ...parsedAdjustments.filter((adjustment) => adjustment.amountPaise !== 0).map((adjustment) => ({ billId: previewBillId, type: adjustment.type, amountPaise: adjustment.amountPaise }))],
      bardan: editBillId ? input.bardan : [...input.bardan, ...(parsedDraftBardan ?? []).map((entry) => ({ ...entry, billId: previewBillId }))],
      payments: paidPaise > 0 ? [...input.payments, { id: previewPaymentId, date: paymentDate, created: '9999-12-31 23:59:59', pool, kind: 'payment', amountPaise: paidPaise }] : input.payments,
      allocations: paidPaise > 0 && billNet.netPaise > 0 ? [...input.allocations, { paymentId: previewPaymentId, billId: previewBillId, amountPaise: Math.min(paidPaise, billNet.netPaise) }] : input.allocations,
    })
    const projectedBill = simulated.pools[pool].bills.find((bill) => bill.billId === previewBillId)
    const proposedPayment = simulated.pools[pool].payments.find((payment) => payment.paymentId === previewPaymentId)
    const paymentById = new Map(supplierBundleQuery.data.payments.map((payment) => [payment.id, payment]))
    return {
      supplierDuePaise: simulated.combined.outstandingPaise,
      billDuePaise: projectedBill?.duePaise ?? billNet.netPaise,
      advancePaise: editBillId
        ? purchaseChittyAdvance(editBillId, simulated.pools[pool].payments, input.allocations)
        : proposedPayment ? Math.max(0, proposedPayment.amountPaise - proposedPayment.appliedPaise) : undefined,
      paidRows: (projectedBill?.creditsApplied ?? []).map((credit) => {
        const payment = credit.paymentId ? paymentById.get(credit.paymentId) : null
        const proposed = credit.paymentId === previewPaymentId
        return { date: credit.date, hasNote: hasPurchasePaymentNote(proposed ? paymentNote : payment?.privateNote), creditLabel: proposed ? undefined : purchaseChittyCreditLabel(payment?.kind, credit.reference, Boolean(payment)), mode: proposed ? paymentMode : payment?.mode ?? '', reference: proposed ? paymentReference : payment?.reference || credit.reference || '', amountPaise: credit.amountPaise, pinned: credit.pinned }
      }),
    }
  }, [supplierBundleQuery.data, editBillId, billDayPaymentPaise, paymentMode, paymentReference, paymentNote, paymentDate, date, pool, taxMode, gstRatePercent, parsedLines, parsedAdjustments, parsedDraftBardan, billNet.netPaise])

  const memoBagsKg = parseFloat(bagsAtReceiptStr)
  const billChittyData = useMemo<BillChittyData>(() => ({
    inNo: inNoPreview, date, supplierName, pool, taxMode,
    gstRateBp: taxMode === 'none' ? 0 : percentToBasisPoints(gstRatePercent),
    supplierBillNo: supplierBillNo.trim(),
    bagsAtReceiptKg: Number.isFinite(memoBagsKg) && memoBagsKg > 0 ? Number(memoBagsKg.toFixed(3)) : null,
    vehicleNo: vehicleNo.trim(),
    lines: parsedLines.filter((line) => line.itemName.trim() && line.weightG > 0).map((line) => ({
      itemName: line.itemName, weightG: line.weightG, rateMilli: line.rateMilli, amountPaise: line.amountPaise,
      bardanText: purchaseReceiptMemoText(line.bardanStr) || undefined,
    })),
    adjustments: parsedAdjustments.filter((adjustment) => adjustment.amountPaise !== 0).map((adjustment) => ({ type: adjustment.type, amountPaise: adjustment.amountPaise, note: adjustment.note.trim() || undefined })),
    bardan: editBillId
      ? (editBillQuery.data?.bardan ?? []).map((entry) => ({ ...entry, itemName: editBillQuery.data?.lines.find((line) => line.id === entry.rateLineId)?.itemName }))
      : (parsedDraftBardan ?? []).map((entry) => ({ ...entry, date: entry.date || date, itemName: entry.rateLineIndex === undefined ? undefined : parsedLines.filter((line) => line.itemName.trim() && line.weightG > 0 && line.rateMilli > 0)[entry.rateLineIndex]?.itemName })),
    paidRows: projectedSettlement?.paidRows ?? (!editBillId && billDayPaymentPaise > 0
      ? [{ date: paymentDate, hasNote: hasPurchasePaymentNote(paymentNote), mode: paymentMode, reference: paymentReference, amountPaise: Math.min(billDayPaymentPaise, billNet.netPaise), pinned: true }]
      : []),
    advancePaise: projectedSettlement?.advancePaise ?? (!editBillId ? Math.max(0, billDayPaymentPaise - billNet.netPaise) : undefined),
  }), [inNoPreview, date, supplierName, pool, taxMode, gstRatePercent, supplierBillNo, memoBagsKg, vehicleNo, parsedLines, parsedAdjustments, editBillQuery.data, editBillId, parsedDraftBardan, projectedSettlement, billDayPaymentPaise, paymentDate, paymentMode, paymentReference, paymentNote, billNet.netPaise])

  // Bardan "advance" entries mint a supplier payment in the bill's pool; moving
  // the bill to the other pool would strand that payment, so the pool is locked.
  const poolLocked = Boolean(editBillId) && (editBillQuery.data?.bardan.some((b) => b.method === 'advance') ?? false)

  const addLine = () => {
    const newLine = defaultLine()
    setLines((prev) => [...prev, newLine])
    return newLine.id
  }

  const removeLine = (id: string) => {
    if (lines.length === 1) return
    setLines((prev) => prev.filter((l) => l.id !== id))
  }
  const updateLine = (id: string, patch: Partial<LineFormItem>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  const handleItemSelect = (lineId: string, item: { id: string; name: string }) => {
    const last = findLastRateForItem(supplierBundleQuery.data, item.id, item.name)
    const line = lines.find((l) => l.id === lineId)
    const patch: Partial<LineFormItem> = {
      itemId: item.id,
      itemName: item.name,
    }
    if (last && (!line?.rateRupeesStr || line.rateRupeesStr === '' || line.rateRupeesStr === '0' || line.rateRupeesStr === '0.000')) {
      patch.rateRupeesStr = last.rateRupees.toString()
    }
    updateLine(lineId, patch)
  }

  const handleQuickItemClick = (item: { id: string; name: string }) => {
    const emptyIdx = lines.findIndex((l) => !l.itemName.trim())
    if (emptyIdx >= 0) {
      const targetId = lines[emptyIdx].id
      handleItemSelect(targetId, item)
      setTimeout(() => document.getElementById(`bardan-${targetId}`)?.focus(), 50)
    } else {
      const newId = addLine()
      handleItemSelect(newId, item)
      setTimeout(() => document.getElementById(`bardan-${newId}`)?.focus(), 50)
    }
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
      if (draftId && (draftQuery.data?.status !== 'pending_review' || draftQuery.data.parsed.kind === 'invalid')) throw new Error('This draft is invalid or was already processed.')
      const paidNowPaise = parsePurchaseDecimal(draftId ? draftPaymentStr || '0' : String(paymentAmountRupees), 2, 'Payment')
      if (!editBillId && paidNowPaise > 0 && supplierPaymentNeedsReference(paymentMode) && !paymentReference.trim()) throw new Error('Enter the payment reference.')
      if (!supplierId) throw new Error('Please select a supplier.')
      if (draftId && lines.some((line) => line.itemName.trim() && !line.itemId)) throw new Error('Match every draft item to a Purchase item before saving.')
      if (!editBillId && !parsedDraftBardan) throw new Error('Complete every bardan entry or remove it.')
      if (!date) throw new Error('Bill date is required.')

      const validLines = parsedLines.filter((l) => l.itemName.trim() && l.weightG > 0 && l.rateMilli > 0)
      const incompleteIndex = parsedLines.findIndex((l) => (l.itemName.trim() || l.weightKgStr.trim() || l.rateRupeesStr.trim() || l.bardanStr.trim()) && !(l.itemName.trim() && l.weightG > 0 && l.rateMilli > 0))
      if (incompleteIndex >= 0) throw new Error(`Complete item, weight and rate on line ${incompleteIndex + 1}, or clear the line.`)
      if (validLines.length === 0) {
        throw new Error('Enter at least one item line with valid weight and rate.')
      }

      const fullNote = formatPrivateNoteWithBags(privateNote, !isNaN(memoBagsKg) && memoBagsKg > 0 ? memoBagsKg : null)

      if (editBillId) {
        const payload: PurchaseBillUpdateInput = {
          supplierId,
          supplierBillNo: supplierBillNo.trim(),
          vehicleNo: vehicleNo.trim(),
          date,
          pool,
          taxMode,
          gstRateBp: taxMode === 'none' ? 0 : percentToBasisPoints(gstRatePercent),
          privateNote: fullNote,
          photos: photos.length > 0 ? photos : undefined,
          lines: validLines.map((l) => ({
            id: l.id,
            itemId: l.itemId || undefined,
            itemName: l.itemName.trim(),
            weightG: l.weightG,
            rateMilli: l.rateMilli,
            amountPaise: l.amountPaise,
            receiptMemo: l.bardanStr.trim(),
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
          inNo: draftId ? '' : inNoPreview,
          draftId,
          supplierBillNo: supplierBillNo.trim(),
          vehicleNo: vehicleNo.trim(),
          date,
          pool,
          taxMode,
          gstRateBp: taxMode === 'none' ? 0 : percentToBasisPoints(gstRatePercent),
          privateNote: fullNote,
          photos: photos.length > 0 ? photos : undefined,
          payment: paidNowPaise > 0 ? { amountPaise: paidNowPaise, date: paymentDate, mode: paymentMode, reference: paymentReference.trim(), note: paymentNote.trim() || undefined } : undefined,
          lines: validLines.map((l) => ({
            itemId: l.itemId || undefined,
            itemName: l.itemName.trim(),
            weightG: l.weightG,
            rateMilli: l.rateMilli,
            amountPaise: l.amountPaise,
            receiptMemo: l.bardanStr.trim(),
          })),
          adjustments: parsedAdjustments
            .filter((a) => a.amountPaise !== 0)
            .map((a) => ({
              type: a.type,
              amountPaise: a.amountPaise,
              note: a.note.trim(),
            })),
          bardan: parsedDraftBardan ?? [],
        }
        return await createPurchaseBill(payload)
      }
    },
    onSuccess: async (savedBill) => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
      if (draftId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['purchase-bill-drafts'] }),
          queryClient.invalidateQueries({ queryKey: ['purchase-bill-drafts-count'] }),
          queryClient.invalidateQueries({ queryKey: ['purchase-bill-draft', draftId] }),
        ])
      }
      if (onSaved) {
        onSaved(savedBill)
        return
      }
      void navigate({ to: '/purchase-bills/$billId', params: { billId: savedBill.inNo } })
    },
    onError: (error) => {
      const details = error && typeof error === 'object' && 'details' in error ? (error as { details?: { billId?: string } }).details : undefined
      setConvertedBillId(details?.billId ?? '')
      setStatusText(toUserMessage(error))
    },
  })

  const hasValidSupplier = Boolean(supplierId)
  const hasValidDate = Boolean(date)
  const validLines = parsedLines.filter((l) => l.itemName.trim() && l.weightG > 0 && l.rateMilli > 0)
  const hasIncompleteLine = parsedLines.some((l) => Boolean(l.itemName.trim() || l.weightKgStr.trim() || l.rateRupeesStr.trim() || l.bardanStr.trim()) && !(l.itemName.trim() && l.weightG > 0 && l.rateMilli > 0))
  const hasValidLines = validLines.length > 0 && !hasIncompleteLine && (!draftId || lines.every((line) => !line.itemName.trim() || Boolean(line.itemId)))

  let validationHint = ''
  if (!hasValidSupplier) {
    validationHint = 'Pick a supplier'
  } else if (!hasValidDate) {
    validationHint = 'Select bill date'
  } else if (lines.every((l) => !l.itemName.trim())) {
    validationHint = 'Select an item'
  } else if (!hasValidLines) {
    validationHint = 'Complete every entered item, weight and rate'
  }

  const isFormValid = hasValidSupplier && hasValidDate && hasValidLines && (editBillId || parsedDraftBardan !== null) && (!draftId || (draftQuery.data?.status === 'pending_review' && draftQuery.data.parsed.kind === 'valid'))

  // Save goes through a preview-confirmation dialog first.
  const requestSave = useCallback(() => {
    if (!saveMutation.isPending && isFormValid) setSaveConfirmOpen(true)
  }, [isFormValid])
  // Keyboard shortcut Ctrl+Enter to save
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        requestSave()
      }
    },
    [requestSave],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const totalWeightG = parsedLines.reduce((sum, line) => sum + line.weightG, 0)
  const totalWeightText = gramsToKgText(totalWeightG)
  const detailsHoldCount = (supplierBillNo.trim() ? 1 : 0) + (vehicleNo.trim() ? 1 : 0) + (bagsAtReceiptStr.trim() !== '' ? 1 : 0) + (pool === 'gst' ? 2 : 0)
  const notesCount = (privateNote.trim() !== '' ? 1 : 0) + photos.length
  const poolCaption =
    pool === 'kacha'
      ? 'Kacha · 0% tax'
      : taxMode === 'rcm'
        ? `RCM · ${gstRatePercent}% · reverse charge`
        : `GST · ${gstRatePercent}% · forward charge`

  const toggleMoreDetails = () => {
    moreTouchedRef.current = true
    setMoreDetailsOpen((open) => !open)
  }
  const toggleAdjustments = () => {
    adjustmentsTouchedRef.current = true
    setAdjustedOpen((open) => !open)
  }
  const toggleNotes = () => {
    notesTouchedRef.current = true
    setNotesOpen((open) => !open)
  }

  return (
    <div className={isPage ? 'w-full px-3 pb-12 pt-3 sm:px-4 lg:px-6' : 'min-w-0 w-full'}>
      <div className={isPage ? 'grid grid-cols-1 gap-5 xl:grid-cols-2' : 'space-y-3'}>
        {/* ============ LEFT PANE — the form (dominant) ============ */}
        <section aria-label="Bill form" className="@container min-w-0 space-y-3">
          {draftId && <Panel className="border-blue-200 bg-blue-50 text-sm text-slate-900">
            <p className="font-semibold">Muse Purchase Bill Draft</p>
            <p className="text-xs text-slate-600">Review and correct the proposal. Opening it does not create a bill.</p>
            {draftQuery.data?.raw_text && <details className="mt-1 text-xs"><summary className="cursor-pointer font-semibold">Original message</summary><p className="mt-1 whitespace-pre-wrap break-words">{draftQuery.data.raw_text}</p></details>}
            {draftQuery.isLoading && <p className="mt-1 text-xs">Loading draft…</p>}
            {draftQuery.isError && <p role="alert" className="mt-1 text-xs text-rose-700">Could not load draft.</p>}
            {draftQuery.data?.parsed.kind === 'invalid' && <p role="alert" className="mt-1 text-xs text-rose-700">Invalid draft: {draftQuery.data.parsed.issues.join('; ')}</p>}
            {draftQuery.data && draftQuery.data.status !== 'pending_review' && <p role="alert" className="mt-1 text-xs text-rose-700">This draft was already processed.</p>}
            {convertedBillQuery.data?.bill.inNo && <a className="mt-1 inline-block text-xs font-semibold text-blue-700 underline" href={`/purchase-bills/${encodeURIComponent(convertedBillQuery.data.bill.inNo)}`}>Open the saved bill</a>}
          </Panel>}

          {hasManualAllocationsWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800" role="alert">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>
                This bill has manual payment allocations assigned. Editing quantities or totals will change remaining dues.
              </span>
            </div>
          )}
          {statusText && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800" role="alert">
              {statusText}
            </div>
          )}

          {/* Row 1 — supplier, date, pool */}
          <Panel className="space-y-3 p-4">
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-12">
              <div className="sm:col-span-12 md:col-span-6">
                <label htmlFor="bill-supplier" className="text-[11px] font-semibold text-slate-600">
                  Supplier <span className="text-rose-600">*</span>
                </label>
                <SearchableCombobox
                  options={supplierOptions}
                  value={supplierId}
                  onChange={setSupplierId}
                  inputClassName="mt-1 h-10 w-full rounded-md border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                  placeholder="Search supplier…"
                  inputId="bill-supplier"
                />
              </div>
              <div className="sm:col-span-6 md:col-span-3">
                <label htmlFor="bill-date" className="text-[11px] font-semibold text-slate-600">
                  Bill Date
                </label>
                <DateInput
                  id="bill-date"
                  value={date}
                  onChange={setDate}
                  className="mt-1 h-10 w-full rounded-md border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                />
              </div>
              <div className="sm:col-span-6 md:col-span-3">
                <span className="text-[11px] font-semibold text-slate-600">Pool</span>
                <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-border bg-secondary p-0.5 text-xs font-semibold" role="group" aria-label="Bill pool">
                  {(['kacha', 'gst'] as SupplierPool[]).map((option) => {
                    const active = pool === option
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={poolLocked}
                        title={poolLocked ? 'Pool is locked: this bill has bardan advance entries tied to its pool.' : undefined}
                        aria-pressed={active}
                        className={`rounded-md py-2 transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          active
                            ? option === 'kacha'
                              ? 'bg-amber-100 text-amber-900 shadow-sm'
                              : 'bg-blue-100 text-blue-900 shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => handlePoolChange(option)}
                      >
                        {option === 'kacha' ? 'Kacha' : 'GST'}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{poolCaption}</p>
                {poolLocked && <p className="mt-0.5 text-[11px] font-medium text-amber-700">Pool locked: bardan advance entries are tied to this pool.</p>}
              </div>
            </div>

            {/* More details — collapsed, auto-opens when it holds data */}
            <div className="border-t border-border pt-2">
              <button
                type="button"
                onClick={toggleMoreDetails}
                aria-expanded={moreDetailsOpen}
                className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left transition hover:bg-secondary"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  More details
                  {detailsHoldCount > 0 && (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-bold text-foreground normal-case tracking-normal">
                      {detailsHoldCount}
                    </span>
                  )}
                </span>
                <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${moreDetailsOpen ? '' : '-rotate-90'}`} />
              </button>
              {moreDetailsOpen && (
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="supplier-bill-no" className="text-[11px] font-semibold text-slate-600">Supplier Invoice No</label>
                    <input
                      id="supplier-bill-no"
                      type="text"
                      placeholder="e.g. INV-1049"
                      value={supplierBillNo}
                      onChange={(e) => setSupplierBillNo(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                    />
                  </div>
                  <div>
                    <label htmlFor="bags-memo" className="text-[11px] font-semibold text-slate-600">Bag weight memo (kg)</label>
                    <input
                      id="bags-memo"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 15.500"
                      value={bagsAtReceiptStr}
                      onChange={(e) => setBagsAtReceiptStr(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                    />
                  </div>
                  <div>
                    <label htmlFor="purchase-vehicle-no" className="text-[11px] font-semibold text-slate-600">Vehicle No</label>
                    <input id="purchase-vehicle-no" type="text" value={vehicleNo} onChange={(event) => setVehicleNo(event.target.value)} className={inputClass} />
                  </div>
                  {pool === 'gst' && (
                    <>
                      <div>
                        <label htmlFor="tax-mode" className="text-[11px] font-semibold text-slate-600">Tax Mode</label>
                        <select
                          id="tax-mode"
                          value={taxMode}
                          onChange={(e) => setTaxMode(e.target.value as PurchaseTaxMode)}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                        >
                          <option value="gst">GST (Forward Charge)</option>
                          <option value="rcm">RCM (Reverse Charge)</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="gst-rate" className="text-[11px] font-semibold text-slate-600">GST Rate (%)</label>
                        <select
                          id="gst-rate"
                          value={gstRatePercent}
                          onChange={(e) => setGstRatePercent(Number(e.target.value))}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                        >
                          <option value={5}>5%</option>
                          <option value={12}>12%</option>
                          <option value={18}>18% (Standard Brass)</option>
                          <option value={28}>28%</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </Panel>

          {/* Items table & Mobile cards */}
          <Panel className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Material Items</h2>
              </div>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:text-foreground"
              >
                <Plus size={13} /> Add item
              </button>
            </div>

            {/* Quick scrap grade chips — loaded dynamically from database (purchase_items) */}
            {activeItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mr-1">
                  Quick scrap:
                </span>
                {activeItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleQuickItemClick(item)}
                    className="rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition"
                  >
                    + {item.name}
                  </button>
                ))}
              </div>
            )}

            {/* Desktop Table View */}
            <div className="relative hidden min-w-0 rounded-lg border border-border @3xl:block">
              <table className="w-full table-fixed border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-700 h-9">
                    <th className="w-10 min-w-[36px] px-2.5 py-2 text-left">#</th>
                    <th className="min-w-[180px] px-3 py-2 text-left">Item</th>
                    <th className="w-24 min-w-[85px] px-2 py-2 text-right">Bags (Bardan)</th>
                    <th className="w-28 min-w-[100px] px-2 py-2 text-right">Weight (kg)</th>
                    <th className="w-28 min-w-[100px] px-2 py-2 text-right">Rate (₹/kg)</th>
                    <th
                      className="w-20 min-w-[75px] px-2 py-2 text-center"
                      title={
                        currentVilaityMilli
                          ? `Difference vs Jamnagar Brass benchmark (${formatChittyRate(currentVilaityMilli)}/kg)`
                          : 'No Brass benchmark for this date'
                      }
                    >
                      Mkt Δ
                    </th>
                    <th className="w-32 min-w-[110px] px-3 py-2 text-right">Amount</th>
                    <th className="w-10 min-w-[36px] px-1 py-2 text-center"><span className="sr-only">Remove row</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, index) => {
                    const parsed = parsedLines[index]
                    const last = findLastRateForItem(supplierBundleQuery.data, l.itemId, l.itemName)
                    return (
                      <tr key={l.id} className="group transition-colors hover:bg-secondary/60">
                        <td className="w-10 min-w-[36px] px-2.5 py-2 font-mono text-[11px] text-muted-foreground">{index + 1}</td>
                        <td className="min-w-[180px] px-3 py-2">
                          <ItemDropdownCell
                            items={activeItems}
                            selectedItemName={l.itemName}
                            inputId={`item-${l.id}`}
                            onSelect={(item) => handleItemSelect(l.id, item)}
                            onNext={() => {
                              const nextInput = document.getElementById(`bardan-${l.id}`)
                              if (nextInput) (nextInput as HTMLInputElement).focus()
                            }}
                            onCreateItem={draftId ? undefined : handleCreateNewItem}
                          />
                        </td>
                        <td className="w-24 min-w-[85px] px-2 py-2 text-right">
                          <input
                            id={`bardan-${l.id}`}
                            type="text"
                            placeholder="0"
                            value={l.bardanStr}
                            onChange={(e) => updateLine(l.id, { bardanStr: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                document.getElementById(`weight-${l.id}`)?.focus()
                              }
                            }}
                            aria-label={`Bags or bardan for row ${index + 1}`}
                            className="h-9 w-full rounded-md border border-border bg-card px-2 text-right font-mono tabular-nums text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                          />
                        </td>
                        <td className="w-28 min-w-[100px] px-2 py-2 text-right">
                          <input
                            id={`weight-${l.id}`}
                            type="text"
                            inputMode="decimal"
                            placeholder="0.000"
                            value={l.weightKgStr}
                            onChange={(e) => updateLine(l.id, { weightKgStr: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                document.getElementById(`rate-${l.id}`)?.focus()
                              }
                            }}
                            aria-label={`Weight in kg for row ${index + 1}`}
                            className="h-9 w-full rounded-md border border-border bg-card px-2 text-right font-mono tabular-nums text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                          />
                        </td>
                        <td className="w-28 min-w-[100px] px-2 py-2 text-right">
                          <input
                            id={`rate-${l.id}`}
                            type="text"
                            inputMode="decimal"
                            placeholder="0.000"
                            value={l.rateRupeesStr}
                            onChange={(e) => updateLine(l.id, { rateRupeesStr: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                if (index === lines.length - 1) {
                                  e.preventDefault()
                                  const newId = addLine()
                                  setTimeout(() => {
                                    document.getElementById(`item-${newId}`)?.focus()
                                  }, 50)
                                }
                              }
                            }}
                            aria-label={`Rate per kg for row ${index + 1}`}
                            className="h-9 w-full rounded-md border border-border bg-card px-2 text-right font-mono tabular-nums text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                          />
                          {last && (
                            <span className="block mt-0.5 text-[11px] text-muted-foreground tabular-nums text-right" title={`Last rate on ${last.date}`}>
                              Last: ₹{last.rateRupees}/kg
                            </span>
                          )}
                        </td>
                        <td className="w-20 min-w-[75px] px-2 py-2 text-center">
                          <MktDeltaBadge rateMilli={parsed.rateMilli} marketMilli={isBrassBenchmarkItem(parsed.itemName) ? currentVilaityMilli : null} />
                        </td>
                        <td className="w-32 min-w-[110px] px-3 py-2 text-right font-mono font-semibold tabular-nums text-foreground">
                          {formatPaiseInr(parsed.amountPaise)}
                        </td>
                        <td className="w-10 min-w-[36px] px-1 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(l.id)}
                            disabled={lines.length === 1}
                            aria-label={`Remove item row ${index + 1}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 disabled:pointer-events-none md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
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

            {/* Mobile Cards View */}
            <div className="block space-y-3 @3xl:hidden">
              {lines.map((l, index) => {
                const parsed = parsedLines[index]
                const last = findLastRateForItem(supplierBundleQuery.data, l.itemId, l.itemName)
                return (
                  <div key={l.id} className="rounded-lg border border-border bg-card p-3 shadow-xs space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">#{index + 1}</span>
                      <div className="flex-1 min-w-0">
                        <ItemDropdownCell
                          items={activeItems}
                          selectedItemName={l.itemName}
                          inputId={`item-mob-${l.id}`}
                          onSelect={(item) => handleItemSelect(l.id, item)}
                          onNext={() => {
                            const nextInput = document.getElementById(`bardan-mob-${l.id}`)
                            if (nextInput) (nextInput as HTMLInputElement).focus()
                          }}
                          onCreateItem={draftId ? undefined : handleCreateNewItem}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(l.id)}
                        disabled={lines.length === 1}
                        aria-label={`Remove row ${index + 1}`}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 items-start pt-1">
                      <div>
                        <label htmlFor={`bardan-mob-${l.id}`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                          Bags (Bardan)
                        </label>
                        <input
                          id={`bardan-mob-${l.id}`}
                          type="text"
                          placeholder="0"
                          value={l.bardanStr}
                          onChange={(e) => updateLine(l.id, { bardanStr: e.target.value })}
                          className="h-9 w-full rounded-md border border-border bg-card px-2 text-right font-mono tabular-nums text-xs text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                        />
                      </div>
                      <div>
                        <label htmlFor={`weight-mob-${l.id}`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                          Weight (kg)
                        </label>
                        <input
                          id={`weight-mob-${l.id}`}
                          type="text"
                          inputMode="decimal"
                          placeholder="0.000"
                          value={l.weightKgStr}
                          onChange={(e) => updateLine(l.id, { weightKgStr: e.target.value })}
                          className="h-9 w-full rounded-md border border-border bg-card px-2 text-right font-mono tabular-nums text-xs text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label htmlFor={`rate-mob-${l.id}`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Rate (₹)
                          </label>
                          <MktDeltaBadge rateMilli={parsed.rateMilli} marketMilli={isBrassBenchmarkItem(parsed.itemName) ? currentVilaityMilli : null} />
                        </div>
                        <input
                          id={`rate-mob-${l.id}`}
                          type="text"
                          inputMode="decimal"
                          placeholder="0.000"
                          value={l.rateRupeesStr}
                          onChange={(e) => updateLine(l.id, { rateRupeesStr: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              if (index === lines.length - 1) {
                                e.preventDefault()
                                const newId = addLine()
                                setTimeout(() => {
                                  document.getElementById(`item-mob-${newId}`)?.focus()
                                }, 50)
                              }
                            }
                          }}
                          className="h-9 w-full rounded-md border border-border bg-card px-2 text-right font-mono tabular-nums text-xs text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                        />
                        {last && (
                          <span className="block mt-0.5 text-[11px] text-muted-foreground tabular-nums text-right">
                            Last: ₹{last.rateRupees}
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1 text-right">
                          Amount
                        </span>
                        <div className="h-9 flex items-center justify-end px-2 font-mono text-xs font-bold tabular-nums text-foreground bg-secondary/50 rounded-md border border-border">
                          {formatPaiseInr(parsed.amountPaise)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Summary strip under items table */}
            <div className="flex flex-wrap items-center justify-between gap-y-2 rounded-lg border border-border bg-secondary/60 px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-[11px] font-semibold uppercase tracking-wider">Summary</span>
              </div>
              <div className="flex flex-wrap items-center gap-4 sm:gap-6 font-mono tabular-nums">
                <div className="text-right">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gross weight</span>
                  <span className="font-bold text-foreground">{totalWeightText} kg</span>
                </div>
                <div className="text-right">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Line Total</span>
                  <span className="font-bold text-foreground">{formatPaiseInr(billNet.linesTotalPaise)}</span>
                </div>
                {(() => {
                  const netAdjustments = billNet.otherAdjustmentsPaise - billNet.qualityCutPaise
                  return (
                    <div className="text-right">
                      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Adjustments</span>
                      <span className={`font-bold ${netAdjustments > 0 ? 'text-blue-700' : netAdjustments < 0 ? 'text-amber-700' : 'text-foreground'}`}>
                        {formatPaiseInr(netAdjustments)}
                      </span>
                    </div>
                  )
                })()}
                <div className="text-right">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Bardan</span>
                  <span className={billNet.bardanDeductPaise ? 'font-bold text-rose-700' : 'font-bold text-foreground'}>{billNet.bardanDeductPaise ? `−${formatPaiseInr(billNet.bardanDeductPaise)}` : formatPaiseInr(0)}</span>
                </div>
                <div className="text-right">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Net Payable</span>
                  <span className="font-bold text-emerald-800">{formatPaiseInr(billNet.netPaise)}</span>
                </div>
              </div>
            </div>
          </Panel>

          {draftId && (draftBardan.length > 0 || draftQuery.data?.parsed.kind === 'valid') && <Panel className="space-y-3 p-3">
            <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">Draft Bardan</h3><p className="text-xs text-slate-600">Confirm each bag settlement before saving.</p></div><button type="button" className={buttonClass('secondary')} onClick={() => setDraftBardan((rows) => [...rows, { id: generateLineId(), weightKgStr: '', rateRupeesStr: '', method: 'deduct', creditRupeesStr: '', cashRupeesStr: '', date, note: '' }])}>Add Bardan</button></div>
            {draftBardan.map((entry, index) => <div key={entry.id} className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 sm:grid-cols-3">
              <label className="text-xs font-medium text-slate-600">Method<select className={`${inputClass} mt-1`} value={entry.method} onChange={(event) => setDraftBardan((rows) => rows.map((row) => row.id === entry.id ? { ...row, method: event.target.value as DraftBardanFormItem['method'] } : row))}>{['deduct', 'in_kind', 'cash_back', 'advance'].map((method) => <option key={method} value={method}>{method.replace('_', ' ')}</option>)}</select></label>
              <label className="text-xs font-medium text-slate-600">Bardan kg<input className={`${inputClass} mt-1`} inputMode="decimal" value={entry.weightKgStr} onChange={(event) => setDraftBardan((rows) => rows.map((row) => row.id === entry.id ? { ...row, weightKgStr: event.target.value } : row))} /></label>
              <label className="text-xs font-medium text-slate-600">Rate ₹/kg<input className={`${inputClass} mt-1`} inputMode="decimal" value={entry.rateRupeesStr} onChange={(event) => setDraftBardan((rows) => rows.map((row) => row.id === entry.id ? { ...row, rateRupeesStr: event.target.value } : row))} /></label>
              <label className="text-xs font-medium text-slate-600">Credit ₹ (blank = calculated)<input className={`${inputClass} mt-1`} inputMode="decimal" value={entry.creditRupeesStr} onChange={(event) => setDraftBardan((rows) => rows.map((row) => row.id === entry.id ? { ...row, creditRupeesStr: event.target.value } : row))} /></label>
              {entry.method === 'cash_back' && <label className="text-xs font-medium text-slate-600">Cash memo ₹<input className={`${inputClass} mt-1`} inputMode="decimal" value={entry.cashRupeesStr} onChange={(event) => setDraftBardan((rows) => rows.map((row) => row.id === entry.id ? { ...row, cashRupeesStr: event.target.value } : row))} /></label>}
              <label className="text-xs font-medium text-slate-600">Line<select className={`${inputClass} mt-1`} value={entry.rateLineIndex ?? ''} onChange={(event) => setDraftBardan((rows) => rows.map((row) => row.id === entry.id ? { ...row, rateLineIndex: event.target.value ? Number(event.target.value) : undefined } : row))}><option value="">No linked line</option>{lines.map((line, lineIndex) => <option key={line.id} value={lineIndex}>{line.itemName || `Line ${lineIndex + 1}`}</option>)}</select></label>
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">Note<input className={`${inputClass} mt-1`} value={entry.note} onChange={(event) => setDraftBardan((rows) => rows.map((row) => row.id === entry.id ? { ...row, note: event.target.value } : row))} /></label>
              <button type="button" className={buttonClass('secondary')} onClick={() => setDraftBardan((rows) => rows.filter((row) => row.id !== entry.id))}>Remove {index + 1}</button>
            </div>)}
            {parsedDraftBardan === null && <p role="alert" className="text-xs font-semibold text-rose-700">Complete each bardan number before saving.</p>}
          </Panel>}

          {!editBillId && !draftId && <Panel className="p-3">
            <button type="button" onClick={() => setBardanOpen((open) => !open)} aria-expanded={bardanOpen} className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left transition hover:bg-secondary">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Settle bardan on this bill
                {draftBardan.length > 0 && <span className="rounded-full bg-secondary px-1.5 py-0.5 font-bold text-foreground normal-case tracking-normal">{draftBardan.length}</span>}
              </span>
              <ChevronDown size={14} className={`text-muted-foreground transition-transform ${bardanOpen ? '' : '-rotate-90'}`} />
            </button>
            {bardanOpen && <div className="mt-2 rounded-lg border border-border bg-secondary/50 p-2">
              {draftBardan.length > 0 && <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[375px] border-collapse text-left text-xs">
                  <thead className="border-b border-slate-200 text-slate-600">
                    <tr><th scope="col" className="py-1.5 pr-2">Item / rate</th><th scope="col" className="px-2 py-1.5">Bardan kg</th><th scope="col" className="px-2 py-1.5">Bags / kg per bag</th><th scope="col"><span className="sr-only">Remove</span></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draftBardan.map((entry, index) => {
                      const line = parsedLines.find((row) => row.id === entry.rateLineKey)
                      const bags = purchaseReceiptBagCount(line?.bardanStr)
                      const kg = Number(entry.weightKgStr)
                      return <tr key={entry.id}>
                        <td className="py-1.5 pr-2"><select aria-label={`Bardan item and rate, row ${index + 1}`} className={`${inputClass} w-full`} value={entry.rateLineKey ?? ''} onChange={(event) => setDraftBardan((rows) => rows.map((row) => row.id === entry.id ? { ...row, rateLineKey: event.target.value } : row))}>
                          <option value="">Choose a bill line</option>
                          {parsedLines.map((row) => row.itemName && row.rateMilli > 0 && <option value={row.id} key={row.id}>{row.itemName} · {formatChittyRate(row.rateMilli)}/kg</option>)}
                        </select></td>
                        <td className="w-24 px-2 py-1.5"><input aria-label={`Bardan weight in kg, row ${index + 1}`} className={`${inputClass} w-full`} inputMode="decimal" value={entry.weightKgStr} onChange={(event) => setDraftBardan((rows) => rows.map((row) => row.id === entry.id ? { ...row, weightKgStr: event.target.value } : row))} /></td>
                        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-600">{bags > 0 ? `${bags} bags` : '—'}{bags > 0 && Number.isFinite(kg) && kg > 0 && <span className="block">{(kg / bags).toFixed(2)} kg/bag</span>}</td>
                        <td className="py-1.5 text-right"><button type="button" className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700" aria-label={`Remove bardan row ${index + 1}`} onClick={() => setDraftBardan((rows) => rows.filter((row) => row.id !== entry.id))}>×</button></td>
                      </tr>
                    })}
                  </tbody>
                </table>
              </div>}
              {draftBardan.length > 0 && <p className="mt-2 text-xs" role="status">{parsedDraftBardan ? `Bardan credit ${formatPaiseInr(billNet.bardanDeductPaise)} · Bill net ${formatPaiseInr(billNet.netPaise)}` : 'Enter a weight and select a rate line for each entry.'}</p>}
              <button type="button" className={`${buttonClass('secondary')} mt-2`} onClick={() => {
                const eligible = parsedLines.flatMap((line, index) => line.itemName && line.rateMilli > 0 ? [index] : [])
                const marked = eligible.filter((index) => purchaseReceiptMemoText(parsedLines[index].bardanStr))
                const choices = marked.length ? marked : eligible
                setDraftBardan((rows) => [...rows, { id: generateLineId(), rateLineKey: choices.length === 1 ? parsedLines[choices[0]].id : undefined, weightKgStr: '', rateRupeesStr: '', method: 'deduct', creditRupeesStr: '', cashRupeesStr: '', date, note: '' }])
              }}>Add Bardan</button>
            </div>}
          </Panel>}

          {/* Adjustments — collapsible with count */}
          <Panel className="p-3">
            <button
              type="button"
              onClick={toggleAdjustments}
              aria-expanded={adjustedOpen}
              className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left transition hover:bg-secondary"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Adjustments
                {adjustments.length > 0 && (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-bold text-foreground normal-case tracking-normal">{adjustments.length}</span>
                )}
              </span>
              <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${adjustedOpen ? '' : '-rotate-90'}`} />
            </button>
            {adjustedOpen && (
              <div className="mt-2 space-y-2">
                <p className="px-1 text-[11px] text-muted-foreground">Labour, transport, quality deductions, or other signed adjustments.</p>
                {adjustments.length === 0 && <p className="px-1 text-[11px] italic text-slate-400">No adjustments yet.</p>}
                {adjustments.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/50 p-2 text-xs">
                    <select
                      value={a.type}
                      onChange={(e) => updateAdjustment(a.id, { type: e.target.value as PurchaseAdjustmentType })}
                      aria-label="Adjustment type"
                      className="h-8 rounded-md border border-border bg-card px-2 font-medium text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                    >
                      <option value="labour">Labour (+)</option>
                      <option value="transport">Transport (+)</option>
                      <option value="quality_cut">Quality Cut (Deduction -)</option>
                      <option value="other">Other (+ / -)</option>
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Amount ₹ (e.g. 500 or -200)"
                      value={a.amountRupeesStr}
                      onChange={(e) => updateAdjustment(a.id, { amountRupeesStr: e.target.value })}
                      aria-label="Adjustment amount in rupees"
                      className="h-8 w-36 rounded-md border border-border bg-card px-2 font-mono tabular-nums text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                    />
                    <input
                      type="text"
                      placeholder="Note / remark"
                      value={a.note}
                      onChange={(e) => updateAdjustment(a.id, { note: e.target.value })}
                      aria-label="Adjustment note"
                      className="h-8 min-w-[140px] flex-1 rounded-md border border-border bg-card px-2 text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                    />
                    <button
                      type="button"
                      onClick={() => removeAdjustment(a.id)}
                      aria-label="Remove adjustment"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addAdjustment}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-50"
                >
                  <Plus size={12} /> Add adjustment
                </button>
              </div>
            )}
          </Panel>

          {/* Notes & photos — collapsible with count */}
          <Panel className="p-3">
            <button
              type="button"
              onClick={toggleNotes}
              aria-expanded={notesOpen}
              className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left transition hover:bg-secondary"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Notes &amp; photos
                {notesCount > 0 && (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-bold text-foreground normal-case tracking-normal">{notesCount}</span>
                )}
              </span>
              <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${notesOpen ? '' : '-rotate-90'}`} />
            </button>
            {notesOpen && (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="private-note" className="text-[11px] font-semibold text-slate-600">Private note <span className="font-normal text-muted-foreground">(never printed)</span></label>
                  <textarea
                    id="private-note"
                    rows={3}
                    placeholder="Internal memo, delivery instructions, quality notes…"
                    value={privateNote}
                    onChange={(e) => setPrivateNote(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-card p-2 text-xs text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                  />
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-slate-600">Attach photos / slips</span>
                  <div className="mt-1 rounded-md border border-dashed border-border bg-secondary/50 p-3 text-center">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm ring-1 ring-border transition hover:bg-secondary">
                      <Upload size={13} />
                      <span>Choose photos</span>
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
                    <p className="mt-1 text-[11px] text-muted-foreground">Slips, weighbridge receipts, or brass photos</p>
                  </div>
                  {photos.length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {photos.map((file, i) => (
                        <li key={i} className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-[11px] text-slate-700">
                          <ImageIcon size={11} /> {file.name}
                          <button
                            type="button"
                            aria-label={`Remove ${file.name}`}
                            onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                            className="text-muted-foreground transition hover:text-rose-600"
                          >
                            <X size={11} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Panel>

        {!editBillId && (
          <Panel className="p-3">
            <button
              type="button"
              onClick={() => {
                paymentTouchedRef.current = true
                setPaymentOpen((open) => !open)
              }}
              aria-expanded={paymentOpen}
              className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left transition hover:bg-secondary"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Payment with bill
                {billDayPaymentPaise > 0 && (
                  <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 normal-case tracking-normal">
                    {formatPaiseInr(billDayPaymentPaise)}
                  </span>
                )}
              </span>
              <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${paymentOpen ? '' : '-rotate-90'}`} />
            </button>
            {paymentOpen && (
              <div className="mt-2 space-y-3">
                <p className="px-1 text-[11px] text-muted-foreground">
                  Optional. Amount accepts shorthand like 350, 3.5l, 50k. Saved with this bill and applied to it first.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-slate-600">Amount paid (₹)
                    {draftId ? <input type="text" inputMode="decimal" value={draftPaymentStr} onChange={(event) => setDraftPaymentStr(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" /> : <PaymentAmountInput
                      value={paymentAmountRupees}
                      onChange={setPaymentAmountRupees}
                      className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                    />}
                  </label>
                  <label className="text-xs font-medium text-slate-600">Payment date
                    <input type="date" className={`${inputClass} mt-1`} value={paymentDate} onChange={(event) => setPaymentDateOverride(event.target.value || null)} />
                  </label>
                  <label className="text-xs font-medium text-slate-600">Mode
                    <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as typeof paymentMode)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2 text-sm">
                      {SUPPLIER_PAYMENT_MODES.map((option) => <option key={option} value={option}>{option === 'cash' ? 'Cash' : option === 'cheque' ? 'Cheque' : option === 'other' ? 'Other' : option.toUpperCase()}</option>)}
                    </select>
                  </label>
                  {paymentMode !== 'cash' && <label className="text-xs font-medium text-slate-600">Reference
                    <input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" />
                  </label>}
                </div>
                <label className="block text-xs font-medium text-slate-600">Note
                  <input
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    placeholder="e.g. Cash given at gate, receipt no. 42"
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>
              </div>
            )}
          </Panel>
        )}

        {/* Sticky bottom action bar — left pane only */}
        <div className={`shrink-0 border-t border-border bg-card px-4 py-3 shadow-sm sm:px-6 ${isPage ? '' : 'sticky bottom-0 z-20 rounded-b-xl'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs tabular-nums text-muted-foreground">
                <span className="font-bold text-foreground">{totalWeightText} kg</span>
                <span className="px-1.5 text-slate-300">·</span>
                <span className="whitespace-nowrap">Net <strong className="text-foreground">{formatPaiseInr(billNet.netPaise)}</strong></span>
              </p>
              {validationHint && (
                <p className="mt-0.5 text-[11px] font-medium text-amber-700">{validationHint}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isPage && (
                <button
                  type="button"
                  onClick={requestBack}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-xs hover:bg-secondary transition"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => isFormValid && requestSave()}
                disabled={!isFormValid || saveMutation.isPending}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Saving…' : editBillId ? 'Update Bill' : 'Save Bill'}
                <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[11px]">Ctrl+↵</kbd>
              </button>
            </div>
          </div>
        </div>
      </section>

        {/* ============ RIGHT PANE — live preview + launchpad / supplier brief ============ */}
        {isPage && <aside
          aria-label="Live bill preview"
          className="flex min-w-0 w-full flex-col gap-3 xl:sticky xl:top-4 xl:self-start"
        >
        <section aria-label="Bill chitty preview" className={`min-w-0 rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:p-3 ${saveConfirmOpen ? 'print:hidden' : ''}`}>
          <BillChitty data={billChittyData} mode="preview" />
        </section>

        <div className="shrink-0">
          {!supplierId ? (
            <LaunchpadCard
              recentBills={cachedRecentBills}
            />
          ) : selectedSupplier ? (
            <section aria-label="Supplier brief" className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Supplier brief</p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm font-bold text-foreground">
                    <Building2 size={13} className="shrink-0 text-blue-600" />
                    <span className="truncate">{selectedSupplier.companyName}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {[selectedSupplier.city, selectedSupplier.phone ? `📞 ${selectedSupplier.phone}` : '', selectedSupplier.gstNo ? `GST ${selectedSupplier.gstNo}` : ''].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBriefOpen((open) => !open)}
                  aria-expanded={briefOpen}
                  aria-label={briefOpen ? 'Hide supplier brief' : 'Show supplier brief'}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary lg:hidden"
                >
                  <ChevronDown size={16} className={`transition-transform duration-200 ${briefOpen ? '' : '-rotate-90'}`} />
                </button>
              </div>

              <div className={briefOpen ? 'block' : 'hidden lg:block'}>
                {supplierBundleQuery.isLoading ? (
                  <p className="mt-3 text-[11px] text-muted-foreground">Loading dues…</p>
                ) : supplierContext ? (
                  <>
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Projected amount we owe after saving</p>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">{formatPaiseInr(projectedSettlement?.supplierDuePaise ?? supplierContext.outstandingPaise)}</p>
                      <p className="mt-1 text-[11px] text-slate-500">Includes this bill, payment today, and any existing supplier credits.</p>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <BriefStat label="Kacha due" value={supplierContext.kachaDuePaise > 0 ? formatPaiseInr(supplierContext.kachaDuePaise) : '—'} tone="amber" />
                      <BriefStat label="GST due" value={supplierContext.gstDuePaise > 0 ? formatPaiseInr(supplierContext.gstDuePaise) : '—'} tone="blue" />
                      <BriefStat label="Advance" value={supplierContext.advancePaise > 0 ? formatPaiseInr(supplierContext.advancePaise) : '—'} tone="emerald" />
                      <BriefStat label="Bills" value={`${supplierContext.billsCount} · ${supplierContext.openCount} open`} tone="slate" />
                    </dl>
                    {(supplierContext.lastBillDate || supplierContext.lastRateMilli != null) && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {supplierContext.lastBillDate && <>Last bill <strong className="text-foreground">{formatFullDate(supplierContext.lastBillDate)}</strong></>}
                        {supplierContext.lastBillDate && supplierContext.lastRateMilli != null && <span className="px-1.5 text-slate-300">·</span>}
                        {supplierContext.lastRateMilli != null && <>last rate paid ₹{milliToRateText(supplierContext.lastRateMilli)}/kg</>}
                      </p>
                    )}
                    {supplierContext.advancePaise > 0 && (
                      <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-800">
                        Advance of {formatPaiseInr(supplierContext.advancePaise)} on file — bills clear against it first.
                      </p>
                    )}
                    {supplierContext.bardanPendingCount > 0 && (
                      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
                        ⚠ {supplierContext.bardanPendingCount} bill{supplierContext.bardanPendingCount === 1 ? '' : 's'} with bardan pending — collect empty bags before paying.
                      </p>
                    )}
                    {selectedSupplier.notes && (
                      <p className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-secondary/60 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
                        <span className="mr-1 font-semibold uppercase tracking-wider text-slate-400">Note</span>{selectedSupplier.notes}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-3 text-[11px] text-muted-foreground">Supplier has no purchase history yet.</p>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </aside>}

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this bill?"
        description="Your unsaved changes will be lost."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => {
          setDiscardOpen(false)
          if (onDiscard) onDiscard()
          else window.history.back()
        }}
      />

      <Dialog open={saveConfirmOpen} onOpenChange={(open) => { if (!saveMutation.isPending) setSaveConfirmOpen(open) }}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[780px]"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            saveConfirmButtonRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Check this bill before saving</DialogTitle>
            <DialogDescription asChild>
              <div className="text-xs leading-5 text-muted-foreground">This is what will print. Amounts and the payment line are final once saved.</div>
            </DialogDescription>
          </DialogHeader>
          {billDayPaymentPaise > 0 && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
              This bill records {paymentMode === 'cash' ? 'a cash' : paymentMode === 'cheque' ? 'a cheque' : 'an'} payment of{' '}
              <strong className="whitespace-nowrap font-mono tabular-nums">{formatPaiseInr(billDayPaymentPaise)}</strong> dated {formatFullDate(paymentDate)}
              {paymentNote.trim() ? <> — “{paymentNote.trim()}”</> : null}.
            </p>
          )}
          <div className="overflow-hidden rounded-lg border border-border bg-slate-50 p-2">
            <BillChitty data={billChittyData} mode="preview" density="dialog" />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setSaveConfirmOpen(false)}
              disabled={saveMutation.isPending}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-xs font-semibold text-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Go back
            </button>
            <button
              ref={saveConfirmButtonRef}
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={!isFormValid || saveMutation.isPending}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : editBillId ? 'Update bill' : 'Save bill'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  )
}

function BriefStat({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'blue' | 'emerald' | 'slate' }) {
  const toneClass =
    tone === 'amber' ? 'text-amber-700' : tone === 'blue' ? 'text-blue-800' : tone === 'emerald' ? 'text-emerald-700' : 'text-foreground'
  return (
    <div className="rounded-md border border-border bg-secondary/60 px-2 py-1.5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 truncate font-mono text-[11px] font-bold tabular-nums ${toneClass}`} title={value}>
        {value}
      </dd>
    </div>
  )
}


/**
 * Centered modal wrapper around the same editor, per the operational plan:
 * Edit is a modal on the current page; View stays a dedicated full page.
 * Esc and the close button ask to discard unsaved changes; Ctrl+Enter saves.
 */
export function PurchaseBillEditDialog({
  billId,
  inNo,
  onClose,
}: {
  billId: string | null
  inNo?: string
  onClose: () => void
}) {
  const [dirty, setDirty] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (!billId) return null

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (open) return
          if (dirty) setConfirmOpen(true)
          else onClose()
        }}
      >
        <DialogContent className="flex h-auto max-h-[92vh] min-w-0 flex-col overflow-hidden p-0 sm:max-w-5xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <DialogTitle className="text-sm font-semibold text-slate-950">Edit purchase bill</DialogTitle>
              <p className="text-[11px] font-mono text-slate-400">{inNo ?? billId}</p>
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 sm:px-4">
            <PurchaseBillEditor
              variant="modal"
              editBillId={billId}
              onSaved={() => onClose()}
              onDirtyChange={setDirty}
            />
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Discard this bill?"
        description="Your unsaved changes to this bill will be lost. The bill itself is unchanged."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => {
          setConfirmOpen(false)
          onClose()
        }}
      />
    </>
  )
}
