import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Edit3,
  Package,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LogsPager, defaultLogFromDate, useLogsPager } from '@/components/logging/logs-shell'
import { z } from 'zod'
import { PurchasesShell } from '@/components/suppliers/purchases-shell'
import { BillChitty } from '@/components/suppliers/bill-chitty'
import { buildPurchaseBillPresentation } from '@/components/suppliers/purchase-bill-presentation'
import { AddBardanModal, CancelBillModal } from '@/components/suppliers/bill-modals'
import { PurchaseBillEditDialog } from '@/components/suppliers/purchase-bill-editor'
import { itemsSummary } from '@/components/suppliers/purchase-bills-table'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { listPurchaseItems, type EnrichedPurchaseBill } from '@/data/suppliers'
import { purchaseBillQueryOptions, purchaseBillsQueryOptions, supplierContextQueryOptions, supplierPaymentsQueryOptions, suppliersSummaryQueryOptions } from '@/data/purchase-queries'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

const searchSchema = z.object({
  billId: z.string().optional(),
  supplier: z.string().optional(),
  tab: z.enum(['all', 'open', 'partial', 'nil', 'cancelled', 'bardan']).optional(),
  pool: z.enum(['all', 'kacha', 'gst']).optional(),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  view: z.enum(['bills', 'payments']).optional(),
  kind: z.enum(['payment', 'paid_on_behalf', 'settle_off', 'refund_received', 'bardan_advance']).optional(),
  payq: z.string().optional(),
})

export const Route = createFileRoute('/purchase-bills/')({
  validateSearch: searchSchema,
  component: PurchaseBillsRoute,
})

type PoolFilter = 'all' | 'kacha' | 'gst'
type TabKey = 'all' | 'open' | 'partial' | 'nil' | 'cancelled' | 'bardan'
type ModalKind = null | 'cancelBill' | 'bardan'
type PayKindFilter = 'payment' | 'paid_on_behalf' | 'settle_off' | 'refund_received' | 'bardan_advance'

const PAY_KIND_OPTIONS: Array<[PayKindFilter, string]> = [
  ['payment', 'Payment'],
  ['paid_on_behalf', 'On behalf'],
  ['settle_off', 'Settle off'],
  ['refund_received', 'Refund'],
  ['bardan_advance', 'Bardan advance'],
]

const TAB_LABELS: Record<TabKey, string> = {
  all: 'All bills',
  open: 'Open bills',
  partial: 'Partially paid bills',
  nil: 'NIL bills',
  cancelled: 'Cancelled bills',
  bardan: 'Bills with bardan pending',
}


function PurchaseBillsRoute() {
  return (
    <PurchasesShell>
      <PurchaseBillsPage />
    </PurchasesShell>
  )
}

