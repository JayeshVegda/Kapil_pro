import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Image as ImageIcon,
  Lock,
  X,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { pb } from '@/data/pocketbase'
import { DateInput } from '@/components/ui/date-input'
import {
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
import { exportNodeAsJpg } from '@/lib/image-export'
import {
  gramsToKgText,
  milliToRateText,
  paiseToRupeesText,
} from '@/domain/supplier-units'

export const Route = createFileRoute('/supplier-ledger/$supplierId')({
  component: SupplierLedgerPage,
})

type PoolFilter = 'all' | 'kacha' | 'gst'

function formatPaise(paise: number): string {
  if (paise === 0) return '₹0.00'
  return `₹${paiseToRupeesText(paise)}`
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
  const exportRef = useRef<HTMLDivElement>(null)
  const [isExporting, setIsExporting] = useState(false)

  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [expandedBillIds, setExpandedBillIds] = useState<Set<string>>(new Set())
  const [selectedDrawerBillId, setSelectedDrawerBillId] = useState<string | null>(null)

  const bundleQuery = useQuery({
    queryKey: ['supplier-bundle', supplierId],
    queryFn: () => loadSupplierBundle(supplierId),
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

        <button
          type="button"
          onClick={handleExportJpg}
          disabled={isExporting}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          <Download size={14} /> {isExporting ? 'Exporting...' : 'Download JPG'}
        </button>
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
              {/* Opening Balance Row */}
              <tr className="bg-slate-50/50 font-medium text-slate-700">
                <td className="px-3 py-2 text-xs text-slate-500">{fromDate ? formatFullDate(fromDate) : 'Start'}</td>
                <td className="px-3 py-2 text-xs text-slate-400">—</td>
                <td className="px-3 py-2">Opening Balance</td>
                <td className="px-3 py-2">
                  <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                    {poolFilter}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {ledgerResult && ledgerResult.openingPaise > 0 ? formatPaise(ledgerResult.openingPaise) : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {ledgerResult && ledgerResult.openingPaise < 0 ? formatPaise(-ledgerResult.openingPaise) : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-slate-800">
                  {ledgerResult ? formatPaise(ledgerResult.openingPaise) : '₹0.00'}
                </td>
              </tr>

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
  const lines = bundle.lines.filter((l) => l.billId === bill.id)
  const adjustments = bundle.adjustments.filter((a) => a.billId === bill.id)
  const bardanList = bundle.bardan.filter((b) => b.billId === bill.id)

  const vilaityMatch = findVilaityForDate(history, bill.date)

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

        {/* Bardan Entries */}
        {bardanList.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">Bardan Entries</h3>
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
          </div>
        )}

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
      </div>
    </div>
  )
}
