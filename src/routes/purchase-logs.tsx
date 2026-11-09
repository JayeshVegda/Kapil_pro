import { LogsDateWindow, LogsPager, defaultLogFromDate, useLogsPager } from '@/components/logging/logs-shell'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Download,
  Edit3,
  Eye,
  IndianRupee,
  Package,
  ReceiptText,
  Search,
  Wallet,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import {
  AddBardanModal,
  CancelBillModal,
  PaymentDetailsModal,
  RecordPaymentModal,
  type PaymentPinTarget,
} from '@/components/suppliers/bill-modals'
import {
  type EnrichedPurchaseBill,
  type EnrichedSupplierPayment,
} from '@/data/suppliers'
import { PurchaseBillEditDialog } from '@/components/suppliers/purchase-bill-editor'
import { purchaseAuditQueryOptions, purchaseBillsQueryOptions, supplierPaymentsQueryOptions, suppliersSummaryQueryOptions } from '@/data/purchase-queries'
import { formatDateTime, formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'
import { computePurchaseLogMetrics, supplierPaymentActivity } from '@/domain/purchase-log-metrics'

const searchSchema = z.object({
  q: z.string().optional(),
  type: z.enum(['all', 'bills', 'payments', 'bardan', 'audit']).optional(),
  pool: z.enum(['all', 'kacha', 'gst']).optional(),
  status: z.enum(['all', 'active', 'cancelled']).optional(),
})

export const Route = createFileRoute('/purchase-logs')({
  validateSearch: searchSchema,
  component: PurchaseLogsPage,
})

type LogType = 'all' | 'bills' | 'payments' | 'bardan' | 'audit'

type UnifiedPurchaseRow =
  | {
      id: string
      key: string
      kind: 'bill'
      date: string
      created: string
      supplierId: string
      supplierName: string
      reference: string
      pool: 'kacha' | 'gst'
      amountPaise: number
      duePaise: number
      paidPaise: number
      status: 'open' | 'partial' | 'nil' | 'cancelled'
      cancelled: boolean
      bardanPending: boolean
      subtitle: string
      rawBill: EnrichedPurchaseBill
    }
  | {
      id: string
      key: string
      kind: 'payment'
      date: string
      created: string
      supplierId: string
      supplierName: string
      reference: string
      pool: 'kacha' | 'gst'
      amountPaise: number
      duePaise: 0
      paidPaise: number
      status: 'nil' | 'cancelled'
      cancelled: boolean
      bardanPending: false
      subtitle: string
      rawPayment: EnrichedSupplierPayment
    }

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

function PurchaseLogsPage() {
  const navigate = useNavigate()
  const searchParams = Route.useSearch()

  // Local filter states synced with URL
  const query = searchParams.q ?? ''
  const typeFilter = searchParams.type ?? 'all'
  const poolFilter = searchParams.pool ?? 'all'
  const statusFilter = searchParams.status ?? 'active'
  const [sortAsc, setSortAsc] = useState(false)
  const [dateFrom, setDateFrom] = useState(() => defaultLogFromDate(getLocalIsoDate()))

  // Modals state
  const [cancelBillTarget, setCancelBillTarget] = useState<{ id: string; inNo: string } | null>(null)
  const [editBillTarget, setEditBillTarget] = useState<{ id: string; inNo: string } | null>(null)
  const [bardanBillId, setBardanBillId] = useState<string | null>(null)
  const [paymentDetailsId, setPaymentDetailsId] = useState<string | null>(null)
  const [recordPaymentTarget, setRecordPaymentTarget] = useState<{
    supplierId: string
    supplierName?: string
    pool: 'kacha' | 'gst'
    pins: PaymentPinTarget[]
  } | null>(null)

  // Queries
  const billsQuery = useQuery(purchaseBillsQueryOptions())
  const paymentsQuery = useQuery(supplierPaymentsQueryOptions())
  const auditQuery = useQuery(purchaseAuditQueryOptions(dateFrom))
  const summaryQuery = useQuery(suppliersSummaryQueryOptions())

  const allBills = useMemo(() => billsQuery.data ?? [], [billsQuery.data])
  const allPayments = useMemo(() => paymentsQuery.data ?? [], [paymentsQuery.data])
  const allAudit = useMemo(() => auditQuery.data ?? [], [auditQuery.data])

  const updateSearch = (patch: Partial<z.infer<typeof searchSchema>>) => {
    const nextQ = 'q' in patch ? patch.q : query
    const nextType = 'type' in patch ? patch.type : typeFilter
    const nextPool = 'pool' in patch ? patch.pool : poolFilter
    const nextStatus = 'status' in patch ? patch.status : statusFilter

    void navigate({
      to: '/purchase-logs',
      search: {
        q: nextQ ? nextQ : undefined,
        type: nextType && nextType !== 'all' ? nextType : undefined,
        pool: nextPool && nextPool !== 'all' ? nextPool : undefined,
        status: nextStatus && nextStatus !== 'active' ? nextStatus : undefined,
      },
      replace: true,
    })
  }

  // Build unified transaction rows (Bills + Payments)
  const transactionRows = useMemo(() => {
    const list: UnifiedPurchaseRow[] = []

    for (const b of allBills) {
      const itemsSummary = b.lines
        .map((l) => `${l.itemName || 'Scrap'} (${(l.weightG / 1000).toFixed(1)}kg)`)
        .slice(0, 2)
        .join(', ')

      list.push({
        id: b.id,
        key: `bill:${b.id}`,
        kind: 'bill',
        date: b.date,
        created: b.created,
        supplierId: b.supplierId,
        supplierName: b.supplierName || 'Unknown Supplier',
        reference: b.inNo,
        pool: b.pool,
        amountPaise: b.netPaise,
        duePaise: b.duePaise,
        paidPaise: b.paidPaise,
        status: b.cancelled ? 'cancelled' : b.status,
        cancelled: b.cancelled,
        bardanPending: b.bardanPending,
        subtitle: itemsSummary || (b.supplierBillNo ? `Supplier Bill #${b.supplierBillNo}` : 'Purchase bill'),
        rawBill: b,
      })
    }

    for (const p of allPayments) {
      const activity = supplierPaymentActivity(p.kind)
      list.push({
        id: p.id,
        key: `payment:${p.id}`,
        kind: 'payment',
        date: p.date,
        created: p.created,
        supplierId: p.supplierId,
        supplierName: p.supplierName || 'Unknown Supplier',
        reference: p.reference ? `Ref: ${p.reference}` : `Mode: ${p.mode.toUpperCase()}`,
        pool: p.pool,
        amountPaise: p.amountPaise,
        duePaise: 0,
        paidPaise: p.amountPaise,
        status: p.cancelled ? 'cancelled' : 'nil',
        cancelled: p.cancelled,
        bardanPending: false,
        subtitle: `${activity.label}${p.allocations?.length ? ` · Applied to ${p.allocations.length} bill(s)` : ` · ${activity.direction === 'incoming' ? 'Incoming refund' : activity.direction === 'non-cash' ? 'Non-cash credit' : 'Outgoing payment'}`}`,
        rawPayment: p,
      })
    }

    return list
  }, [allBills, allPayments])

  // Filtered rows for transaction view
  const filteredTransactions = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return transactionRows
      .filter((row) => row.date >= dateFrom)
      .filter((row) => {
        if (typeFilter === 'bills') return row.kind === 'bill'
        if (typeFilter === 'payments') return row.kind === 'payment'
        if (typeFilter === 'bardan') return row.kind === 'bill' && row.bardanPending
        return true
      })
      .filter((row) => {
        if (poolFilter === 'all') return true
        return row.pool === poolFilter
      })
      .filter((row) => {
        if (statusFilter === 'active') return !row.cancelled
        if (statusFilter === 'cancelled') return row.cancelled
        return true
      })
      .filter((row) => {
        if (!needle) return true
        const hay = `${row.supplierName} ${row.reference} ${row.subtitle} ${row.pool} ${row.kind}`.toLowerCase()
        return hay.includes(needle)
      })
      .sort((a, b) => {
        const cmp = a.date.localeCompare(b.date) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id)
        return sortAsc ? cmp : -cmp
      })
  }, [transactionRows, query, typeFilter, poolFilter, statusFilter, sortAsc, dateFrom])

  // Filtered rows for audit trail view
  const filteredAudit = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allAudit
      .filter((entry) => entry.created.slice(0, 10) >= dateFrom)
      .filter((entry) => {
        if (!needle) return true
        const hay = `${entry.title} ${entry.detail} ${entry.action} ${entry.collection} ${entry.actor}`.toLowerCase()
        return hay.includes(needle)
      })
      .sort((a, b) => (sortAsc ? a.created.localeCompare(b.created) : b.created.localeCompare(a.created)))
  }, [allAudit, query, sortAsc, dateFrom])

  const transactionPager = useLogsPager(filteredTransactions)
  const auditPager = useLogsPager(filteredAudit)

  // Summary Metrics
  const summaryKpi = useMemo(() => computePurchaseLogMetrics(allBills, allPayments, summaryQuery.data ?? []), [allBills, allPayments, summaryQuery.data])

  const handleExportCsv = () => {
    if (typeFilter === 'audit') {
      const headers = ['Date', 'Entry', 'Detail', 'Collection', 'Action', 'Actor']
      const body = filteredAudit.map((e) => [
        formatDateTime(e.created),
        e.title,
        e.detail,
        e.collection,
        e.action,
        e.actor,
      ])
      downloadCsv(`purchase-audit-${getLocalIsoDate()}.csv`, toCsv([headers, ...body]))
      return
    }

    const headers = ['Date', 'Type', 'Direction', 'Party', 'Reference', 'Pool', 'Total Amount', 'Due Amount', 'Status']
    const body = filteredTransactions.map((r) => [
      r.date,
      r.kind === 'bill' ? 'BILL' : supplierPaymentActivity(r.rawPayment.kind).label,
      r.kind === 'bill' ? 'Payable' : supplierPaymentActivity(r.rawPayment.kind).direction,
      r.supplierName,
      r.reference,
      r.pool.toUpperCase(),
      (r.amountPaise / 100).toFixed(2),
      (r.duePaise / 100).toFixed(2),
      r.status.toUpperCase(),
    ])
    downloadCsv(`purchase-transactions-${getLocalIsoDate()}.csv`, toCsv([headers, ...body]))
  }

  const isLoading = billsQuery.isLoading || paymentsQuery.isLoading || auditQuery.isLoading || summaryQuery.isLoading
  const hasActiveFilters = Boolean(query || typeFilter !== 'all' || poolFilter !== 'all' || statusFilter !== 'active')

  return (
    <div className="w-full space-y-4 p-3 sm:p-5 max-w-[1600px] mx-auto">
      {/* 1. TOP KPI STRIP (4 Dense Cards) */}
      <section className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {/* Metric 1: Total Volume */}
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px] sm:text-[11px]">
              <ReceiptText size={14} className="text-primary" /> Activity Records
            </span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground">
              {summaryKpi.activeCount} active
            </span>
          </div>
          <p className="mt-2 font-mono text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">
            {allBills.length} <span className="text-xs font-semibold text-muted-foreground font-sans">bills · {allPayments.length} payments</span>
          </p>
        </div>

        {/* Metric 2: Bills Spend */}
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px] sm:text-[11px]">
              <Package size={14} className="text-blue-600" /> Total Purchases
            </span>
            <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[11px] font-bold text-blue-700 font-mono">
              Bills
            </span>
          </div>
          <p className="mt-2 font-mono text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">
            {formatPaiseInr(summaryKpi.totalBillsPaise)}
          </p>
        </div>

        {/* Metric 3: Payments Settled */}
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px] sm:text-[11px]">
              <Wallet size={14} className="text-emerald-600" /> Total Paid Out
            </span>
            <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 font-mono">
              Settled
            </span>
          </div>
          <p className="mt-2 font-mono text-xl sm:text-2xl font-extrabold tracking-tight text-emerald-700">
            {formatPaiseInr(summaryKpi.totalPaymentsPaise)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Refunds received {formatPaiseInr(summaryKpi.refundsReceivedPaise)} · Non-cash credits {formatPaiseInr(summaryKpi.nonCashCreditsPaise)}</p>
        </div>

        {/* Metric 4: Net Payables Outstanding */}
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px] sm:text-[11px]">
              <IndianRupee size={14} className="text-rose-600" /> Amount Owed
            </span>
            {summaryKpi.bardanCount > 0 && (
              <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 font-mono">
                {summaryKpi.bardanCount} bardan
              </span>
            )}
          </div>
          <p className="mt-2 font-mono text-xl sm:text-2xl font-extrabold tracking-tight text-rose-600">
            {formatPaiseInr(summaryKpi.totalDuePaise)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Available advance {formatPaiseInr(summaryKpi.availableAdvancePaise)}</p>
        </div>
      </section>

      {/* 2. FILTER & ACTION CARD (Strictly Enclosed Inside Card) */}
      <section className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2.5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          {/* Search Input */}
          <div className="relative min-w-[240px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-xs text-foreground shadow-2xs outline-none transition placeholder:text-muted-foreground focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
              placeholder="Search supplier, IN number, reference, scrap grade, note…"
              value={query}
              onChange={(e) => updateSearch({ q: e.target.value })}
            />
          </div>

          {/* Type Dropdown */}
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30 lg:w-44 lg:flex-none"
            value={typeFilter}
            onChange={(e) => updateSearch({ type: e.target.value as LogType })}
          >
            <option value="all">All Transactions</option>
            <option value="bills">Purchase Bills</option>
            <option value="payments">Supplier Payments</option>
            <option value="bardan">Bardan Pending</option>
            <option value="audit">System Audit Log</option>
          </select>

          {/* Pool Toggle (Kacha vs GST) */}
          {typeFilter !== 'audit' && (
            <div className="inline-flex flex-none rounded-md border border-border bg-secondary/50 p-0.5 text-xs">
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  poolFilter === 'all' ? 'bg-card text-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => updateSearch({ pool: 'all' })}
              >
                All Pools
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  poolFilter === 'kacha' ? 'bg-card text-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => updateSearch({ pool: 'kacha' })}
              >
                Kacha
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  poolFilter === 'gst' ? 'bg-card text-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => updateSearch({ pool: 'gst' })}
              >
                GST
              </button>
            </div>
          )}

          {/* Status Mode (Active vs Cancelled) */}
          {typeFilter !== 'audit' && (
            <div className="inline-flex flex-none rounded-md border border-border bg-secondary/50 p-0.5 text-xs">
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  statusFilter === 'active' ? 'bg-card text-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => updateSearch({ status: 'active' })}
              >
                Active
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  statusFilter === 'cancelled' ? 'bg-card text-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => updateSearch({ status: 'cancelled' })}
              >
                Cancelled
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  statusFilter === 'all' ? 'bg-card text-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => updateSearch({ status: 'all' })}
              >
                All
              </button>
            </div>
          )}

          {/* Sort order toggle */}
          <button
            type="button"
            onClick={() => setSortAsc((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground hover:bg-secondary transition shrink-0"
            title="Toggle sort order"
          >
            {sortAsc ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            <span>{sortAsc ? 'Oldest' : 'Newest'}</span>
          </button>

          {/* CSV Export Button */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={typeFilter === 'audit' ? filteredAudit.length === 0 : filteredTransactions.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-2xs hover:bg-secondary transition disabled:opacity-50 lg:ml-auto shrink-0"
            aria-label="Export filtered records as CSV" title="Export filtered records as CSV"
          >
            <Download size={13} /> CSV
          </button>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => updateSearch({ q: undefined, type: undefined, pool: undefined, status: undefined })}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-secondary/50 px-2.5 text-xs font-medium text-foreground hover:bg-secondary transition shrink-0"
              title="Clear all filters"
            >
              <X size={13} /> Clear
            </button>
          )}
        </div>
      </section>

      {/* 3. MAIN TABLE CARD (Inspired by /transactions with rich columns) */}
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">
            Loading purchases transactions log…
          </div>
        ) : typeFilter === 'audit' ? (
          /* ================= SUB-VIEW: RAW AUDIT TRAIL ================= */
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[760px] text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3.5 py-2.5">Date & Time</th>
                  <th className="px-3.5 py-2.5">Entity / Record</th>
                  <th className="px-3.5 py-2.5">Detail</th>
                  <th className="px-3.5 py-2.5">Action</th>
                  <th className="px-3.5 py-2.5">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredAudit.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-xs italic text-muted-foreground">
                      No system audit entries match your filters.
                    </td>
                  </tr>
                ) : (
                  auditPager.pageRows.map((entry) => (
                    <tr key={entry.id} className="transition hover:bg-secondary/30">
                      <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {formatDateTime(entry.created)}
                      </td>
                      <td className="px-3.5 py-2.5 font-medium text-foreground">
                        {entry.title}
                      </td>
                      <td className="px-3.5 py-2.5 text-muted-foreground max-w-md truncate">
                        {entry.detail || '—'}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className="rounded px-1.5 py-0.5 text-[11px] font-bold uppercase bg-secondary text-foreground">
                          {entry.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-muted-foreground">{entry.actor || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* ================= MAIN VIEW: TRANSACTIONS LEDGER ================= */
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[920px] text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3.5 py-2.5">Date</th>
                  <th className="px-3.5 py-2.5">Type</th>
                  <th className="px-3.5 py-2.5">Supplier / Party</th>
                  <th className="px-3.5 py-2.5">Reference / IN No</th>
                  <th className="px-3.5 py-2.5">Pool</th>
                  <th className="px-3.5 py-2.5 text-right">Amount</th>
                  <th className="px-3.5 py-2.5 text-right">Balance Due</th>
                  <th className="px-3.5 py-2.5 text-center">Status</th>
                  <th className="px-3.5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-xs text-muted-foreground">
                      No purchase transactions found matching the selected filters.
                    </td>
                  </tr>
                ) : (
                  transactionPager.pageRows.map((row) => {
                    const isBill = row.kind === 'bill'
                    return (
                      <tr key={row.key} className="transition hover:bg-secondary/30">
                        {/* Date */}
                        <td className="whitespace-nowrap px-3.5 py-3 font-mono text-xs text-muted-foreground">
                          {formatFullDate(row.date)}
                        </td>

                        {/* Type Badge */}
                        <td className="whitespace-nowrap px-3.5 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider ${
                              isBill
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            {isBill ? <ReceiptText size={11} /> : <Wallet size={11} />}
                            {row.kind === 'bill' ? 'BILL' : supplierPaymentActivity(row.rawPayment.kind).label}
                          </span>
                        </td>

                        {/* Supplier Name + link to ledger */}
                        <td className="px-3.5 py-3">
                          <Link
                            to="/supplier-ledger/$supplierId"
                            params={{ supplierId: row.supplierId }}
                            className="font-semibold text-foreground hover:text-primary transition hover:underline"
                          >
                            {row.supplierName}
                          </Link>
                          {row.subtitle && (
                            <p className="text-[11px] text-muted-foreground truncate max-w-xs">{row.subtitle}</p>
                          )}
                        </td>

                        {/* Reference / IN No */}
                        <td className="px-3.5 py-3 font-mono font-medium text-foreground">
                          {isBill ? (
                            <Link
                              to="/purchase-bills"
                              search={{ billId: row.id }}
                              className="text-primary hover:underline font-bold"
                            >
                              {row.reference}
                            </Link>
                          ) : (
                            row.reference
                          )}
                        </td>

                        {/* Pool Badge */}
                        <td className="whitespace-nowrap px-3.5 py-3">
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase ${
                              row.pool === 'gst'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {row.pool}
                          </span>
                        </td>

                        {/* Amount */}
                        <td className="whitespace-nowrap px-3.5 py-3 text-right font-mono font-bold text-foreground tabular-nums">
                          {formatPaiseInr(row.amountPaise)}
                        </td>

                        {/* Balance Due */}
                        <td className="whitespace-nowrap px-3.5 py-3 text-right font-mono tabular-nums">
                          {isBill ? (
                            row.duePaise > 0 ? (
                              <span className="font-bold text-rose-600">{formatPaiseInr(row.duePaise)}</span>
                            ) : (
                              <span className="font-semibold text-emerald-700">NIL</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* Status Stamp */}
                        <td className="whitespace-nowrap px-3.5 py-3 text-center">
                          {row.cancelled ? (
                            <span className="rounded bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] font-bold uppercase text-rose-700">
                              Cancelled
                            </span>
                          ) : row.kind === 'payment' ? (
                            <span className="rounded bg-slate-50 border border-slate-200 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-600">Recorded</span>
                          ) : row.status === 'nil' ? (
                            <span className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold uppercase text-emerald-700">
                              NIL
                            </span>
                          ) : row.status === 'partial' ? (
                            <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-800">
                              Partial
                            </span>
                          ) : (
                            <span className="rounded bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] font-bold uppercase text-rose-700">
                              Open
                            </span>
                          )}
                          {row.bardanPending && (
                            <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 border border-amber-300">
                              Bardan
                            </span>
                          )}
                        </td>

                        {/* Actions (View, Edit, Pay/Cancel) */}
                        <td className="whitespace-nowrap px-3.5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isBill ? (
                              <>
                                <Link
                                  to="/purchase-bills"
                                  search={{ billId: row.id }}
                                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-semibold text-foreground hover:bg-secondary transition"
                                  title="View bill & chitty preview"
                                >
                                  <Eye size={12} /> Chitty
                                </Link>
                                {!row.cancelled && (
                                  <button
                                    type="button"
                                    onClick={() => setEditBillTarget({ id: row.id, inNo: row.reference })}
                                    className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 transition"
                                    title="Edit bill in a dialog"
                                  >
                                    <Edit3 size={12} /> Edit
                                  </button>
                                )}
                                {!row.cancelled && row.duePaise > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRecordPaymentTarget({
                                        supplierId: row.supplierId,
                                        supplierName: row.supplierName,
                                        pool: row.pool,
                                        pins: [{ billId: row.id, inNo: row.reference, duePaise: row.duePaise }],
                                      })
                                    }
                                    className="inline-flex h-7 items-center gap-1 rounded bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-700 transition"
                                    title="Record payment for this bill"
                                  >
                                    Pay
                                  </button>
                                )}
                                {!row.cancelled && (
                                  <button
                                    type="button"
                                    onClick={() => setCancelBillTarget({ id: row.id, inNo: row.reference })}
                                    className="inline-flex h-7 items-center rounded border border-border bg-card px-1.5 text-[11px] text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition"
                                    title="Cancel bill"
                                    aria-label="Cancel bill"
                                  >
                                    ✕
                                  </button>
                                )}
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setPaymentDetailsId(row.id)}
                                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-semibold text-foreground hover:bg-secondary transition"
                                  title="View payment allocations & breakdown"
                                >
                                  <Eye size={12} /> View
                                </button>
                                <Link
                                  to="/new-supplier-payment"
                                  search={{ supplierId: row.supplierId }}
                                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 transition"
                                  title="New payment to this supplier"
                                >
                                  <Edit3 size={12} /> Pay
                                </Link>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end px-3 py-2"><LogsDateWindow from={dateFrom} onFromChange={setDateFrom} /></div>
        <LogsPager {...(typeFilter === 'audit' ? auditPager : transactionPager)} />
        {/* Footer record count */}
        <div className="mt-3 border-t border-border pt-3 flex flex-wrap items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing{' '}
            <strong className="text-foreground">
              {typeFilter === 'audit' ? filteredAudit.length : filteredTransactions.length}
            </strong>{' '}
            of {typeFilter === 'audit' ? allAudit.length : transactionRows.length} records
          </span>
          <span className="font-mono text-[11px]">
            Real-time ledger updates
          </span>
        </div>
      </section>

      {/* MODALS */}
      {cancelBillTarget && (
        <CancelBillModal
          billId={cancelBillTarget.id}
          inNo={cancelBillTarget.inNo}
          onClose={() => setCancelBillTarget(null)}
        />
      )}

      {bardanBillId && (
        <AddBardanModal
          billId={bardanBillId}
          onClose={() => setBardanBillId(null)}
        />
      )}

      {paymentDetailsId && (
        <PaymentDetailsModal
          paymentId={paymentDetailsId}
          onClose={() => setPaymentDetailsId(null)}
        />
      )}

      {editBillTarget && (
        <PurchaseBillEditDialog
          billId={editBillTarget.id}
          inNo={editBillTarget.inNo}
          onClose={() => setEditBillTarget(null)}
        />
      )}

      {recordPaymentTarget && (
        <RecordPaymentModal
          supplierId={recordPaymentTarget.supplierId}
          supplierName={recordPaymentTarget.supplierName}
          pool={recordPaymentTarget.pool}
          pins={recordPaymentTarget.pins}
          onClose={() => setRecordPaymentTarget(null)}
        />
      )}
    </div>
  )
}
