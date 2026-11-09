import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  Plus,
  Power,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { PurchasedVsPaidTrendChart } from '@/components/reports/company-charts'
import {
  SupplierFormModal,
  type SupplierFormState,
} from '@/components/suppliers/supplier-form-modal'
import {
  AddBardanModal,
  CancelBillModal,
  RecordPaymentModal,
  SettleToNilModal,
  PaymentDetailsModal,
} from '@/components/suppliers/bill-modals'
import {
  PurchaseBillsTable,
  itemsSummary,
  type BillsTableRow,
} from '@/components/suppliers/purchase-bills-table'
import { SupplierPaymentsTable } from '@/components/suppliers/supplier-payments-table'
import { DateInput } from '@/components/ui/date-input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  computeSupplierBundleLedger,
  deactivateSupplier,
  reactivateSupplier,
  updateSupplier,
  type SupplierBundle,
  type SupplierUpsertInput,
} from '@/data/suppliers'
import { supplierContextQueryOptions, supplierPaymentsQueryOptions } from '@/data/purchase-queries'
import { CREDIT_KINDS } from '@/domain/supplier-settlement'
import { computeDaysSince } from '@/domain/supplier-purchases'
import { normalizeItemName } from '@/domain/purchase-item-name'
import { gramsToKgText, milliToRateText, rupeesToPaise } from '@/domain/supplier-units'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { exportNodeAsJpg } from '@/lib/image-export'
import { formatInrInteger, formatPaiseInr } from '@/lib/inr-format'

const searchSchema = z.object({
  highlightBill: z.string().optional(),
  tab: z.enum(['ledger', 'bills', 'payments']).optional(),
})

export const Route = createFileRoute('/supplier-ledger/$supplierId')({
  validateSearch: searchSchema,
  beforeLoad: ({ params, search }) => { throw redirect({ to: '/ledger', search: { tab: 'suppliers', supplierId: params.supplierId, supplierSection: search.tab, highlightBill: search.highlightBill } }) },
})

type PoolFilter = 'all' | 'kacha' | 'gst'

