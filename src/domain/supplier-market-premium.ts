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

export type PurchaseItemMarketPremium = {
  itemName: string
  totalKg: number
  totalPaise: number
  avgRateRupees: number
  premiumRupees: number
  premiumKg: number
  premiumRupeesPerKg: number
}

export type PurchaseBillLike = {
  id: string
  inNo?: string
  date: string
  cancelled?: boolean
  bardanPending?: boolean
  lines: Array<{
    itemName: string
    weightG: number
    rateMilli: number
    amountPaise: number
  }>
}

/**
 * Computes per-item purchase rates against historical Vilaity market rates.
 * Invariant: Market premium is strictly an internal management signal;
 * never exposed in external prints or exports.
 */
export function computePurchaseItemMarketPremium(
  bills: readonly PurchaseBillLike[],
  history: readonly VilaityEntry[],
): PurchaseItemMarketPremium[] {
  const lookup = makeVilaityLookup(history)
  const itemMap = new Map<string, { kg: number; paise: number; premium: number; premiumKg: number }>()

  for (const bill of bills) {
    if (bill.cancelled) continue
    const marketMilli = lookup(bill.date)

    for (const line of bill.lines) {
      const row = itemMap.get(line.itemName) ?? { kg: 0, paise: 0, premium: 0, premiumKg: 0 }
      const kg = line.weightG / 1000
      row.kg += kg
      row.paise += line.amountPaise
      if (marketMilli != null) {
        row.premium += ((line.rateMilli - marketMilli) / 1000) * kg
        row.premiumKg += kg
      }
      itemMap.set(line.itemName, row)
    }
  }

  return [...itemMap.entries()].map(([itemName, row]) => ({
    itemName,
    totalKg: row.kg,
    totalPaise: row.paise,
    avgRateRupees: row.kg > 0 ? row.paise / 100 / row.kg : 0,
    premiumRupees: row.premium,
    premiumKg: row.premiumKg,
    premiumRupeesPerKg: row.premiumKg > 0 ? row.premium / row.premiumKg : 0,
  }))
}

export type BardanPendingBill = {
  id: string
  inNo: string
  supplierName: string
  date: string
  daysOld: number
}

export type BardanPendingSummary = {
  count: number
  oldestDays: number
  bills: BardanPendingBill[]
}

/**
 * Computes bardan-pending count and ageing in days since purchase bill arrival.
 */
export function computeBardanPendingSummary(
  bills: readonly {
    id: string
    inNo?: string
    supplierName?: string
    date: string
    cancelled?: boolean
    bardanPending?: boolean
  }[],
  asOfDate: string,
): BardanPendingSummary {
  const pending: BardanPendingBill[] = []
  const asOfMs = new Date(`${asOfDate}T00:00:00Z`).getTime()

  for (const bill of bills) {
    if (bill.cancelled || !bill.bardanPending) continue
    const billMs = new Date(`${bill.date}T00:00:00Z`).getTime()
    const daysOld = Math.max(0, Math.floor((asOfMs - billMs) / (1000 * 60 * 60 * 24)))
    pending.push({
      id: bill.id,
      inNo: bill.inNo ?? '',
      supplierName: bill.supplierName ?? '',
      date: bill.date,
      daysOld,
    })
  }

  pending.sort((a, b) => b.daysOld - a.daysOld)
  const oldestDays = pending.length > 0 ? pending[0].daysOld : 0

  return {
    count: pending.length,
    oldestDays,
    bills: pending,
  }
}

