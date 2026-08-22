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

/**
 * Rate formatter — preserves up to 2 decimal places so fractional rates like
 * 17.30 (electronic parts) display correctly. Whole-number gas rates like 1592
 * display without decimals. Use this for per-unit rates, never for rupee totals.
 */
const rateNumber = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

export function formatRate(value: number): string {
  const n = Number.isFinite(value) ? value : 0
  return rateNumber.format(n)
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
 * Absolute ceiling for a single money entry — anything above is rejected.
 */
export const MAX_PAYMENT_AMOUNT = 1_50_00_000

type AmountShorthandResult = number

/**
 * Unified money-entry rules (house convention):
 *  - Explicit suffix wins:        45k -> 45,000 · 3.5l -> 3,50,000 · 1c/1cr -> 1,00,00,000
 *  - Decimal value stays exact:   298200.00 -> 298,200 · 250.5 -> 250.50
 *  - Whole number 1-999 = x1000:  350 -> 3,50,000 · 20 -> 20,000 · 999 -> 9,99,000
 *  - Whole number >= 1000 exact:  49852 -> 49,852 · 20000 -> 20,000
 *  - ₹ or thousands-separators make the value literal: ₹350 -> 350
 *  - Results above ₹1.5 crore are rejected (0) so typos fail loudly.
 */
function parseAmountShorthand(raw: string): AmountShorthandResult {
  const original = String(raw ?? '')
  const hasLiteralMarkers = /[₹,]/.test(original)
  const normalized = original
    .trim()
    .toLowerCase()
    .replace(/[₹,\s]/g, '')

  if (!normalized) return 0

  const match = normalized.match(/^(\d+(?:\.\d+)?)(k|thousand|l|lac|lakh|lakhs|c|cr|crore|crores)?$/)
  if (!match) return 0

  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) return 0

  // Literal markers (₹ / separators) always mean "as typed".
  if (hasLiteralMarkers && !match[2]) return Math.round(value * 100) / 100

  if (match[2]) {
    const multiplier =
      match[2] === 'k' || match[2] === 'thousand'
        ? 1_000
        : match[2] === 'c' || match[2] === 'cr' || match[2] === 'crore' || match[2] === 'crores'
          ? 1_00_00_000
          : 1_00_000
    const scaled = Math.round(value * multiplier)
    return scaled <= MAX_PAYMENT_AMOUNT ? scaled : 0
  }

  // Bare numbers: decimals stay exact, small wholes mean thousands, big wholes are literal.
  if (normalized.includes('.')) return Math.round(value * 100) / 100
  if (value >= 1 && value <= 999) {
    const scaled = value * 1_000
    return scaled <= MAX_PAYMENT_AMOUNT ? scaled : 0
  }
  return value
}

/**
 * Payment entry shorthand. See parseAmountShorthand for the full rule set.
 */
export function parseIndianPaymentAmountInput(raw: string): number {
  return parseAmountShorthand(raw)
}

/**
 * Bill quick-payment shorthand. Same rule set as payment entry.
 */
export function parseBillQuickPaymentAmountInput(raw: string): number {
  return parseAmountShorthand(raw)
}
