import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CreditCard,
  Download,
  Eye,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { pb } from '@/data/pocketbase'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import {
  cancelSupplierPayment,
  listSuppliers,
  loadAllSupplierPayments,
  type EnrichedSupplierPayment,
} from '@/data/suppliers'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

export const Route = createFileRoute('/supplier-payments')({
  component: SupplierPaymentsPage,
})

type PoolFilter = 'all' | 'kacha' | 'gst'
type ModeFilter = 'all' | 'cash' | 'upi' | 'rtgs' | 'neft' | 'cheque' | 'other'
type KindFilter = 'all' | 'payment' | 'paid_on_behalf' | 'settle_off' | 'refund_received' | 'bardan_advance'
type SortKey = 'date' | 'supplier' | 'amount' | 'allocated' | 'advance' | 'kind' | 'mode'

const KIND_LABELS: Record<string, { label: string; badgeClass: string }> = {
  payment: { label: 'Payment', badgeClass: 'bg-blue-100 text-blue-800' },
  paid_on_behalf: { label: 'Paid for them', badgeClass: 'bg-purple-100 text-purple-800' },
  settle_off: { label: 'Settle-off', badgeClass: 'bg-slate-200 text-slate-800' },
  refund_received: { label: 'Refund', badgeClass: 'bg-amber-100 text-amber-800' },
  bardan_advance: { label: 'Bardan Advance', badgeClass: 'bg-teal-100 text-teal-800' },
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

function SortableTh({
  label,
  active,
  desc,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  desc: boolean
  onClick: () => void
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <th
      className={`cursor-pointer select-none px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] transition hover:bg-slate-100 ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${active ? 'text-blue-700' : 'text-slate-600'}`}
      onClick={onClick}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span>{label}</span>
        {active ? (
          desc ? <ArrowDown size={13} className="text-blue-600" /> : <ArrowUp size={13} className="text-blue-600" />
        ) : (
          <span className="w-3" />
        )}
      </span>
    </th>
  )
}

function SupplierPaymentsPage() {
  const queryClient = useQueryClient()

  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all')
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [supplierIdFilter, setSupplierIdFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cancelled'>('all')

  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDesc, setSortDesc] = useState(true)

  // Details Modal & Cancel Modal State
  const [detailsPayment, setDetailsPayment] = useState<EnrichedSupplierPayment | null>(null)
  const [cancelModalPayment, setCancelModalPayment] = useState<EnrichedSupplierPayment | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

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

  const cancelMutation = useMutation({
    mutationFn: async ({ paymentId, reason }: { paymentId: string; reason: string }) => {
      return cancelSupplierPayment(paymentId, reason)
    },
    onSuccess: async (_, variables) => {
      await invalidateAfterSupplierPurchaseWrite(queryClient)
      setCancelModalPayment(null)
      setCancelReason('')
      if (detailsPayment?.id === variables.paymentId) {
        setDetailsPayment(null)
      }
    },
    onError: (err) => {
      setErrorMessage(toUserMessage(err))
    },
  })

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc)
    } else {
      setSortKey(key)
      setSortDesc(key === 'date' || key === 'amount' || key === 'allocated' || key === 'advance')
    }
  }

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

  const sortedPayments = useMemo(() => {
    const rows = [...filteredPayments]
    rows.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'date':
          cmp = a.date.localeCompare(b.date) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id)
          break
        case 'supplier':
          cmp = a.supplierName.localeCompare(b.supplierName)
          break
        case 'amount':
          cmp = a.amountPaise - b.amountPaise
          break
        case 'allocated':
          cmp = a.appliedPaise - b.appliedPaise
          break
        case 'advance':
          cmp = a.advancePaise - b.advancePaise
          break
        case 'kind':
          cmp = a.kind.localeCompare(b.kind)
          break
        case 'mode':
          cmp = a.mode.localeCompare(b.mode)
          break
      }
      return sortDesc ? -cmp : cmp
    })
    return rows
  }, [filteredPayments, sortKey, sortDesc])

  const totals = useMemo(() => {
    let totalAmountPaise = 0
    let totalAllocatedPaise = 0
    let totalAdvancePaise = 0
    let activeCount = 0

    for (const p of filteredPayments) {
      if (!p.cancelled) {
        activeCount++
        totalAmountPaise += p.amountPaise
        totalAllocatedPaise += p.appliedPaise
        totalAdvancePaise += p.advancePaise
      }
    }

    return {
      count: filteredPayments.length,
      activeCount,
      totalAmountPaise,
      totalAllocatedPaise,
      totalAdvancePaise,
    }
  }, [filteredPayments])

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

    const rows = sortedPayments.map((p) => [
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

    const dateStr = getLocalIsoDate()
    downloadCsv(`supplier-payments-${dateStr}.csv`, toCsv([headers, ...rows]))
  }

  const hasActiveFilters =
    query.trim() !== '' ||
    fromDate !== '' ||
    toDate !== '' ||
    poolFilter !== 'all' ||
    modeFilter !== 'all' ||
    kindFilter !== 'all' ||
    supplierIdFilter !== 'all' ||
    statusFilter !== 'all'

  const clearFilters = () => {
    setQuery('')
    setFromDate('')
    setToDate('')
    setPoolFilter('all')
    setModeFilter('all')
    setKindFilter('all')
    setSupplierIdFilter('all')
    setStatusFilter('all')
  }

  return (
    <div className="w-full space-y-4 px-3 pb-12 pt-3 sm:px-4 lg:px-6">
      {/* Top Header Card */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">Supplier Payments</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              {allPayments.length} Total
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
              Paid: {formatPaiseInr(totals.totalAmountPaise)}
            </span>
            {totals.totalAdvancePaise > 0 && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                Advance Left: {formatPaiseInr(totals.totalAdvancePaise)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={sortedPayments.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Download size={14} /> Export CSV
            </button>
            <Link
              to="/new-supplier-payment"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <Plus size={14} /> New Supplier Payment
            </Link>
          </div>
        </div>

        {/* Filters Toolbar */}
        <div className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-12 lg:items-center">
          {/* Search Bar */}
          <div className="relative lg:col-span-3">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search reference, supplier, note..."
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Supplier Dropdown */}
          <div className="lg:col-span-3">
            <select
              value={supplierIdFilter}
              onChange={(e) => setSupplierIdFilter(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-400"
            >
              <option value="all">All Suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.companyName}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-1.5 lg:col-span-2">
            <div className="w-1/2">
              <DateInput
                value={fromDate}
                onChange={setFromDate}
                className="h-9 w-full rounded-md border border-slate-300 px-2 text-xs"
              />
            </div>
            <span className="text-xs text-slate-400">to</span>
            <div className="w-1/2">
              <DateInput
                value={toDate}
                onChange={setToDate}
                className="h-9 w-full rounded-md border border-slate-300 px-2 text-xs"
              />
            </div>
          </div>

          {/* Pool Filter */}
          <div className="lg:col-span-1.5">
            <select
              value={poolFilter}
              onChange={(e) => setPoolFilter(e.target.value as PoolFilter)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400"
            >
              <option value="all">All Pools</option>
              <option value="kacha">Kacha</option>
              <option value="gst">GST</option>
            </select>
          </div>

          {/* Kind Filter */}
          <div className="lg:col-span-1.5">
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilter)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400"
            >
              <option value="all">All Kinds</option>
              <option value="payment">Payment</option>
              <option value="paid_on_behalf">Paid for them</option>
              <option value="settle_off">Settle-off</option>
              <option value="refund_received">Refund</option>
              <option value="bardan_advance">Bardan Adv</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="lg:col-span-1">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'cancelled')}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-1 text-xs text-slate-800 outline-none focus:border-blue-400"
            >
              <option value="all">Status</option>
              <option value="active">Active</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
            <span>
              Showing {filteredPayments.length} of {allPayments.length} payments
            </span>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
            >
              <X size={12} /> Clear all filters
            </button>
          </div>
        )}
      </section>

      {/* Main Table */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {paymentsQuery.isLoading && (
          <div className="p-8 text-center text-sm text-slate-500">
            <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-slate-400" />
            Loading supplier payments...
          </div>
        )}
        {paymentsQuery.isError && (
          <div className="p-8 text-center text-sm text-rose-600">
            Unable to load supplier payments. Please refresh.
          </div>
        )}
        {!paymentsQuery.isLoading && !paymentsQuery.isError && sortedPayments.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            <CreditCard size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">No supplier payments found</p>
            <p className="mt-1 text-xs text-slate-500">
              {hasActiveFilters ? 'Try adjusting your filters.' : 'Record your first supplier payment or adjustment.'}
            </p>
          </div>
        )}

        {!paymentsQuery.isLoading && !paymentsQuery.isError && sortedPayments.length > 0 && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[1040px] text-xs">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr className="text-left text-slate-500">
                  <SortableTh label="Date" active={sortKey === 'date'} desc={sortDesc} onClick={() => toggleSort('date')} />
                  <SortableTh label="Supplier" active={sortKey === 'supplier'} desc={sortDesc} onClick={() => toggleSort('supplier')} />
                  <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.06em]">Pool</th>
                  <SortableTh label="Kind" active={sortKey === 'kind'} desc={sortDesc} onClick={() => toggleSort('kind')} />
                  <SortableTh label="Mode" active={sortKey === 'mode'} desc={sortDesc} onClick={() => toggleSort('mode')} />
                  <th className="px-3 py-2.5 font-semibold uppercase tracking-[0.06em]">Reference</th>
                  <SortableTh label="Amount" active={sortKey === 'amount'} desc={sortDesc} onClick={() => toggleSort('amount')} align="right" />
                  <SortableTh label="Allocated" active={sortKey === 'allocated'} desc={sortDesc} onClick={() => toggleSort('allocated')} align="right" />
                  <SortableTh label="Advance Left" active={sortKey === 'advance'} desc={sortDesc} onClick={() => toggleSort('advance')} align="right" />
                  <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.06em]">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-[0.06em]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {sortedPayments.map((p) => {
                  const kindInfo = KIND_LABELS[p.kind] ?? { label: p.kind, badgeClass: 'bg-slate-100 text-slate-700' }
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setDetailsPayment(p)}
                      className={`cursor-pointer transition hover:bg-blue-50/40 ${
                        p.cancelled ? 'bg-slate-50/70 opacity-60' : ''
                      }`}
                    >
                      {/* Date */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                        {formatFullDate(p.date)}
                      </td>

                      {/* Supplier */}
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        <Link
                          to="/supplier-ledger/$supplierId"
                          params={{ supplierId: p.supplierId }}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-blue-600 hover:underline"
                        >
                          {p.supplierName}
                        </Link>
                        {p.payeeName && (
                          <div className="text-[11px] font-normal text-purple-700">
                            Payee: {p.payeeName}
                          </div>
                        )}
                      </td>

                      {/* Pool */}
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                            p.pool === 'kacha'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {p.pool}
                        </span>
                      </td>

                      {/* Kind */}
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${kindInfo.badgeClass}`}>
                          {kindInfo.label}
                        </span>
                      </td>

                      {/* Mode */}
                      <td className="whitespace-nowrap px-3 py-2.5 uppercase font-medium text-slate-700">
                        {p.mode}
                      </td>

                      {/* Reference */}
                      <td className="px-3 py-2.5 font-mono text-slate-600">
                        {p.reference ? p.reference : <span className="text-slate-300">—</span>}
                      </td>

                      {/* Amount */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-slate-900">
                        {formatPaiseInr(p.amountPaise)}
                      </td>

                      {/* Allocated */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-emerald-700">
                        {p.appliedPaise > 0 ? formatPaiseInr(p.appliedPaise) : '—'}
                      </td>

                      {/* Advance Left */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium text-amber-700">
                        {p.advancePaise > 0 ? formatPaiseInr(p.advancePaise) : '—'}
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-center">
                        {p.cancelled ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            Cancelled
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Active
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setDetailsPayment(p)}
                            title="View Details"
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                          >
                            Details
                          </button>
                          {!p.cancelled && (
                            <button
                              type="button"
                              onClick={() => {
                                setCancelModalPayment(p)
                                setCancelReason('')
                                setErrorMessage('')
                              }}
                              title="Cancel Payment"
                              className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Totals Footer */}
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                <tr>
                  <td colSpan={6} className="px-3 py-2.5 text-xs">
                    Totals for {totals.count} payment{totals.count === 1 ? '' : 's'} ({totals.activeCount} active)
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">
                    {formatPaiseInr(totals.totalAmountPaise)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-emerald-700">
                    {formatPaiseInr(totals.totalAllocatedPaise)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-amber-700">
                    {formatPaiseInr(totals.totalAdvancePaise)}
                  </td>
                  <td colSpan={2} className="px-3 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Payment Details Modal */}
      {detailsPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <button
              type="button"
              onClick={() => setDetailsPayment(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2">
              <CreditCard className="text-blue-600" size={20} />
              <h3 className="text-base font-bold text-slate-900">Payment Details</h3>
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${
                  detailsPayment.pool === 'kacha' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                }`}
              >
                {detailsPayment.pool}
              </span>
              {detailsPayment.cancelled && (
                <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">
                  CANCELLED
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
              <div>
                <span className="text-slate-500">Supplier:</span>
                <p className="font-semibold text-slate-900">{detailsPayment.supplierName}</p>
              </div>
              <div>
                <span className="text-slate-500">Payment Date:</span>
                <p className="font-semibold text-slate-900">{formatFullDate(detailsPayment.date)}</p>
              </div>
              <div>
                <span className="text-slate-500">Kind / Mode:</span>
                <p className="font-semibold capitalize text-slate-900">
                  {detailsPayment.kind} • <span className="uppercase">{detailsPayment.mode}</span>
                </p>
              </div>
              <div>
                <span className="text-slate-500">Reference:</span>
                <p className="font-mono font-semibold text-slate-900">
                  {detailsPayment.reference || '—'}
                </p>
              </div>
              {detailsPayment.payeeName && (
                <div className="col-span-2">
                  <span className="text-slate-500">Third-Party Payee:</span>
                  <p className="font-semibold text-purple-800">{detailsPayment.payeeName}</p>
                </div>
              )}
            </div>

            {/* Financial Overview */}
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                <span className="text-[11px] text-slate-500">Total Amount</span>
                <p className="font-mono text-sm font-bold text-slate-900">
                  {formatPaiseInr(detailsPayment.amountPaise)}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5">
                <span className="text-[11px] text-emerald-800">Applied to Bills</span>
                <p className="font-mono text-sm font-bold text-emerald-800">
                  {formatPaiseInr(detailsPayment.appliedPaise)}
                </p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5">
                <span className="text-[11px] text-amber-800">Advance Remaining</span>
                <p className="font-mono text-sm font-bold text-amber-800">
                  {formatPaiseInr(detailsPayment.advancePaise)}
                </p>
              </div>
            </div>

            {/* Allocations breakdown */}
            <div className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Bill Allocations ({detailsPayment.allocations.length})
              </h4>
              {detailsPayment.allocations.length === 0 ? (
                <p className="mt-1 rounded border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                  No manual allocations pinned. Handled via automatic FIFO settlement against open bills.
                </p>
              ) : (
                <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {detailsPayment.allocations.map((a, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 text-xs">
                      <div>
                        <span className="font-mono font-semibold text-blue-700">{a.inNo || a.billId}</span>
                        {a.isManual && (
                          <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                            Pinned
                          </span>
                        )}
                      </div>
                      <span className="font-mono font-bold text-emerald-700">
                        {formatPaiseInr(a.amountPaise)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Note */}
            {detailsPayment.privateNote && (
              <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-2.5 text-xs">
                <span className="font-semibold text-slate-600">Note: </span>
                <span className="text-slate-700">{detailsPayment.privateNote}</span>
              </div>
            )}

            {/* Photos */}
            {detailsPayment.photos && detailsPayment.photos.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-slate-600">Attachments ({detailsPayment.photos.length})</h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detailsPayment.photos.map((file, i) => {
                    const url = pb.files.getURL({ id: detailsPayment.id, collectionName: 'supplier_payments' }, file)
                    return (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="group relative block h-20 w-20 overflow-hidden rounded-lg border border-slate-200 hover:border-blue-400"
                      >
                        <img src={url} alt={`Receipt ${i + 1}`} className="h-full w-full object-cover" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                          <Eye size={16} className="text-white" />
                        </div>
                      </a>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Cancel Status / Cancel Button */}
            {detailsPayment.cancelled ? (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <p className="font-bold">Payment was cancelled</p>
                <p className="mt-0.5">Reason: {detailsPayment.cancelReason || 'No reason provided'}</p>
              </div>
            ) : (
              <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setCancelModalPayment(detailsPayment)
                    setCancelReason('')
                    setErrorMessage('')
                  }}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Cancel this Payment
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancel Payment Modal */}
      {cancelModalPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center gap-2 text-rose-600">
              <AlertTriangle size={20} />
              <h3 className="text-base font-bold text-slate-900">Cancel Supplier Payment</h3>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Cancelling this payment of{' '}
              <strong className="text-slate-900">{formatPaiseInr(cancelModalPayment.amountPaise)}</strong> for{' '}
              <strong className="text-slate-900">{cancelModalPayment.supplierName}</strong> will remove all bill
              allocations and un-settle covered bills.
            </p>

            {errorMessage && (
              <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                {errorMessage}
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700">
                Cancellation Reason <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Why is this payment being cancelled? (required for audit log)"
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-xs text-slate-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelModalPayment(null)}
                disabled={cancelMutation.isPending}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!cancelReason.trim()) {
                    setErrorMessage('Cancellation reason is required.')
                    return
                  }
                  cancelMutation.mutate({
                    paymentId: cancelModalPayment.id,
                    reason: cancelReason.trim(),
                  })
                }}
                disabled={cancelMutation.isPending || !cancelReason.trim()}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-rose-700 disabled:opacity-50"
              >
                {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
