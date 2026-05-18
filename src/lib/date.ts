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
