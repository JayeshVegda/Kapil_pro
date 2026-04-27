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
