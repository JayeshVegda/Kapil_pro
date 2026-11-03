import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Clock,
  Download,
  Package,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { BillDetailsDrawer } from '@/components/suppliers/bill-details-drawer'
import { loadAllPurchaseBills } from '@/data/suppliers'
import {
  computeBardanAgeBucket,
  computeDaysSince,
  type BardanAgeBucket,
} from '@/domain/supplier-purchases'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

export const Route = createFileRoute('/bardan-pending')({
  component: BardanPendingPage,
})

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

function BardanPendingPage() {
  const [query, setQuery] = useState('')
  const [bucketFilter, setBucketFilter] = useState<'all' | BardanAgeBucket>('all')
  const [drawerBillId, setDrawerBillId] = useState<string | null>(null)
  const [showAddBardanDirect, setShowAddBardanDirect] = useState(false)

  const billsQuery = useQuery({
    queryKey: ['purchase-bills'],
    queryFn: loadAllPurchaseBills,
  })

  const allBills = billsQuery.data ?? []

  // Filter only bills that need bardan settlement and are not cancelled
  const pendingBills = useMemo(() => {
    return allBills.filter((b) => b.bardanPending && !b.cancelled)
  }, [allBills])

  // Compute metrics and age buckets
  const itemsWithAge = useMemo(() => {
    return pendingBills.map((bill) => {
      const days = computeDaysSince(bill.date)
      const bucket = computeBardanAgeBucket(days)
      return {
        ...bill,
        daysSince: days,
        bucket,
      }
    })
  }, [pendingBills])

  // Summary counts
  const summary = useMemo(() => {
    let criticalCount = 0
    let warningCount = 0
    let freshCount = 0
    let totalNetPaise = 0

    for (const item of itemsWithAge) {
      totalNetPaise += item.netPaise
      if (item.bucket === 'critical') criticalCount++
      else if (item.bucket === 'warning') warningCount++
      else freshCount++
    }

    return {
      total: itemsWithAge.length,
      criticalCount,
      warningCount,
      freshCount,
      totalNetPaise,
    }
  }, [itemsWithAge])

  // Filter visible items
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return itemsWithAge
      .filter((item) => {
        if (bucketFilter !== 'all' && item.bucket !== bucketFilter) return false
        if (needle) {
          const inMatch = item.inNo.toLowerCase().includes(needle)
          const suppMatch = item.supplierName.toLowerCase().includes(needle)
          const billNoMatch = (item.supplierBillNo ?? '').toLowerCase().includes(needle)
          if (!inMatch && !suppMatch && !billNoMatch) return false
        }
        return true
      })
      .sort((a, b) => b.daysSince - a.daysSince) // Oldest first
  }, [itemsWithAge, query, bucketFilter])

  const handleExportCsv = () => {
    const headers = [
      'IN No',
      'Supplier',
      'Bill Date',
      'Days Elapsed',
      'Age Bucket',
      'Bags at Receipt (kg)',
      'Total Kg',
      'Net Amount (Rs)',
      'Due Amount (Rs)',
      'Supplier Bill No',
    ]

    const rows = visibleItems.map((item) => [
      item.inNo,
      item.supplierName,
      item.date,
      item.daysSince,
      item.bucket.toUpperCase(),
      item.bagsAtReceiptKg != null ? item.bagsAtReceiptKg.toFixed(3) : '',
      item.totalKg.toFixed(3),
      (item.netPaise / 100).toFixed(2),
      (item.duePaise / 100).toFixed(2),
      item.supplierBillNo ?? '',
    ])

    const dateStr = getLocalIsoDate()
    downloadCsv(`bardan-pending-${dateStr}.csv`, toCsv([headers, ...rows]))
  }

  const openBardanEntry = (billId: string) => {
    setDrawerBillId(billId)
    setShowAddBardanDirect(true)
  }

  return (
    <div className="w-full space-y-4 px-3 pb-12 pt-3 sm:px-4 lg:px-6">
      {/* Top Banner & KPI Cards */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Bardan Pending Worklist</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Scrap bills awaiting bag settlement (deduct, return in-kind, cash back, or advance).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={visibleItems.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Download size={14} /> Export CSV
            </button>
            <Link
              to="/purchase-bills"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              All Bills
            </Link>
          </div>
        </div>

        {/* Status Metrics Cards */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Total Pending */}
          <div
            onClick={() => setBucketFilter('all')}
            className={`cursor-pointer rounded-lg border p-3 transition ${
              bucketFilter === 'all'
                ? 'border-blue-400 bg-blue-50/60 ring-2 ring-blue-100'
                : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Total Pending</span>
            <p className="mt-1 text-xl font-bold text-slate-900">{summary.total}</p>
            <span className="text-[11px] text-slate-600">Net: {formatPaiseInr(summary.totalNetPaise)}</span>
          </div>

          {/* Critical > 10 Days */}
          <div
            onClick={() => setBucketFilter('critical')}
            className={`cursor-pointer rounded-lg border p-3 transition ${
              bucketFilter === 'critical'
                ? 'border-rose-400 bg-rose-50/80 ring-2 ring-rose-200'
                : 'border-rose-200 bg-rose-50/40 hover:bg-rose-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-800">Critical (&gt; 10 Days)</span>
              <AlertTriangle size={14} className="text-rose-600" />
            </div>
            <p className="mt-1 text-xl font-bold text-rose-700">{summary.criticalCount}</p>
            <span className="text-[11px] text-rose-700">Urgent settlement required</span>
          </div>

          {/* Warning 7-10 Days */}
          <div
            onClick={() => setBucketFilter('warning')}
            className={`cursor-pointer rounded-lg border p-3 transition ${
              bucketFilter === 'warning'
                ? 'border-amber-400 bg-amber-50/80 ring-2 ring-amber-200'
                : 'border-amber-200 bg-amber-50/40 hover:bg-amber-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Warning (7-10 Days)</span>
              <Clock size={14} className="text-amber-600" />
            </div>
            <p className="mt-1 text-xl font-bold text-amber-800">{summary.warningCount}</p>
            <span className="text-[11px] text-amber-700">Follow up with supplier</span>
          </div>

          {/* Fresh < 7 Days */}
          <div
            onClick={() => setBucketFilter('fresh')}
            className={`cursor-pointer rounded-lg border p-3 transition ${
              bucketFilter === 'fresh'
                ? 'border-emerald-400 bg-emerald-50/80 ring-2 ring-emerald-200'
                : 'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50'
            }`}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Fresh (&lt; 7 Days)</span>
            <p className="mt-1 text-xl font-bold text-emerald-800">{summary.freshCount}</p>
            <span className="text-[11px] text-emerald-700">Normal processing</span>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search IN no, supplier, bill no..."
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 transition ${
                bucketFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setBucketFilter('all')}
            >
              All ({summary.total})
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 transition ${
                bucketFilter === 'critical' ? 'bg-rose-100 text-rose-900 font-bold shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setBucketFilter('critical')}
            >
              Critical ({summary.criticalCount})
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 transition ${
                bucketFilter === 'warning' ? 'bg-amber-100 text-amber-900 font-bold shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setBucketFilter('warning')}
            >
              Warning ({summary.warningCount})
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 transition ${
                bucketFilter === 'fresh' ? 'bg-emerald-100 text-emerald-900 font-bold shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setBucketFilter('fresh')}
            >
              Fresh ({summary.freshCount})
            </button>
          </div>
        </div>
      </section>

      {/* Main Table */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {billsQuery.isLoading && (
          <div className="p-8 text-center text-sm text-slate-500">
            <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-slate-400" />
            Loading bardan pending bills...
          </div>
        )}
        {billsQuery.isError && (
          <div className="p-8 text-center text-sm text-rose-600">
            Unable to load bills. Please refresh.
          </div>
        )}
        {!billsQuery.isLoading && !billsQuery.isError && visibleItems.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            <Package size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">No bardan-pending bills found</p>
            <p className="mt-1 text-xs text-slate-500">
              {query || bucketFilter !== 'all'
                ? 'No items match your filters.'
                : 'All incoming purchase bills have settled bardan entries. Great job!'}
            </p>
          </div>
        )}

        {!billsQuery.isLoading && !billsQuery.isError && visibleItems.length > 0 && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[960px] text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr className="text-left">
                  <th className="px-3 py-2.5 font-semibold uppercase tracking-[0.06em]">IN No</th>
                  <th className="px-3 py-2.5 font-semibold uppercase tracking-[0.06em]">Supplier</th>
                  <th className="px-3 py-2.5 font-semibold uppercase tracking-[0.06em]">Bill Date</th>
                  <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.06em]">Days Elapsed</th>
                  <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-[0.06em]">Receipt Bags (kg)</th>
                  <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-[0.06em]">Total Kg</th>
                  <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-[0.06em]">Net Amount</th>
                  <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-[0.06em]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {visibleItems.map((item) => {
                  const isCritical = item.bucket === 'critical'
                  const isWarning = item.bucket === 'warning'

                  return (
                    <tr
                      key={item.id}
                      onClick={() => {
                        setDrawerBillId(item.id)
                        setShowAddBardanDirect(false)
                      }}
                      className={`cursor-pointer transition hover:bg-blue-50/50 ${
                        isCritical
                          ? 'bg-rose-50/70 border-l-4 border-l-rose-500'
                          : isWarning
                            ? 'bg-amber-50/70 border-l-4 border-l-amber-500'
                            : 'border-l-4 border-l-transparent'
                      }`}
                    >
                      {/* IN No */}
                      <td className="px-3 py-3 font-mono font-bold text-blue-700">
                        {item.inNo}
                        {item.supplierBillNo && (
                          <span className="ml-1 text-[10px] font-normal text-slate-500">
                            ({item.supplierBillNo})
                          </span>
                        )}
                      </td>

                      {/* Supplier */}
                      <td className="px-3 py-3 font-medium text-slate-900">
                        <Link
                          to="/supplier-ledger/$supplierId"
                          params={{ supplierId: item.supplierId }}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-blue-600 hover:underline"
                        >
                          {item.supplierName}
                        </Link>
                      </td>

                      {/* Date */}
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                        {formatFullDate(item.date)}
                      </td>

                      {/* Days Elapsed */}
                      <td className="whitespace-nowrap px-3 py-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            isCritical
                              ? 'bg-rose-200 text-rose-900'
                              : isWarning
                                ? 'bg-amber-200 text-amber-900'
                                : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {isCritical && <AlertTriangle size={11} />}
                          {item.daysSince} day{item.daysSince === 1 ? '' : 's'}
                        </span>
                      </td>

                      {/* Bags at Receipt (kg) memo */}
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-slate-900">
                        {item.bagsAtReceiptKg != null ? (
                          <span className="font-semibold text-blue-800">
                            {item.bagsAtReceiptKg.toFixed(3)} kg
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Total kg */}
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-slate-800">
                        {item.totalKg.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                      </td>

                      {/* Net Amount */}
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-semibold text-slate-900">
                        {formatPaiseInr(item.netPaise)}
                      </td>

                      {/* Action */}
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openBardanEntry(item.id)
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
                        >
                          <Plus size={13} /> Add Bardan
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bill Drawer Host */}
      <BillDetailsDrawer
        billId={drawerBillId}
        initialShowAddBardan={showAddBardanDirect}
        onClose={() => {
          setDrawerBillId(null)
          setShowAddBardanDirect(false)
        }}
      />
    </div>
  )
}
