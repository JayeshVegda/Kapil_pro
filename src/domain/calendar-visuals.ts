const PREMIUM_TINT_CAP = 150

export type DayDotState = 'covered' | 'partial'

/** Dot under the day number: green when collections covered the day's billing, amber when partial. */
export function dayDotState(sales: number, collections: number): DayDotState | null {
  if (!(sales > 0)) return null
  return collections >= sales ? 'covered' : 'partial'
}

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
