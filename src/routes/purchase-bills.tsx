import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Download,
  Package,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { DateInput } from '@/components/ui/date-input'
import { BillDetailsDrawer } from '@/components/suppliers/bill-details-drawer'
import { loadAllPurchaseBills } from '@/data/suppliers'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

export const Route = createFileRoute('/purchase-bills')({
  component: PurchaseBillsPage,
})

type PoolFilter = 'all' | 'kacha' | 'gst'
type StatusFilter = 'all' | 'open' | 'partial' | 'nil' | 'cancelled'
type BardanFilter = 'all' | 'pending' | 'settled'
type SortKey = 'date' | 'inNo' | 'supplier' | 'totalKg' | 'net' | 'paid' | 'due' | 'status'

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

function PurchaseBillsPage() {
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [bardanFilter, setBardanFilter] = useState<BardanFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDesc, setSortDesc] = useState(true)

  const [drawerBillId, setDrawerBillId] = useState<string | null>(null)

  const billsQuery = useQuery({
    queryKey: ['purchase-bills'],
    queryFn: loadAllPurchaseBills,
  })

  const allBills = billsQuery.data ?? []

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc)
    } else {
      setSortKey(key)
      setSortDesc(key === 'date' || key === 'net' || key === 'paid' || key === 'due' || key === 'totalKg')
    }
  }

  const filteredBills = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allBills.filter((b) => {
      if (poolFilter !== 'all' && b.pool !== poolFilter) return false
      if (statusFilter !== 'all' && b.status !== statusFilter) return false
      if (bardanFilter === 'pending' && (!b.bardanPending || b.cancelled)) return false
      if (bardanFilter === 'settled' && (b.bardanPending && !b.cancelled)) return false
      if (fromDate && b.date < fromDate) return false
      if (toDate && b.date > toDate) return false

      if (needle) {
        const inMatch = b.inNo.toLowerCase().includes(needle)
        const supplierMatch = b.supplierName.toLowerCase().includes(needle)
        const billNoMatch = (b.supplierBillNo ?? '').toLowerCase().includes(needle)
        const itemMatch = b.lines.some((l) => l.itemName.toLowerCase().includes(needle))
        if (!inMatch && !supplierMatch && !billNoMatch && !itemMatch) return false
      }

      return true
    })
  }, [allBills, query, poolFilter, statusFilter, bardanFilter, fromDate, toDate])

  const sortedBills = useMemo(() => {
    const rows = [...filteredBills]
    rows.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'date':
          cmp = a.date.localeCompare(b.date) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id)
          break
        case 'inNo':
          cmp = a.inNo.localeCompare(b.inNo)
          break
        case 'supplier':
          cmp = a.supplierName.localeCompare(b.supplierName)
          break
        case 'totalKg':
          cmp = a.totalKg - b.totalKg
          break
        case 'net':
          cmp = a.netPaise - b.netPaise
          break
        case 'paid':
          cmp = a.paidPaise - b.paidPaise
          break
        case 'due':
          cmp = a.duePaise - b.duePaise
          break
        case 'status':
          cmp = a.status.localeCompare(b.status)
          break
      }
      return sortDesc ? -cmp : cmp
    })
    return rows
  }, [filteredBills, sortKey, sortDesc])

  const totals = useMemo(() => {
    let totalKg = 0
    let totalNetPaise = 0
    let totalPaidPaise = 0
    let totalDuePaise = 0
    let pendingBardanCount = 0

    for (const b of filteredBills) {
      totalKg += b.totalKg
      totalNetPaise += b.netPaise
      totalPaidPaise += b.paidPaise
      totalDuePaise += b.duePaise
      if (b.bardanPending && !b.cancelled) pendingBardanCount++
    }

    return {
      count: filteredBills.length,
      totalKg,
      totalNetPaise,
      totalPaidPaise,
      totalDuePaise,
      pendingBardanCount,
    }
  }, [filteredBills])

  const handleExportCsv = () => {
    const headers = [
      'IN No',
      'Date',
      'Supplier',
      'Pool',
      'Tax Mode',
      'GST %',
      'Supplier Bill No',
      'Vehicle No',
      'Total Kg',
      'Net Amount (Rs)',
      'Paid Amount (Rs)',
      'Due Amount (Rs)',
      'Status',
      'Bardan Status',
      'Bags at Receipt (kg)',
      'Note',
    ]

    const rows = sortedBills.map((b) => [
      b.inNo,
      b.date,
      b.supplierName,
      b.pool.toUpperCase(),
      b.taxMode.toUpperCase(),
      b.gstRateBp ? (b.gstRateBp / 100).toFixed(2) : '0',
      b.supplierBillNo ?? '',
      b.vehicleNo ?? '',
      b.totalKg.toFixed(3),
      (b.netPaise / 100).toFixed(2),
      (b.paidPaise / 100).toFixed(2),
      (b.duePaise / 100).toFixed(2),
      b.status.toUpperCase(),
      b.bardanPending && !b.cancelled ? 'PENDING' : 'SETTLED',
      b.bagsAtReceiptKg != null ? b.bagsAtReceiptKg.toFixed(3) : '',
      b.userNote,
    ])

    const dateStr = getLocalIsoDate()
    downloadCsv(`purchase-bills-${dateStr}.csv`, toCsv([headers, ...rows]))
  }

  const hasActiveFilters =
    query.trim() !== '' ||
    fromDate !== '' ||
    toDate !== '' ||
    poolFilter !== 'all' ||
    statusFilter !== 'all' ||
    bardanFilter !== 'all'

  const clearFilters = () => {
    setQuery('')
    setFromDate('')
    setToDate('')
    setPoolFilter('all')
    setStatusFilter('all')
    setBardanFilter('all')
  }

  return (
    <div className="w-full space-y-4 px-3 pb-12 pt-3 sm:px-4 lg:px-6">
      {/* Top Header Card */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">Purchase Bills</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              {allBills.length} Total
            </span>
            {totals.totalDuePaise > 0 && (
              <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                Due: {formatPaiseInr(totals.totalDuePaise)}
              </span>
            )}
            {totals.pendingBardanCount > 0 && (
              <Link
                to="/bardan-pending"
                className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100"
              >
                {totals.pendingBardanCount} Bardan Pending
              </Link>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={sortedBills.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Download size={14} /> Export CSV
            </button>
            <Link
              to="/purchase-bills/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <Plus size={14} /> New Purchase Bill
            </Link>
          </div>
        </div>

        {/* Filters Toolbar */}
        <div className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-12 lg:items-center">
          {/* Search Bar */}
          <div className="relative lg:col-span-4">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search IN no, supplier, bill no, item..."
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-1.5 lg:col-span-3">
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
          <div className="lg:col-span-2">
            <select
              value={poolFilter}
              onChange={(e) => setPoolFilter(e.target.value as PoolFilter)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-400"
            >
              <option value="all">All Pools</option>
              <option value="kacha">Kacha Pool</option>
              <option value="gst">GST Pool</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="lg:col-span-1.5">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400"
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="partial">Partial</option>
              <option value="nil">NIL (Paid)</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Bardan Filter */}
          <div className="lg:col-span-1.5">
            <select
              value={bardanFilter}
              onChange={(e) => setBardanFilter(e.target.value as BardanFilter)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400"
            >
              <option value="all">All Bardan</option>
              <option value="pending">Pending</option>
              <option value="settled">Settled</option>
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
            <span>
              Showing {filteredBills.length} of {allBills.length} bills
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
        {billsQuery.isLoading && (
          <div className="p-8 text-center text-sm text-slate-500">
            <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-slate-400" />
            Loading purchase bills...
          </div>
        )}
        {billsQuery.isError && (
          <div className="p-8 text-center text-sm text-rose-600">
            Unable to load purchase bills. Please refresh.
          </div>
        )}
        {!billsQuery.isLoading && !billsQuery.isError && sortedBills.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            <Package size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">No purchase bills found</p>
            <p className="mt-1 text-xs text-slate-500">
              {hasActiveFilters ? 'Try adjusting your search filters.' : 'Create your first incoming scrap purchase bill.'}
            </p>
          </div>
        )}

        {!billsQuery.isLoading && !billsQuery.isError && sortedBills.length > 0 && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[1020px] text-xs">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr className="text-left text-slate-500">
                  <SortableTh label="IN No" active={sortKey === 'inNo'} desc={sortDesc} onClick={() => toggleSort('inNo')} />
                  <SortableTh label="Date" active={sortKey === 'date'} desc={sortDesc} onClick={() => toggleSort('date')} />
                  <SortableTh label="Supplier" active={sortKey === 'supplier'} desc={sortDesc} onClick={() => toggleSort('supplier')} />
                  <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.06em]">Pool</th>
                  <SortableTh label="Total kg" active={sortKey === 'totalKg'} desc={sortDesc} onClick={() => toggleSort('totalKg')} align="right" />
                  <SortableTh label="Net Amount" active={sortKey === 'net'} desc={sortDesc} onClick={() => toggleSort('net')} align="right" />
                  <SortableTh label="Paid" active={sortKey === 'paid'} desc={sortDesc} onClick={() => toggleSort('paid')} align="right" />
                  <SortableTh label="Due" active={sortKey === 'due'} desc={sortDesc} onClick={() => toggleSort('due')} align="right" />
                  <SortableTh label="Status" active={sortKey === 'status'} desc={sortDesc} onClick={() => toggleSort('status')} align="center" />
                  <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.06em]">Bardan</th>
                  <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-[0.06em]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {sortedBills.map((b) => {
                  return (
                    <tr
                      key={b.id}
                      onClick={() => setDrawerBillId(b.id)}
                      className={`cursor-pointer transition hover:bg-blue-50/40 ${
                        b.cancelled ? 'bg-slate-50/70 opacity-60' : ''
                      }`}
                    >
                      {/* IN No */}
                      <td className="px-3 py-2.5 font-mono font-semibold text-blue-700">
                        {b.inNo}
                        {b.supplierBillNo && (
                          <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                            (Bill: {b.supplierBillNo})
                          </span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                        {formatFullDate(b.date)}
                      </td>

                      {/* Supplier */}
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        <Link
                          to="/supplier-ledger/$supplierId"
                          params={{ supplierId: b.supplierId }}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-blue-600 hover:underline"
                        >
                          {b.supplierName}
                        </Link>
                        {b.lines.length > 0 && (
                          <div className="line-clamp-1 text-[11px] font-normal text-slate-500">
                            {b.lines.map((l) => `${l.itemName} (${(l.weightG / 1000).toFixed(1)}k)`).join(', ')}
                          </div>
                        )}
                      </td>

                      {/* Pool */}
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                            b.pool === 'kacha'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {b.pool}
                        </span>
                      </td>

                      {/* Total kg */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-slate-900">
                        {b.totalKg.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                      </td>

                      {/* Net */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-slate-900">
                        {formatPaiseInr(b.netPaise)}
                      </td>

                      {/* Paid */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-emerald-700">
                        {b.paidPaise > 0 ? formatPaiseInr(b.paidPaise) : '—'}
                      </td>

                      {/* Due */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold text-rose-700">
                        {b.duePaise > 0 ? formatPaiseInr(b.duePaise) : '—'}
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-center">
                        {b.cancelled ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            Cancelled
                          </span>
                        ) : b.status === 'nil' ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            NIL (Paid)
                          </span>
                        ) : b.status === 'partial' ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            Partial
                          </span>
                        ) : (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">
                            Open
                          </span>
                        )}
                      </td>

                      {/* Bardan */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-center">
                        {b.cancelled ? (
                          <span className="text-[10px] text-slate-400">—</span>
                        ) : b.bardanPending ? (
                          <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            Pending
                          </span>
                        ) : (
                          <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                            Settled ({b.bardanEntryCount})
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDrawerBillId(b.id)
                          }}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Totals Footer */}
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                <tr>
                  <td colSpan={4} className="px-3 py-2.5 text-xs">
                    Totals for {totals.count} bill{totals.count === 1 ? '' : 's'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">
                    {totals.totalKg.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">
                    {formatPaiseInr(totals.totalNetPaise)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-emerald-700">
                    {formatPaiseInr(totals.totalPaidPaise)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-rose-700">
                    {formatPaiseInr(totals.totalDuePaise)}
                  </td>
                  <td colSpan={3} className="px-3 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Bill Drawer Host */}
      <BillDetailsDrawer
        billId={drawerBillId}
        onClose={() => setDrawerBillId(null)}
      />
    </div>
  )
}
