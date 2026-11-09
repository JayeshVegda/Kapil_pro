/**
 * Pure calculation helpers for the Purchase Dashboard.
 */

import { makeVilaityLookup, type VilaityEntry } from './supplier-market-premium'

export type ItemPurchaseStat = {
  itemName: string
  kg: number
  amountPaise: number
  avgRateRupees: number
}

export type RateVsMarketPoint = {
  date: string
  ourRate: number
  marketRate: number | null
  premiumRupees: number | null
}

/**
 * Aggregates purchased items by kg for the selected period bills.
 */
export function aggregatePurchasedItems(
  bills: ReadonlyArray<{
    cancelled?: boolean
    lines?: ReadonlyArray<{
      itemName: string
      weightG: number
      amountPaise: number
    }>
  }>,
): ItemPurchaseStat[] {
  const map = new Map<string, { kg: number; paise: number }>()

  for (const b of bills) {
    if (b.cancelled || !b.lines) continue
    for (const line of b.lines) {
      const name = (line.itemName || 'Scrap').trim()
      const kg = line.weightG / 1000
      const cur = map.get(name) ?? { kg: 0, paise: 0 }
      cur.kg += kg
      cur.paise += line.amountPaise
      map.set(name, cur)
    }
  }

  return [...map.entries()]
    .map(([itemName, cur]) => ({
      itemName,
      kg: cur.kg,
      amountPaise: cur.paise,
      avgRateRupees: cur.kg > 0 ? cur.paise / 100 / cur.kg : 0,
    }))
    .sort((a, b) => b.kg - a.kg)
}

/**
 * Builds Rate vs Market timeline for a selected purchase item.
 * Uses exact day Vilaity rate if available, else nearest earlier day rate.
 */
export function buildItemRateVsMarketTimeline(
  bills: ReadonlyArray<{
    date: string
    cancelled?: boolean
    lines?: ReadonlyArray<{
      itemName: string
      weightG: number
      rateMilli: number
      amountPaise: number
    }>
  }>,
  selectedItemName: string,
  vilaityHistory: ReadonlyArray<VilaityEntry>,
): RateVsMarketPoint[] {
  const lookup = makeVilaityLookup(vilaityHistory)
  const byDate = new Map<string, { weightG: number; paise: number }>()

  for (const bill of bills) {
    if (bill.cancelled || !bill.lines) continue
    for (const line of bill.lines) {
      if (line.itemName.trim().toLowerCase() === selectedItemName.trim().toLowerCase()) {
        const cur = byDate.get(bill.date) ?? { weightG: 0, paise: 0 }
        cur.weightG += line.weightG
        cur.paise += line.amountPaise
        byDate.set(bill.date, cur)
      }
    }
  }

  const sortedDates = [...byDate.keys()].sort()
  return sortedDates.map((date) => {
    const cur = byDate.get(date)!
    const ourRate = cur.weightG > 0 ? (cur.paise / 100) / (cur.weightG / 1000) : 0
    const mktMilli = lookup(date)
    const marketRate = mktMilli != null ? mktMilli / 1000 : null
    const premiumRupees = marketRate != null ? ourRate - marketRate : null

    return {
      date,
      ourRate: Math.round(ourRate * 10) / 10,
      marketRate: marketRate != null ? Math.round(marketRate * 10) / 10 : null,
      premiumRupees: premiumRupees != null ? Math.round(premiumRupees * 10) / 10 : null,
    }
  })
}
