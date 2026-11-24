export const brassRateSeries = [
  { key: 'vilaity', label: 'Vilaity', unit: '₹/kg' },
  { key: 'honey_gulf', label: 'Honey Gulf', unit: '₹/kg' },
  { key: 'honey_europe', label: 'Honey Europe', unit: '₹/kg' },
  { key: 'delhi_honey', label: 'Delhi Honey', unit: '₹/kg' },
  { key: 'delhi_local', label: 'Delhi Local', unit: '₹/kg' },
  { key: 'armature', label: 'Armature', unit: '₹/kg' },
  { key: 'plant_pass', label: 'Zinc Plant Pass', unit: '₹/kg' },
  { key: 'zinc_9995', label: 'Zinc 99.95', unit: '₹/kg' },
  { key: 'mcx_copper', label: 'MCX Copper', unit: 'Bulletin units' },
  { key: 'mcx_zinc', label: 'MCX Zinc', unit: 'Bulletin units' },
  { key: 'lme_3m', label: 'LME 3M', unit: 'Bulletin units' },
  { key: 'usd_inr', label: 'USD/INR', unit: '₹/USD' },
] as const

export type BrassRateSeries = (typeof brassRateSeries)[number]
export type BrassRateKey = BrassRateSeries['key']
export type BrassRateDay = { date: string; rates: Partial<Record<BrassRateKey, number>> }

export function normalizeBrassRateHistory(records: readonly Record<string, unknown>[]): BrassRateDay[] {
  const byDate = new Map<string, BrassRateDay>()
  for (const record of records) {
    const date = String(record.date ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const time = Date.parse(`${date}T00:00:00Z`)
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) continue
    const rates = byDate.get(date)?.rates ?? {}
    for (const { key } of brassRateSeries) {
      const raw = record[key]
      const rate = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN
      if (Number.isFinite(rate) && rate > 0) rates[key] = rate
    }
    if (Object.keys(rates).length) byDate.set(date, { date, rates })
  }
  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date))
}

export function summarizeBrassSeries(days: readonly BrassRateDay[], key: BrassRateKey) {
  const points: { date: string; time: number; rate: number }[] = []
  let low = Infinity
  let high = -Infinity
  let total = 0
  for (const day of days) {
    const rate = day.rates[key]
    if (rate === undefined) continue
    points.push({ date: day.date, time: Date.parse(`${day.date}T00:00:00Z`), rate })
    low = Math.min(low, rate)
    high = Math.max(high, rate)
    total += rate
  }
  const first = points[0]
  const latest = points.at(-1)
  return {
    points, latest,
    low: first ? low : null,
    high: first ? high : null,
    average: first ? total / points.length : null,
    change: latest && first && points.length > 1 ? latest.rate - first.rate : null,
    changePercent: latest && first && points.length > 1 ? (latest.rate / first.rate - 1) * 100 : null,
  }
}
