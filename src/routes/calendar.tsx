import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { loadCalendarMonthData } from '@/data/calendar-month'
import type { PBRecord } from '@/data/dashboard'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/calendar')({
  component: CalendarPage,
})

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function str(value: unknown) {
  return String(value ?? '')
}

function shiftMonth(monthKey: string, delta: number) {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey
  const d = new Date(year, month - 1 + delta, 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
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
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7))
  }
  return weeks
}

type DayBill = {
  id: string
  bookNo: number
  billNo: number
  /** Display ref; prefers PocketBase bill_ref when set. */
  billRefDisplay: string
  customerId: string
  customerName: string
  total: number
}

type DayPayment = {
  id: string
  customerId: string
  customerName: string
  amount: number
  mode: string
  note: string
}

function sortDayBills(a: DayBill, b: DayBill) {
  if (a.bookNo !== b.bookNo) return a.bookNo - b.bookNo
  return a.billNo - b.billNo
}

/** Matches new-bill / printed ref style when bill_ref is missing. */
function formatBillRefFallback(bookNo: number, billNo: number) {
  return `${String(bookNo).padStart(3, '0')}/${String(billNo).padStart(3, '0')}`
}

function billsRefDisplay(pbRef: unknown, bookNo: number, billNo: number) {
  const raw = str(pbRef).trim()
  if (raw.length > 0) return raw
  return formatBillRefFallback(bookNo, billNo)
}

function CalendarPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [monthKey, setMonthKey] = useState(() => today.slice(0, 7))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [showSales, setShowSales] = useState(true)
  const [showCollections, setShowCollections] = useState(true)
  const [showMarket, setShowMarket] = useState(true)

  const calendarQuery = useQuery({
    queryKey: ['calendar-month', monthKey],
    queryFn: () => loadCalendarMonthData(monthKey),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })

  useEffect(() => {
    setSelectedDay(null)
  }, [monthKey])

  const aggregates = useMemo(() => {
    const data = calendarQuery.data
    const clipFutureToToday = monthKey === today.slice(0, 7)
    if (!data) {
      return {
        dailySales: new Map<string, number>(),
        dailyCollections: new Map<string, number>(),
        dailyBillCount: new Map<string, number>(),
        billsByDate: new Map<string, DayBill[]>(),
        paymentsByDate: new Map<string, DayPayment[]>(),
        rateByDate: new Map<string, number>(),
        monthSales: 0,
        monthCollections: 0,
        monthBillCount: 0,
        monthAvgMarketRate: null as number | null,
        monthAvgMarketRateDays: 0,
        marketRateVsPrev: null as number | null,
      }
    }

    const { billsRaw, billItemsRaw, paymentsRaw, ratesRaw, prevRatesRaw, rangeStart: rs, rangeEnd: re } = data
    const itemSumByBill = new Map<string, number>()
    for (const item of billItemsRaw as PBRecord[]) {
      const billId = str(item.bill)
      itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(item.amount))
    }

    const dailySales = new Map<string, number>()
    const dailyBillCount = new Map<string, number>()
    const billsByDate = new Map<string, DayBill[]>()

    for (const bill of billsRaw as PBRecord[]) {
      const billDate = str(bill.date).slice(0, 10)
      if (!billDate) continue
      if (clipFutureToToday && billDate > today) continue
      if (billDate < rs || billDate > re) continue
      const base = itemSumByBill.get(bill.id) ?? 0
      const total = calculateBillTotalFromBase(base, num(bill.transport), num(bill.gst_rate))
      dailySales.set(billDate, (dailySales.get(billDate) ?? 0) + total)
      dailyBillCount.set(billDate, (dailyBillCount.get(billDate) ?? 0) + 1)
      const bookNoVal = num(bill.book_no)
      const billNoVal = num(bill.bill_no)
      const row: DayBill = {
        id: bill.id,
        bookNo: bookNoVal,
        billNo: billNoVal,
        billRefDisplay: billsRefDisplay(bill.bill_ref, bookNoVal, billNoVal),
        customerId: str(bill.customer),
        customerName: str(bill.customer_name),
        total,
      }
      const list = billsByDate.get(billDate) ?? []
      list.push(row)
      billsByDate.set(billDate, list)
    }

    const dailyCollections = new Map<string, number>()
    const paymentsByDate = new Map<string, DayPayment[]>()
    for (const payment of paymentsRaw as PBRecord[]) {
      const paymentDate = str(payment.date).slice(0, 10)
      if (!paymentDate) continue
      if (clipFutureToToday && paymentDate > today) continue
      if (paymentDate < rs || paymentDate > re) continue
      const amount = num(payment.amount)
      dailyCollections.set(paymentDate, (dailyCollections.get(paymentDate) ?? 0) + amount)
      const row: DayPayment = {
        id: payment.id,
        customerId: str(payment.customer),
        customerName: str(payment.customer_name),
        amount,
        mode: str(payment.mode),
        note: str(payment.note),
      }
      const list = paymentsByDate.get(paymentDate) ?? []
      list.push(row)
      paymentsByDate.set(paymentDate, list)
    }

    const rateByDate = new Map<string, number>()
    for (const r of ratesRaw) {
      const day = str(r.date).slice(0, 10)
      const v = num(r.vilaity)
      if (day && v > 0) rateByDate.set(day, v)
    }

    let monthSales = 0
    let monthCollections = 0
    let monthBillCount = 0
    for (const v of dailySales.values()) monthSales += v
    for (const v of dailyCollections.values()) monthCollections += v
    for (const v of dailyBillCount.values()) monthBillCount += v

    const thisMonthRates = (ratesRaw as PBRecord[])
      .map((r) => num(r.vilaity))
      .filter((v) => v > 0)
    const monthAvgMarketRate =
      thisMonthRates.length > 0 ? thisMonthRates.reduce((a, b) => a + b, 0) / thisMonthRates.length : null
    const monthAvgMarketRateDays = thisMonthRates.length

    const prevRates = (prevRatesRaw as PBRecord[])
      .map((r) => num(r.vilaity))
      .filter((v) => v > 0)
    const prevAvg = prevRates.length > 0 ? prevRates.reduce((a, b) => a + b, 0) / prevRates.length : null
    const marketRateVsPrev =
      monthAvgMarketRate != null && prevAvg != null ? monthAvgMarketRate - prevAvg : null

    return {
      dailySales,
      dailyCollections,
      dailyBillCount,
      billsByDate,
      paymentsByDate,
      rateByDate,
      monthSales,
      monthCollections,
      monthBillCount,
      monthAvgMarketRate,
      monthAvgMarketRateDays,
      marketRateVsPrev,
    }
  }, [calendarQuery.data, monthKey, today])

  const gridWeeks = useMemo(() => {
    const [y, m] = monthKey.split('-').map(Number)
    const firstOfMonth = new Date(y, m - 1, 1)
    const lastOfMonth = new Date(y, m, 0)
    const gridStart = startOfWeekSunday(firstOfMonth)
    const gridEnd = endOfWeekSaturday(lastOfMonth)
    const days = eachDayInclusive(gridStart, gridEnd)
    return chunkWeeks(days)
  }, [monthKey])

  const maxSalesInMonth = useMemo(() => {
    let max = 0
    for (const v of aggregates.dailySales.values()) {
      if (v > max) max = v
    }
    return max
  }, [aggregates.dailySales])

  const selectedBills = useMemo(() => {
    if (!selectedDay) return []
    return [...(aggregates.billsByDate.get(selectedDay) ?? [])].sort(sortDayBills)
  }, [aggregates.billsByDate, selectedDay])

  const selectedPayments = useMemo(() => {
    if (!selectedDay) return []
    const list = aggregates.paymentsByDate.get(selectedDay) ?? []
    return [...list].sort((a, b) => {
      const nameCmp = a.customerName.localeCompare(b.customerName, undefined, { sensitivity: 'base' })
      if (nameCmp !== 0) return nameCmp
      return b.amount - a.amount
    })
  }, [aggregates.paymentsByDate, selectedDay])

  const selectedDaySales = selectedDay ? aggregates.dailySales.get(selectedDay) ?? 0 : 0
  const selectedDayCollections = selectedDay ? aggregates.dailyCollections.get(selectedDay) ?? 0 : 0
  const selectedDayRate = selectedDay ? aggregates.rateByDate.get(selectedDay) : undefined

  return (
    <div className="w-full space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            <LayerToggle
              label="Sales"
              active={showSales}
              onToggle={() => setShowSales((v) => !v)}
              accent="blue"
            />
            <LayerToggle
              label="Collections"
              active={showCollections}
              onToggle={() => setShowCollections((v) => !v)}
              accent="emerald"
            />
            <LayerToggle label="Market rate" active={showMarket} onToggle={() => setShowMarket((v) => !v)} accent="amber" />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-0.5 sm:justify-end">
            <button
              type="button"
              aria-label="Previous month"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              onClick={() => setMonthKey(shiftMonth(monthKey, -1))}
            >
              <ChevronLeft size={17} />
            </button>
            <div className="min-w-[9.5rem] px-1.5 text-center">
              <p className="text-sm font-semibold tabular-nums text-slate-900">{formatMonthYear(monthKey)}</p>
              {monthKey === today.slice(0, 7) && <p className="text-[10px] leading-tight text-slate-500">This month</p>}
            </div>
            <button
              type="button"
              aria-label="Next month"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              onClick={() => setMonthKey(shiftMonth(monthKey, 1))}
            >
              <ChevronRight size={17} />
            </button>
            <button
              type="button"
              className="ml-0.5 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
              onClick={() => setMonthKey(today.slice(0, 7))}
            >
              Today
            </button>
          </div>
        </div>
      </section>

      {calendarQuery.isLoading && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">Loading calendar…</section>
      )}
      {calendarQuery.isError && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">Unable to load calendar data.</section>
      )}

      {!calendarQuery.isLoading && !calendarQuery.isError && (
        <>
          <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100 sm:p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Month sales</p>
              <p className="mt-1.5 font-mono text-lg font-semibold text-blue-800 tabular-nums">{formatInrInteger(aggregates.monthSales)}</p>
              <p className="mt-0.5 text-xs text-slate-500">{aggregates.monthBillCount} bills in view</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100 sm:p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Month collections</p>
              <p className="mt-1.5 font-mono text-lg font-semibold text-emerald-800 tabular-nums">{formatInrInteger(aggregates.monthCollections)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100 sm:p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Avg market rate</p>
              <p className="mt-0.5 text-[11px] font-normal text-slate-400">Mean of saved daily rates · this month</p>
              {aggregates.monthAvgMarketRate != null ? (
                <>
                  <p className="mt-1.5 font-mono text-lg font-semibold text-amber-900 tabular-nums">
                    {formatInrInteger(Math.round(aggregates.monthAvgMarketRate))}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {aggregates.monthAvgMarketRateDays} day{aggregates.monthAvgMarketRateDays !== 1 ? 's' : ''} with rate
                  </p>
                  {aggregates.marketRateVsPrev != null ? (
                    <p className="mt-1 text-xs text-slate-600">
                      <span
                        className={
                          aggregates.marketRateVsPrev >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-800'
                        }
                      >
                        {aggregates.marketRateVsPrev >= 0 ? '+' : '−'}
                        {formatInrInteger(Math.round(Math.abs(aggregates.marketRateVsPrev)))}
                      </span>
                      <span className="text-slate-400"> vs last month</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-400">No last month rate data</p>
                  )}
                </>
              ) : (
                <p className="mt-1.5 text-sm text-slate-500">No rates this month</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100 sm:p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Net position</p>
              <p className="mt-0.5 text-[11px] font-normal text-slate-400">Collections − sales · this month</p>
              <p
                className={`mt-1.5 font-mono text-lg font-semibold tabular-nums ${
                  aggregates.monthCollections - aggregates.monthSales >= 0 ? 'text-emerald-800' : 'text-amber-800'
                }`}
              >
                {formatInrInteger(aggregates.monthCollections - aggregates.monthSales)}
              </p>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-200 p-px shadow-sm">
            <div className="grid grid-cols-7 gap-px bg-slate-200">
              {WEEKDAYS.map((d) => (
                <div key={d} className="bg-slate-50 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {d}
                </div>
              ))}
            </div>
            {gridWeeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-px bg-slate-200">
                {week.map((date) => {
                  const iso = toIsoDate(date)
                  const inMonth = iso.slice(0, 7) === monthKey
                  const isToday = iso === today
                  const sales = aggregates.dailySales.get(iso) ?? 0
                  const col = aggregates.dailyCollections.get(iso) ?? 0
                  const billsN = aggregates.dailyBillCount.get(iso) ?? 0
                  const rate = aggregates.rateByDate.get(iso)
                  const intensity = maxSalesInMonth > 0 ? Math.min(1, sales / maxSalesInMonth) : 0
                  const hasActivity = sales > 0 || col > 0

                  let cellBg = 'bg-white'
                  if (hasActivity && sales > 0 && showSales) {
                    cellBg = intensity > 0.66 ? 'bg-blue-100' : intensity > 0.33 ? 'bg-blue-50' : 'bg-blue-50/60'
                  } else if (hasActivity && sales > 0 && !showSales) {
                    cellBg = 'bg-blue-50/55'
                  } else if (hasActivity && col > 0 && sales === 0) {
                    cellBg = 'bg-emerald-50/65'
                  } else if (showMarket && (rate ?? 0) > 0 && !hasActivity && inMonth) {
                    cellBg = 'bg-amber-50/45'
                  }

                  const isSelected = selectedDay === iso
                  const showRateInCell = showMarket && rate != null && rate > 0

                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => setSelectedDay(iso)}
                      className={`flex min-h-[6.75rem] flex-col p-1.5 text-left transition-colors hover:brightness-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 sm:min-h-[7rem] sm:p-2 ${cellBg} ${
                        !inMonth ? 'opacity-50' : ''
                      } ${isSelected ? 'z-[1] ring-2 ring-inset ring-blue-600' : ''}`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                          isToday
                            ? 'bg-blue-600 text-white shadow-sm'
                            : isSelected && !isToday
                              ? 'bg-slate-200 text-slate-800 ring-1 ring-slate-300'
                              : inMonth
                                ? 'text-slate-800'
                                : 'text-slate-400'
                        }`}
                      >
                        {date.getDate()}
                      </span>
                      <div className="mt-0.5 flex min-h-0 flex-1 flex-col gap-0.5 text-[10px] leading-tight">
                        {showRateInCell && (
                          <span className="line-clamp-1 font-mono font-semibold text-amber-700" title={`Mkt rate ${formatInrInteger(rate)}`}>
                            Rate {formatInrInteger(rate)}
                          </span>
                        )}
                        {showSales && sales > 0 && (
                          <span
                            className="line-clamp-2 font-mono font-semibold text-blue-700"
                            title={`Sales ${formatInrInteger(sales)}`}
                          >
                            Sales {formatInrInteger(sales)}
                          </span>
                        )}
                        {showSales && sales > 0 && billsN > 0 && (
                          <span className="text-[10px] font-normal text-blue-700/65">
                            {billsN} bill{billsN !== 1 ? 's' : ''}
                          </span>
                        )}
                        {showCollections && col > 0 && (
                          <span
                            className="line-clamp-2 font-mono font-semibold text-emerald-700"
                            title={`Collections ${formatInrInteger(col)}`}
                          >
                            Coll. {formatInrInteger(col)}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <div className="flex flex-col gap-2 border-b border-slate-100 pb-2.5 sm:flex-row sm:items-end sm:justify-between sm:pb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 sm:text-base">{selectedDay ? formatFullDate(selectedDay) : 'Day detail'}</h2>
                {!selectedDay && <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">Choose a date in the grid.</p>}
              </div>
              {selectedDay && (
                <div className="flex flex-wrap gap-1.5">
                  <DayChip
                    label="Mkt rate"
                    value={selectedDayRate != null && selectedDayRate > 0 ? formatInrInteger(selectedDayRate) : '—'}
                    className="border-amber-200 bg-amber-50 text-amber-950"
                  />
                  <DayChip label="Sales" value={formatInrInteger(selectedDaySales)} className="border-blue-200 bg-blue-50 text-blue-900" />
                  <DayChip label="Collections" value={formatInrInteger(selectedDayCollections)} className="border-emerald-200 bg-emerald-50 text-emerald-900" />
                </div>
              )}
            </div>

            {selectedDay && (
              <div className="mt-3 grid gap-4 lg:grid-cols-2 lg:gap-6">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Bills ({selectedBills.length})</p>
                  {selectedBills.length === 0 && <p className="mt-2 text-sm text-slate-500">No bills on this date.</p>}
                  <ul className="mt-3 space-y-2">
                    {selectedBills.map((b) => (
                      <li key={b.id} className="group flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/90 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{b.customerName}</p>
                          <p className="font-mono text-xs text-slate-600">
                            {b.billRefDisplay} · {formatInrInteger(b.total)}
                          </p>
                        </div>
                        <Link
                          to="/ledger"
                          search={{ customerId: b.customerId, focus: '' }}
                          className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 opacity-100 transition-opacity hover:bg-slate-100 focus-visible:opacity-100 sm:pointer-events-auto sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                        >
                          Ledger
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Payments ({selectedPayments.length})</p>
                  {selectedPayments.length === 0 && <p className="mt-2 text-sm text-slate-500">No payments on this date.</p>}
                  <ul className="mt-3 space-y-2">
                    {selectedPayments.map((p) => (
                      <li key={p.id} className="group flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/90 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{p.customerName}</p>
                          <p className="font-mono text-xs text-emerald-800">{formatInrInteger(p.amount)}</p>
                          {(p.mode || p.note) && (
                            <p className="truncate text-[11px] text-slate-500">
                              {p.mode}
                              {p.mode && p.note ? ' · ' : ''}
                              {p.note}
                            </p>
                          )}
                        </div>
                        <Link
                          to="/ledger"
                          search={{ customerId: p.customerId, focus: '' }}
                          className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 opacity-100 transition-opacity hover:bg-slate-100 focus-visible:opacity-100 sm:pointer-events-auto sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                        >
                          Ledger
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function DayChip({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 text-left ${className}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="font-mono text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

const layerAccent = {
  blue: {
    on: 'border-blue-400 bg-blue-50 text-blue-950 shadow-sm',
    dot: 'bg-blue-500',
    offDot: 'bg-slate-300',
  },
  emerald: {
    on: 'border-emerald-400 bg-emerald-50 text-emerald-950 shadow-sm',
    dot: 'bg-emerald-500',
    offDot: 'bg-slate-300',
  },
  amber: {
    on: 'border-amber-400 bg-amber-50 text-amber-950 shadow-sm',
    dot: 'bg-amber-500',
    offDot: 'bg-slate-300',
  },
} as const

function LayerToggle({
  label,
  active,
  onToggle,
  accent,
}: {
  label: string
  active: boolean
  onToggle: () => void
  accent: keyof typeof layerAccent
}) {
  const p = layerAccent[accent]
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={`${label} layer ${active ? 'on' : 'off'}`}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
        active
          ? p.on
          : 'border border-dashed border-slate-200 bg-white text-slate-400 opacity-70 shadow-none saturate-50 hover:opacity-100 hover:saturate-100'
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full shadow-sm transition-all ${active ? p.dot + ' opacity-100' : p.offDot + ' opacity-45'}`} aria-hidden />
      <span>{label}</span>
    </button>
  )
}
