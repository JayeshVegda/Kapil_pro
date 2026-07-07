/**
 * Indian number grouping without odd spaces (₹1,78,304 not ₹1, 78, 304).
 * Use integer rupees; avoids Intl currency mode inserting narrow spaces.
 */
const inrNumber = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
})

export function formatInrInteger(value: number): string {
  const n = Math.round(Number.isFinite(value) ? value : 0)
  return `₹${inrNumber.format(n)}`
}

const qtyFmt = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

/**
 * Qty / weight (Indian grouping, no currency symbol).
 */
export function formatInQty(value: number, unit = 'kg'): string {
  const n = Number.isFinite(value) ? value : 0
  return `${qtyFmt.format(n)} ${unit}`.trim()
}

/** Digits only → non-negative int. Leading zeros removed via base-10 parse (e.g. 0112 → 112). */
export function parsePositiveIntInput(raw: string): number {
  const digits = String(raw).replace(/\D/g, '')
  if (digits === '') return 0
  const n = parseInt(digits, 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

/** Number-like input into non-negative finite value (fallback 0). */
export function parseNonNegativeNumber(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

/**
 * Payment entry shorthand for Indian operators.
 * Bare numbers are treated as lakhs: "2" -> 2,00,000 and "142" -> 1,42,00,000.
 */
export function parseIndianPaymentAmountInput(raw: string): number {
  const original = String(raw ?? '')
  const hasRupeeFormatting = /[₹,]/.test(original)
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[₹,\s]/g, '')

  if (!normalized) return 0

  const match = normalized.match(/^(\d+(?:\.\d+)?)(k|thousand|l|lac|lakh|lakhs|c|cr|crore|crores)?$/)
  if (!match) return 0

  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) return 0

  if (hasRupeeFormatting && !match[2]) return Math.round(value)

  const unit = match[2] ?? 'lakh'
  const multiplier =
    unit === 'k' || unit === 'thousand'
      ? 1_000
      : unit === 'c' || unit === 'cr' || unit === 'crore' || unit === 'crores'
        ? 1_00_00_000
        : 1_00_000

  return Math.round(value * multiplier)
}

/**
 * Bill quick-payment shorthand.
 * Bare numbers are treated as thousands: "190" -> 1,90,000 and "1900" -> 19,00,000.
 */
export function parseBillQuickPaymentAmountInput(raw: string): number {
  const original = String(raw ?? '')
  const hasRupeeFormatting = /[₹,]/.test(original)
  const normalized = original
    .trim()
    .toLowerCase()
    .replace(/[₹,\s]/g, '')

  if (!normalized) return 0

  const match = normalized.match(/^(\d+(?:\.\d+)?)(k|thousand|l|lac|lakh|lakhs|c|cr|crore|crores)?$/)
  if (!match) return 0

  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) return 0
  if (hasRupeeFormatting && !match[2]) return Math.round(value)

  const unit = match[2] ?? 'k'
  const multiplier =
    unit === 'k' || unit === 'thousand'
      ? 1_000
      : unit === 'c' || unit === 'cr' || unit === 'crore' || unit === 'crores'
        ? 1_00_00_000
        : 1_00_000

  return Math.round(value * multiplier)
}
