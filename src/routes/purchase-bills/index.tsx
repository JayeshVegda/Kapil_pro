import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Ban,
  Download,
  Package,
  Plus,
  RefreshCw,
  Search,
  Wallet,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { PurchasesShell } from '@/components/suppliers/purchases-shell'
import {
  AddBardanModal,
  CancelBillModal,
  RecordPaymentModal,
  SettleToNilModal,
  PaymentDetailsModal,
  type PaymentPinTarget,
} from '@/components/suppliers/bill-modals'
import {
  PurchaseBillsTable,
  itemsSummary,
  type BillsTableRow,
} from '@/components/suppliers/purchase-bills-table'
import { DateInput } from '@/components/ui/date-input'
import { loadAllPurchaseBills } from '@/data/suppliers'
import { computeDaysSince } from '@/domain/supplier-purchases'
import { getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

const searchSchema = z.object({
  supplier: z.string().optional(),
  tab: z.enum(['open', 'partial', 'nil', 'cancelled', 'bardan']).optional(),
})

export const Route = createFileRoute('/purchase-bills/')({
  validateSearch: searchSchema,
  component: PurchaseBillsRoute,
})

type PoolFilter = 'all' | 'kacha' | 'gst'
type TabKey = 'all' | 'open' | 'partial' | 'nil' | 'cancelled' | 'bardan'

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

function PurchaseBillsRoute() {
  return (
    <PurchasesShell>
      <PurchaseBillsPage />
    </PurchasesShell>
  )
}

function PurchaseBillsPage() {
  const { supplier: supplierFilter, tab = 'all' } = Route.useSearch()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<null | { type: 'bardan' | 'payment' | 'settleNil' | 'cancelBill'; row: BillsTableRow }>(null)
  const [multiPay, setMultiPay] = useState(false)
  const [paymentDetailsId, setPaymentDetailsId] = useState<string | null>(null)

  const billsQuery = useQuery({
    queryKey: ['purchase-bills'],
    queryFn: loadAllPurchaseBills,
  })

  const allBills = billsQuery.data ?? []

  const rows = useMemo<BillsTableRow[]>(
    () =>
      allBills.map((b) => ({
        id: b.id,
        inNo: b.inNo,
        date: b.date,
        supplierId: b.supplierId,
        supplierName: b.supplierName,
        pool: b.pool,
        itemsSummary: itemsSummary(b.lines),
        totalKg: b.totalKg,
        netPaise: b.netPaise,
        paidPaise: b.paidPaise,
        duePaise: b.duePaise,
        daysOld: computeDaysSince(b.date),
        bardanPending: b.bardanPending,
        status: (b.status as BillsTableRow['status']) ?? (b.cancelled ? 'cancelled' : 'open'),
        cancelled: b.cancelled,
      })),
    [allBills],
  )

  // Filters applied BEFORE the tab/status filter; tab counts come from this set.
  const preTabRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (supplierFilter && r.supplierId !== supplierFilter) return false
      if (poolFilter !== 'all' && r.pool !== poolFilter) return false
      if (fromDate && r.date < fromDate) return false
      if (toDate && r.date > toDate) return false
      if (needle) {
        const bill = allBills.find((b) => b.id === r.id)
        const inMatch = r.inNo.toLowerCase().includes(needle)
        const supplierMatch = r.supplierName.toLowerCase().includes(needle)
        const billNoMatch = (bill?.supplierBillNo ?? '').toLowerCase().includes(needle)
        const itemMatch = (bill?.lines ?? []).some((l) => l.itemName.toLowerCase().includes(needle))
        if (!inMatch && !supplierMatch && !billNoMatch && !itemMatch) return false
      }
      return true
    })
  }, [rows, allBills, supplierFilter, poolFilter, fromDate, toDate, query])

  const tabCounts = useMemo(() => {
    let open = 0
    let partial = 0
    let nil = 0
    let bardan = 0
    let cancelled = 0
    for (const r of preTabRows) {
      if (r.cancelled) cancelled++
      else if (r.status === 'open') open++
      else if (r.status === 'partial') partial++
      else if (r.status === 'nil') nil++
      if (r.bardanPending && !r.cancelled) bardan++
    }
    return { all: preTabRows.length, open, partial, nil, cancelled, bardan }
  }, [preTabRows])

  const tabRows = useMemo(() => {
    switch (tab) {
      case 'open':
        return preTabRows.filter((r) => !r.cancelled && r.status === 'open')
      case 'partial':
        return preTabRows.filter((r) => !r.cancelled && r.status === 'partial')
      case 'nil':
        return preTabRows.filter((r) => !r.cancelled && r.status === 'nil')
      case 'cancelled':
        return preTabRows.filter((r) => r.cancelled)
      case 'bardan':
        return preTabRows.filter((r) => r.bardanPending && !r.cancelled)
      default:
        return preTabRows
    }
  }, [preTabRows, tab])

  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r.id)), [rows, selectedIds])
  const payableRows = useMemo(() => selectedRows.filter((r) => r.duePaise > 0 && !r.cancelled), [selectedRows])
  const payablePaise = payableRows.reduce((s, r) => s + r.duePaise, 0)

  const payPins = useMemo<PaymentPinTarget[]>(() => {
    const billMap = new Map(allBills.map((b) => [b.id, b]))
    const src = [...payableRows]
    src.sort((a, b) => `${a.date}|${billMap.get(a.id)?.created ?? ''}`.localeCompare(`${b.date}|${billMap.get(b.id)?.created ?? ''}`) || a.id.localeCompare(b.id))
    return src.map((r) => ({ billId: r.id, inNo: r.inNo, duePaise: r.duePaise }))
  }, [payableRows, allBills])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
    const rowsCsv = tabRows.map((r) => {
      const bill = allBills.find((b) => b.id === r.id)
      return [
        r.inNo,
        r.date,
        r.supplierName,
        r.pool.toUpperCase(),
        (bill?.taxMode ?? '').toUpperCase(),
        bill?.gstRateBp ? (bill.gstRateBp / 100).toFixed(2) : '0',
        bill?.supplierBillNo ?? '',
        bill?.vehicleNo ?? '',
        r.totalKg.toFixed(3),
        (r.netPaise / 100).toFixed(2),
        (r.paidPaise / 100).toFixed(2),
        (r.duePaise / 100).toFixed(2),
        r.status.toUpperCase(),
        r.bardanPending && !r.cancelled ? 'PENDING' : 'SETTLED',
        bill?.bagsAtReceiptKg != null ? bill.bagsAtReceiptKg.toFixed(3) : '',
        bill?.userNote ?? '',
      ]
    })
    downloadCsv(`purchase-bills-${getLocalIsoDate()}.csv`, toCsv([headers, ...rowsCsv]))
  }

  const hasActiveFilters =
    query.trim() !== '' || fromDate !== '' || toDate !== '' || poolFilter !== 'all' || supplierFilter != null

  const supplierName = supplierFilter ? (allBills.find((b) => b.supplierId === supplierFilter)?.supplierName ?? null) : null

  const emptyMessage =
    tab === 'bardan'
      ? 'No bills with pending bardan.'
      : tab === 'cancelled'
        ? 'No cancelled bills.'
        : tab === 'nil'
          ? 'No fully paid (NIL) bills.'
          : tab === 'partial'
            ? 'No partially paid bills.'
            : tab === 'open'
              ? 'No open bills.'
              : 'No purchase bills match.'

  return (
    <div className="min-w-0 px-3 pb-10 pt-2 sm:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold text-slate-900">Purchase Bills</h1>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{allBills.length} total</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={tabRows.length === 0}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={13} /> CSV
          </button>
          <Link
            to="/new-purchase-bill"
            className="inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus size={13} /> Bill
          </Link>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs">
        <div className="relative min-w-52 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search IN no, supplier, bill no, item…"
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
        {supplierFilter && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200">
            {supplierName ?? `Supplier ${supplierFilter.slice(0, 8)}`}
            <button
              type="button"
              aria-label="Clear supplier filter"
              onClick={() => void navigate({ from: '/purchase-bills/', search: (prev) => ({ tab: prev.tab }) })}
              className="rounded-full p-0.5 hover:bg-blue-100"
            >
              <X size={10} />
            </button>
          </span>
        )}
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-200"
          >
            <Ban size={10} /> {selectedIds.size} selected · Clear
          </button>
        )}
      </div>

      {/* Tabs with counts */}
      <div className="mt-2 inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
        {(
          [
            ['all', 'All'],
            ['open', 'Open'],
            ['partial', 'Partial'],
            ['nil', 'NIL'],
            ['bardan', 'Bardan Pending'],
            ['cancelled', 'Cancelled'],
          ] as Array<[TabKey, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => void navigate({ from: '/purchase-bills/', search: (prev) => (key === 'all' ? { supplier: prev.supplier } : { supplier: prev.supplier, tab: key }) })}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {label}
            <span className={`rounded px-1 text-[10px] font-bold tabular-nums ${tab === key ? 'bg-slate-100 text-slate-700' : 'bg-slate-100 text-slate-500'}`}>
              {tabCounts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Pay Selected bar */}
      {payableRows.length > 0 && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
          <span className="font-semibold text-blue-900">
            {selectedRows.length} bill{selectedRows.length === 1 ? '' : 's'} selected · payable due <span className="font-mono tabular-nums">{formatPaiseInr(payablePaise)}</span>
          </span>
          <button
            type="button"
            onClick={() => setMultiPay(true)}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-3 font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Wallet size={13} /> Pay Selected ({payableRows.length}) · {formatPaiseInr(payablePaise)}
          </button>
        </div>
      )}

      {/* Loading / table */}
      {billsQuery.isLoading ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-slate-400" />
          Loading purchase bills…
        </div>
      ) : billsQuery.isError ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-rose-600">
          Unable to load purchase bills. Please refresh.
        </div>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl bg-white">
          <PurchaseBillsTable
            rows={tabRows}
            showSupplier={!supplierFilter}
            selection={{ selectedIds, onToggle: toggleSelect }}
            actions={{
              onRecordPayment: (row) => setModal({ type: 'payment', row }),
              onAddBardan: (row) => setModal({ type: 'bardan', row }),
              onSettleNil: (row) => setModal({ type: 'settleNil', row }),
              onEdit: (row) => void navigate({ to: '/new-purchase-bill', search: { editBillId: row.id } }),
              onCancel: (row) => setModal({ type: 'cancelBill', row }),
            }}
            emptyMessage={emptyMessage}
          />
          {billsQuery.data?.length === 0 && (
            <div className="p-10 text-center text-slate-500">
              <Package size={28} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No purchase bills yet</p>
              <p className="mt-1 text-xs text-slate-500">Create your first incoming scrap purchase bill.</p>
            </div>
          )}
        </div>
      )}

      {hasActiveFilters && (
        <p className="mt-1.5 px-1 text-[10px] text-slate-400">
          Showing {tabRows.length} of {rows.length} bills
        </p>
      )}

      {/* Modals */}
      {modal?.type === 'bardan' && <AddBardanModal billId={modal.row.id} onClose={() => setModal(null)} />}
      {modal?.type === 'payment' && (
        <RecordPaymentModal
          supplierId={modal.row.supplierId}
          supplierName={modal.row.supplierName}
          pool={modal.row.pool}
          pins={[{ billId: modal.row.id, inNo: modal.row.inNo, duePaise: modal.row.duePaise }]}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'settleNil' && (
        <SettleToNilModal
          supplierId={modal.row.supplierId}
          pool={modal.row.pool}
          billId={modal.row.id}
          inNo={modal.row.inNo}
          duePaise={modal.row.duePaise}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'cancelBill' && <CancelBillModal billId={modal.row.id} inNo={modal.row.inNo} onClose={() => setModal(null)} />}
      {multiPay && (
        <RecordPaymentModal
          supplierId={payableRows[0]?.supplierId}
          supplierName={payableRows[0]?.supplierName}
          pool={(payableRows[0]?.pool ?? 'kacha') as 'kacha' | 'gst'}
          pins={payPins}
          onClose={() => setMultiPay(false)}
        />
      )}
      {paymentDetailsId && <PaymentDetailsModal paymentId={paymentDetailsId} onClose={() => setPaymentDetailsId(null)} />}
    </div>
  )
}
