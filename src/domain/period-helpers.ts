export type PeriodMode = 'month' | 'last_month' | 'last_30_days' | 'fy'

export type PeriodRange = {
  mode: PeriodMode
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  asOfDate: string // YYYY-MM-DD
  daysElapsed: number
  totalDaysInPeriod: number
  isPartial: boolean
  label: string
}

export type PreviousPeriodResult = PeriodRange & {
  comparisonNote: string
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function deltaPct(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous <= 0 || !Number.isFinite(previous) || !Number.isFinite(current)) {
    return null
  }
  return ((current - previous) / previous) * 100
}

export function getFiscalYearStart(asOfDate: string): string {
  const [yearRaw, monthRaw] = asOfDate.split('-').map(Number)
  const year = Number.isFinite(yearRaw) ? yearRaw : 2026
  const month = Number.isFinite(monthRaw) ? monthRaw : 4
  const fyStartYear = month >= 4 ? year : year - 1
  return `${fyStartYear}-04-01`
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function diffDays(fromIso: string, toIso: string): number {
  const fromMs = new Date(`${fromIso}T00:00:00Z`).getTime()
  const toMs = new Date(`${toIso}T00:00:00Z`).getTime()
  return Math.max(0, Math.floor((toMs - fromMs) / (1000 * 60 * 60 * 24)))
}

export function buildPeriodRange(mode: PeriodMode, selectedMonth?: string, asOfDate?: string): PeriodRange {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10)
  const currentMonth = today.slice(0, 7)
  const activeMonth = selectedMonth ?? currentMonth

  if (mode === 'month') {
    const [y, m] = activeMonth.split('-').map(Number)
    const totalDays = daysInMonth(y, m)
    const isCurrent = activeMonth === currentMonth
    const currentDay = Number(today.slice(8, 10))
    const daysElapsed = isCurrent ? Math.min(currentDay, totalDays) : totalDays
    const isPartial = isCurrent && daysElapsed < totalDays
    const to = `${activeMonth}-${pad2(daysElapsed)}`
    const monthName = MONTH_NAMES[m - 1] ?? activeMonth

    return {
      mode,
      from: `${activeMonth}-01`,
      to,
      asOfDate: today,
      daysElapsed,
      totalDaysInPeriod: totalDays,
      isPartial,
      label: `${monthName} ${y}`,
    }
  }

  if (mode === 'last_month') {
    const prevKey = shiftMonthKey(today.slice(0, 7), -1)
    const [y, m] = prevKey.split('-').map(Number)
    const totalDays = daysInMonth(y, m)
    const monthName = MONTH_NAMES[m - 1] ?? prevKey

    return {
      mode,
      from: `${prevKey}-01`,
      to: `${prevKey}-${pad2(totalDays)}`,
      asOfDate: today,
      daysElapsed: totalDays,
      totalDaysInPeriod: totalDays,
      isPartial: false,
      label: `${monthName} ${y}`,
    }
  }

  if (mode === 'last_30_days') {
    const from = addDays(today, -29)
    return {
      mode,
      from,
      to: today,
      asOfDate: today,
      daysElapsed: 30,
      totalDaysInPeriod: 30,
      isPartial: false,
      label: 'Last 30 Days',
    }
  }

  // mode === 'fy'
  const fyStart = getFiscalYearStart(today)
  const fyStartYear = Number(fyStart.slice(0, 4))
  const fyEndYear = fyStartYear + 1
  const daysElapsed = diffDays(fyStart, today) + 1

  return {
    mode,
    from: fyStart,
    to: today,
    asOfDate: today,
    daysElapsed,
    totalDaysInPeriod: 365,
    isPartial: true,
    label: `FY ${fyStartYear}–${String(fyEndYear).slice(-2)}`,
  }
}

export function previousPeriod(range: PeriodRange): PreviousPeriodResult {
  if (range.mode === 'month') {
    const activeMonth = range.from.slice(0, 7)
    const prevMonthKey = shiftMonthKey(activeMonth, -1)
    const [prevY, prevM] = prevMonthKey.split('-').map(Number)
    const prevMonthDays = daysInMonth(prevY, prevM)
    const prevMonthName = MONTH_NAMES[prevM - 1] ?? prevMonthKey

    if (range.isPartial) {
      // Day 9 vs Day 9 rule (clamped to prev month last day)
      const clampedDays = Math.min(range.daysElapsed, prevMonthDays)
      const to = `${prevMonthKey}-${pad2(clampedDays)}`
      return {
        mode: 'month',
        from: `${prevMonthKey}-01`,
        to,
        asOfDate: range.asOfDate,
        daysElapsed: clampedDays,
        totalDaysInPeriod: prevMonthDays,
        isPartial: true,
        label: `${prevMonthName} ${prevY}`,
        comparisonNote: `vs same ${range.daysElapsed} days of ${prevMonthName}`,
      }
    }

    // Full month
    return {
      mode: 'month',
      from: `${prevMonthKey}-01`,
      to: `${prevMonthKey}-${pad2(prevMonthDays)}`,
      asOfDate: range.asOfDate,
      daysElapsed: prevMonthDays,
      totalDaysInPeriod: prevMonthDays,
      isPartial: false,
      label: `${prevMonthName} ${prevY}`,
      comparisonNote: `vs ${prevMonthName} ${prevY}`,
    }
  }

  if (range.mode === 'last_month') {
    const activeMonth = range.from.slice(0, 7)
    const twoMonthsAgoKey = shiftMonthKey(activeMonth, -1)
    const [y, m] = twoMonthsAgoKey.split('-').map(Number)
    const totalDays = daysInMonth(y, m)
    const name = MONTH_NAMES[m - 1] ?? twoMonthsAgoKey

    return {
      mode: 'last_month',
      from: `${twoMonthsAgoKey}-01`,
      to: `${twoMonthsAgoKey}-${pad2(totalDays)}`,
      asOfDate: range.asOfDate,
      daysElapsed: totalDays,
      totalDaysInPeriod: totalDays,
      isPartial: false,
      label: `${name} ${y}`,
      comparisonNote: `vs ${name} ${y}`,
    }
  }

  if (range.mode === 'last_30_days') {
    const to = addDays(range.from, -1)
    const from = addDays(to, -29)
    return {
      mode: 'last_30_days',
      from,
      to,
      asOfDate: range.asOfDate,
      daysElapsed: 30,
      totalDaysInPeriod: 30,
      isPartial: false,
      label: 'Previous 30 Days',
      comparisonNote: 'vs previous 30 days',
    }
  }

  // mode === 'fy'
  const currentFyStartYear = Number(range.from.slice(0, 4))
  const prevFyStartYear = currentFyStartYear - 1
  const prevFyStart = `${prevFyStartYear}-04-01`
  // Map range.to to previous year, handling leap day 02-29
  const [toY, toM, toD] = range.to.split('-').map(Number)
  const prevToY = toY - 1
  const maxDaysInPrevMonth = daysInMonth(prevToY, toM)
  const clampedToD = Math.min(toD, maxDaysInPrevMonth)
  const prevTo = `${prevToY}-${pad2(toM)}-${pad2(clampedToD)}`
  const prevDays = diffDays(prevFyStart, prevTo) + 1

  return {
    mode: 'fy',
    from: prevFyStart,
    to: prevTo,
    asOfDate: range.asOfDate,
    daysElapsed: prevDays,
    totalDaysInPeriod: 365,
    isPartial: true,
    label: `FY ${prevFyStartYear}–${String(currentFyStartYear).slice(-2)}`,
    comparisonNote: 'vs same period last FY',
  }
}
