import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  CreditCard,
  Download,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { PurchasesShell } from '@/components/suppliers/purchases-shell'
import { PaymentDetailsModal } from '@/components/suppliers/bill-modals'
import { SupplierPaymentsTable } from '@/components/suppliers/supplier-payments-table'
import { DateInput } from '@/components/ui/date-input'
import { listSuppliers, loadAllSupplierPayments } from '@/data/suppliers'
import { getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

export const Route = createFileRoute('/supplier-payments')({
  component: SupplierPaymentsRoute,
})

type PoolFilter = 'all' | 'kacha' | 'gst'
type ModeFilter = 'all' | 'cash' | 'upi' | 'rtgs' | 'neft' | 'cheque' | 'other'
type KindFilter = 'all' | 'payment' | 'paid_on_behalf' | 'settle_off' | 'refund_received' | 'bardan_advance'

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

function SupplierPaymentsRoute() {
  return (
    <PurchasesShell>
      <SupplierPaymentsPage />
    </PurchasesShell>
  )
}

function SupplierPaymentsPage() {
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all')
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [supplierIdFilter, setSupplierIdFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cancelled'>('all')
  const [paymentDetailsId, setPaymentDetailsId] = useState<string | null>(null)

  const paymentsQuery = useQuery({
    queryKey: ['supplier-payments'],
    queryFn: loadAllSupplierPayments,
  })

  const suppliersQuery = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => listSuppliers(),
  })

  const allPayments = paymentsQuery.data ?? []
  const suppliers = suppliersQuery.data ?? []

  const filteredPayments = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allPayments.filter((p) => {
      if (poolFilter !== 'all' && p.pool !== poolFilter) return false
      if (modeFilter !== 'all' && p.mode !== modeFilter) return false
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false
      if (supplierIdFilter !== 'all' && p.supplierId !== supplierIdFilter) return false
      if (statusFilter === 'active' && p.cancelled) return false
      if (statusFilter === 'cancelled' && !p.cancelled) return false
      if (fromDate && p.date < fromDate) return false
      if (toDate && p.date > toDate) return false

      if (needle) {
        const suppMatch = p.supplierName.toLowerCase().includes(needle)
        const refMatch = (p.reference ?? '').toLowerCase().includes(needle)
        const payeeMatch = (p.payeeName ?? '').toLowerCase().includes(needle)
        const noteMatch = (p.privateNote ?? '').toLowerCase().includes(needle)
        if (!suppMatch && !refMatch && !payeeMatch && !noteMatch) return false
      }

      return true
    })
  }, [allPayments, query, poolFilter, modeFilter, kindFilter, supplierIdFilter, statusFilter, fromDate, toDate])

  const activeTotals = useMemo(
    () => ({
      amount: filteredPayments.filter((p) => !p.cancelled).reduce((s, p) => s + p.amountPaise, 0),
      advance: filteredPayments.filter((p) => !p.cancelled).reduce((s, p) => s + p.advancePaise, 0),
    }),
    [filteredPayments],
  )

  const handleExportCsv = () => {
    const headers = [
      'Date',
      'Supplier',
      'Pool',
      'Kind',
      'Mode',
      'Reference',
      'Payee Name',
      'Amount (Rs)',
      'Allocated (Rs)',
      'Advance Left (Rs)',
      'Status',
      'Cancel Reason',
      'Notes',
    ]

    const rows = filteredPayments.map((p) => [
      p.date,
      p.supplierName,
      p.pool.toUpperCase(),
      p.kind,
      p.mode.toUpperCase(),
      p.reference ?? '',
      p.payeeName ?? '',
      (p.amountPaise / 100).toFixed(2),
      (p.appliedPaise / 100).toFixed(2),
      (p.advancePaise / 100).toFixed(2),
      p.cancelled ? 'CANCELLED' : 'ACTIVE',
      p.cancelReason ?? '',
      p.privateNote ?? '',
    ])

    downloadCsv(`supplier-payments-${getLocalIsoDate()}.csv`, toCsv([headers, ...rows]))
  }

  return (
    <div className="min-w-0 px-3 pb-10 pt-2 sm:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold text-slate-900">Supplier Payments</h1>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{allPayments.length} total</span>
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700">Paid {formatPaiseInr(activeTotals.amount)}</span>
          {activeTotals.advance > 0 && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">Advance {formatPaiseInr(activeTotals.advance)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredPayments.length === 0}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={13} /> CSV
          </button>
          <Link
            to="/new-supplier-payment"
            className="inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus size={13} /> Payment
          </Link>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs">
        <div className="relative min-w-48 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search supplier, reference, payee, note…"
            className="h-7 w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 font-semibold">
          {(['all', 'kacha', 'gst'] as PoolFilter[]).map((pf) => (
            <button
              key={pf}
              type="button"
              onClick={() => setPoolFilter(pf)}
              className={`rounded px-2.5 py-1 transition ${poolFilter === pf ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {pf === 'all' ? 'All Pools' : pf === 'kacha' ? 'Kacha' : 'GST'}
            </button>
          ))}
        </div>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as KindFilter)}
          className="h-7 rounded-md border border-slate-300 bg-white px-1.5 text-xs text-slate-800 outline-none focus:border-blue-400"
          aria-label="Filter by kind"
        >
          <option value="all">All Kinds</option>
          <option value="payment">Payment</option>
          <option value="paid_on_behalf">Paid for them</option>
          <option value="settle_off">Settle-off</option>
          <option value="refund_received">Refund</option>
          <option value="bardan_advance">Bardan Adv</option>
        </select>
        <select
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value as ModeFilter)}
          className="h-7 rounded-md border border-slate-300 bg-white px-1.5 text-xs text-slate-800 outline-none focus:border-blue-400"
          aria-label="Filter by mode"
        >
          <option value="all">All Modes</option>
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="rtgs">RTGS</option>
          <option value="neft">NEFT</option>
          <option value="cheque">Cheque</option>
          <option value="other">Other</option>
        </select>
        <select
          value={supplierIdFilter}
          onChange={(e) => setSupplierIdFilter(e.target.value)}
          className="h-7 max-w-40 rounded-md border border-slate-300 bg-white px-1.5 text-xs text-slate-800 outline-none focus:border-blue-400"
          aria-label="Filter by supplier"
        >
          <option value="all">All Suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.companyName}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'cancelled')}
          className="h-7 rounded-md border border-slate-300 bg-white px-1.5 text-xs text-slate-800 outline-none focus:border-blue-400"
          aria-label="Filter by status"
        >
          <option value="all">Active + Cancelled</option>
          <option value="active">Active only</option>
          <option value="cancelled">Cancelled only</option>
        </select>
        <div className="flex items-center gap-1 text-slate-500">
          <DateInput className="h-7 w-28 rounded border border-slate-300 px-1.5 text-xs" value={fromDate} onChange={setFromDate} />
          <span>→</span>
          <DateInput className="h-7 w-28 rounded border border-slate-300 px-1.5 text-xs" value={toDate} onChange={setToDate} />
          {(fromDate || toDate) && (
            <button type="button" onClick={() => { setFromDate(''); setToDate('') }} className="px-1 text-[10px] text-blue-600 hover:underline">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {paymentsQuery.isLoading ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-slate-400" />
          Loading supplier payments…
        </div>
      ) : paymentsQuery.isError ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-rose-600">
          Unable to load supplier payments. Please refresh.
        </div>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl bg-white">
          <SupplierPaymentsTable
            rows={filteredPayments}
            onOpenDetails={(row) => setPaymentDetailsId(row.id)}
            onCancel={(row) => setPaymentDetailsId(row.id)}
            emptyMessage="No supplier payments match."
          />
          {allPayments.length === 0 && (
            <div className="p-10 text-center text-slate-500">
              <CreditCard size={28} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No supplier payments yet</p>
              <p className="mt-1 text-xs text-slate-500">Record your first supplier payment or adjustment.</p>
            </div>
          )}
        </div>
      )}

      {filteredPayments.length !== allPayments.length && (
        <p className="mt-1.5 px-1 text-[10px] text-slate-400">
          Showing {filteredPayments.length} of {allPayments.length} payments
          {(query.trim() || poolFilter !== 'all' || modeFilter !== 'all' || kindFilter !== 'all' || supplierIdFilter !== 'all' || statusFilter !== 'all' || fromDate || toDate) && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setFromDate('')
                setToDate('')
                setPoolFilter('all')
                setModeFilter('all')
                setKindFilter('all')
                setSupplierIdFilter('all')
                setStatusFilter('all')
              }}
              className="ml-2 inline-flex items-center gap-0.5 font-semibold text-blue-600 hover:underline"
            >
              <X size={10} /> Clear filters
            </button>
          )}
        </p>
      )}

      {paymentDetailsId && <PaymentDetailsModal paymentId={paymentDetailsId} onClose={() => setPaymentDetailsId(null)} />}
    </div>
  )
}
