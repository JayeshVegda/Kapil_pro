export function getLocalIsoDate(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function normalizeDateLike(dateText: string) {
  return dateText.includes(' ') && !dateText.includes('T') ? dateText.replace(' ', 'T') : dateText
}

export function toMonthKey(dateText: string): string {
  return dateText.slice(0, 7)
}

function parseIsoDate(dateText: string): Date | null {
  if (!dateText) return null
  const normalized = normalizeDateLike(dateText)
  const trimmed = normalized.slice(0, 10)
  const parsed = new Date(`${trimmed}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export function formatFullDate(dateText: string): string {
  const parsed = parseIsoDate(dateText)
  if (!parsed) return dateText || '-'
  const day = String(parsed.getDate()).padStart(2, '0')
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const year = parsed.getFullYear()
  return `${day}-${month}-${year}`
}

export function parseDisplayDate(dateText: string): string {
  const trimmed = String(dateText ?? '').trim()
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed)
  if (!match) return ''
  const [, day, month, year] = match
  const iso = `${year}-${month}-${day}`
  const parsed = parseIsoDate(iso)
  if (!parsed) return ''
  if (formatFullDate(iso) !== trimmed) return ''
  return iso
}

const isValidCalendarDay = (year: number, month: number, day: number) => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const probe = new Date(year, month - 1, day)
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day
}

/**
 * Fast day-first date entry for operators:
 *   "13"        -> 13th of the current month
 *   "13-6"      -> 13 June this year
 *   "1-31"      -> 31 January (when the month slot is impossible, day/month swap)
 *   "13-6-25"   -> 13-06-2025
 *   "13-06-2026"-> as written
 * Separators -, /, . and space all work. Returns '' when nothing sensible fits.
 */
export function parseSmartDate(input: string, todayIso = getLocalIsoDate()): string {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) return ''

  const parts = trimmed.split(/[\s/.-]+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 3 || parts.some((part) => !/^\d{1,4}$/.test(part))) return ''

  const today = parseIsoDate(todayIso) ?? new Date()
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth() + 1

  let day = Number(parts[0])
  let month = parts.length >= 2 ? Number(parts[1]) : currentMonth
  let year = parts.length === 3 ? Number(parts[2]) : currentYear
  if (parts.length === 3 && parts[2].length <= 2) year = 2000 + year

  // Day-first is the house convention; when the month slot is impossible but a
  // swap fixes it (e.g. "1-31"), assume the operator typed month-day.
  if (!isValidCalendarDay(year, month, day) && isValidCalendarDay(year, day, month)) {
    ;[day, month] = [month, day]
  }
  if (!isValidCalendarDay(year, month, day)) return ''

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function formatDateTime(dateText: string): string {
  if (!dateText) return '-'
  const parsed = new Date(normalizeDateLike(dateText))
  if (Number.isNaN(parsed.getTime())) return formatFullDate(dateText)
  const day = String(parsed.getDate()).padStart(2, '0')
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const year = parsed.getFullYear()
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${day}-${month}-${year} ${hours}:${minutes}`
}

export function toDateTimeLocalInputValue(dateText: string): string {
  if (!dateText) return ''
  const parsed = new Date(normalizeDateLike(dateText))
  if (Number.isNaN(parsed.getTime())) return dateText.slice(0, 16)
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function toStoredDateTimeValue(input: string): string {
  if (!input) return ''
  if (input.endsWith('Z')) return input
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return `${input}T00:00`
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) return input
  return parsed.toISOString()
}

export function formatMonthYear(input: string): string {
  if (!input) return '-'
  const normalized = input.length >= 7 ? input.slice(0, 7) : input
  const [yearRaw, monthRaw] = normalized.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return input
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthLabel = months[month - 1]
  if (!monthLabel) return input
  return `${monthLabel}-${year}`
}
