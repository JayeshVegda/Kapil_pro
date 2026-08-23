import type { GasSalesMetrics } from '@/domain/gas-sales-reporting'
import type { MonthlyItemComparisons } from '@/domain/monthly-item-rollup'

export type DayDotState = 'covered' | 'partial'

/** Dot under the day number: green when collections covered the day's billing, amber when partial. */
export function dayDotState(sales: number, collections: number): DayDotState | null {
  if (!(sales > 0)) return null
  return collections >= sales ? 'covered' : 'partial'
}

const PREMIUM_TINT_CAP = 150

// Literal class names so Tailwind's scanner picks them up.
const PREMIUM_TINTS = {
  positive: ['bg-emerald-50/70', 'bg-emerald-100/70', 'bg-emerald-200/70'],
  negative: ['bg-rose-50/70', 'bg-rose-100/70', 'bg-rose-200/70'],
} as const

/**
 * Soft background wash keyed to premium vs market: emerald above, rose below,
 * intensity capped so cells stay readable. Empty string when premium unknown.
 */
export function premiumTint(premiumPerKg: number | null | undefined): string {
  if (premiumPerKg == null || !Number.isFinite(premiumPerKg) || premiumPerKg === 0) return ''
  const intensity = Math.min(Math.abs(premiumPerKg) / PREMIUM_TINT_CAP, 1)
  const step = intensity < 0.34 ? 0 : intensity < 0.67 ? 1 : 2
  return premiumPerKg > 0 ? PREMIUM_TINTS.positive[step] : PREMIUM_TINTS.negative[step]
}

export type RateTrendPoint = {
  day: number
  selling: number | null
  market: number | null
  premium: number | null
}

/**
 * Per-day series for the trend strip. Selling rate comes from the gas report,
 * falling back to the recorded bill-market "vilaity" rate only where no gas
 * metrics exist. Market rate is never faked from a selling rate.
 */
export function buildRateSeries(
  dailyGasByDate: Map<string, GasSalesMetrics>,
  rateByDate: Map<string, number>,
  monthKey: string,
): Array<RateTrendPoint> {
  const daysInMonth = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate()
  const points: Array<RateTrendPoint> = []
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${monthKey}-${String(day).padStart(2, '0')}`
    const gas = dailyGasByDate.get(iso)
    const recordedRate = rateByDate.get(iso) ?? null
    points.push({
      day,
      selling: gas?.weightedSellingRate ?? (gas ? null : recordedRate),
      market: gas?.weightedMarketRate ?? null,
      premium: gas?.premiumPerKg ?? null,
    })
  }
  return points
}

export type TopMover = {
  label: string
  bags: number
  deltaBags: number
}

/** Item family with the highest bag count this month, with its vs-last-month delta. */
export function topMover(itemComparisons: MonthlyItemComparisons): TopMover | null {
  const candidates = [
    { label: 'Spindle 7.5GM', metric: itemComparisons.spindle75 },
    { label: 'Spindle 8.5GM', metric: itemComparisons.spindle85 },
    { label: 'Tapper Plug', metric: itemComparisons.tapperPlug },
  ].filter((entry) => entry.metric.bags > 0)
  if (candidates.length === 0) return null
  const best = candidates.sort((a, b) => b.metric.bags - a.metric.bags)[0]
  return {
    label: best.label,
    bags: best.metric.bags,
    deltaBags: Math.round(best.metric.bags - best.metric.previousBags),
  }
}

/** Best single sales day of the month. */
export function bestSalesDay(dailySales: Map<string, number>, monthKey: string): { day: number; sales: number } | null {
  let best: { day: number; sales: number } | null = null
  for (const [iso, sales] of dailySales) {
    if (!iso.startsWith(`${monthKey}-`) || !(sales > 0)) continue
    const day = Number(iso.slice(8))
    if (!best || sales > best.sales) best = { day, sales }
  }
  return best
}
