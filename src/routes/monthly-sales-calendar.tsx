import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, ChevronLeft, ChevronRight, CircleDollarSign, PackageCheck, ReceiptText, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useModuleSettings } from '@/lib/use-module-settings'
import { purchaseReadModelQueryOptions } from '@/data/purchase-queries'
import { loadCastingSessions } from '@/data/casting'
import { Link } from '@tanstack/react-router'
import { type CalendarDaySidebarData, type CalendarSidebarBill, type CalendarSidebarPayment } from '@/components/calendar/calendar-day-sidebar'
import { CalendarMonthOverview } from '@/components/calendar/calendar-month-overview'
import { loadCalendarMonthData } from '@/data/calendar-month'
import type { PBRecord } from '@/data/dashboard'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { buildGasSalesReport, type GasSalesMetrics } from '@/domain/gas-sales-reporting'
import { buildMonthlyItemComparisons, emptyMonthlyItemComparisons } from '@/domain/monthly-item-rollup'
import { bestSalesDay, dayDotState } from '@/domain/calendar-visuals'
import type { GasSalesGroup } from '@/domain/gas-sales-reporting'
import { GasSellingStrip } from '@/components/calendar/gas-selling-strip'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { formatInrInteger, formatPaiseInr } from '@/lib/inr-format'

export const Route = createFileRoute('/monthly-sales-calendar')({
  validateSearch: (search: Record<string, unknown>) => ({
    month: typeof search.month === 'string' && /^\d{4}-\d{2}$/.test(search.month) ? search.month : undefined,
  }),
  component: CalendarPage,
})

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function str(value: unknown) {
  return String(value ?? '')
}

