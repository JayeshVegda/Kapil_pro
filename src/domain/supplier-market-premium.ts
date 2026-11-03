/**
 * Bardan market premium. Pure domain - the caller (data layer) preloads the
 * Jamnagar vilaity history that the brass_rates collection feeds.
 *
 * premium_paise = roundHalfUp(weight_g * (bardan_rate_milli - vilaity_milli) / 10000)
 *
 * Lookup rule (spec): use the vilaity for the bardan's own date; if that day
 * has no row, fall back to the nearest EARLIER day (never a later day). When
 * the history has no day at or before the entry's date the premium cannot be
 * computed and the row is reported with a null rate.
 */

export type VilaityEntry = { date: string; vilaityMilli: number }

export type BardanPremiumRowInput = {
  bardanId: string
  date: string
  rateMilli: number
  weightG: number
}

export type BardanPremiumRow = {
  bardanId: string
  date: string
  vilaityMilli: number | null
  rateDeltaMilli: number | null
  premiumPaise: number | null
}

export type BardanPremiumResult = {
  rows: BardanPremiumRow[]
  totalPremiumPaise: number
}

/** Builds the date -> vilaity lookup: exact day, else nearest earlier day. */
export function makeVilaityLookup(history: readonly VilaityEntry[]): (yyyymmdd: string) => number | null {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const dates = sorted.map((entry) => entry.date)
  return (yyyymmdd: string) => {
    // binary search for the last date <= yyyymmdd
    let low = 0
    let high = sorted.length - 1
    let found: number | null = null
    while (low <= high) {
      const mid = (low + high) >> 1
      if (dates[mid] <= yyyymmdd) {
        found = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return found == null ? null : sorted[found].vilaityMilli
  }
}

/** Signed integer half-up division by 10000 (premium deltas can be negative). */
function signedMilliToPaise(weightG: number, deltaMilli: number): number {
  const product = weightG * deltaMilli
  const sign = product < 0 ? -1 : 1
  const abs = product < 0 ? -product : product
  return sign * Math.floor((abs + 5_000) / 10_000)
}

export function computeBardanPremium(
  rows: readonly BardanPremiumRowInput[],
  history: readonly VilaityEntry[],
): BardanPremiumResult {
  const lookup = makeVilaityLookup(history)
  let total = 0
  const outRows: BardanPremiumRow[] = rows.map((row) => {
    const vilaityMilli = lookup(row.date)
    const rateDeltaMilli = vilaityMilli == null ? null : row.rateMilli - vilaityMilli
    const premiumPaise = rateDeltaMilli == null ? null : signedMilliToPaise(row.weightG, rateDeltaMilli)
    total += premiumPaise ?? 0
    return {
      bardanId: row.bardanId,
      date: row.date,
      vilaityMilli,
      rateDeltaMilli,
      premiumPaise,
    }
  })
  return { rows: outRows, totalPremiumPaise: total }
}
