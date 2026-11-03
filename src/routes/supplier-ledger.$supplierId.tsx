import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  FileText,
  Image as ImageIcon,
  Lock,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { pb } from '@/data/pocketbase'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import {
  addPurchaseBardanEntry,
  cancelPurchaseBill,
  cancelSupplierPayment,
  computeSupplierBundleLedger,
  computeSupplierBundleSettlement,
  loadSupplierBundle,
  loadVilaityHistory,
  type PurchaseBillView,
  type SupplierBundle,
  type SupplierPaymentView,
} from '@/data/suppliers'
import type { SupplierPool } from '@/domain/supplier-ledger'
import { formatFullDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'
import { exportNodeAsJpg } from '@/lib/image-export'
import {
  gramsToKgText,
  kgToGrams,
  lineAmountPaise,
  milliToRateText,
  rupeesToPaise,
} from '@/domain/supplier-units'

export const Route = createFileRoute('/supplier-ledger/$supplierId')({
  component: SupplierLedgerPage,
})

type PoolFilter = 'all' | 'kacha' | 'gst'

function formatPaise(paise: number): string {
  return formatPaiseInr(paise)
}

function findVilaityForDate(
  history: Array<{ date: string; vilaityMilli: number }>,
  targetDate: string,
): { date: string; vilaityMilli: number } | null {
  if (!history || history.length === 0) return null
  const exact = history.find((h) => h.date === targetDate)
  if (exact) return exact
  const earlier = history.filter((h) => h.date < targetDate)
  if (earlier.length > 0) return earlier[earlier.length - 1]
  return history[0]
}

type MergedLedgerRow = {
  id: string
  date: string
  created: string
  pool: SupplierPool
  kind: string
  label: string
  inNo: string
  modeOrRef: string
  debitPaise: number
  creditPaise: number
  balancePaise: number | null
  cancelled: boolean
  cancelReason?: string
  billId?: string
  paymentId?: string
  isSettled?: boolean
  isBardanPending?: boolean
}

function SupplierLedgerPage() {
  const { supplierId } = Route.useParams()
  const queryClient = useQueryClient()
  const exportRef = useRef<HTMLDivElement>(null)
  const [isExporting, setIsExporting] = useState(false)

  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [expandedBillIds, setExpandedBillIds] = useState<Set<string>>(new Set())
  const [selectedDrawerBillId, setSelectedDrawerBillId] = useState<string | null>(null)

  const [cancelPaymentId, setCancelPaymentId] = useState<string | null>(null)
  const [cancelPaymentReason, setCancelPaymentReason] = useState('')
  const [cancelPaymentError, setCancelPaymentError] = useState('')

  const bundleQuery = useQuery({
    queryKey: ['supplier-bundle', supplierId],
    queryFn: () => loadSupplierBundle(supplierId),
  })

  const cancelPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!cancelPaymentReason.trim()) throw new Error('Cancellation reason is required.')
      await cancelSupplierPayment(cancelPaymentId!, cancelPaymentReason.trim())
    },
    onSuccess: async () => {
      setCancelPaymentId(null)
      setCancelPaymentReason('')
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
    },
    onError: (err) => setCancelPaymentError(toUserMessage(err)),
  })

  const vilaityQuery = useQuery({
    queryKey: ['vilaity-history'],
    queryFn: loadVilaityHistory,
  })

  const bundle = bundleQuery.data
  const vilaityHistory = vilaityQuery.data ?? []

  const settlement = useMemo(() => {
    if (!bundle) return null
    return computeSupplierBundleSettlement(bundle)
  }, [bundle])

  const ledgerResult = useMemo(() => {
    if (!bundle) return null
    return computeSupplierBundleLedger(bundle, {
      pool: poolFilter,
      from: fromDate || undefined,
      to: toDate || undefined,
    })
  }, [bundle, poolFilter, fromDate, toDate])

  const billMap = useMemo(() => {
    const map = new Map<string, PurchaseBillView>()
    if (bundle) {
      for (const bill of bundle.bills) map.set(bill.id, bill)
    }
    return map
  }, [bundle])

  const paymentMap = useMemo(() => {
    const map = new Map<string, SupplierPaymentView>()
    if (bundle) {
      for (const p of bundle.payments) map.set(p.id, p)
    }
    return map
  }, [bundle])

  const billSettlementMap = useMemo(() => {
    const map = new Map<string, { status: string; bardanPending: boolean; paidPaise: number; duePaise: number }>()
    if (settlement) {
      for (const b of [...settlement.pools.kacha.bills, ...settlement.pools.gst.bills]) {
        map.set(b.billId, {
          status: b.status,
          bardanPending: b.bardanPending,
          paidPaise: b.paidPaise,
          duePaise: b.duePaise,
        })
      }
    }
    return map
  }, [settlement])

  const mergedRows = useMemo(() => {
    if (!bundle || !ledgerResult) return []

    const rows: MergedLedgerRow[] = []

    for (const entry of ledgerResult.entries) {
      const bill = entry.kind === 'bill' ? billMap.get(entry.id) : undefined
      const payment = paymentMap.get(entry.id)
      const bInfo = bill ? billSettlementMap.get(bill.id) : undefined

      const inNo = bill?.inNo || ''
      const modeOrRef = payment ? [payment.mode, payment.reference].filter(Boolean).join(' / ') : ''

      let debitPaise = 0
      let creditPaise = 0
      if (entry.amountPaise > 0) {
        debitPaise = entry.amountPaise
      } else if (entry.amountPaise < 0) {
        creditPaise = -entry.amountPaise
      }

      rows.push({
        id: entry.id,
        date: entry.date,
        created: entry.created,
        pool: entry.pool,
        kind: entry.kind,
        label: entry.label || entry.kind.replace('_', ' '),
        inNo,
        modeOrRef,
        debitPaise,
        creditPaise,
        balancePaise: entry.balancePaise,
        cancelled: false,
        billId: bill?.id,
        paymentId: payment?.id,
        isSettled: bInfo?.status === 'nil',
        isBardanPending: bInfo?.bardanPending,
      })
    }

    const cancelledBills = bundle.bills.filter((b) => b.cancelled)
    for (const bill of cancelledBills) {
      if (poolFilter !== 'all' && bill.pool !== poolFilter) continue
      if (fromDate && bill.date < fromDate) continue
      if (toDate && bill.date > toDate) continue

      rows.push({
        id: bill.id,
        date: bill.date,
        created: bill.created,
        pool: bill.pool,
        kind: 'bill',
        label: 'Purchase Bill (Cancelled)',
        inNo: bill.inNo,
        modeOrRef: '',
        debitPaise: 0,
        creditPaise: 0,
        balancePaise: null,
        cancelled: true,
        cancelReason: bill.cancelReason,
        billId: bill.id,
      })
    }

    const cancelledPayments = bundle.payments.filter((p) => p.cancelled)
    for (const payment of cancelledPayments) {
      if (poolFilter !== 'all' && payment.pool !== poolFilter) continue
      if (fromDate && payment.date < fromDate) continue
      if (toDate && payment.date > toDate) continue

      rows.push({
        id: payment.id,
        date: payment.date,
        created: payment.created,
        pool: payment.pool,
        kind: payment.kind,
        label: `${payment.kind.replace('_', ' ')} (Cancelled)`,
        inNo: '',
        modeOrRef: [payment.mode, payment.reference].filter(Boolean).join(' / '),
        debitPaise: 0,
        creditPaise: 0,
        balancePaise: null,
        cancelled: true,
        cancelReason: payment.cancelReason,
        paymentId: payment.id,
      })
    }

    rows.sort((a, b) => {
      const keyA = `${a.date}|${a.created}|${a.id}`
      const keyB = `${b.date}|${b.created}|${b.id}`
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
    })

    return rows
  }, [bundle, ledgerResult, billMap, paymentMap, billSettlementMap, poolFilter, fromDate, toDate])

  const bardanPendingCount = useMemo(() => {
    if (!bundle) return 0
    return bundle.bardan.filter((b) => b.method === 'advance').length
  }, [bundle])

  const toggleExpandBill = (billId: string) => {
    setExpandedBillIds((prev) => {
      const next = new Set(prev)
      if (next.has(billId)) next.delete(billId)
      else next.add(billId)
      return next
    })
  }

  const handleExportJpg = async () => {
    if (!exportRef.current || !bundle) return
    try {
      setIsExporting(true)
      const filename = `ledger-${bundle.supplier.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${new Date()
        .toISOString()
        .slice(0, 10)}.jpg`
      await exportNodeAsJpg(exportRef.current, {
        filename,
        backgroundColor: '#ffffff',
        preferredWidthPx: 1200,
      })
    } catch (err) {
      console.error('Export ledger failed', err)
    } finally {
      setIsExporting(false)
    }
  }

  if (bundleQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center p-6 text-slate-500">
        <p className="text-sm">Loading supplier ledger...</p>
      </div>
    )
  }

  if (bundleQuery.isError || !bundle) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="font-medium">Failed to load supplier bundle.</p>
          <Link to="/suppliers" className="mt-2 inline-flex items-center gap-1 text-sm underline">
            <ArrowLeft size={14} /> Back to suppliers
          </Link>
        </div>
      </div>
    )
  }

  const s = bundle.supplier
  const drawerBill = selectedDrawerBillId ? billMap.get(selectedDrawerBillId) : null

  return (
    <div className="w-full space-y-4 px-3 pb-12 pt-3 sm:px-4 lg:px-6">
      {/* Top Header & Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            to="/suppliers"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          <h1 className="text-base font-bold text-slate-900">{s.companyName}</h1>
          {s.city && <span className="text-xs text-slate-500">• {s.city}</span>}
          {!s.active && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
              Inactive
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/purchase-bills/new"
            search={{ supplierId: s.id }}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Plus size={13} /> New Bill
          </Link>
          <Link
            to="/supplier-payments/new"
            search={{ supplierId: s.id }}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Plus size={13} /> New Payment
          </Link>
          <button
            type="button"
            onClick={handleExportJpg}
            disabled={isExporting}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <Download size={14} /> {isExporting ? 'Exporting...' : 'Download JPG'}
          </button>
        </div>
      </div>

      {/* Exportable Container Root */}
      <div ref={exportRef} className="space-y-4 bg-white p-2 sm:p-4 rounded-xl">
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Total Net Owed</p>
            <p className="mt-1 font-mono text-base font-bold text-rose-600">
              {formatPaise(settlement?.combined.netPositionPaise ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Kacha Pool</p>
            <p className="mt-1 font-mono text-base font-semibold text-amber-700">
              {formatPaise(settlement?.pools.kacha.outstandingPaise ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">GST Pool</p>
            <p className="mt-1 font-mono text-base font-semibold text-blue-700">
              {formatPaise(settlement?.pools.gst.outstandingPaise ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Advance (Paid ahead)</p>
            <p className="mt-1 font-mono text-base font-semibold text-emerald-600">
              {formatPaise(settlement?.combined.advancePaise ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 col-span-2 sm:col-span-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Bardan Pending</p>
            <p
              className={`mt-1 font-mono text-base font-semibold ${
                bardanPendingCount > 0 ? 'text-amber-600' : 'text-slate-600'
              }`}
            >
              {bardanPendingCount} {bardanPendingCount === 1 ? 'entry' : 'entries'}
            </p>
          </div>
        </div>

        {/* Filters Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 pt-1">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            {(['all', 'kacha', 'gst'] as PoolFilter[]).map((pf) => (
              <button
                key={pf}
                type="button"
                className={`rounded-md px-3 py-1.5 transition ${
                  poolFilter === pf ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setPoolFilter(pf)}
              >
                {pf === 'all' ? 'All Pools' : pf === 'kacha' ? 'Kacha Pool' : 'GST Pool'}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1 text-slate-600">
              <Calendar size={13} className="text-slate-400" />
              <span>From:</span>
              <DateInput className="h-8 w-32 rounded border border-slate-300 px-2 text-xs" value={fromDate} onChange={setFromDate} />
            </div>
            <div className="flex items-center gap-1 text-slate-600">
              <span>To:</span>
              <DateInput className="h-8 w-32 rounded border border-slate-300 px-2 text-xs" value={toDate} onChange={setToDate} />
            </div>
            {(fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('')
                  setToDate('')
                }}
                className="text-xs text-blue-600 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Running Ledger Table */}
        <div className="overflow-x-auto no-scrollbar rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">IN No / Ref</th>
                <th className="px-3 py-2.5">Description</th>
                <th className="px-3 py-2.5">Pool</th>
                <th className="px-3 py-2.5 text-right">Debit (We Owe)</th>
                <th className="px-3 py-2.5 text-right">Credit (Paid)</th>
                <th className="px-3 py-2.5 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* Opening Balance Rows */}
              {(poolFilter === 'all' || poolFilter === 'kacha') && (
                <tr className="bg-slate-50/50 font-medium text-slate-700">
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {fromDate ? formatFullDate(fromDate) : s.openingBalanceDate ? formatFullDate(s.openingBalanceDate) : 'Start'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">—</td>
                  <td className="px-3 py-2">Opening (Kacha)</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                      kacha
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {s.openingKachaPaise > 0 ? formatPaise(s.openingKachaPaise) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {s.openingKachaPaise < 0 ? formatPaise(-s.openingKachaPaise) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-slate-800">
                    {formatPaise(s.openingKachaPaise)}
                  </td>
                </tr>
              )}

              {(poolFilter === 'all' || poolFilter === 'gst') && (
                <tr className="bg-slate-50/50 font-medium text-slate-700">
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {fromDate ? formatFullDate(fromDate) : s.openingBalanceDate ? formatFullDate(s.openingBalanceDate) : 'Start'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">—</td>
                  <td className="px-3 py-2">Opening (GST)</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-800">
                      gst
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {s.openingGstPaise > 0 ? formatPaise(s.openingGstPaise) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {s.openingGstPaise < 0 ? formatPaise(-s.openingGstPaise) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-slate-800">
                    {poolFilter === 'all'
                      ? formatPaise(s.openingKachaPaise + s.openingGstPaise)
                      : formatPaise(s.openingGstPaise)}
                  </td>
                </tr>
              )}

              {mergedRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                    No transactions recorded for this period.
                  </td>
                </tr>
              )}

              {mergedRows.map((row) => {
                const isBill = row.kind === 'bill'
                const isExpanded = row.billId ? expandedBillIds.has(row.billId) : false
                const billAdjustments = row.billId ? bundle.adjustments.filter((a) => a.billId === row.billId) : []
                const billBardan = row.billId ? bundle.bardan.filter((b) => b.billId === row.billId) : []

                if (row.cancelled) {
                  return (
                    <tr key={`${row.id}-cancelled`} className="bg-slate-50/30 opacity-60">
                      <td className="px-3 py-2 text-xs line-through text-slate-400">{formatFullDate(row.date)}</td>
                      <td className="px-3 py-2 font-mono text-xs line-through text-slate-400">{row.inNo || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="line-through text-slate-400">{row.label}</span>
                        <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          Cancelled
                        </span>
                        {row.cancelReason && <span className="ml-1 text-[11px] text-slate-400">({row.cancelReason})</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-400">
                          {row.pool}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">—</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">—</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">—</td>
                    </tr>
                  )
                }

                return (
                  <tr
                    key={row.id}
                    className={`transition hover:bg-slate-50/60 ${isBill ? 'cursor-pointer' : ''}`}
                    onClick={() => {
                      if (row.billId) setSelectedDrawerBillId(row.billId)
                    }}
                  >
                    <td className="px-3 py-2.5 text-xs text-slate-600">{formatFullDate(row.date)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-800">
                      {row.inNo ? (
                        <div className="flex items-center gap-1 text-blue-700">
                          <FileText size={12} />
                          <span>{row.inNo}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-slate-800">{row.label}</span>
                        {row.isSettled && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                            <CheckCircle2 size={10} /> NIL
                          </span>
                        )}
                        {row.isBardanPending && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-100">
                            <AlertCircle size={10} /> Bardan Pending
                          </span>
                        )}
                        {row.paymentId && !row.cancelled && (
                          <button
                            type="button"
                            title="Cancel payment"
                            onClick={(e) => {
                              e.stopPropagation()
                              setCancelPaymentId(row.paymentId!)
                            }}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 size={11} /> Cancel
                          </button>
                        )}
                        {row.billId && (billAdjustments.length > 0 || billBardan.length > 0) && (
                          <button
                            type="button"
                            className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleExpandBill(row.billId!)
                            }}
                          >
                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        )}
                      </div>
                      {row.modeOrRef && <p className="mt-0.5 text-xs text-slate-500">{row.modeOrRef}</p>}

                      {/* Sub-rows for Bardan Deduct and Adjustments */}
                      {isExpanded && (
                        <div className="mt-1.5 space-y-1 rounded border border-slate-200 bg-slate-50/80 p-2 text-xs text-slate-600">
                          {billBardan
                            .filter((b) => b.method === 'deduct')
                            .map((b) => (
                              <div key={b.id} className="flex justify-between text-amber-700">
                                <span>
                                  ↳ Bardan Deduct: {gramsToKgText(b.bardanG)} kg @ ₹{milliToRateText(b.rateMilli)}/kg
                                </span>
                                <span className="font-mono">-{formatPaise(b.creditPaise)}</span>
                              </div>
                            ))}
                          {billAdjustments.map((a) => (
                            <div key={a.id} className="flex justify-between text-slate-600">
                              <span>↳ Adjustment ({a.type.replace('_', ' ')})</span>
                              <span className="font-mono">
                                {a.amountPaise >= 0 ? `+${formatPaise(a.amountPaise)}` : `-${formatPaise(-a.amountPaise)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          row.pool === 'gst' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {row.pool}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {row.debitPaise > 0 ? (
                        <span className="font-medium text-rose-600">{formatPaise(row.debitPaise)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {row.creditPaise > 0 ? (
                        <span className="font-medium text-emerald-600">{formatPaise(row.creditPaise)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {row.balancePaise != null ? formatPaise(row.balancePaise) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {ledgerResult && (
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                <tr>
                  <td className="px-3 py-3" colSpan={4}>
                    Closing Balance
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-rose-700">
                    {formatPaise(ledgerResult.totalDebitsPaise)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-700">
                    {formatPaise(ledgerResult.totalCreditsPaise)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-base font-bold tabular-nums text-slate-900">
                    {formatPaise(ledgerResult.closingPaise)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Read-Only Bill Drawer (Mounted outside exportRef so private notes and premium never appear in exports) */}
      {drawerBill && (
        <BillDetailsDrawer
          bill={drawerBill}
          bundle={bundle}
          settlementInfo={billSettlementMap.get(drawerBill.id)}
          history={vilaityHistory}
          onClose={() => setSelectedDrawerBillId(null)}
        />
      )}

      {/* Cancel Payment Modal */}
      {cancelPaymentId && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setCancelPaymentId(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-900">Cancel Payment</h3>
            <p className="text-xs text-slate-600">
              Soft cancellation: The payment will remain in the audit trail and struck-through in the ledger.
            </p>
            {cancelPaymentError && <p className="text-xs text-rose-600">{cancelPaymentError}</p>}
            <input
              type="text"
              placeholder="Cancellation reason (required)"
              value={cancelPaymentReason}
              onChange={(e) => setCancelPaymentReason(e.target.value)}
              className="h-8 w-full rounded border border-slate-300 px-2 text-xs text-slate-900 outline-none focus:border-rose-400"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setCancelPaymentId(null)
                  setCancelPaymentReason('')
                }}
                className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                Keep Payment
              </button>
              <button
                type="button"
                disabled={!cancelPaymentReason.trim() || cancelPaymentMutation.isPending}
                onClick={() => cancelPaymentMutation.mutate()}
                className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {cancelPaymentMutation.isPending ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BillDetailsDrawer({
  bill,
  bundle,
  settlementInfo,
  history,
  onClose,
}: {
  bill: PurchaseBillView
  bundle: SupplierBundle
  settlementInfo?: { status: string; bardanPending: boolean; paidPaise: number; duePaise: number }
  history: Array<{ date: string; vilaityMilli: number }>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const lines = bundle.lines.filter((l) => l.billId === bill.id)
  const adjustments = bundle.adjustments.filter((a) => a.billId === bill.id)
  const bardanList = bundle.bardan.filter((b) => b.billId === bill.id)
  const hasManualAllocations = bundle.allocations.some((a) => a.billId === bill.id)

  const vilaityMatch = findVilaityForDate(history, bill.date)

  // Add Bardan state
  const [showAddBardan, setShowAddBardan] = useState(false)
  const [bardanKgStr, setBardanKgStr] = useState('')
  const [bardanLineId, setBardanLineId] = useState(() => lines[0]?.id ?? '')
  const [bardanMethod, setBardanMethod] = useState<'deduct' | 'in_kind' | 'cash_back' | 'advance'>('deduct')
  const [bardanDate, setBardanDate] = useState(() => bill.date)
  const [bardanNote, setBardanNote] = useState('')
  const [bardanCashStr, setBardanCashStr] = useState('')
  const [bardanError, setBardanError] = useState('')

  // Cancel Bill state
  const [showCancelPrompt, setShowCancelPrompt] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState('')

  const selectedLine = lines.find((l) => l.id === bardanLineId) || lines[0]
  const bardanRateMilli = selectedLine?.rateMilli ?? 0
  const bardanGrams = kgToGrams(parseFloat(bardanKgStr) || 0)
  const bardanCreditPaise = bardanMethod === 'deduct' || bardanMethod === 'advance' ? lineAmountPaise(bardanGrams, bardanRateMilli) : 0
  const bardanCashPaise = bardanMethod === 'cash_back' ? rupeesToPaise(parseFloat(bardanCashStr) || 0) : 0

  const addBardanMutation = useMutation({
    mutationFn: async () => {
      if (bardanGrams <= 0) throw new Error('Please enter a valid bardan weight in kg.')
      await addPurchaseBardanEntry({
        billId: bill.id,
        bardanG: bardanGrams,
        rateLineId: selectedLine?.id,
        rateMilli: bardanRateMilli,
        method: bardanMethod,
        creditPaise: bardanCreditPaise,
        cashAmountPaise: bardanCashPaise,
        date: bardanDate,
        note: bardanNote.trim(),
      })
    },
    onSuccess: async () => {
      setShowAddBardan(false)
      setBardanKgStr('')
      setBardanNote('')
      setBardanCashStr('')
      await invalidateAfterSupplierPurchaseWrite(queryClient, bill.supplierId)
    },
    onError: (err) => setBardanError(toUserMessage(err)),
  })

  const cancelBillMutation = useMutation({
    mutationFn: async () => {
      if (!cancelReason.trim()) throw new Error('Cancellation reason is required.')
      await cancelPurchaseBill(bill.id, cancelReason.trim())
    },
    onSuccess: async () => {
      setShowCancelPrompt(false)
      await invalidateAfterSupplierPurchaseWrite(queryClient, bill.supplierId)
      onClose()
    },
    onError: (err) => setCancelError(toUserMessage(err)),
  })

  return (
    <div className="fixed inset-0 z-[75] flex justify-end bg-slate-900/40 backdrop-blur-xs" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl p-5 space-y-5"
        role="dialog"
        aria-label="Purchase Bill Details"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Bill {bill.inNo || bill.id}</h2>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                  bill.pool === 'gst' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-800'
                }`}
              >
                {bill.pool}
              </span>
              {bill.cancelled && (
                <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                  Cancelled
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Date: {formatFullDate(bill.date)} {bill.supplierBillNo && `• Supplier Inv: ${bill.supplierBillNo}`}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        {hasManualAllocations && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
            <AlertTriangle size={15} className="shrink-0 text-amber-600" />
            <span>
              <strong>Notice:</strong> This bill has manual payment allocations assigned. Editing quantities or totals
              will modify remaining dues.
            </span>
          </div>
        )}

        {/* Settlement Status Card */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <div>
            <span className="text-slate-500">Tax Mode:</span>{' '}
            <span className="font-semibold uppercase text-slate-800">{bill.taxMode}</span>
            {bill.gstRateBp > 0 && <span className="ml-1 text-slate-600">({bill.gstRateBp / 100}%)</span>}
          </div>
          <div>
            <span className="text-slate-500">Vehicle No:</span>{' '}
            <span className="font-semibold text-slate-800">{bill.vehicleNo || '—'}</span>
          </div>
          <div>
            <span className="text-slate-500">Paid:</span>{' '}
            <span className="font-mono font-semibold text-emerald-700">
              {formatPaise(settlementInfo?.paidPaise ?? 0)}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Remaining Due:</span>{' '}
            <span className="font-mono font-semibold text-rose-700">
              {formatPaise(settlementInfo?.duePaise ?? 0)}
            </span>
          </div>
        </div>

        {/* Line Items */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">Line Items (Raw Brass)</h3>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-2.5 py-2 text-left">Item</th>
                  <th className="px-2.5 py-2 text-right">Weight (kg)</th>
                  <th className="px-2.5 py-2 text-right">Rate (₹/kg)</th>
                  <th className="px-2.5 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-2.5 py-2 font-medium text-slate-800">{l.itemName}</td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">{gramsToKgText(l.weightG)} kg</td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">₹{milliToRateText(l.rateMilli)}</td>
                    <td className="px-2.5 py-2 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {formatPaise(l.amountPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Internal Market Premium vs Vilaity (Internal Only) */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-1.5 text-xs text-amber-900">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <Lock size={12} />
            <span>Market Premium vs Vilaity</span>
            <span className="rounded bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
              Internal Only
            </span>
          </div>
          {vilaityMatch ? (
            <div className="space-y-1">
              <p className="text-[11px] text-amber-700">
                Vilaity reference ({formatFullDate(vilaityMatch.date)}): ₹{milliToRateText(vilaityMatch.vilaityMilli)}/kg
              </p>
              {lines.map((l) => {
                const diffMilli = l.rateMilli - vilaityMatch.vilaityMilli
                const isPremium = diffMilli >= 0
                return (
                  <div key={l.id} className="flex justify-between font-mono text-[11px]">
                    <span>{l.itemName}</span>
                    <span>
                      {isPremium ? '+' : '-'}₹{milliToRateText(Math.abs(diffMilli))}/kg {isPremium ? 'premium' : 'discount'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-[11px] text-amber-700">No Vilaity rate recorded for this date period.</p>
          )}
        </div>

        {/* Adjustments */}
        {adjustments.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">Adjustments</h3>
            <div className="rounded border border-slate-200 divide-y divide-slate-100 text-xs">
              {adjustments.map((a) => (
                <div key={a.id} className="flex justify-between px-3 py-2 text-slate-700">
                  <span className="capitalize">{a.type.replace('_', ' ')}</span>
                  <span className="font-mono font-semibold">{formatPaise(a.amountPaise)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bardan Entries & Add Bardan Form */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Bardan Entries</h3>
            {!bill.cancelled && !showAddBardan && (
              <button
                type="button"
                onClick={() => setShowAddBardan(true)}
                className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                <Plus size={13} /> Add Bardan
              </button>
            )}
          </div>

          {showAddBardan && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-blue-950">New Bardan Settlement Entry</span>
                <button type="button" onClick={() => setShowAddBardan(false)} className="text-slate-400 hover:text-slate-700">
                  <X size={14} />
                </button>
              </div>

              {bardanError && <p className="text-xs text-rose-600">{bardanError}</p>}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-slate-600">Bardan Weight (kg)</label>
                  <input
                    type="text"
                    placeholder="e.g. 45.000"
                    value={bardanKgStr}
                    onChange={(e) => setBardanKgStr(e.target.value)}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2 font-mono text-xs text-slate-900 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-600">Settlement Method</label>
                  <select
                    value={bardanMethod}
                    onChange={(e) => setBardanMethod(e.target.value as any)}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none"
                  >
                    <option value="deduct">Deduct (Credit kg × rate)</option>
                    <option value="in_kind">In Kind (Settled, nil)</option>
                    <option value="cash_back">Cash Back (Refund memo)</option>
                    <option value="advance">Advance (Future pool payment)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-slate-600">Rate Line</label>
                  <select
                    value={bardanLineId}
                    onChange={(e) => setBardanLineId(e.target.value)}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none"
                  >
                    {lines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.itemName} (₹{milliToRateText(l.rateMilli)}/kg)
                      </option>
                    ))}
                  </select>
                </div>

                {bardanMethod === 'cash_back' ? (
                  <div>
                    <label className="text-[11px] font-medium text-slate-600">Cash Back Amount (₹)</label>
                    <input
                      type="text"
                      placeholder="₹ amount"
                      value={bardanCashStr}
                      onChange={(e) => setBardanCashStr(e.target.value)}
                      className="h-8 w-full rounded border border-slate-300 bg-white px-2 font-mono text-xs text-slate-900 outline-none"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-[11px] font-medium text-slate-600">Date</label>
                    <DateInput value={bardanDate} onChange={setBardanDate} className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs" />
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-600">Note / Bags description</label>
                <input
                  type="text"
                  placeholder="e.g. 50 plastic bags returned"
                  value={bardanNote}
                  onChange={(e) => setBardanNote(e.target.value)}
                  className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none"
                />
              </div>

              {/* Preview banner */}
              <div className="rounded bg-white p-2 border border-blue-200 text-xs">
                {bardanMethod === 'deduct' && (
                  <p className="text-slate-700">
                    Credit Preview: <strong>{formatPaise(bardanCreditPaise)}</strong> (deducted from bill payable)
                  </p>
                )}
                {bardanMethod === 'in_kind' && (
                  <p className="text-slate-600 italic">Money ₹0.00 — settled in kind with note.</p>
                )}
                {bardanMethod === 'cash_back' && (
                  <p className="text-slate-600">
                    Memo cash back: <strong>{formatPaise(bardanCashPaise)}</strong> (no effect on payable).
                  </p>
                )}
                {bardanMethod === 'advance' && (
                  <p className="text-emerald-700 font-medium">
                    Creates an advance payment of <strong>{formatPaise(bardanCreditPaise)}</strong> in the {bill.pool} pool.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddBardan(false)}
                  className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => addBardanMutation.mutate()}
                  disabled={addBardanMutation.isPending}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {addBardanMutation.isPending ? 'Saving...' : 'Save Bardan'}
                </button>
              </div>
            </div>
          )}

          {bardanList.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No bardan settled yet for this bill.</p>
          ) : (
            <div className="space-y-1.5">
              {bardanList.map((b) => (
                <div key={b.id} className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>
                      Method: <span className="uppercase text-blue-700">{b.method}</span>
                    </span>
                    <span className="font-mono">{gramsToKgText(b.bardanG)} kg</span>
                  </div>
                  {b.creditPaise > 0 && (
                    <div className="flex justify-between text-slate-600 font-mono">
                      <span>Credit:</span>
                      <span>{formatPaise(b.creditPaise)}</span>
                    </div>
                  )}
                  {b.cashAmountPaise > 0 && (
                    <div className="flex justify-between text-slate-600 font-mono">
                      <span>Cash Back:</span>
                      <span>{formatPaise(b.cashAmountPaise)}</span>
                    </div>
                  )}
                  {b.note && <p className="text-[11px] text-slate-500 italic">Note: {b.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Private Note (Internal only) */}
        {bill.privateNote && (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs">
            <span className="font-semibold text-slate-700">Private Note (Internal):</span>
            <p className="mt-1 text-slate-600 whitespace-pre-wrap">{bill.privateNote}</p>
          </div>
        )}

        {/* Photos */}
        {bill.photos && bill.photos.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">Attached Photos</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {bill.photos.map((photo) => {
                const photoUrl = pb.files.getURL(
                  { id: bill.id, collectionName: 'purchase_bills' } as unknown as { [key: string]: unknown; id: string; collectionName: string },
                  photo,
                )
                return (
                  <a
                    key={photo}
                    href={photoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100 hover:opacity-90"
                  >
                    <img src={photoUrl} alt="Bill attachment" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition text-white">
                      <ImageIcon size={20} />
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        )}

        {/* Bottom Actions: Edit & Cancel Bill */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
          <Link
            to="/purchase-bills/new"
            search={{ editBillId: bill.id }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Edit3 size={13} /> Edit Bill
          </Link>

          {!bill.cancelled && (
            <button
              type="button"
              onClick={() => setShowCancelPrompt(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
            >
              <Trash2 size={13} /> Cancel Bill
            </button>
          )}
        </div>

        {/* Cancel Dialog / Prompt */}
        {showCancelPrompt && (
          <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 space-y-2 text-xs">
            <p className="font-bold text-rose-900">Are you sure you want to cancel this bill?</p>
            <p className="text-rose-700">
              This is a soft cancellation: the bill will remain struck-through in the ledger for the audit paper trail.
            </p>
            {cancelError && <p className="font-semibold text-rose-800">{cancelError}</p>}
            <input
              type="text"
              placeholder="Cancellation reason (required)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="h-8 w-full rounded border border-rose-300 bg-white px-2 text-xs text-slate-900 outline-none"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCancelPrompt(false)}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
              >
                Keep Bill
              </button>
              <button
                type="button"
                onClick={() => cancelBillMutation.mutate()}
                disabled={cancelBillMutation.isPending}
                className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {cancelBillMutation.isPending ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