function PurchaseBillsPage() {
  const purchaseItems = useQuery({ queryKey: ['purchase-items'], queryFn: listPurchaseItems })
  const itemNames = useMemo(() => new Map(purchaseItems.data?.map((item) => [item.id, item.name])), [purchaseItems.data])
  const routeSearch = Route.useSearch()
  const supplierFilter = routeSearch.supplier
  const tab = routeSearch.tab ?? 'all'
  const poolFilter = (routeSearch.pool as PoolFilter) ?? 'all'
  const query = routeSearch.q ?? ''
  const fromDate = routeSearch.from ?? defaultLogFromDate(getLocalIsoDate())
  const toDate = routeSearch.to ?? ''
  const kindFilter = routeSearch.kind as PayKindFilter | undefined
  const payQuery = routeSearch.payq ?? ''

  const navigate = useNavigate()
  const previewCardRef = useRef<HTMLDivElement>(null)

  const [selectedId, setSelectedId] = useState<string>(routeSearch.billId ?? '')
  const [modal, setModal] = useState<ModalKind>(null)
  const [editingBill, setEditingBill] = useState<{ id: string; inNo: string } | null>(null)
  // 1. Load bills and suppliers
  const billsQuery = useQuery(purchaseBillsQueryOptions())
  const paymentsQuery = useQuery(supplierPaymentsQueryOptions())
  const suppliersQuery = useQuery(suppliersSummaryQueryOptions())

  const supplierOptions = useMemo(
    () => [
      { id: '', name: 'All suppliers' },
      ...(suppliersQuery.data ?? [])
        .filter((s) => s.supplier.active)
        .map((s) => ({ id: s.supplier.id, name: s.supplier.companyName })),
    ],
    [suppliersQuery.data],
  )

  const allBills = useMemo(
    () =>
      [...(billsQuery.data ?? [])].sort((a, b) =>
        `${b.date}|${b.created}|${b.id}`.localeCompare(`${a.date}|${a.created}|${a.id}`),
      ),
    [billsQuery.data],
  )

  const updateUrlFilter = (patch: Record<string, string | undefined>) => {
    void navigate({
      from: '/purchase-bills/',
      search: (prev) => {
        const next: Record<string, string | undefined> = { ...prev, ...patch }
        for (const k of Object.keys(next)) {
          if (!next[k] || next[k] === 'all') delete next[k]
        }
        return next as any
      },
      replace: true,
    })
  }

  // 2. Pre-tab filters (supplier, pool, date range, search)
  const preTabBills = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allBills.filter((bill) => {
      if (supplierFilter && bill.supplierId !== supplierFilter) return false
      if (poolFilter !== 'all' && bill.pool !== poolFilter) return false
      if (fromDate && bill.date < fromDate && bill.id !== routeSearch.billId) return false
      if (toDate && bill.date > toDate) return false
      if (needle) {
        const inMatch = bill.inNo.toLowerCase().includes(needle)
        const supplierMatch = bill.supplierName.toLowerCase().includes(needle)
        const billNoMatch = (bill.supplierBillNo ?? '').toLowerCase().includes(needle)
        const itemMatch = (bill.lines ?? []).some((l) => [l.itemName, itemNames.get(l.itemId ?? '')].some((name) => name?.toLowerCase().includes(needle)))
        if (!inMatch && !supplierMatch && !billNoMatch && !itemMatch) return false
      }
      return true
    })
  }, [allBills, supplierFilter, poolFilter, fromDate, toDate, query, routeSearch.billId, itemNames])

  // 3. Tab counts
  const tabCounts = useMemo(() => {
    let open = 0
    let partial = 0
    let nil = 0
    let bardan = 0
    let cancelled = 0
    for (const b of preTabBills) {
      if (b.cancelled) cancelled++
      else if (b.status === 'open') open++
      else if (b.status === 'partial') partial++
      else if (b.status === 'nil') nil++
      if (b.bardanPending && !b.cancelled) bardan++
    }
    return { all: preTabBills.length, open, partial, nil, cancelled, bardan }
  }, [preTabBills])

  // 4. Tab filtered bills
  const filteredBills = useMemo(() => {
    switch (tab) {
      case 'open':
        return preTabBills.filter((b) => !b.cancelled && b.status === 'open')
      case 'partial':
        return preTabBills.filter((b) => !b.cancelled && b.status === 'partial')
      case 'nil':
        return preTabBills.filter((b) => !b.cancelled && b.status === 'nil')
      case 'cancelled':
        return preTabBills.filter((b) => b.cancelled)
      case 'bardan':
        return preTabBills.filter((b) => b.bardanPending && !b.cancelled)
      default:
        return preTabBills
    }
  }, [preTabBills, tab])
  const billsPager = useLogsPager(filteredBills)
  const filteredPayments = useMemo(() => {
    const payNeedle = payQuery.trim().toLowerCase()
    return (paymentsQuery.data ?? [])
      .filter((payment) => {
        if (payment.date >= fromDate && (!toDate || payment.date <= toDate) && (!supplierFilter || payment.supplierId === supplierFilter)) {
          if (poolFilter !== 'all' && payment.pool !== poolFilter) return false
          if (kindFilter && payment.kind !== kindFilter) return false
          if (payNeedle) {
            const refMatch = (payment.reference ?? '').toLowerCase().includes(payNeedle)
            const payeeMatch = (payment.payeeName ?? '').toLowerCase().includes(payNeedle)
            const supplierMatch = payment.supplierName.toLowerCase().includes(payNeedle)
            if (!refMatch && !payeeMatch && !supplierMatch) return false
          }
          return true
        }
        return false
      })
      .sort((a, b) => `${b.date}|${b.created}|${b.id}`.localeCompare(`${a.date}|${a.created}|${a.id}`))
  }, [paymentsQuery.data, fromDate, toDate, supplierFilter, poolFilter, kindFilter, payQuery])
  const paymentsPager = useLogsPager(filteredPayments)

  // Keep selectedId valid
  useEffect(() => {
    if (!selectedId && filteredBills.length > 0) {
      setSelectedId(filteredBills[0].id)
    }
  }, [filteredBills, selectedId])

  useEffect(() => {
    if (routeSearch.billId && routeSearch.billId !== selectedId) {
      setSelectedId(routeSearch.billId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSearch.billId])

  const selectedIndex = filteredBills.findIndex((b) => b.id === selectedId)
  const selected: EnrichedPurchaseBill | null =
    selectedIndex >= 0 ? filteredBills[selectedIndex] : filteredBills[0] ?? null

  const handleSelectBill = (bill: EnrichedPurchaseBill) => {
    setSelectedId(bill.id)
    updateUrlFilter({ billId: bill.id })
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      previewCardRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const activeBillId = selected?.id ?? selectedId

  // 5. Detail & bundle for selected bill chitty
  const detailQuery = useQuery(purchaseBillQueryOptions(activeBillId))
  const detail = detailQuery.data
  const supplierId = detail?.bill.supplierId ?? selected?.supplierId ?? ''

  const bundleQuery = useQuery(supplierContextQueryOptions(supplierId))
  const presentation = useMemo(
    () => buildPurchaseBillPresentation(detail, bundleQuery.data),
    [detail, bundleQuery.data],
  )
  const chittyData = presentation?.chitty

  const goto = (delta: number) => {
    const next = filteredBills[selectedIndex + delta]
    if (next) handleSelectBill(next)
  }

  // Quick KPI numbers for filtered list
  const kpi = useMemo(() => {
    const active = filteredBills.filter((b) => !b.cancelled)
    const totalDuePaise = active.reduce((s, b) => s + b.duePaise, 0)
    return { totalDuePaise }
  }, [filteredBills])

  const isPaymentsView = routeSearch.view === 'payments'

  const clearAllFilters = () => {
    void navigate({ to: '/purchase-bills', search: { billId: routeSearch.billId, view: routeSearch.view } })
  }

  const activeChips: Array<{ key: string; label: string; onClear: () => void }> = [
    supplierFilter && { key: 'supplier', label: `Supplier: ${supplierOptions.find((s) => s.id === supplierFilter)?.name ?? supplierFilter.slice(0, 10)}…`, onClear: () => updateUrlFilter({ supplier: undefined }) },
    tab !== 'all' && { key: 'tab', label: TAB_LABELS[tab], onClear: () => updateUrlFilter({ tab: undefined }) },
    poolFilter !== 'all' && { key: 'pool', label: poolFilter === 'kacha' ? 'Kacha' : 'GST', onClear: () => updateUrlFilter({ pool: undefined }) },
    query && { key: 'q', label: `“${query}”`, onClear: () => updateUrlFilter({ q: undefined }) },
    routeSearch.from && { key: 'from', label: `From ${fromDate}`, onClear: () => updateUrlFilter({ from: undefined }) },
    toDate && { key: 'to', label: `To ${toDate}`, onClear: () => updateUrlFilter({ to: undefined }) },
    isPaymentsView && kindFilter && { key: 'kind', label: PAY_KIND_OPTIONS.find(([k]) => k === kindFilter)?.[1] ?? kindFilter, onClear: () => updateUrlFilter({ kind: undefined }) },
    isPaymentsView && payQuery && { key: 'payq', label: `Payee/Ref: ${payQuery}`, onClear: () => updateUrlFilter({ payq: undefined }) },
  ].filter((chip): chip is { key: string; label: string; onClear: () => void } => Boolean(chip))

  return (
    <div className="w-full px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* View switch */}
          <div className="flex w-fit gap-1 rounded-lg bg-slate-50 p-1">
            {(['bills', 'payments'] as const).map((view) => (
              <button
                key={view}
                type="button"
                className={`rounded-md px-3 py-1 ${isPaymentsView === (view === 'payments') ? 'bg-white font-semibold shadow-sm' : ''}`}
                onClick={() => updateUrlFilter({ view })}
              >
                {view === 'bills' ? 'Bills' : 'Payments'}
              </button>
            ))}
          </div>
          {/* Date window */}
          <label htmlFor="purchase-bills-from" className="flex items-center gap-1.5 text-slate-600">
            From
            <input
              id="purchase-bills-from"
              type="date"
              value={fromDate}
              onChange={(event) => updateUrlFilter({ from: event.target.value || '1900-01-01' })}
              className="h-7 rounded-md border border-slate-300 bg-white px-2"
            />
          </label>
          <button type="button" onClick={() => updateUrlFilter({ from: '1900-01-01' })} className="h-7 rounded-md border border-slate-300 bg-white px-2 whitespace-nowrap">Load all history</button>
          {isPaymentsView && (
            <>
              <select
                aria-label="Payment kind filter"
                value={kindFilter ?? ''}
                onChange={(event) => updateUrlFilter({ kind: event.target.value as PayKindFilter || undefined })}
                className="h-7 rounded-md border border-slate-300 bg-white px-2"
              >
                <option value="">All kinds</option>
                {PAY_KIND_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <select
                aria-label="Payment pool filter"
                value={poolFilter}
                onChange={(event) => updateUrlFilter({ pool: event.target.value as PoolFilter || undefined })}
                className="h-7 rounded-md border border-slate-300 bg-white px-2"
              >
                <option value="all">Both pools</option>
                <option value="kacha">Kacha</option>
                <option value="gst">GST</option>
              </select>
              <label htmlFor="purchase-payq" className="sr-only">Payee or reference</label>
              <input
                id="purchase-payq"
                type="search"
                value={payQuery}
                onChange={(event) => updateUrlFilter({ payq: event.target.value || undefined })}
                placeholder="Payee / reference…"
                className="h-7 w-44 rounded-md border border-slate-300 bg-white px-2"
              />
            </>
          )}
        </div>
        {/* Active-filter chips */}
        {activeChips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-1.5">
            {activeChips.map((chip) => (
              <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                {chip.label}
                <button
                  type="button"
                  aria-label={`Clear ${chip.label}`}
                  onClick={chip.onClear}
                  className="rounded-full text-slate-400 transition hover:text-slate-800"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <button type="button" onClick={clearAllFilters} className="ml-auto text-[11px] font-semibold text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline">
              Clear all
            </button>
          </div>
        )}
      </div>
      {routeSearch.view === 'payments' ? <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-900">Purchase payments</h2><Link to="/new-supplier-payment" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">New payment</Link></div>
        {paymentsQuery.isLoading ? <p className="text-xs text-slate-500">Loading payments…</p> : paymentsQuery.isError ? <p role="alert" className="text-xs text-rose-700">Payments could not load.</p> : <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Pool</th><th className="px-3 py-2">Payee / Ref</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
            <tbody>{paymentsPager.pageRows.map((payment) => <tr key={payment.id} className="border-t border-slate-100"><td className="px-3 py-2">{formatFullDate(payment.date)}</td><td className="px-3 py-2">{payment.supplierName}</td><td className="px-3 py-2">{payment.kind}</td><td className="px-3 py-2">{payment.pool}</td><td className="max-w-[180px] truncate px-3 py-2 text-slate-600" title={payment.payeeName ? `${payment.payeeName} · ${payment.reference}` : payment.reference}>{payment.payeeName || payment.reference || '—'}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{formatPaiseInr(payment.amountPaise)}</td></tr>)}</tbody>
          </table>
          <LogsPager {...paymentsPager} />
        </div>}
      </section> : <>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* ================= LEFT COLUMN: BILL LIST (End-to-End full glance height) ================= */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm xl:col-span-5 flex flex-col xl:h-[calc(100vh-6.5rem)]">
          {/* Row 1: Title, KPI metrics, Search Input */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Bill List
              <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                {filteredBills.length}
              </span>
            </h3>

            <label className="relative w-48 max-w-full">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                className="h-7 w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-xs text-slate-800 shadow-xs outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                value={query}
                onChange={(e) => updateUrlFilter({ q: e.target.value })}
                placeholder="Filter bills…"
                aria-label="Filter bills"
              />
            </label>
          </div>

          {/* Row 2: Status Tabs, Supplier Selector, Pool Toggle */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
            {/* Status Tabs */}
            <div className="flex flex-wrap gap-1 text-[11px]">
              {(
                [
                  ['all', 'All'],
                  ['open', 'Open'],
                  ['partial', 'Partial'],
                  ['nil', 'NIL'],
                ] as Array<[TabKey, string]>
              ).map(([key, label]) => {
                const active = tab === key
                const count = tabCounts[key]
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateUrlFilter({ tab: key === 'all' ? undefined : key })}
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition ${
                      active
                        ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200'
                        : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`font-mono text-[11px] ${
                        active ? 'text-blue-700 font-bold' : 'text-slate-400'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
              <select aria-label="More bill filters" value={tab === 'bardan' || tab === 'cancelled' ? tab : ''} onChange={(event) => updateUrlFilter({ tab: event.target.value ? event.target.value as TabKey : undefined })} className="h-6 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-600">
                <option value="">More</option>
                <option value="bardan">Bardan ({tabCounts.bardan})</option>
                <option value="cancelled">Cancelled ({tabCounts.cancelled})</option>
              </select>
            </div>

            {/* Supplier & Pool */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="w-32 shrink-0">
                <SearchableCombobox
                  options={supplierOptions}
                  value={supplierFilter ?? ''}
                  onChange={(val) => updateUrlFilter({ supplier: val || undefined })}
                  placeholder="All suppliers…"
                  inputClassName="h-7 w-full rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-800 shadow-xs outline-none focus:border-slate-400"
                />
              </div>
              <div className="inline-flex rounded border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-medium shrink-0">
                {(['all', 'kacha', 'gst'] as PoolFilter[]).map((pf) => (
                  <button
                    key={pf}
                    type="button"
                    onClick={() => updateUrlFilter({ pool: pf })}
                    className={`rounded px-1.5 py-0.5 transition font-semibold ${
                      poolFilter === pf
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {pf === 'all' ? 'All' : pf === 'kacha' ? 'Kacha' : 'GST'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Table of Bills */}
          {billsQuery.isLoading && (
            <p className="px-3 py-10 text-center text-xs text-slate-400">Loading bills…</p>
          )}
          {billsQuery.isError && (
            <p className="px-3 py-10 text-center text-xs text-rose-600">Unable to load bills.</p>
          )}
          {!billsQuery.isLoading && !billsQuery.isError && (
            <div className="flex-1 overflow-auto rounded-md border border-slate-200 no-scrollbar">              <table className="w-full min-w-[360px]">
                <thead>
                  <tr className="sticky top-0 bg-slate-100 text-[11px] uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200 z-10">
                    <th className="px-3 py-2 text-left">Bill &amp; Date</th>
                    <th className="px-3 py-2 text-left">Party</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {filteredBills.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center text-xs italic text-slate-400">
                        No purchase bills match current filters.
                      </td>
                    </tr>
                  )}
                  {billsPager.pageRows.map((bill) => {
                    const active = bill.id === selectedId
                    const summary = itemsSummary(bill.lines.map((line) => ({ ...line, itemName: itemNames.get(line.itemId ?? '') ?? line.itemName })))
                    const isPaid = !bill.cancelled && (bill.status === 'nil' || bill.duePaise <= 0)
                    const isPartial = !bill.cancelled && (bill.status === 'partial' || (bill.duePaise > 0 && bill.duePaise < bill.netPaise))

                    let rowStyle: string
                    if (bill.cancelled) {
                      rowStyle = active
                        ? 'border-l-4 border-l-slate-600 bg-slate-200/90 ring-2 ring-inset ring-slate-400 opacity-80'
                        : 'border-l-4 border-l-slate-400 bg-slate-100/70 hover:bg-slate-200/60 opacity-60'
                    } else if (isPaid) {
                      // Fully Paid: Green
                      rowStyle = active
                        ? 'border-l-4 border-l-emerald-600 bg-emerald-100 ring-2 ring-inset ring-emerald-400'
                        : 'border-l-4 border-l-emerald-500 bg-emerald-50/90 hover:bg-emerald-100/80'
                    } else if (isPartial) {
                      // Partial Paid: Yellow
                      rowStyle = active
                        ? 'border-l-4 border-l-amber-600 bg-amber-100 ring-2 ring-inset ring-amber-400'
                        : 'border-l-4 border-l-amber-500 bg-amber-50/90 hover:bg-amber-100/80'
                    } else {
                      // Fully Unpaid: Red
                      rowStyle = active
                        ? 'border-l-4 border-l-rose-600 bg-rose-100 ring-2 ring-inset ring-rose-400'
                        : 'border-l-4 border-l-rose-500 bg-rose-50/90 hover:bg-rose-100/80'
                    }

                    return (
                      <tr
                        key={bill.id}
                        onClick={() => handleSelectBill(bill)}
                        className={`cursor-pointer transition ${rowStyle}`}
                      >
                        {/* Bill No (Top) & Date (Bottom replacing status) */}
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          <span className="font-mono text-xs font-bold text-slate-900 block whitespace-nowrap">
                            {bill.inNo}
                          </span>
                          <span className="text-[11px] text-slate-600 font-medium block whitespace-nowrap mt-0.5">
                            {formatFullDate(bill.date)}
                          </span>
                        </td>

                        {/* Party / Supplier */}
                        <td className="max-w-[200px] px-3 py-2 align-top">
                          <span className="block truncate text-xs font-semibold text-slate-900">
                            {bill.supplierName}
                          </span>
                          <span
                            className="block truncate text-[11px] text-slate-500"
                            title={summary}
                          >
                            {summary || '—'}
                          </span>
                        </td>

                        {/* Amount & Due */}
                        <td className="px-3 py-2 align-top text-right shrink-0">
                          <span className="block font-mono text-xs font-bold tabular-nums text-slate-900">
                            {formatPaiseInr(bill.netPaise)}
                          </span>
                          {bill.cancelled ? (
                            <span className="block text-[11px] text-slate-400 line-through">
                              Cancelled
                            </span>
                          ) : isPaid ? (
                            <span className="block font-mono text-[11px] tabular-nums font-bold text-emerald-700">
                              NIL
                            </span>
                          ) : isPartial ? (
                            <span className="block font-mono text-[11px] tabular-nums font-bold text-amber-800">
                              Due: {formatPaiseInr(bill.duePaise)}
                            </span>
                          ) : (
                            <span className="block font-mono text-[11px] tabular-nums font-bold text-rose-700">
                              Unpaid
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-1.5 flex shrink-0 items-center justify-between text-[11px] text-slate-500">
            <span>
              Showing <strong className="font-mono text-slate-700">{filteredBills.length}</strong> of {allBills.length} bills
            </span>
            {kpi.totalDuePaise > 0 && (
              <span>
                Open due <strong className="font-mono tabular-nums text-slate-900">{formatPaiseInr(kpi.totalDuePaise)}</strong>
              </span>
            )}
          </div>
        </div>

        {/* ================= RIGHT COLUMN: INTELLIGENCE & CHITTY PREVIEW ================= */}
        <div
          ref={previewCardRef}
          className="xl:col-span-7 flex flex-col gap-3 xl:h-[calc(100vh-6.5rem)]"
        >
          {!selected || !chittyData ? (
            <div className="flex-1 grid min-h-[72vh] place-items-center rounded-xl border border-dashed border-slate-300 bg-white p-3.5 text-center shadow-sm">
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  {billsQuery.isLoading ? 'Loading bills…' : 'Select a bill from the list to preview'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Preview shows the live chitty with lines, bardan, applied credits, and dues.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Bill detail remains in the chitty; no duplicate settlement panel. */}
              <div className="flex-1 flex flex-col rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm min-h-0">
                {/* Header Action Bar */}
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs font-semibold text-slate-900">
                      Bill Chitty · <span className="font-mono font-bold">{chittyData.inNo}</span>
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <ActionButton
                      label="View"
                      onClick={() =>
                        void navigate({
                          to: '/purchase-bills/$billId',
                          params: { billId: selected.id },
                        })
                      }
                    />
                    <ActionButton
                      label="Edit"
                      icon={<Edit3 size={12} />}
                      tone="blue"
                      onClick={() => setEditingBill({ id: selected.id, inNo: selected.inNo })}
                    />
                    {!selected.cancelled && <ActionButton label="Add Bardan" icon={<Package size={12} />} onClick={() => setModal('bardan')} />}
                    {!selected.cancelled && (
                      <ActionButton
                        label="Void"
                        icon={<Trash2 size={12} />}
                        tone="danger"
                        onClick={() => setModal('cancelBill')}
                      />
                    )}
                    <div className="inline-flex items-center rounded border border-slate-200">
                      <button
                        type="button"
                        aria-label="Previous bill"
                        disabled={selectedIndex <= 0}
                        onClick={() => goto(-1)}
                        className="inline-flex h-7 w-7 items-center justify-center text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label="Next bill"
                        disabled={selectedIndex >= filteredBills.length - 1}
                        onClick={() => goto(1)}
                        className="inline-flex h-7 w-7 items-center justify-center border-l border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Pure Chitty Voucher Container (scrolls independently, no KPI box inside) */}
                <div className="flex-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/40 p-2">
                  <div className="flex justify-center py-2">
                    <BillChitty data={chittyData} mode="view" />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
      <LogsPager {...billsPager} />
      </>}

      {/* Modals */}
      {modal === 'bardan' && selected && <AddBardanModal key={selected.id} billId={selected.id} onClose={() => setModal(null)} />}
      {modal === 'cancelBill' && selected && (
        <CancelBillModal
          billId={selected.id}
          inNo={selected.inNo}
          onClose={() => {
            setModal(null)
          }}
        />
      )}

      {/* Edit opens the shared centered editor; View stays a full page. */}
      {editingBill && (
        <PurchaseBillEditDialog
          billId={editingBill.id}
          inNo={editingBill.inNo}
          onClose={() => setEditingBill(null)}
        />
      )}

    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon?: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'blue' | 'danger'
}) {
  const styles =
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
      : tone === 'blue'
        ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {icon}
      {label}
    </button>
  )
}
