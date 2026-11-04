import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coins,
  Download,
  Plus,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { PurchasesShell } from '@/components/suppliers/purchases-shell'
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
import {
  computeSupplierBundleLedger,
  computeSupplierBundleSettlement,
  loadSupplierBundle,
  type SupplierBundle,
} from '@/data/suppliers'
import { CREDIT_KINDS } from '@/domain/supplier-settlement'
import { computeDaysSince } from '@/domain/supplier-purchases'
import { gramsToKgText, milliToRateText } from '@/domain/supplier-units'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { exportNodeAsJpg } from '@/lib/image-export'
import { formatPaiseInr } from '@/lib/inr-format'

const searchSchema = z.object({
  highlightBill: z.string().optional(),
  tab: z.enum(['ledger', 'bills', 'payments']).optional(),
})

export const Route = createFileRoute('/supplier-ledger/$supplierId')({
  validateSearch: searchSchema,
  component: SupplierLedgerRoute,
})

type PoolFilter = 'all' | 'kacha' | 'gst'

function SupplierLedgerRoute() {
  return (
    <PurchasesShell>
      <SupplierLedgerPage />
    </PurchasesShell>
  )
}

function SupplierLedgerPage() {
  const { supplierId } = Route.useParams()
  const { tab = 'ledger', highlightBill } = Route.useSearch()
  const navigate = useNavigate()
  const exportRef = useRef<HTMLDivElement>(null)
  const [isExporting, setIsExporting] = useState(false)

  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [expandedBillIds, setExpandedBillIds] = useState<Set<string>>(new Set())
  const [billModal, setBillModal] = useState<null | { type: 'bardan' | 'payment' | 'settleNil' | 'cancelBill'; row: BillsTableRow }>(null)
  const [paymentDetailsId, setPaymentDetailsId] = useState<string | null>(null)

  const bundleQuery = useQuery({
    queryKey: ['supplier-bundle', supplierId],
    queryFn: () => loadSupplierBundle(supplierId),
  })

  const bundle = bundleQuery.data

  const settlement = useMemo(() => (bundle ? computeSupplierBundleSettlement(bundle) : null), [bundle])

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

  // ---- Payments tab rows (enriched from the bundle) ----
  const paymentRows = useMemo(() => {
    if (!bundle) return []
    const settlementPayments = settlement ? [...settlement.pools.kacha.payments, ...settlement.pools.gst.payments] : []
    const appliedMap = new Map(settlementPayments.map((p) => [p.paymentId, p.appliedPaise]))
    const billMap = new Map(bundle.bills.map((b) => [b.id, b]))
    return bundle.payments.map((p) => {
      const appliedPaise = appliedMap.get(p.id) ?? 0
      const allocations = bundle.allocations
        .filter((a) => a.paymentId === p.id)
        .map((a) => ({ billId: a.billId, inNo: billMap.get(a.billId)?.inNo ?? '', amountPaise: a.amountPaise, isManual: true as const }))
      return {
        id: p.id,
        date: p.date,
        created: p.created,
        supplierId: p.supplierId,
        supplierName: bundle.supplier.companyName,
        pool: p.pool,
        kind: p.kind,
        mode: p.mode,
        reference: p.reference,
        payeeName: p.payeeName,
        privateNote: p.privateNote,
        photos: p.photos,
        amountPaise: p.amountPaise,
        appliedPaise,
        advancePaise: CREDIT_KINDS.has(p.kind) ? Math.max(0, p.amountPaise - appliedPaise) : 0,
        cancelled: p.cancelled,
        cancelReason: p.cancelReason,
        allocations,
      }
    })
  }, [bundle, settlement])

  const ledgerResult = useMemo(() => {
    if (!bundle) return null
    return computeSupplierBundleLedger(bundle, { pool: poolFilter, from: fromDate || undefined, to: toDate || undefined })
  }, [bundle, poolFilter, fromDate, toDate])

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
        kind: payment.kind,
        caption: `${payment.kind.replace(/_/g, ' ')} · (cancelled)`,
        debitPaise: 0,
        creditPaise: 0,
        balancePaise: null,
        cancelled: true,
        cancelReason: payment.cancelReason,
        paymentId: payment.id,
        modeOrRef: [payment.mode, payment.reference].filter(Boolean).join(' · ').toUpperCase(),
      })
    }

    rows.sort((a, b) => `${a.date}|${a.created}|${a.id}`.localeCompare(`${b.date}|${b.created}|${b.id}`))
    return rows
  }, [bundle, ledgerResult, billMap, paymentMap, billSettlementMap, poolFilter, fromDate, toDate])

  const handleExportJpg = async () => {
    if (!exportRef.current) return
    try {
      setIsExporting(true)
      const filename = `ledger-${bundle?.supplier.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-') ?? supplierId}-${getLocalIsoDate()}.jpg`
      await exportNodeAsJpg(exportRef.current, { filename, backgroundColor: '#ffffff', preferredWidthPx: 1200 })
    } catch (err) {
      console.error('Ledger export failed', err)
    } finally {
      setIsExporting(false)
    }
  }

  if (bundleQuery.isLoading) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-400">Loading supplier…</div>
  }
  if (bundleQuery.isError || !bundle) {
    return (
      <div className="p-6">
        <p className="text-sm text-rose-600">Failed to load this supplier.</p>
        <Link to="/suppliers" className="mt-2 inline-flex items-center gap-1 text-sm text-blue-700 underline">
          <ArrowLeft size={14} /> Back to suppliers
        </Link>
      </div>
    )
  }

  const s = bundle.supplier

  return (
    <div className="min-w-0 px-3 pb-10 pt-2 sm:px-4">
      {/* Supplier identity + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold text-slate-900">{s.companyName}</h1>
          {s.city && <span className="text-xs text-slate-500">· {s.city}</span>}
          {!s.active && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Inactive</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <Link to="/new-purchase-bill" search={{ supplierId: s.id }} className="inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700">
            <Plus size={13} /> Bill
          </Link>
          <Link to="/new-supplier-payment" search={{ supplierId: s.id }} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
            <Coins size={13} /> Payment
          </Link>
          {tab === 'ledger' && (
            <button type="button" onClick={() => void handleExportJpg()} disabled={isExporting} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50">
              <Download size={13} /> {isExporting ? 'Exporting…' : 'JPG'}
            </button>
          )}
        </div>
      </div>

      {/* Slim KPI row */}
      <div className="mt-2 flex flex-wrap divide-x divide-slate-200 overflow-hidden rounded-md border border-slate-200 bg-white text-xs">
        <KpiCell label="Total Owed" value={settlement?.combined.netPositionPaise ?? 0} tone="rose" />
        <KpiCell label="Kacha" value={settlement?.pools.kacha.outstandingPaise ?? 0} tone="amber" />
        <KpiCell label="GST" value={settlement?.pools.gst.outstandingPaise ?? 0} tone="blue" />
        <KpiCell label="Advance" value={settlement?.combined.advancePaise ?? 0} tone="emerald" />
        <div className="flex min-w-24 flex-col justify-center px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Bardan Pending</span>
          <span className={`font-semibold tabular-nums ${bardanPendingCount > 0 ? 'text-amber-600' : 'text-slate-600'}`}>{bardanPendingCount} bills</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-2.5 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
        {(['ledger', 'bills', 'payments'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => void navigate({ to: '/supplier-ledger/$supplierId', params: { supplierId }, search: (prev) => ({ ...prev, tab: key }) })}
            className={`rounded-md px-3 py-1.5 capitalize transition ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {key}
          </button>
        ))}
      </div>

      {/* ---------- LEDGER TAB ---------- */}
      {tab === 'ledger' && (
        <div ref={exportRef} className="mt-2 rounded-xl bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
              {(['all', 'kacha', 'gst'] as PoolFilter[]).map((pf) => (
                <button key={pf} type="button" onClick={() => setPoolFilter(pf)} className={`rounded-md px-3 py-1 transition ${poolFilter === pf ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {pf === 'all' ? 'All' : pf === 'kacha' ? 'Kacha' : 'GST'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <DateInput className="h-7 w-28 rounded border border-slate-300 px-1.5 text-xs" value={fromDate} onChange={setFromDate} />
              <span>→</span>
              <DateInput className="h-7 w-28 rounded border border-slate-300 px-1.5 text-xs" value={toDate} onChange={setToDate} />
              {(fromDate || toDate) && (
                <button type="button" onClick={() => { setFromDate(''); setToDate('') }} className="text-[10px] text-blue-600 hover:underline">
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-[13px]">
              <thead className="bg-slate-50">
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5">Pool</th>
                  <th className="px-2 py-1.5 text-right">Debit</th>
                  <th className="px-2 py-1.5 text-right">Credit</th>
                  <th className="px-2 py-1.5 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(poolFilter === 'all' || poolFilter === 'kacha') && (
                  <OpeningRow label="Opening (Kacha)" pool="kacha" paise={s.openingKachaPaise} date={fromDate || s.openingBalanceDate} />
                )}
                {(poolFilter === 'all' || poolFilter === 'gst') && (
                  <OpeningRow label="Opening (GST)" pool="gst" paise={s.openingGstPaise} date={fromDate || s.openingBalanceDate} combined={poolFilter === 'all' ? s.openingKachaPaise + s.openingGstPaise : undefined} />
                )}
                {mergedRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-xs italic text-slate-400">No transactions in this period.</td>
                  </tr>
                )}
                {mergedRows.map((row) => {
                                  const isBillRow = row.kind === 'bill' && row.billId
                  const isExpanded = row.billId ? expandedBillIds.has(row.billId) : false
                  const billBardan = row.billId ? bundle.bardan.filter((b) => b.billId === row.billId) : []
                  const billAdjustments = row.billId ? bundle.adjustments.filter((a) => a.billId === row.billId) : []

                  if (row.cancelled) {
                    return (
                      <tr key={`${row.id}-x`} className="opacity-60">
                        <td className="px-2 py-1.5 text-xs text-slate-400 line-through">{formatFullDate(row.date)}</td>
                        <td className="px-2 py-1.5 text-xs">
                          <span className="line-through text-slate-400">{row.caption}</span>
                          <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Cancelled</span>
                          {row.cancelReason && <span className="ml-1 text-[11px] text-slate-400">({row.cancelReason})</span>}
                        </td>
                        <td className="px-2 py-1.5"><PoolPill pool={row.pool} /></td>
                        <td className="px-2 py-1.5 text-right text-slate-400">—</td>
                        <td className="px-2 py-1.5 text-right text-slate-400">—</td>
                        <td className="px-2 py-1.5 text-right text-slate-400">—</td>
                      </tr>
                    )
                  }

                  return (
                    <tr
                      key={row.id}
                      onClick={() => {
                        if (row.inNo) void navigate({ to: '/purchase-bills/$billId', params: { billId: row.inNo } })
                        else if (row.paymentId) setPaymentDetailsId(row.paymentId)
                      }}
                      className="h-[34px] cursor-pointer transition hover:bg-slate-50"
                    >
                      <td className="whitespace-nowrap px-2 py-0 text-xs text-slate-600">{formatFullDate(row.date)}</td>
                      <td className="px-2 py-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="max-w-[420px] truncate text-slate-800" title={row.caption}>{row.caption}</span>
                          {row.isSettled && <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-semibold text-emerald-700"><CheckCircle2 size={9} /> NIL</span>}
                          {row.isBardanPending && <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-700"><AlertCircle size={9} /> Bardan</span>}
                          {isBillRow && (billBardan.length > 0 || billAdjustments.length > 0) && (
                            <button
                              type="button"
                              className="rounded p-0.5 text-slate-400 hover:text-slate-700"
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
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          )}
                        </div>
                        {row.modeOrRef && <p className="text-[10px] uppercase text-slate-400">{row.modeOrRef}</p>}
                        {isExpanded && (
                          <div className="mt-1 space-y-0.5 rounded border border-slate-200 bg-slate-50/80 p-1.5 text-[11px] text-slate-600">
                            {billBardan.filter((b) => b.method === 'deduct').map((b) => (
                              <div key={b.id} className="flex justify-between text-amber-700">
                                <span>↳ Bardan Deduct: {gramsToKgText(b.bardanG)} kg @ ₹{milliToRateText(b.rateMilli)}/kg</span>
                                <span className="font-mono">-{formatPaiseInr(b.creditPaise)}</span>
                              </div>
                            ))}
                            {billAdjustments.map((a) => (
                              <div key={a.id} className="flex justify-between">
                                <span>↳ {a.type.replace(/_/g, ' ')}</span>
                                <span className="font-mono">{a.amountPaise >= 0 ? `+${formatPaiseInr(a.amountPaise)}` : `-${formatPaiseInr(-a.amountPaise)}`}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-0"><PoolPill pool={row.pool} /></td>
                      <td className="px-2 py-0 text-right font-mono tabular-nums">{row.debitPaise > 0 ? <span className="text-rose-600">{formatPaiseInr(row.debitPaise)}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-0 text-right font-mono tabular-nums">{row.creditPaise > 0 ? <span className="text-emerald-700">{formatPaiseInr(row.creditPaise)}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-0 text-right font-mono font-semibold tabular-nums text-slate-900">{row.balancePaise != null ? formatPaiseInr(row.balancePaise) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
              {ledgerResult && (
                <tfoot>
                  <tr className="border-t border-slate-300 bg-slate-50 font-semibold text-slate-800">
                    <td className="px-2 py-2 text-[10px] uppercase tracking-wider text-slate-500" colSpan={3}>Closing Balance</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-rose-700">{formatPaiseInr(ledgerResult.totalDebitsPaise)}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-emerald-700">{formatPaiseInr(ledgerResult.totalCreditsPaise)}</td>
                    <td className="px-2 py-2 text-right font-mono text-base font-bold tabular-nums text-slate-900">{formatPaiseInr(ledgerResult.closingPaise)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ---------- BILLS TAB ---------- */}
      {tab === 'bills' && (
        <div className="mt-2">
          <PurchaseBillsTable
            rows={highlightBill ? billRows.filter((r) => r.id === highlightBill) : billRows}
            showSupplier={false}
            actions={{
              onRecordPayment: (row) => setBillModal({ type: 'payment', row }),
              onAddBardan: (row) => setBillModal({ type: 'bardan', row }),
              onSettleNil: (row) => setBillModal({ type: 'settleNil', row }),
              onEdit: (row) => void navigate({ to: '/new-purchase-bill', search: { editBillId: row.id } }),
              onCancel: (row) => setBillModal({ type: 'cancelBill', row }),
            }}
            emptyMessage="No purchase bills for this supplier."
          />
        </div>
      )}

      {/* ---------- PAYMENTS TAB ---------- */}
      {tab === 'payments' && (
        <div className="mt-2">
          <SupplierPaymentsTable
            rows={paymentRows}
            showSupplier={false}
            onOpenDetails={(row) => setPaymentDetailsId(row.id)}
            onCancel={(row) => setPaymentDetailsId(row.id)}
            emptyMessage="No payments for this supplier."
          />
        </div>
      )}

      {/* Modals */}
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
  fallback: string,
  bill: SupplierBundle['bills'][number] | undefined,
  payment: SupplierBundle['payments'][number] | undefined,
  bundle: SupplierBundle,
): string {
  if (kind === 'bill' && bill) {
    const lines = bundle.lines.filter((l) => l.billId === bill.id)
    const parts: string[] = []
    for (const line of lines.slice(0, 2)) {
      parts.push(`${line.itemName} ${gramsToKgText(line.weightG)} kg @ ₹${milliToRateText(line.rateMilli)}`)
    }
    if (lines.length > 2) parts.push(`+${lines.length - 2} more`)
    return `Bill ${bill.inNo}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
  }
  if (payment) {
    const base = kind === 'refund_received' ? 'Refund received' : payment.kind === 'bardan_advance' ? 'Bardan advance' : payment.kind.replace(/_/g, ' ')
    const ref = payment.reference ? ` · ${payment.reference}` : ''
    const text = `${base}${ref}`
    return text.charAt(0).toUpperCase() + text.slice(1)
  }
  return fallback
}

function OpeningRow({ label, pool, paise, date, combined }: { label: string; pool: 'kacha' | 'gst'; paise: number; date?: string; combined?: number }) {
  const balance = combined ?? paise
  return (
    <tr className="bg-slate-50/50 font-medium text-slate-700">
      <td className="px-2 py-1.5 text-xs text-slate-500">{date ? formatFullDate(date) : 'Opening'}</td>
      <td className="px-2 py-1.5 text-slate-600">{label}</td>
      <td className="px-2 py-1.5"><PoolPill pool={pool} /></td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{paise > 0 ? formatPaiseInr(paise) : '—'}</td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{paise < 0 ? formatPaiseInr(-paise) : '—'}</td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-800">{formatPaiseInr(balance)}</td>
    </tr>
  )
}

function PoolPill({ pool }: { pool: string }) {
  return (
    <span className={`inline-flex h-4 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold uppercase ${pool === 'gst' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
      {pool === 'gst' ? 'G' : 'K'}
    </span>
  )
}

function KpiCell({ label, value, tone }: { label: string; value: number; tone: 'rose' | 'amber' | 'blue' | 'emerald' }) {
  const valueClass =
    tone === 'rose' ? (value > 0 ? 'text-rose-600' : 'text-slate-700') : tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-700' : 'text-blue-700'
  return (
    <div className="flex min-w-24 flex-col justify-center px-3 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <span className={`font-semibold tabular-nums ${valueClass}`}>{formatPaiseInr(value)}</span>
    </div>
  )
}
