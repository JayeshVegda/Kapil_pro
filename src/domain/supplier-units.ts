/**
 * Supplier Purchase integer units. Phase 1 core math — NO floats survive any
 * boundary in this module, and no strings leave it except display helpers.
 *
 * Unit conventions (spec, 2026-11-03):
 * - Weight      = integer GRAMS          (3-decimal kg). 400.000 kg  = 400_000
 * - Money       = integer PAISE          ₹352,000.00  = 35_200_000_00? no —
 *                 1 rupee = 100 paise, so ₹3,52,000 = 35_200_000
 * - Rate        = integer MILLI-RUPEES per kg (3-decimal rupees/kg).
 *                 ₹880.000/kg = 880_000
 * - GST rate    = integer BASIS POINTS. 18% = 1800
 *
 * Line amount (both KB doubles and mega scale stay inside 2^53):
 *   amount_paise = roundHalfUp(weight_g * rate_milli / 10000)
 * Check: 400_000 g x 880_000 m₹/kg = 35_200_000_000 / 10_000 = 35_200_000 paise.
 */

/** Round half away from zero on integer-safe magnitudes (max ~9e15). */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (!Number.isInteger(value)) {
    // Guard: inputs are expected to already be integers. Non-integers appear
    // only from caller errors, snap them deterministically instead of drifting.
    value = value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5)
  }
  return value
}

/** Exact integer half-up division of an integer numerator by 10000. */
function divideBy10000HalfUp(numerator: number): number {
  const sign = numerator < 0 ? -1 : 1
  const abs = numerator < 0 ? -numerator : numerator
  return sign * Math.floor((abs + 5_000) / 10_000)
}

/** kg (decimal, up to 3 dp) -> integer grams. */
export function kgToGrams(kg: number): number {
  const n = Number(kg ?? 0)
  if (!Number.isFinite(n)) return 0
  // kg with up to 3 decimals scales exactly-ish to grams; roundHalfUp
  // removes the last-binary-fraction noise (e.g. 0.034 * 1000 = 33.99999999).
  return n < 0 ? -Math.floor(-n * 1_000 + 0.5) : Math.floor(n * 1_000 + 0.5)
}

/** rupees (decimal) -> integer paise. */
export function rupeesToPaise(rupees: number): number {
  const n = Number(rupees ?? 0)
  if (!Number.isFinite(n)) return 0
  return n < 0 ? -Math.floor(-n * 100 + 0.5) : Math.floor(n * 100 + 0.5)
}

/** rate in rupees/kg -> integer milli-rupees (3-decimal rupees/kg). */
export function rateToMilli(rateRupeesPerKg: number): number {
  const n = Number(rateRupeesPerKg ?? 0)
  if (!Number.isFinite(n)) return 0
  return n < 0 ? -Math.floor(-n * 1_000 + 0.5) : Math.floor(n * 1_000 + 0.5)
}

/** gst % (e.g. 18) -> basis points (1800). */
export function percentToBasisPoints(percent: number): number {
  const n = Number(percent ?? 0)
  if (!Number.isFinite(n)) return 0
  return n < 0 ? -Math.floor(-n * 100 + 0.5) : Math.floor(n * 100 + 0.5)
}

/** Line amount: roundHalfUp(weight_g * rate_milli / 10000). Always an integer paise value. */
export function lineAmountPaise(weightGrams: number, rateMilli: number): number {
  const w = Math.trunc(Number(weightGrams ?? 0)) || 0
  const r = Math.trunc(Number(rateMilli ?? 0)) || 0
  return divideBy10000HalfUp(w * r)
}

/** Lines total helper — plain integer sum, nothing rounding here. */
export function sumPaise(values: number[]): number {
  let total = 0
  for (const value of values) total += Math.trunc(Number(value) || 0)
  return total
}

/** Basis-point proportion: roundHalfUp(valuePaise * bp / 10000). */
export function applyBasisPoints(valuePaise: number, basisPoints: number): number {
  const v = Math.trunc(Number(valuePaise ?? 0))
  const bp = Math.trunc(Number(basisPoints ?? 0))
  return divideBy10000HalfUp(v * bp)
}

/** Display: grams -> "400.000" (3-decimal kg). */
export function gramsToKgText(grams: number): string {
  const g = Math.trunc(Number(grams ?? 0)) || 0
  const sign = g < 0 ? '-' : ''
  const abs = Math.abs(g)
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`
}

/** Display: paise -> "352000.00" (2-decimal rupees, Indian plain, no grouping). */
export function paiseToRupeesText(paise: number): string {
  const p = Math.trunc(Number(paise ?? 0)) || 0
  const sign = p < 0 ? '-' : ''
  const abs = Math.abs(p)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Display: milli-rupees -> "880.000". */
export function milliToRateText(milli: number): string {
  const m = Math.trunc(Number(milli ?? 0)) || 0
  const sign = m < 0 ? '-' : ''
  const abs = Math.abs(m)
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`
}