function shiftMonth(monthKey: string, delta: number) {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const date = new Date(Number(yearRaw), Number(monthRaw) - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function eachDayInclusive(startDate: Date, endDate: Date) {
  const days: Date[] = []
  const cursor = new Date(startDate)
  while (cursor <= endDate) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfWeekSunday(date: Date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function endOfWeekSaturday(date: Date) {
  const d = new Date(date)
  d.setDate(d.getDate() + (6 - d.getDay()))
  return d
}

function chunkWeeks(dates: Date[]) {
  const weeks: Date[][] = []
  for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7))
  return weeks
}

function formatBillRefFallback(bookNo: number, billNo: number) {
  return `${String(bookNo).padStart(3, '0')}/${String(billNo).padStart(3, '0')}`
}

function billsRefDisplay(pbRef: unknown, bookNo: number, billNo: number) {
  const raw = str(pbRef).trim()
  return raw || formatBillRefFallback(bookNo, billNo)
}

function mergeBillItemLines(rows: Array<{ itemName: string; qty: number; bags: number }>) {
  const merged = new Map<string, number>()
  const bags = new Map<string, number>()
  for (const row of rows) {
    const name = row.itemName.trim()
    if (!name || (!(row.qty > 0) && !(row.bags > 0))) continue
    merged.set(name, (merged.get(name) ?? 0) + row.qty)
    bags.set(name, (bags.get(name) ?? 0) + row.bags)
  }
  return [...merged.entries()].map(([itemName, qty]) => ({ itemName, qty, bags: bags.get(itemName) ?? 0 }))
}

function formatWhole(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(value))
}

function formatRate(value: number | null) {
  return value == null ? '-' : `${formatInrInteger(value)}/kg`
}

function formatPremium(value: number | null) {
  if (value == null) return '-'
  return `${value >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(value))}`
}

function CalendarPage() {
  const { purchaseEnabled, castingEnabled } = useModuleSettings()
  const [showPurchase, setShowPurchase] = useState(true)
  const [showCasting, setShowCasting] = useState(true)
  const today = useMemo(() => getLocalIsoDate(), [])
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [monthKey, setMonthKey] = useState(() => search.month ?? today.slice(0, 7))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const calendarRef = useRef<HTMLDivElement | null>(null)

  const calendarQuery = useQuery({
    queryKey: ['calendar-month', monthKey],
    queryFn: () => loadCalendarMonthData(monthKey),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
  const purchaseQuery = useQuery({ ...purchaseReadModelQueryOptions(), enabled: purchaseEnabled })
  const castingQuery = useQuery({ queryKey: ['calendar-casting', monthKey], queryFn: () => loadCastingSessions({ from: `${monthKey}-01`, to: `${monthKey}-${String(new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate()).padStart(2, '0')}` }), enabled: castingEnabled })
  const purchaseByDay = useMemo(() => {
    const result = new Map<string, number>()
    for (const bill of purchaseQuery.data?.bills ?? []) if (!bill.cancelled && bill.date.startsWith(monthKey) && (monthKey !== today.slice(0, 7) || bill.date <= today)) result.set(bill.date, (result.get(bill.date) ?? 0) + bill.netPaise)
    return result
  }, [purchaseQuery.data, monthKey, today])
  const purchasePaidByDay = useMemo(() => {
    const result = new Map<string, number>()
    for (const payment of purchaseQuery.data?.payments ?? []) if (!payment.cancelled && payment.date.startsWith(monthKey) && (monthKey !== today.slice(0, 7) || payment.date <= today) && (payment.kind === 'payment' || payment.kind === 'paid_on_behalf')) result.set(payment.date, (result.get(payment.date) ?? 0) + payment.amountPaise)
    return result
  }, [purchaseQuery.data, monthKey, today])
  const castingByDay = useMemo(() => {
    const result = new Map<string, number>()
    for (const session of castingQuery.data ?? []) if (monthKey !== today.slice(0, 7) || session.date <= today) result.set(session.date, (result.get(session.date) ?? 0) + session.totalWireOut)
    return result
  }, [castingQuery.data, monthKey, today])
  const castingCountByDay = useMemo(() => {
    const result = new Map<string, number>()
    for (const session of castingQuery.data ?? []) if (monthKey !== today.slice(0, 7) || session.date <= today) result.set(session.date, (result.get(session.date) ?? 0) + 1)
    return result
  }, [castingQuery.data, monthKey, today])
  const monthPurchase = useMemo(() => {
    const bills = (purchaseQuery.data?.bills ?? []).filter((bill) => !bill.cancelled && bill.date.startsWith(monthKey) && (monthKey !== today.slice(0, 7) || bill.date <= today))
    const payments = (purchaseQuery.data?.payments ?? []).filter((payment) => !payment.cancelled && payment.date.startsWith(monthKey) && (monthKey !== today.slice(0, 7) || payment.date <= today) && (payment.kind === 'payment' || payment.kind === 'paid_on_behalf'))
    return { boughtPaise: bills.reduce((sum, bill) => sum + bill.netPaise, 0), paidPaise: payments.reduce((sum, payment) => sum + payment.amountPaise, 0), weightG: bills.reduce((sum, bill) => sum + bill.lines.reduce((lineSum, line) => lineSum + line.weightG, 0), 0), bills: bills.length, payments: payments.length }
  }, [purchaseQuery.data, monthKey, today])
  const monthCasting = useMemo(() => {
    const sessions = (castingQuery.data ?? []).filter((session) => monthKey !== today.slice(0, 7) || session.date <= today)
    return { kg: sessions.reduce((sum, session) => sum + session.totalWireOut, 0), inputKg: sessions.reduce((sum, session) => sum + session.totalInputKg, 0), count: sessions.length, days: new Set(sessions.map((session) => session.date)).size }
  }, [castingQuery.data, monthKey, today])
  useEffect(() => {
    setSelectedDay(null)
  }, [monthKey])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!selectedDay || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : event.key === 'ArrowDown' ? 7 : 0
      if (!delta) return
      event.preventDefault()
      const date = new Date(`${selectedDay}T00:00:00`)
      date.setDate(date.getDate() + delta)
      const next = toIsoDate(date)
      setSelectedDay(next)
      if (next.slice(0, 7) !== monthKey) {
        const nextMonth = next.slice(0, 7)
        setMonthKey(nextMonth)
        void navigate({ search: { month: nextMonth }, replace: true })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [monthKey, navigate, selectedDay])

  const aggregates = useMemo(() => buildCalendarAggregates(calendarQuery.data, monthKey, today), [calendarQuery.data, monthKey, today])
  const bestDay = useMemo(() => bestSalesDay(aggregates.dailySales, monthKey), [aggregates, monthKey])
  const gridWeeks = useMemo(() => {
    const [year, month] = monthKey.split('-').map(Number)
    return chunkWeeks(eachDayInclusive(startOfWeekSunday(new Date(year, month - 1, 1)), endOfWeekSaturday(new Date(year, month, 0))))
  }, [monthKey])

  const monthBills = [...aggregates.dailyBillCount.values()].reduce((sum, count) => sum + count, 0)
  const monthPayments = [...aggregates.paymentsByDate.values()].reduce((sum, rows) => sum + rows.length, 0)

  const topCards = [
    {
      label: 'Sales billed',
      value: calendarQuery.isLoading ? 'Loading…' : calendarQuery.isError ? 'Unavailable' : formatInrInteger(aggregates.monthSales),
      details: [{ label: 'Bills', value: formatWhole(monthBills) }, { label: 'Active days', value: formatWhole(aggregates.dailyBillCount.size) }],
      icon: ReceiptText,
    },
    {
      label: 'Sales collected',
      value: calendarQuery.isLoading ? 'Loading…' : calendarQuery.isError ? 'Unavailable' : formatInrInteger(aggregates.monthCollections),
      details: [{ label: 'Payments', value: formatWhole(monthPayments) }, { label: 'Top collection', value: aggregates.topCollection ? formatInrInteger(aggregates.topCollection.amount) : '—' }],
      icon: CircleDollarSign,
    },
    ...(purchaseEnabled ? [{ label: 'Purchase bought', value: purchaseQuery.isLoading ? 'Loading…' : purchaseQuery.isError ? 'Unavailable' : formatPaiseInr(monthPurchase.boughtPaise), details: [{ label: 'Paid out', value: purchaseQuery.isLoading || purchaseQuery.isError ? '—' : formatPaiseInr(monthPurchase.paidPaise) }, { label: 'Bills · kg', value: purchaseQuery.isLoading || purchaseQuery.isError ? '—' : `${monthPurchase.bills} · ${formatWhole(monthPurchase.weightG / 1000)}` }], icon: PackageCheck }] : []),
    ...(castingEnabled ? [{ label: 'Casting wire out', value: castingQuery.isLoading ? 'Loading…' : castingQuery.isError ? 'Unavailable' : `${formatWhole(monthCasting.kg)} kg`, details: [{ label: 'Sessions', value: castingQuery.isLoading || castingQuery.isError ? '—' : formatWhole(monthCasting.count) }, { label: 'Metal in', value: castingQuery.isLoading || castingQuery.isError ? '—' : `${formatWhole(monthCasting.inputKg)} kg` }], icon: Activity }] : []),
  ]

  const selectedSidebarData = selectedDay ? makeDaySidebarData(selectedDay, aggregates) : null

  function changeMonth(nextMonth: string) {
    setMonthKey(nextMonth)
    void navigate({ search: { month: nextMonth }, replace: true })
  }

  function selectToday() {
    changeMonth(today.slice(0, 7))
    setSelectedDay(today)
    window.setTimeout(() => calendarRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0)
  }

  return (
    <div className="w-full px-3 pb-6 pt-3 sm:px-4 lg:px-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold text-slate-900">{formatMonthYear(monthKey)} at a glance</h2><p className="text-xs text-slate-500">{monthKey === today.slice(0, 7) ? `Through ${formatFullDate(today)}` : 'Full month'}</p></div>
      <section className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {topCards.map((card) => <TopKpiCard key={card.label} {...card} />)}
      </section>

      {calendarQuery.isLoading ? <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">Loading calendar...</section> : null}
      {calendarQuery.isError ? <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">Unable to load calendar data.</section> : null}

      {!calendarQuery.isLoading && !calendarQuery.isError ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,7.4fr)_minmax(340px,2.6fr)]">
          <section ref={calendarRef} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Previous month" className={navButtonClass} onClick={() => changeMonth(shiftMonth(monthKey, -1))}>
                  <ChevronLeft size={17} />
                </button>
                <div className="min-w-0 px-1">
                  <h2 className="mt-0.5 text-xl font-bold leading-tight text-slate-950">{formatMonthYear(monthKey)}</h2>
                </div>
                <button type="button" aria-label="Next month" className={navButtonClass} onClick={() => changeMonth(shiftMonth(monthKey, 1))}>
                  <ChevronRight size={17} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                <button type="button" className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700" onClick={selectToday}>
                  Today
                </button>
                {purchaseEnabled && <button type="button" aria-pressed={showPurchase} onClick={() => setShowPurchase((value) => !value)} className={`h-9 rounded-lg border px-2.5 text-xs font-semibold ${showPurchase ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>Purchase</button>}
                {castingEnabled && <button type="button" aria-pressed={showCasting} onClick={() => setShowCasting((value) => !value)} className={`h-9 rounded-lg border px-2.5 text-xs font-semibold ${showCasting ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>Casting</button>}
              </div>
            </div>
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEKDAYS.map((day) => <div key={day} className="py-1.5 text-center text-[11px] font-semibold tracking-[0.08em] text-slate-500">{day}</div>)}
            </div>
            <div className="grid bg-slate-100" style={{ gap: 1 }}>
              {gridWeeks.map((week, weekIndex) => (
                <div key={weekIndex} className="grid grid-cols-7 gap-px">
                  {week.map((date) => {
                    const iso = toIsoDate(date)
                    const inMonth = iso.slice(0, 7) === monthKey
                    const isSelected = selectedDay === iso
                    const isToday = iso === today
                    const sales = aggregates.dailySales.get(iso) ?? 0
                    const collections = aggregates.dailyCollections.get(iso) ?? 0
                    const purchaseAmount = showPurchase && purchaseEnabled ? purchaseByDay.get(iso) ?? 0 : 0
                    const purchasePaid = showPurchase && purchaseEnabled ? purchasePaidByDay.get(iso) ?? 0 : 0
                    const castingKg = showCasting && castingEnabled ? castingByDay.get(iso) ?? 0 : 0
                    const castingCount = showCasting && castingEnabled ? castingCountByDay.get(iso) ?? 0 : 0
                    const soldBags = aggregates.dailySoldBags.get(iso) ?? 0
                    const rate = aggregates.rateByDate.get(iso)
                    const gas = aggregates.dailyGasByDate.get(iso)
                    // Rates never blend across GST streams: show the dominant bucket of the day.
                    const dayBuckets = [gas?.gst, gas?.nonGst].filter((basis): basis is NonNullable<typeof basis> => !!basis && basis.kg > 0)
                    const dominant = dayBuckets.sort((a, b) => b.kg - a.kg)[0] ?? null
                    const hasActivity = sales > 0 || collections > 0 || soldBags > 0 || !!rate || (gas?.kg ?? 0) > 0 || purchaseAmount > 0 || purchasePaid > 0 || castingCount > 0
                    const dotState = dayDotState(sales, collections)
                    const bucketLine = (label: string, basis: NonNullable<typeof dominant>) =>
                      `${label}: ${formatRate(basis.weightedSellingRate)} (incl. GST ${formatRate(basis.weightedSellingRateWithGst)}) · market ${formatRate(basis.weightedMarketRate)} · premium ${formatPremium(basis.premiumPerKg)}/kg`
                    const title = `${formatFullDate(iso)}\n${dayBuckets.map((basis) => bucketLine(dayBuckets.length > 1 ? (basis === gas?.gst ? 'GST' : 'non-GST') : 'Selling rate', basis)).join('\n')}\nCollections: ${formatInrInteger(collections)}\nSales: ${formatInrInteger(sales)}\nGas: ${formatWhole(gas?.kg ?? 0)} kg`
                    return (
                      <button
                        key={iso}
                        type="button"
                        title={title}
                        onClick={() => setSelectedDay((current) => (current === iso ? null : iso))}
                        className={`group min-h-[6.25rem] min-w-0 p-1 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 sm:p-2 ${
                          isSelected ? 'bg-blue-50 ring-2 ring-inset ring-blue-500' : hasActivity ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/80 hover:bg-white'
                        } ${!inMonth ? 'opacity-45' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-lg px-1 text-sm font-bold tabular-nums ${isToday ? 'bg-blue-700 text-white' : isSelected ? 'bg-white text-blue-700' : 'text-slate-900'}`}>{date.getDate()}</span>
                          {dotState ? (
                            <span className={`h-1.5 w-1.5 rounded-full ${dotState === 'covered' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                          ) : null}
                        </div>
                        <div className="mt-1 space-y-0.5 font-mono text-[11px] leading-tight tabular-nums">
                          {sales > 0 && <p className="truncate text-slate-900" title={`Sales ${formatInrInteger(sales)}`}>S {formatInrInteger(sales)}</p>}
                          {(purchaseAmount > 0 || purchasePaid > 0) && <p className="truncate text-slate-700" title={`Purchase bought ${formatPaiseInr(purchaseAmount)}; paid ${formatPaiseInr(purchasePaid)}`}>P {purchaseAmount > 0 ? formatPaiseInr(purchaseAmount) : `paid ${formatPaiseInr(purchasePaid)}`}</p>}
                          {castingCount > 0 && <p className="truncate text-slate-700" title={`Casting ${castingKg.toFixed(2)} kg, ${castingCount} sessions`}>C {formatWhole(castingKg)} kg</p>}
                          {!sales && !purchaseAmount && !purchasePaid && !castingCount && <p className="text-slate-400">—</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>

          <aside className="hidden xl:block">
            <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-auto rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm transition">
              <GasSellingStrip items={aggregates.gasByItem} />
              {(
                <CalendarMonthOverview
                  monthKey={monthKey}
                  avgRate={aggregates.monthAvgMarketRate}
                  rateDelta={aggregates.monthAvgMarketRateVsPrev}
                  topBuyer={aggregates.topBuyer}
                  topCollection={aggregates.topCollection}
                  itemComparisons={aggregates.itemComparisons}
                  leadingGasItem={aggregates.leadingGasItem}
                  bestDay={bestDay}
                />
              )}
            </div>
          </aside>
          <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm xl:hidden"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sales gas detail</h3><p className="mt-1 text-sm text-slate-700">Average bill market rate: <span className="font-mono font-semibold">{formatRate(aggregates.monthAvgMarketRate)}</span></p><GasSellingStrip items={aggregates.gasByItem} /></section>

        </div>
      ) : null}
      <Dialog open={Boolean(selectedDay)} onOpenChange={(open) => { if (!open) setSelectedDay(null) }}>
        <DialogContent className="flex max-h-[min(85dvh,700px)] w-[calc(100vw-1.5rem)] max-w-2xl flex-col overflow-hidden p-0">
          <div className="shrink-0 border-b border-slate-200 px-4 py-3"><DialogTitle className="text-base font-semibold">{selectedDay ? formatFullDate(selectedDay) : 'Day details'}</DialogTitle></div>
          <div className="min-h-0 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-3">
            {selectedSidebarData && <section className="space-y-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sales</h3><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg border border-slate-200 p-2">Billed <strong className="block font-mono text-sm">{formatInrInteger(selectedSidebarData.sales)}</strong></div><div className="rounded-lg border border-slate-200 p-2">Collected <strong className="block font-mono text-sm">{formatInrInteger(selectedSidebarData.collections)}</strong></div></div>{selectedSidebarData.bills.map((bill) => <Link key={bill.id} to="/transactions" search={{ focusKind: 'bill', focusId: bill.id }} className="block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 hover:bg-slate-50">{bill.billRefDisplay} · {bill.customerName} <span className="font-mono">{formatInrInteger(bill.total)}</span></Link>)}{selectedSidebarData.payments.map((payment) => <Link key={payment.id} to="/transactions" search={{ focusKind: 'payment', focusId: payment.id }} className="block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 hover:bg-slate-50">{payment.customerName} · Collected <span className="font-mono">{formatInrInteger(payment.amount)}</span></Link>)}</section>}
            {purchaseEnabled && showPurchase && <section className="space-y-2 border-t border-slate-200 pt-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Purchase</h3>
              {(purchaseQuery.data?.bills ?? []).filter((bill) => bill.date === selectedDay && !bill.cancelled).map((bill) => <Link key={bill.id} to="/purchase-bills/$billId" params={{ billId: bill.inNo }} className="block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 hover:bg-slate-50">{bill.inNo} · {bill.supplierName} · {formatPaiseInr(bill.netPaise)}</Link>)}
              {(purchaseQuery.data?.payments ?? []).filter((payment) => payment.date === selectedDay && !payment.cancelled).map((payment) => <Link key={payment.id} to="/purchase-bills" search={{ view: 'payments', from: selectedDay ?? undefined, to: selectedDay ?? undefined }} className="block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 hover:bg-slate-50">{payment.supplierName} · {payment.kind} · {formatPaiseInr(payment.amountPaise)}</Link>)}
            </section>}
            {castingEnabled && showCasting && <section className="space-y-2 border-t border-slate-200 pt-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Casting</h3>{(castingQuery.data ?? []).filter((session) => session.date === selectedDay).map((session) => <Link key={session.id} to="/casting/log" className="block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 hover:bg-slate-50">{session.totalWireOut.toFixed(2)} kg wire out</Link>)}</section>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TopKpiCard({
  label,
  value,
  details,
  icon: Icon,
}: {
  label: string
  value: string
  details: Array<{ label: string; value: string }>
  icon: LucideIcon
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon size={15} /></span>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      </div>
      <p className="mt-2 break-words font-mono text-xl font-bold leading-tight text-slate-950 tabular-nums" title={value}>{value}</p>
      <dl className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-xs">{details.map((detail) => <div key={detail.label} className="flex items-start justify-between gap-2"><dt className="text-slate-500">{detail.label}</dt><dd className="text-right font-mono font-semibold text-slate-800 tabular-nums">{detail.value}</dd></div>)}</dl>
    </div>
  )
}

const navButtonClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'

function buildCalendarAggregates(data: Awaited<ReturnType<typeof loadCalendarMonthData>> | undefined, monthKey: string, today: string) {
  const emptyGasReport = buildGasSalesReport({ bills: [], lines: [] })
  const empty = {
    dailySales: new Map<string, number>(),
    dailyCollections: new Map<string, number>(),
    dailyBillCount: new Map<string, number>(),
    dailySoldBags: new Map<string, number>(),
    dailySoldKg: new Map<string, number>(),
    billsByDate: new Map<string, CalendarSidebarBill[]>(),
    paymentsByDate: new Map<string, CalendarSidebarPayment[]>(),
    rateByDate: new Map<string, number>(),
    monthSales: 0,
    monthCollections: 0,
    monthSoldBags: 0,
    monthSoldKg: 0,
    monthAvgMarketRate: null as number | null,
    monthAvgMarketRateVsPrev: null as number | null,
    monthGas: emptyGasReport.overall,
    previousMonthGas: emptyGasReport.overall,
    dailyGasByDate: new Map<string, GasSalesMetrics>(),
    gasByItem: [] as Array<GasSalesGroup>,
    leadingGasItem: null as null | { name: string; kg: number; bags: number },
    itemComparisons: emptyMonthlyItemComparisons(),
    topBuyer: null as null | { customerName: string; sales: number; bags: number; qty: number; avgRate: number },
    topCollection: null as null | { customerName: string; amount: number },
  }
  if (!data) return empty

  const clipFutureToToday = monthKey === today.slice(0, 7)
  const customerDisplayById = new Map((data.customersRaw as PBRecord[]).map((row) => [row.id, formatCustomerDisplayName(row.company_name, row.name)]))
  const itemById = new Map((data.itemsRaw as PBRecord[]).map((row) => [row.id, row]))
  const itemByName = new Map((data.itemsRaw as PBRecord[]).map((row) => [str(row.name).trim().toLowerCase(), row]))
  const buildGasReport = (billsRaw: PBRecord[], billItemsRaw: PBRecord[], clipFuture: boolean) => {
    const bills = billsRaw
      .filter((bill) => {
        const day = str(bill.date).slice(0, 10)
        return day && (!clipFuture || day <= today)
      })
      .map((bill) => ({
        id: bill.id,
        date: str(bill.date).slice(0, 10),
        customerId: str(bill.customer),
        customerName: customerDisplayById.get(str(bill.customer)) ?? str(bill.customer_name) ?? 'Unknown customer',
        marketRate: num(bill.mkt),
        gstRate: num(bill.gst_rate),
        gstAmount: num(bill.gst_amount),
      }))
    const billIds = new Set(bills.map((bill) => bill.id))
    const lines = billItemsRaw
      .filter((line) => billIds.has(str(line.bill)))
      .map((line) => {
        const item = itemById.get(str(line.item)) ?? itemByName.get(str(line.item_name).trim().toLowerCase())
        return {
          billId: str(line.bill),
          itemId: str(line.item) || str(line.item_name).trim().toLowerCase(),
          itemName: str(line.item_name) || str(item?.name) || 'Unknown item',
          itemType: str(item?.type) || 'gas',
          qty: num(line.qty),
          bags: num(line.bags),
          amount: num(line.amount),
        }
      })
    return buildGasSalesReport({ bills, lines })
  }
  const currentGasReport = buildGasReport(data.billsRaw as PBRecord[], data.billItemsRaw as PBRecord[], clipFutureToToday)
  const previousGasReport = buildGasReport(data.prevBillsRaw as PBRecord[], data.prevBillItemsRaw as PBRecord[], false)
  const dailyGasByDate = new Map(currentGasReport.byDay.map((row) => [row.key, row as GasSalesMetrics]))
  const leadingGasItem = currentGasReport.byItem[0]
    ? { name: currentGasReport.byItem[0].label, kg: currentGasReport.byItem[0].kg, bags: currentGasReport.byItem[0].bags }
    : null
  const itemSumByBill = new Map<string, number>()
  const itemLinesByBill = new Map<string, Array<{ itemName: string; qty: number; bags: number }>>()
  for (const item of data.billItemsRaw as PBRecord[]) {
    const billId = str(item.bill)
    itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(item.amount))
    const lines = itemLinesByBill.get(billId) ?? []
    lines.push({ itemName: str(item.item_name), qty: num(item.qty), bags: num(item.bags) })
    itemLinesByBill.set(billId, lines)
  }

  const dailySales = new Map<string, number>()
  const dailyBillCount = new Map<string, number>()
  const dailySoldBags = new Map<string, number>()
  const dailySoldKg = new Map<string, number>()
  const billsByDate = new Map<string, CalendarSidebarBill[]>()
  const buyerAgg = new Map<string, { customerName: string; sales: number; bags: number; qty: number }>()
  for (const bill of data.billsRaw as PBRecord[]) {
    const day = str(bill.date).slice(0, 10)
    if (!day || (clipFutureToToday && day > today)) continue
    const base = itemSumByBill.get(bill.id) ?? 0
    const total = calculateBillTotalFromBase(base, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount))
    dailySales.set(day, (dailySales.get(day) ?? 0) + total)
    dailyBillCount.set(day, (dailyBillCount.get(day) ?? 0) + 1)
    const bookNo = num(bill.book_no)
    const billNo = num(bill.bill_no)
    const customerName = customerDisplayById.get(str(bill.customer)) ?? str(bill.customer_name)
    const billRef = billsRefDisplay(bill.bill_ref, bookNo, billNo)
    const itemLines = mergeBillItemLines(itemLinesByBill.get(bill.id) ?? [])
    const billBags = itemLines.reduce((sum, line) => sum + line.bags, 0)
    const billKg = itemLines.reduce((sum, line) => sum + line.qty, 0)
    dailySoldBags.set(day, (dailySoldBags.get(day) ?? 0) + billBags)
    dailySoldKg.set(day, (dailySoldKg.get(day) ?? 0) + billKg)
    const buyer = buyerAgg.get(str(bill.customer)) ?? { customerName, sales: 0, bags: 0, qty: 0 }
    buyer.sales += total
    buyer.bags += billBags
    buyer.qty += billKg
    buyerAgg.set(str(bill.customer), buyer)
    const row = {
      id: bill.id,
      customerId: str(bill.customer),
      customerName,
      billRefDisplay: billRef,
      total,
      itemLines,
    }
    billsByDate.set(day, [...(billsByDate.get(day) ?? []), row])
  }

  const dailyCollections = new Map<string, number>()
  const paymentsByDate = new Map<string, CalendarSidebarPayment[]>()
  const collectionAgg = new Map<string, { customerName: string; amount: number }>()
  for (const payment of data.paymentsRaw as PBRecord[]) {
    const day = str(payment.date).slice(0, 10)
    if (!day || (clipFutureToToday && day > today)) continue
    const amount = num(payment.amount)
    dailyCollections.set(day, (dailyCollections.get(day) ?? 0) + amount)
    const customerName = customerDisplayById.get(str(payment.customer)) ?? str(payment.customer_name)
    const collection = collectionAgg.get(str(payment.customer)) ?? { customerName, amount: 0 }
    collection.amount += amount
    collectionAgg.set(str(payment.customer), collection)
    const row = {
      id: payment.id,
      customerId: str(payment.customer),
      customerName,
      amount,
      mode: str(payment.mode),
      note: str(payment.note),
    }
    paymentsByDate.set(day, [...(paymentsByDate.get(day) ?? []), row])
  }

  const rateByDate = new Map<string, number>()
  for (const rate of data.ratesRaw as PBRecord[]) {
    const day = str(rate.date).slice(0, 10)
    const value = num(rate.vilaity)
    if (day && value > 0) rateByDate.set(day, value)
  }
  const prevRates = (data.prevRatesRaw as PBRecord[]).map((rate) => num(rate.vilaity)).filter((value) => value > 0)

  const monthSales = [...dailySales.values()].reduce((sum, value) => sum + value, 0)
  const monthCollections = [...dailyCollections.values()].reduce((sum, value) => sum + value, 0)
  const monthSoldBags = [...dailySoldBags.values()].reduce((sum, value) => sum + value, 0)
  const monthSoldKg = [...dailySoldKg.values()].reduce((sum, value) => sum + value, 0)
  const rates = [...rateByDate.values()].filter((value) => value > 0)
  const monthAvgMarketRate = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : null
  const prevAvgMarketRate = prevRates.length ? prevRates.reduce((sum, value) => sum + value, 0) / prevRates.length : null
  const itemComparisons = buildMonthlyItemComparisons({
    currentBills: data.billsRaw as PBRecord[],
    currentItems: data.billItemsRaw as PBRecord[],
    previousBills: data.prevBillsRaw as PBRecord[],
    previousItems: data.prevBillItemsRaw as PBRecord[],
    currentMonthKey: monthKey,
    previousMonthKey: shiftMonth(monthKey, -1),
    maxCurrentDate: clipFutureToToday ? today : undefined,
  })
  const topBuyerRaw = [...buyerAgg.values()].sort((a, b) => b.sales - a.sales)[0] ?? null
  const topBuyer = topBuyerRaw
    ? { ...topBuyerRaw, avgRate: topBuyerRaw.qty > 0 ? topBuyerRaw.sales / topBuyerRaw.qty : 0 }
    : null
  const topCollection = [...collectionAgg.values()].sort((a, b) => b.amount - a.amount)[0] ?? null

  return {
    dailySales,
    dailyCollections,
    dailyBillCount,
    dailySoldBags,
    dailySoldKg,
    billsByDate,
    paymentsByDate,
    rateByDate,
    monthSales,
    monthCollections,
    monthSoldBags,
    monthSoldKg,
    monthAvgMarketRate,
    monthAvgMarketRateVsPrev: monthAvgMarketRate != null && prevAvgMarketRate != null ? monthAvgMarketRate - prevAvgMarketRate : null,
    monthGas: currentGasReport.overall,
    previousMonthGas: previousGasReport.overall,
    dailyGasByDate,
    gasByItem: currentGasReport.byItem,
    leadingGasItem,
    itemComparisons,
    topBuyer,
    topCollection,
  }
}

function makeDaySidebarData(date: string, aggregates: ReturnType<typeof buildCalendarAggregates>): CalendarDaySidebarData {
  const bills = [...(aggregates.billsByDate.get(date) ?? [])].sort((a, b) => a.billRefDisplay.localeCompare(b.billRefDisplay))
  const payments = [...(aggregates.paymentsByDate.get(date) ?? [])].sort((a, b) => a.customerName.localeCompare(b.customerName) || b.amount - a.amount)
  return {
    date,
    rate: aggregates.rateByDate.get(date),
    sales: aggregates.dailySales.get(date) ?? 0,
    collections: aggregates.dailyCollections.get(date) ?? 0,
    soldBags: aggregates.dailySoldBags.get(date) ?? 0,
    soldKg: aggregates.dailySoldKg.get(date) ?? 0,
    gas: aggregates.dailyGasByDate.get(date),
    bills,
    payments,
  }
}
