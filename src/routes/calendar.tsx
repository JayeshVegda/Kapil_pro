import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, ChevronLeft, ChevronRight, CircleDollarSign, PackageCheck, ReceiptText, TrendingUp, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDaySidebar, type CalendarDaySidebarData, type CalendarSidebarBill, type CalendarSidebarPayment } from '@/components/calendar/calendar-day-sidebar'
import { CalendarMonthOverview } from '@/components/calendar/calendar-month-overview'
import { loadCalendarMonthData } from '@/data/calendar-month'
import type { PBRecord } from '@/data/dashboard'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { buildMonthlyItemComparisons, type MonthlyItemComparisons } from '@/domain/monthly-item-rollup'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/calendar')({
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

function formatSignedMoney(value: number) {
  if (value === 0) return 'No gap'
  return `${value > 0 ? '+' : '-'}${formatInrInteger(Math.abs(value))}`
}

function compactNumber(value: number, suffix: string) {
  if (!(value > 0)) return ''
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)} ${suffix}`
}

function formatWhole(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(value))
}

function formatVsLastMonth(current: number, previous: number, unit = '') {
  const delta = Math.round(current - previous)
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '±'
  const suffix = unit ? ` ${unit}` : ''
  return `vs ${sign}${formatWhole(Math.abs(delta))}${suffix} (${formatWhole(previous)} last month)`
}

function CalendarPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [monthKey, setMonthKey] = useState(() => today.slice(0, 7))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const calendarRef = useRef<HTMLDivElement | null>(null)

  const calendarQuery = useQuery({
    queryKey: ['calendar-month', monthKey],
    queryFn: () => loadCalendarMonthData(monthKey),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
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
      if (next.slice(0, 7) !== monthKey) setMonthKey(next.slice(0, 7))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [monthKey, selectedDay])

  const aggregates = useMemo(() => buildCalendarAggregates(calendarQuery.data, monthKey, today), [calendarQuery.data, monthKey, today])
  const gridWeeks = useMemo(() => {
    const [year, month] = monthKey.split('-').map(Number)
    return chunkWeeks(eachDayInclusive(startOfWeekSunday(new Date(year, month - 1, 1)), endOfWeekSaturday(new Date(year, month, 0))))
  }, [monthKey])

  const topCards = [
    {
      label: 'Month Sales',
      value: formatInrInteger(aggregates.monthSales),
      helper: aggregates.topBuyer ? `${aggregates.topBuyer.customerName} · ${compactNumber(aggregates.topBuyer.bags, 'bags')} · avg ${formatInrInteger(aggregates.topBuyer.avgRate)}` : 'No buyer yet',
      tone: 'text-slate-950',
      icon: ReceiptText,
      chip: 'bg-blue-50 text-blue-700',
    },
    {
      label: 'Collections',
      value: formatInrInteger(aggregates.monthCollections),
      helper: aggregates.topCollection ? `Highest: ${aggregates.topCollection.customerName} · ${formatInrInteger(aggregates.topCollection.amount)}` : 'No collection yet',
      tone: 'text-emerald-700',
      icon: CircleDollarSign,
      chip: 'bg-emerald-50 text-emerald-700',
    },
    {
      label: 'Avg Market Rate',
      value: aggregates.monthAvgMarketRate == null ? '-' : formatInrInteger(aggregates.monthAvgMarketRate),
      helper: aggregates.monthAvgMarketRateVsPrev == null ? 'No last-month rate' : `${aggregates.monthAvgMarketRateVsPrev >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(aggregates.monthAvgMarketRateVsPrev))} vs last month`,
      tone: 'text-blue-700',
      icon: TrendingUp,
      chip: 'bg-sky-50 text-sky-700',
    },
    {
      label: 'Net Position',
      value: formatInrInteger(aggregates.monthCollections - aggregates.monthSales),
      helper: aggregates.monthSales > 0 ? `${Math.round((aggregates.monthCollections / aggregates.monthSales) * 100)}% collected · ${formatSignedMoney(aggregates.monthCollections - aggregates.monthSales)}` : 'No sales base',
      tone: aggregates.monthCollections - aggregates.monthSales >= 0 ? 'text-emerald-700' : 'text-red-700',
      icon: Activity,
      chip: aggregates.monthCollections - aggregates.monthSales >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
    },
    {
      label: 'Sold Bags',
      value: formatWhole(aggregates.monthSoldBags),
      helper: `${formatWhole(aggregates.monthSoldKg)} kg sold from bills`,
      tone: 'text-amber-700',
      icon: PackageCheck,
      chip: 'bg-amber-50 text-amber-700',
    },
  ]

  const selectedSidebarData = selectedDay ? makeDaySidebarData(selectedDay, aggregates) : null

  function selectToday() {
    setMonthKey(today.slice(0, 7))
    setSelectedDay(today)
    window.setTimeout(() => calendarRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0)
  }

  return (
    <div className="w-full px-3 pb-6 pt-3 sm:px-4 lg:px-6">
      <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {topCards.map((card) => <TopKpiCard key={card.label} {...card} />)}
        <ItemSignalsKpi itemComparisons={aggregates.itemComparisons} />
      </section>

      {calendarQuery.isLoading ? <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">Loading calendar...</section> : null}
      {calendarQuery.isError ? <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">Unable to load calendar data.</section> : null}

      {!calendarQuery.isLoading && !calendarQuery.isError ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,7.4fr)_minmax(340px,2.6fr)]">
          <section ref={calendarRef} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Previous month" className={navButtonClass} onClick={() => setMonthKey(shiftMonth(monthKey, -1))}>
                  <ChevronLeft size={17} />
                </button>
                <div className="min-w-0 px-1">
                  <h1 className="mt-0.5 text-xl font-bold leading-tight text-slate-950">{formatMonthYear(monthKey)}</h1>
                </div>
                <button type="button" aria-label="Next month" className={navButtonClass} onClick={() => setMonthKey(shiftMonth(monthKey, 1))}>
                  <ChevronRight size={17} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <button type="button" className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700" onClick={selectToday}>
                  Today
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEKDAYS.map((day) => <div key={day} className="py-2 text-center text-[11px] font-semibold tracking-[0.08em] text-slate-500">{day}</div>)}
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
                    const soldBags = aggregates.dailySoldBags.get(iso) ?? 0
                    const rate = aggregates.rateByDate.get(iso)
                    const hasActivity = sales > 0 || collections > 0 || soldBags > 0 || !!rate
                    const dayBalance = collections - sales
                    const title = `${formatFullDate(iso)}\nRate: ${rate ? formatInrInteger(rate) : '-'}\nCollections: ${formatInrInteger(collections)}\nSales: ${formatInrInteger(sales)}\nSold bags: ${formatWhole(soldBags)}`
                    return (
                      <button
                        key={iso}
                        type="button"
                        title={title}
                        onClick={() => setSelectedDay((current) => (current === iso ? null : iso))}
                        className={`group min-h-[6.2rem] p-1.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 sm:p-2 ${
                          isSelected ? 'bg-blue-50 ring-2 ring-inset ring-blue-500' : hasActivity ? 'bg-white hover:bg-blue-50/50' : 'bg-slate-50/80 hover:bg-white'
                        } ${!inMonth ? 'opacity-45' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-1 text-sm font-bold tabular-nums ${isToday ? 'bg-blue-700 text-white' : isSelected ? 'bg-white text-blue-700' : 'text-slate-900'}`}>{date.getDate()}</span>
                          {hasActivity ? (
                            <span className={`h-1.5 w-1.5 rounded-full ${dayBalance >= 0 ? 'bg-emerald-500' : 'bg-blue-600'}`} />
                          ) : null}
                        </div>
                        <div className="mt-1.5 space-y-1 text-[11px] leading-tight">
                          <MetricLine label="Rate" value={rate ? formatInrInteger(rate) : '-'} tone={rate ? 'text-blue-700' : 'text-slate-300'} />
                          <MetricLine label="Coll" value={collections > 0 ? formatInrInteger(collections) : '-'} tone={collections > 0 ? 'text-emerald-700' : 'text-slate-300'} />
                          <MetricLine label="Sales" value={sales > 0 ? formatInrInteger(sales) : '-'} tone={sales > 0 ? 'text-slate-950 font-bold' : 'text-slate-300'} />
                          <MetricLine label="Bags" value={soldBags > 0 ? formatWhole(soldBags) : '-'} tone={soldBags > 0 ? 'text-amber-700 font-bold' : 'text-slate-300'} />
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
              {selectedSidebarData ? (
                <CalendarDaySidebar data={selectedSidebarData} />
              ) : (
                <CalendarMonthOverview
                  monthKey={monthKey}
                  sales={aggregates.monthSales}
                  collections={aggregates.monthCollections}
                  avgRate={aggregates.monthAvgMarketRate}
                  netPosition={aggregates.monthCollections - aggregates.monthSales}
                  topBuyer={aggregates.topBuyer}
                  topCollection={aggregates.topCollection}
                  rateDelta={aggregates.monthAvgMarketRateVsPrev}
                  itemComparisons={aggregates.itemComparisons}
                  soldBags={aggregates.monthSoldBags}
                  soldKg={aggregates.monthSoldKg}
                />
              )}
            </div>
          </aside>

          {selectedSidebarData ? (
            <div className="fixed inset-x-0 bottom-0 z-[70] max-h-[82dvh] overflow-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl xl:hidden">
              <div className="mb-3 flex justify-end">
                <button type="button" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700" onClick={() => setSelectedDay(null)}>
                  Close
                </button>
              </div>
              <CalendarDaySidebar data={selectedSidebarData} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function TopKpiCard({
  label,
  value,
  helper,
  tone,
  icon: Icon,
  chip,
}: {
  label: string
  value: string
  helper?: string
  tone: string
  icon: LucideIcon
  chip: string
}) {
  return (
    <div className="min-h-[7rem] rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${chip}`}>
          <Icon size={15} />
        </span>
      </div>
      <p className={`truncate font-mono text-lg font-bold leading-tight tabular-nums ${tone}`} title={value}>{value}</p>
      {helper ? <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug text-slate-500" title={helper}>{helper}</p> : null}
    </div>
  )
}