const fmtKg = (kg: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(kg)

type SupplierLedgerTab = 'ledger' | 'bills' | 'payments'

/** Full supplier account: summary, ledger, bills, payments. Route-agnostic so the
 *  suppliers hub can embed it as the master-detail right pane. */
export function SupplierLedgerDetail({
  supplierId,
  tab: tabProp = 'ledger',
  highlightBill,
  showBack = true,
  onTabChange,
}: {
  supplierId: string
  tab?: SupplierLedgerTab
  highlightBill?: string
  showBack?: boolean
  onTabChange?: (tab: SupplierLedgerTab) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const exportRef = useRef<HTMLDivElement>(null)
  const [isExporting, setIsExporting] = useState(false)
  const tab = tabProp ?? 'ledger'

  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [expandedBillIds, setExpandedBillIds] = useState<Set<string>>(new Set())
  const [showTrendChart, setShowTrendChart] = useState(false)

  // Drawer & Modals state
  const [billModal, setBillModal] = useState<null | { type: 'bardan' | 'payment' | 'settleNil' | 'cancelBill'; row: BillsTableRow }>(null)
  const [paymentDetailsId, setPaymentDetailsId] = useState<string | null>(null)

  // Supplier Edit state
  const [editSupplierOpen, setEditSupplierOpen] = useState(false)
  const [supplierFormState, setSupplierFormState] = useState<SupplierFormState | null>(null)
  const [supplierError, setSupplierError] = useState('')
  const [deactivateOpen, setDeactivateOpen] = useState(false)

  const bundleQuery = useQuery(supplierContextQueryOptions(supplierId))
  const paymentsQuery = useQuery(supplierPaymentsQueryOptions())
  const bundle = bundleQuery.data?.bundle
  const settlement = bundleQuery.data?.settlement ?? null

  const billSettlementMap = useMemo(() => {
    const map = new Map<string, { status: string; bardanPending: boolean; paidPaise: number; duePaise: number; netPaise: number }>()
    if (settlement) {
      for (const b of [...settlement.pools.kacha.bills, ...settlement.pools.gst.bills]) {
        map.set(b.billId, { status: b.status, bardanPending: b.bardanPending, paidPaise: b.paidPaise, duePaise: b.duePaise, netPaise: b.netPaise })
      }
    }
    return map
  }, [settlement])

  const bardanPendingCount = useMemo(() => {
    if (!settlement) return 0
    return [...settlement.pools.kacha.bills, ...settlement.pools.gst.bills].filter((b) => b.bardanPending).length
  }, [settlement])

  // ---- Bills tab rows (enriched from the bundle) ----
  const billRows = useMemo<BillsTableRow[]>(() => {
    if (!bundle) return []
    return bundle.bills.map((bill) => {
      const lines = bundle.lines.filter((l) => l.billId === bill.id)
      const s = billSettlementMap.get(bill.id)
      const totalKg = lines.reduce((sum, l) => sum + l.weightG, 0) / 1000
      return {
        id: bill.id,
        inNo: bill.inNo,
        date: bill.date,
        supplierId: bill.supplierId,
        supplierName: bundle.supplier.companyName,
        pool: bill.pool,
        itemsSummary: itemsSummary(lines),
        totalKg,
        netPaise: s?.netPaise ?? 0,
        paidPaise: s?.paidPaise ?? 0,
        duePaise: s?.duePaise ?? 0,
        daysOld: computeDaysSince(bill.date),
        bardanPending: s?.bardanPending ?? false,
        status: (s?.status as BillsTableRow['status']) ?? (bill.cancelled ? 'cancelled' : 'open'),
        cancelled: bill.cancelled,
      }
    })
  }, [bundle, billSettlementMap])

  // The shared projection is newest first; keep the detail table's chronological input.
  const paymentRows = useMemo(
    () => (paymentsQuery.data ?? []).filter((payment) => payment.supplierId === supplierId).reverse(),
    [paymentsQuery.data, supplierId],
  )

  const ledgerResult = useMemo(() => {
    if (!bundle) return null
    return computeSupplierBundleLedger(bundle, { pool: poolFilter, from: fromDate || undefined, to: toDate || undefined })
  }, [bundle, poolFilter, fromDate, toDate])

  // ---- Monthly trend: purchased vs paid, last 6 months ----
  const trendData = useMemo(() => {
    if (!bundle) return []
    const months: Array<{ key: string }> = []
    const now = new Date()
    for (let offset = 5; offset >= 0; offset--) {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1)
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
    }
    return months.map(({ key }) => {
      let purchased = 0
      let paid = 0
      for (const bill of bundle.bills) {
        if (bill.cancelled || bill.date.slice(0, 7) !== key) continue
        purchased += billSettlementMap.get(bill.id)?.netPaise ?? 0
      }
      for (const payment of bundle.payments) {
        if (payment.cancelled || !CREDIT_KINDS.has(payment.kind) || payment.date.slice(0, 7) !== key) continue
        paid += payment.amountPaise
      }
      return { month: `${key}-01`, purchased: purchased / 100, paid: paid / 100 }
    })
  }, [bundle, billSettlementMap])

  // Material and scrap purchases breakdown for this supplier
  const materialPurchases = useMemo(() => {
    if (!bundle) return []
    const map = new Map<
      string,
      {
        name: string
        billsCount: number
        totalKg: number
        totalAmountRupees: number
        lastRate: number
        lastDate: string
      }
    >()
    const bMap = new Map(bundle.bills.map((b) => [b.id, b]))

    for (const line of bundle.lines) {
      const bill = bMap.get(line.billId)
      if (bill?.cancelled) continue
      const normName = normalizeItemName(line.itemName)
      const key = normName.toLowerCase()
      const cur = map.get(key) ?? {
        name: normName,
        billsCount: 0,
        totalKg: 0,
        totalAmountRupees: 0,
        lastRate: 0,
        lastDate: '',
      }
      cur.totalKg += line.weightG / 1000
      cur.totalAmountRupees += line.amountPaise / 100
      cur.billsCount += 1
      if (!cur.lastDate || (bill?.date && bill.date >= cur.lastDate)) {
        cur.lastDate = bill?.date ?? ''
        cur.lastRate = line.rateMilli / 1000
      }
      map.set(key, cur)
    }

    const totalKgAll = Array.from(map.values()).reduce((sum, r) => sum + r.totalKg, 0)

    return Array.from(map.values())
      .map((r) => ({
        ...r,
        avgRate: r.totalKg > 0 ? r.totalAmountRupees / r.totalKg : 0,
        share: totalKgAll > 0 ? (r.totalKg / totalKgAll) * 100 : 0,
      }))
      .sort((a, b) => b.totalKg - a.totalKg)
  }, [bundle])

  const billMap = useMemo(() => new Map((bundle?.bills ?? []).map((b) => [b.id, b])), [bundle])
  const paymentMap = useMemo(() => new Map((bundle?.payments ?? []).map((p) => [p.id, p])), [bundle])

  const mergedRows = useMemo(() => {
    if (!bundle || !ledgerResult) return []
    const rows: MergedRow[] = []

    for (const entry of ledgerResult.entries) {
      const bill = entry.kind === 'bill' ? billMap.get(entry.id) : undefined
      const payment = paymentMap.get(entry.id)
      const bInfo = bill ? billSettlementMap.get(bill.id) : undefined

      let debitPaise = 0
      let creditPaise = 0
      if (entry.amountPaise > 0) debitPaise = entry.amountPaise
      else if (entry.amountPaise < 0) creditPaise = -entry.amountPaise

      rows.push({
        id: entry.id,
        date: entry.date,
        created: entry.created,
        pool: entry.pool,
        kind: entry.kind,
        caption: captionFor(entry.kind, entry.label ?? entry.kind, bill, payment, bundle),
        debitPaise,
        creditPaise,
        balancePaise: entry.balancePaise,
        cancelled: false,
        billId: bill?.id,
        inNo: bill?.inNo,
        paymentId: payment?.id,
        modeOrRef: payment ? [payment.mode, payment.reference].filter(Boolean).join(' · ').toUpperCase() : '',
        isSettled: bInfo?.status === 'nil',
        isBardanPending: bInfo?.bardanPending,
      })
    }

    for (const bill of bundle.bills.filter((b) => b.cancelled)) {
      if (poolFilter !== 'all' && bill.pool !== poolFilter) continue
      if (fromDate && bill.date < fromDate) continue
      if (toDate && bill.date > toDate) continue
      rows.push({
        id: bill.id,
        date: bill.date,
        created: bill.created,
        pool: bill.pool,
        kind: 'bill',
        caption: `Bill ${bill.inNo} · (cancelled)`,
        debitPaise: 0,
        creditPaise: 0,
        balancePaise: null,
        cancelled: true,
        cancelReason: bill.cancelReason,
        billId: bill.id,
        inNo: bill.inNo,
      })
    }
    for (const payment of bundle.payments.filter((p) => p.cancelled)) {
      if (poolFilter !== 'all' && payment.pool !== poolFilter) continue
      if (fromDate && payment.date < fromDate) continue
      if (toDate && payment.date > toDate) continue
      rows.push({
        id: payment.id,
        date: payment.date,
        created: payment.created,
        pool: payment.pool,
        kind: 'payment',
        caption: `Payment · (cancelled)`,
        debitPaise: 0,
        creditPaise: 0,
        balancePaise: null,
        cancelled: true,
        cancelReason: payment.cancelReason,
        paymentId: payment.id,
      })
    }

    return rows.sort((a, b) => `${a.date}|${a.created}`.localeCompare(`${b.date}|${b.created}`))
  }, [bundle, ledgerResult, billMap, paymentMap, billSettlementMap, poolFilter, fromDate, toDate])

  const updateSupplierMutation = useMutation({
    mutationFn: async (formState: SupplierFormState) => {
      const kachaSign = formState.openingKachaDirection === 'we_owe' ? 1 : -1
      const gstSign = formState.openingGstDirection === 'we_owe' ? 1 : -1
      const payload: SupplierUpsertInput = {
        companyName: formState.companyName.trim(),
        contactName: formState.contactName,
        phone: formState.phone,
        gstNo: formState.gstNo,
        city: formState.city,
        notes: formState.notes,
        openingKachaPaise: kachaSign * rupeesToPaise(formState.openingKachaRupees),
        openingGstPaise: gstSign * rupeesToPaise(formState.openingGstRupees),
        openingBalanceDate: formState.openingBalanceDate,
        active: formState.active,
      }
      await updateSupplier(supplierId, payload)
    },
    onSuccess: async () => {
      setEditSupplierOpen(false)
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
    },
    onError: (error) => setSupplierError(toUserMessage(error)),
  })

  // Deactivate/reactivate lives here so the hub keeps supplier status controls
  // even though the standalone list page became a master-detail view.
  const statusMutation = useMutation({
    mutationFn: async () => {
      if (bundle?.supplier.active) await deactivateSupplier(supplierId)
      else await reactivateSupplier(supplierId)
    },
    onSuccess: async () => {
      setDeactivateOpen(false)
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
    },
    onError: (error) => setSupplierError(toUserMessage(error)),
  })

  const openEditSupplier = () => {
    if (!bundle) return
    const s = bundle.supplier
    setSupplierFormState({
      id: s.id,
      companyName: s.companyName,
      contactName: s.contactName ?? '',
      phone: s.phone ?? '',
      gstNo: s.gstNo ?? '',
      city: s.city ?? '',
      notes: s.notes ?? '',
      openingKachaRupees: Math.abs(s.openingKachaPaise) / 100,
      openingKachaDirection: s.openingKachaPaise >= 0 ? 'we_owe' : 'they_owe',
      openingGstRupees: Math.abs(s.openingGstPaise) / 100,
      openingGstDirection: s.openingGstPaise >= 0 ? 'we_owe' : 'they_owe',
      openingBalanceDate: s.openingBalanceDate ?? '',
      active: s.active,
    })
    setSupplierError('')
    setEditSupplierOpen(true)
  }

  async function handleExportJpg() {
    if (!exportRef.current || !bundle) return
    setIsExporting(true)
    try {
      await exportNodeAsJpg(exportRef.current, { filename: `${bundle.supplier.companyName}-ledger-${getLocalIsoDate()}.jpg` })
    } catch (err) {
      console.error('Ledger export failed', err)
    } finally {
      setIsExporting(false)
    }
  }

  const applyThisMonthPreset = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    setFromDate(`${year}-${month}-01`)
    setToDate(getLocalIsoDate())
  }

  const applyLast30DaysPreset = () => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    setFromDate(getLocalIsoDate(thirtyDaysAgo))
    setToDate(getLocalIsoDate())
  }

  if (bundleQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
        Loading supplier statement…
      </div>
    )
  }

  if (bundleQuery.isError || !bundle) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm font-semibold text-rose-600">Failed to load this supplier.</p>
        <Link to="/suppliers" className="inline-flex items-center gap-1.5 text-xs text-blue-700 underline font-medium">
          <ArrowLeft size={14} /> Back to suppliers directory
        </Link>
      </div>
    )
  }

  const s = bundle.supplier

  return (
    <div className="min-w-0 p-3 sm:p-5 space-y-4">
      {/* 1. Supplier Summary Card */}
      <section className="rounded-xl border border-border bg-card p-3.5 sm:p-4 shadow-xs space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void navigate({ to: '/suppliers' })}
              aria-label="Back to suppliers"
              className={showBack ? 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-xs transition hover:bg-secondary hover:text-foreground' : 'hidden'}
            >
              <ArrowLeft size={15} />
            </button>
            <h2 className="truncate text-sm font-semibold text-slate-950">{s.companyName}</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 ${
                s.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-secondary text-muted-foreground'
              }`}
            >
              {s.active ? 'Active' : 'Inactive'}
            </span>
            {bardanPendingCount > 0 && (
              <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800 shrink-0">
                {bardanPendingCount} bardan
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <Link
              to="/new-purchase-bill"
              search={{ supplierId: s.id }}
              className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg bg-primary px-3 sm:px-4 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition"
            >
              <Plus size={14} /> Bill
            </Link>
            <Link
              to="/new-supplier-payment"
              search={{ supplierId: s.id }}
              className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 transition"
            >
              <Wallet size={14} /> Payment
            </Link>
            <button
              type="button"
              onClick={openEditSupplier}
              className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-xs hover:bg-secondary transition"
            >
              <Edit3 size={14} /> Edit
            </button>
            <button
              type="button"
              onClick={() => (s.active ? setDeactivateOpen(true) : statusMutation.mutate())}
              disabled={statusMutation.isPending}
              className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted-foreground shadow-xs hover:bg-secondary hover:text-foreground disabled:opacity-50 transition"
              title={s.active ? 'Hide from active lists, history stays' : 'Show the supplier again'}
            >
              <Power size={14} /> {s.active ? 'Deactivate' : 'Reactivate'}
            </button>
            {tab === 'ledger' && (
              <button
                type="button"
                onClick={() => void handleExportJpg()}
                disabled={isExporting}
                className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-xs hover:bg-secondary disabled:opacity-50 transition"
              >
                <Download size={14} /> {isExporting ? 'Exporting…' : 'JPG'}
              </button>
            )}
          </div>
        </div>

        {/* Supplier Metadata Subline */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border/60 pt-2.5">
          <span>City: <strong className="text-foreground">{s.city || '—'}</strong></span>
          {s.phone && <span>Phone: <strong className="font-mono text-foreground">{s.phone}</strong></span>}
          {s.contactName && <span>Contact: <strong className="text-foreground">{s.contactName}</strong></span>}
          {s.gstNo && <span>GSTIN: <strong className="font-mono text-foreground">{s.gstNo}</strong></span>}
        </div>
      </section>

      {/* 2. Position KPI Strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 rounded-xl border border-border bg-card p-2.5 shadow-xs">
        <KpiCell
          label="Net Position"
          value={settlement?.combined.netPositionPaise ?? 0}
          tone={(settlement?.combined.netPositionPaise ?? 0) > 0 ? 'rose' : (settlement?.combined.advancePaise ?? 0) > 0 ? 'emerald' : 'default'}
          subLabel={(settlement?.combined.netPositionPaise ?? 0) > 0 ? 'We owe supplier' : 'Advance with supplier'}
        />
        <KpiCell
          label="Kacha Due"
          value={settlement?.pools.kacha.outstandingPaise ?? 0}
          tone="amber"
          subLabel="Raw scrap pool"
        />
        <KpiCell
          label="GST Due"
          value={settlement?.pools.gst.outstandingPaise ?? 0}
          tone="blue"
          subLabel="Tax invoice pool"
        />
        <KpiCell
          label="Advance Credit"
          value={settlement?.combined.advancePaise ?? 0}
          tone="emerald"
          subLabel="Deposits &amp; on-behalf"
        />
        <div className="flex flex-col justify-center rounded-lg bg-secondary/50 p-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Bardan Pending</span>
          <span className={`font-mono text-sm sm:text-base font-bold tabular-nums mt-0.5 ${bardanPendingCount > 0 ? 'text-amber-700' : 'text-foreground'}`}>
            {bardanPendingCount} bill{bardanPendingCount === 1 ? '' : 's'}
          </span>
          <span className="text-[11px] text-muted-foreground">Empty bags to collect</span>
        </div>
      </div>

      {/* 3. Collapsible Volume Trends (Last 6 Months) */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
        <button
          type="button"
          onClick={() => setShowTrendChart((prev) => !prev)}
          className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2.5 bg-secondary/30 hover:bg-secondary/60 transition text-left"
        >
          <div className="flex min-w-0 items-center gap-2">
            <TrendingUp size={15} className="shrink-0 text-blue-600" />
            <span className="truncate text-xs font-bold text-foreground">6-Month Volume Trend</span>
            <span className="hidden sm:inline text-xs font-medium text-muted-foreground">(Purchased vs Paid)</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
            <span>{showTrendChart ? 'Hide' : 'Show'}</span>
            {showTrendChart ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </button>

        {showTrendChart && (
          <div className="p-4 border-t border-border">
            <PurchasedVsPaidTrendChart data={trendData} />
          </div>
        )}
      </div>

      {/* 4. Item-Wise Scrap Purchases & Pricing (as requested, inspired by /ledger) */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
          <div>
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Boxes size={15} className="text-primary" />
              <span>Item-Wise Scrap Purchases &amp; Pricing</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Grade-wise scrap bought from {s.companyName} · weighted average rates
            </p>
          </div>
          {materialPurchases.length > 0 && (
            <span className="text-xs font-mono font-bold text-muted-foreground rounded bg-secondary px-2 py-0.5">
              {fmtKg(materialPurchases.reduce((sum, m) => sum + m.totalKg, 0))} kg total
            </span>
          )}
        </div>

        {materialPurchases.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground italic">
            No scrap purchase lines recorded for this supplier yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Item Description</th>
                  <th className="px-2 py-2 text-right">Bills</th>
                  <th className="px-3 py-2 text-right">Total Weight</th>
                  <th className="px-3 py-2 text-right">Avg Buy Rate</th>
                  <th className="px-3 py-2 text-right">Last Rate</th>
                  <th className="px-3 py-2 text-right">Last Purchase</th>
                  <th className="px-3 py-2 text-right">Total Spend</th>
                  <th className="px-3 py-2 text-left w-28">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {materialPurchases.map((m) => (
                  <tr key={m.name} className="hover:bg-secondary/20 transition">
                    <td className="px-3 py-2.5 font-bold text-foreground text-xs">{m.name}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">{m.billsCount}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-foreground tabular-nums">
                      {fmtKg(m.totalKg)} kg
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-blue-700 tabular-nums">
                      <span className="bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                        ₹{m.avgRate.toFixed(2)}/kg
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground tabular-nums">
                      {m.lastRate > 0 ? `₹${m.lastRate.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[11px] text-muted-foreground">
                      {m.lastDate ? formatFullDate(m.lastDate) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-foreground tabular-nums">
                      {formatInrInteger(m.totalAmountRupees)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, m.share)}%` }} />
                        </div>
                        <span className="w-8 text-right font-mono text-[11px] font-bold text-muted-foreground">
                          {m.share.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 5. Tab Navigation with Live Counts */}
      <div className="rounded-xl border border-border bg-card p-1.5 shadow-xs inline-flex flex-wrap items-center gap-1.5">
        {(
          [
            ['ledger', 'Ledger', mergedRows.length],
            ['bills', 'Bills', billRows.length],
            ['payments', 'Payments', paymentRows.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() =>
              onTabChange
                ? onTabChange(key as SupplierLedgerTab)
                : void navigate({
                    to: '/supplier-ledger/$supplierId',
                    params: { supplierId },
                    search: (prev) => ({ ...prev, tab: key }),
                  })
            }
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs transition ${
              tab === key
                ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground font-medium'
            }`}
          >
            <span>{label}</span>
            <span
              className={`rounded-full px-1.5 py-0.2 font-mono text-[11px] font-bold ${
                tab === key ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* 5. TAB CONTENT */}

      {/* ---------- A. LEDGER TAB ---------- */}
      {tab === 'ledger' && (
        <div ref={exportRef} className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          {/* Statement Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border p-3 bg-secondary/20">
            {/* Pool Selector */}
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs font-semibold">
              {(['all', 'kacha', 'gst'] as PoolFilter[]).map((pf) => (
                <button
                  key={pf}
                  type="button"
                  onClick={() => setPoolFilter(pf)}
                  className={`rounded-md px-3 py-1 transition ${
                    poolFilter === pf ? 'bg-primary text-primary-foreground shadow-xs font-bold' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {pf === 'all' ? 'All Pools' : pf === 'kacha' ? 'Kacha' : 'GST'}
                </button>
              ))}
            </div>

            {/* Date Range & Presets */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Range:</span>
              <DateInput className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs" value={fromDate} onChange={setFromDate} />
              <span className="text-muted-foreground">&rarr;</span>
              <DateInput className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs" value={toDate} onChange={setToDate} />

              <div className="flex items-center gap-1 pl-1">
                <button
                  type="button"
                  onClick={applyThisMonthPreset}
                  className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-secondary transition"
                >
                  This Month
                </button>
                <button
                  type="button"
                  onClick={applyLast30DaysPreset}
                  className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-secondary transition"
                >
                  Last 30d
                </button>
                {(fromDate || toDate) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFromDate('')
                      setToDate('')
                    }}
                    className="rounded-md bg-secondary px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 transition"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Statement Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-xs">
              <thead className="bg-secondary/70 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr className="text-left">
                  <th className="px-3.5 py-2.5">Date</th>
                  <th className="px-3.5 py-2.5">Transaction Description</th>
                  <th className="px-3.5 py-2.5">Pool</th>
                  <th className="px-3.5 py-2.5 text-right">Debit (We Owe)</th>
                  <th className="px-3.5 py-2.5 text-right">Credit (Paid)</th>
                  <th className="px-3.5 py-2.5 text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {(poolFilter === 'all' || poolFilter === 'kacha') && (
                  <OpeningRow label="Opening Balance (Kacha)" pool="kacha" paise={s.openingKachaPaise} date={fromDate || s.openingBalanceDate} />
                )}
                {(poolFilter === 'all' || poolFilter === 'gst') && (
                  <OpeningRow
                    label="Opening Balance (GST)"
                    pool="gst"
                    paise={s.openingGstPaise}
                    date={fromDate || s.openingBalanceDate}
                    combined={poolFilter === 'all' ? s.openingKachaPaise + s.openingGstPaise : undefined}
                  />
                )}

                {mergedRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs italic text-muted-foreground">
                      No transactions recorded in this period.
                    </td>
                  </tr>
                )}

                {mergedRows.map((row) => {
                  const isBillRow = row.kind === 'bill' && row.billId
                  const isExpanded = row.billId ? expandedBillIds.has(row.billId) : false
                  const billBardan = row.billId ? bundle.bardan.filter((b) => b.billId === row.billId) : []
                  const billAdjustments = row.billId ? bundle.adjustments.filter((a) => a.billId === row.billId) : []

                  if (row.cancelled) {
                    return (
                      <tr key={`${row.id}-x`} className="opacity-60 bg-secondary/10">
                        <td className="px-3.5 py-2 font-mono text-muted-foreground line-through">{formatFullDate(row.date)}</td>
                        <td className="px-3.5 py-2">
                          <span className="line-through text-muted-foreground">{row.caption}</span>
                          <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.2 text-[11px] font-bold text-rose-700">
                            Cancelled
                          </span>
                          {row.cancelReason && <span className="ml-1 text-[11px] text-muted-foreground">({row.cancelReason})</span>}
                        </td>
                        <td className="px-3.5 py-2"><PoolPill pool={row.pool} /></td>
                        <td className="px-3.5 py-2 text-right text-muted-foreground/40">—</td>
                        <td className="px-3.5 py-2 text-right text-muted-foreground/40">—</td>
                        <td className="px-3.5 py-2 text-right text-muted-foreground/40">—</td>
                      </tr>
                    )
                  }

                  return (
                    <tr
                      key={row.id}
                      onClick={() => {
                        if (row.billId) {
                          const bRow = billRows.find((b) => b.id === row.billId)
                          if (bRow) void navigate({ to: '/purchase-bills/$billId', params: { billId: bRow.inNo } })
                        } else if (row.paymentId) {
                          setPaymentDetailsId(row.paymentId)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={row.inNo ? `Open bill ${row.inNo}` : 'Open payment details'}
                      className="cursor-pointer transition hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <td className="whitespace-nowrap px-3.5 py-2 font-mono text-muted-foreground">
                        {formatFullDate(row.date)}
                      </td>
                      <td className="px-3.5 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground max-w-[420px] truncate" title={row.caption}>
                            {row.caption}
                          </span>
                          {row.isSettled && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.2 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                              <CheckCircle2 size={10} /> NIL
                            </span>
                          )}
                          {row.isBardanPending && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.2 text-[11px] font-bold text-amber-800 border border-amber-200">
                              <AlertCircle size={10} /> Bardan
                            </span>
                          )}
                          {isBillRow && (billBardan.length > 0 || billAdjustments.length > 0) && (
                            <button
                              type="button"
                              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedBillIds((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(row.billId!)) next.delete(row.billId!)
                                  else next.add(row.billId!)
                                  return next
                                })
                              }}
                              aria-label="Toggle details"
                            >
                              {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                          )}
                        </div>
                        {row.modeOrRef && <p className="text-[11px] uppercase text-muted-foreground font-mono mt-0.5">{row.modeOrRef}</p>}

                        {/* Inline sub-lines if expanded */}
                        {isExpanded && (
                          <div className="mt-1.5 space-y-1 rounded-lg border border-border bg-secondary/50 p-2 text-[11px]">
                            {billBardan.filter((b) => b.method === 'deduct').map((b) => (
                              <div key={b.id} className="flex justify-between text-amber-800">
                                <span>↳ Bardan Deduct: {gramsToKgText(b.bardanG)} kg @ ₹{milliToRateText(b.rateMilli)}/kg</span>
                                <span className="font-mono font-semibold">-{formatPaiseInr(b.creditPaise)}</span>
                              </div>
                            ))}
                            {billAdjustments.map((a) => (
                              <div key={a.id} className="flex justify-between text-muted-foreground">
                                <span>↳ {a.type.replace(/_/g, ' ')}</span>
                                <span className="font-mono font-semibold">
                                  {a.amountPaise >= 0 ? `+${formatPaiseInr(a.amountPaise)}` : `-${formatPaiseInr(-a.amountPaise)}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="px-3.5 py-2"><PoolPill pool={row.pool} /></td>

                      {/* Debit (Purchases) */}
                      <td className="px-3.5 py-2 text-right font-mono font-medium tabular-nums">
                        {row.debitPaise > 0 ? (
                          <span className="text-rose-600 font-semibold">{formatPaiseInr(row.debitPaise)}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>

                      {/* Credit (Payments) */}
                      <td className="px-3.5 py-2 text-right font-mono font-medium tabular-nums">
                        {row.creditPaise > 0 ? (
                          <span className="text-emerald-700 font-semibold">{formatPaiseInr(row.creditPaise)}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>

                      {/* Running Balance */}
                      <td className="px-3.5 py-2 text-right font-mono font-bold tabular-nums text-foreground">
                        {row.balancePaise != null ? (
                          <span className={row.balancePaise > 0 ? 'text-rose-600' : row.balancePaise < 0 ? 'text-emerald-700' : 'text-foreground'}>
                            {formatPaiseInr(row.balancePaise)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {ledgerResult && (
                <tfoot>
                  <tr className="border-t border-border bg-secondary/80 font-bold text-foreground">
                    <td className="px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground" colSpan={3}>
                      Closing Statement Balance
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-rose-600">
                      {formatPaiseInr(ledgerResult.totalDebitsPaise)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-emerald-700">
                      {formatPaiseInr(ledgerResult.totalCreditsPaise)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono text-sm sm:text-base font-bold tabular-nums">
                      {formatPaiseInr(ledgerResult.closingPaise)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ---------- B. BILLS TAB ---------- */}
      {tab === 'bills' && (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <PurchaseBillsTable
            rows={highlightBill ? billRows.filter((r) => r.id === highlightBill) : billRows}
            showSupplier={false}
            onRowClick={(row) => void navigate({ to: '/purchase-bills/$billId', params: { billId: row.inNo } })}
            actions={{
              onRecordPayment: (row) => setBillModal({ type: 'payment', row }),
              onAddBardan: (row) => setBillModal({ type: 'bardan', row }),
              onSettleNil: (row) => setBillModal({ type: 'settleNil', row }),
              onEdit: (row) => void navigate({ to: '/new-purchase-bill', search: { editBillId: row.id } }),
              onCancel: (row) => setBillModal({ type: 'cancelBill', row }),
            }}
            emptyMessage="No purchase bills on file for this supplier."
          />
        </div>
      )}

      {/* ---------- C. PAYMENTS TAB ---------- */}
      {tab === 'payments' && (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <SupplierPaymentsTable
            rows={paymentRows}
            showSupplier={false}
            onOpenDetails={(row) => setPaymentDetailsId(row.id)}
            onCancel={(row) => setPaymentDetailsId(row.id)}
            emptyMessage="No payments on file for this supplier."
          />
        </div>
      )}

      {/* Operational Modals */}
      {billModal?.type === 'bardan' && <AddBardanModal billId={billModal.row.id} onClose={() => setBillModal(null)} />}
      {billModal?.type === 'payment' && (
        <RecordPaymentModal
          supplierId={billModal.row.supplierId}
          supplierName={billModal.row.supplierName}
          pool={billModal.row.pool}
          pins={[{ billId: billModal.row.id, inNo: billModal.row.inNo, duePaise: billModal.row.duePaise }]}
          onClose={() => setBillModal(null)}
        />
      )}
      {billModal?.type === 'settleNil' && (
        <SettleToNilModal
          supplierId={billModal.row.supplierId}
          pool={billModal.row.pool}
          billId={billModal.row.id}
          inNo={billModal.row.inNo}
          duePaise={billModal.row.duePaise}
          onClose={() => setBillModal(null)}
        />
      )}
      {billModal?.type === 'cancelBill' && <CancelBillModal billId={billModal.row.id} inNo={billModal.row.inNo} onClose={() => setBillModal(null)} />}
      {paymentDetailsId && <PaymentDetailsModal paymentId={paymentDetailsId} onClose={() => setPaymentDetailsId(null)} />}

      {/* Supplier Edit Modal */}
      {editSupplierOpen && supplierFormState && (
        <SupplierFormModal
          formState={supplierFormState}
          isSaving={updateSupplierMutation.isPending}
          errorText={supplierError}
          onChange={setSupplierFormState}
          onClose={() => setEditSupplierOpen(false)}
          onSave={() => {
            setSupplierError('')
            updateSupplierMutation.mutate(supplierFormState)
          }}
        />
      )}

      {deactivateOpen && (
        <ConfirmDialog
          open={deactivateOpen}
          onOpenChange={setDeactivateOpen}
          title={`Deactivate ${bundle?.supplier.companyName ?? 'this supplier'}?`}
          description="The supplier disappears from active lists and the hub, but its full ledger history stays. Reactivate anytime from the same button."
          confirmLabel="Deactivate"
          tone="danger"
          onConfirm={() => statusMutation.mutate()}
          pending={statusMutation.isPending}
        />
      )}
    </div>
  )
}

type MergedRow = {
  id: string
  date: string
  created: string
  pool: 'kacha' | 'gst'
  kind: string
  caption: string
  debitPaise: number
  creditPaise: number
  balancePaise: number | null
  cancelled: boolean
  cancelReason?: string
  billId?: string
  inNo?: string
  paymentId?: string
  modeOrRef?: string
  isSettled?: boolean
  isBardanPending?: boolean
}

function captionFor(
  kind: string,
  rawLabel: string,
  bill?: { inNo: string; supplierBillNo?: string },
  payment?: { kind: string; mode?: string; reference?: string },
  _bundle?: SupplierBundle,
): string {
  if (kind === 'bill') {
    const inPart = bill?.inNo ? `Bill ${bill.inNo}` : 'Bill'
    const invPart = bill?.supplierBillNo ? ` (Inv #${bill.supplierBillNo})` : ''
    return `${inPart}${invPart}`
  }
  if (kind === 'payment') {
    const pKind = (payment?.kind ?? 'payment').replace(/_/g, ' ')
    const ref = payment?.reference ? ` · Ref ${payment.reference}` : ''
    return `${pKind.toUpperCase()}${ref}`
  }
  if (kind === 'opening') {
    return rawLabel
  }
  return rawLabel.replace(/_/g, ' ')
}

function PoolPill({ pool }: { pool: 'kacha' | 'gst' }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider ${
        pool === 'gst' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
      }`}
    >
      {pool}
    </span>
  )
}

function KpiCell({
  label,
  value,
  tone,
  subLabel,
}: {
  label: string
  value: number
  tone: 'rose' | 'amber' | 'blue' | 'emerald' | 'default'
  subLabel?: string
}) {
  const color =
    tone === 'rose'
      ? 'text-rose-600'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'blue'
          ? 'text-blue-700'
          : tone === 'emerald'
            ? 'text-emerald-700'
            : 'text-foreground'

  return (
    <div className="flex flex-col justify-center rounded-lg bg-secondary/50 p-2.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm sm:text-base font-bold tabular-nums mt-0.5 ${color}`}>
        {formatPaiseInr(value)}
      </span>
      {subLabel && <span className="text-[11px] text-muted-foreground">{subLabel}</span>}
    </div>
  )
}

function OpeningRow({
  label,
  pool,
  paise,
  date,
  combined,
}: {
  label: string
  pool: 'kacha' | 'gst'
  paise: number
  date?: string
  combined?: number
}) {
  const isDebit = paise > 0
  const isCredit = paise < 0
  return (
    <tr className="bg-secondary/30 italic text-muted-foreground">
      <td className="whitespace-nowrap px-3.5 py-2 font-mono text-xs">{date ? formatFullDate(date) : '—'}</td>
      <td className="px-3.5 py-2 font-medium">{label}</td>
      <td className="px-3.5 py-2"><PoolPill pool={pool} /></td>
      <td className="px-3.5 py-2 text-right font-mono tabular-nums">
        {isDebit ? <span className="text-rose-600 font-semibold">{formatPaiseInr(paise)}</span> : '—'}
      </td>
      <td className="px-3.5 py-2 text-right font-mono tabular-nums">
        {isCredit ? <span className="text-emerald-700 font-semibold">{formatPaiseInr(-paise)}</span> : '—'}
      </td>
      <td className="px-3.5 py-2 text-right font-mono font-semibold tabular-nums text-foreground">
        {formatPaiseInr(combined !== undefined ? combined : paise)}
      </td>
    </tr>
  )
}