function ItemSignalsKpi({ itemComparisons }: { itemComparisons: MonthlyItemComparisons }) {
  return (
    <div className="min-h-[7rem] rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Item Signals</p>
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
          <PackageCheck size={15} />
        </span>
      </div>
      <div className="space-y-1.5">
        <ItemSignalLine
          label="Spindle"
          value={formatWhole(itemComparisons.spindle.bags)}
          detail={formatVsLastMonth(itemComparisons.spindle.bags, itemComparisons.spindle.previousBags, 'bags')}
        />
        <ItemSignalLine
          label="Tapper Plug"
          value={formatWhole(itemComparisons.tapperPlug.bags)}
          detail={formatVsLastMonth(itemComparisons.tapperPlug.bags, itemComparisons.tapperPlug.previousBags, 'bags')}
        />
        <ItemSignalLine
          label="Tapper Parties"
          value={formatWhole(itemComparisons.tapperPlug.partyCount)}
          detail={formatVsLastMonth(itemComparisons.tapperPlug.partyCount, itemComparisons.tapperPlug.previousPartyCount, 'party')}
        />
      </div>
    </div>
  )
}

function ItemSignalLine({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-lg bg-slate-50 px-2 py-1">
      <p className="truncate text-[11px] font-semibold text-slate-600">{label}</p>
      <p className="font-mono text-sm font-bold leading-tight text-slate-950 tabular-nums">{value}</p>
      <p className="col-span-2 truncate text-[10px] font-medium leading-snug text-slate-500" title={detail}>{detail}</p>
    </div>
  )
}

function MetricLine({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <p className="flex min-w-0 items-center justify-between gap-1">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400">{label}</span>
      <span className={`min-w-0 truncate text-right font-mono tabular-nums ${tone}`}>{value}</span>
    </p>
  )
}

const navButtonClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'

function buildCalendarAggregates(data: Awaited<ReturnType<typeof loadCalendarMonthData>> | undefined, monthKey: string, today: string) {
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
    itemComparisons: {
      spindle: { bags: 0, kg: 0, partyCount: 0, previousBags: 0, previousKg: 0, previousPartyCount: 0 },
      tapperPlug: { bags: 0, kg: 0, partyCount: 0, previousBags: 0, previousKg: 0, previousPartyCount: 0 },
    } as MonthlyItemComparisons,
    topBuyer: null as null | { customerName: string; sales: number; bags: number; qty: number; avgRate: number },
    topCollection: null as null | { customerName: string; amount: number },
  }
  if (!data) return empty

  const clipFutureToToday = monthKey === today.slice(0, 7)
  const customerDisplayById = new Map((data.customersRaw as PBRecord[]).map((row) => [row.id, formatCustomerDisplayName(row.company_name, row.name)]))
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

  return { dailySales, dailyCollections, dailyBillCount, dailySoldBags, dailySoldKg, billsByDate, paymentsByDate, rateByDate, monthSales, monthCollections, monthSoldBags, monthSoldKg, monthAvgMarketRate, monthAvgMarketRateVsPrev: monthAvgMarketRate != null && prevAvgMarketRate != null ? monthAvgMarketRate - prevAvgMarketRate : null, itemComparisons, topBuyer, topCollection }
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
    bills,
    payments,
  }
}
