import { toMonthKey } from '@/lib/date'

type BillLike = Record<string, unknown> & { id: string }
type BillItemLike = Record<string, unknown>

export type MonthlyItemMetric = {
  bags: number
  kg: number
  partyCount: number
  previousBags: number
  previousKg: number
  previousPartyCount: number
}

export type MonthlyItemComparisons = {
  /** All Spindle variants combined (7.5GM + 8.5GM + any other). */
  spindle: MonthlyItemMetric
  spindle75: MonthlyItemMetric
  spindle85: MonthlyItemMetric
  tapperPlug: MonthlyItemMetric
}

const emptyMetric = (): MonthlyItemMetric => ({
  bags: 0,
  kg: 0,
  partyCount: 0,
  previousBags: 0,
  previousKg: 0,
  previousPartyCount: 0,
})

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const str = (value: unknown) => String(value ?? '')

function classifyItem(name: string): Array<keyof MonthlyItemComparisons> {
  const normalized = name.trim().toLowerCase()
  if (normalized.includes('spindle')) {
    // Variant detection from the item name; the combined "spindle" bucket always accumulates too.
    if (normalized.includes('7.5')) return ['spindle', 'spindle75']
    if (normalized.includes('8.5')) return ['spindle', 'spindle85']
    return ['spindle']
  }
  if (normalized.includes('tapper') && normalized.includes('plug')) return ['tapperPlug']
  return []
}

function billLookup(bills: BillLike[], monthKey?: string, maxDate?: string) {
  const lookup = new Map<string, { date: string; customerId: string }>()
  for (const bill of bills) {
    const date = str(bill.date).slice(0, 10)
    if (!date || (monthKey && toMonthKey(date) !== monthKey) || (maxDate && date > maxDate)) continue
    lookup.set(bill.id, { date, customerId: str(bill.customer) })
  }
  return lookup
}

function addItems(
  target: MonthlyItemComparisons,
  bills: Map<string, { customerId: string }>,
  items: BillItemLike[],
  mode: 'current' | 'previous',
) {
  const parties: Record<keyof MonthlyItemComparisons, Set<string>> = {
    spindle: new Set<string>(),
    spindle75: new Set<string>(),
    spindle85: new Set<string>(),
    tapperPlug: new Set<string>(),
  }

  for (const item of items) {
    const bill = bills.get(str(item.bill))
    if (!bill) continue
    const categories = classifyItem(str(item.item_name))
    if (!categories) continue
    const bags = num(item.bags)
    const kg = num(item.qty)
    for (const category of categories) {
      const metric = target[category]
      if (mode === 'current') {
        metric.bags += bags
        metric.kg += kg
      } else {
        metric.previousBags += bags
        metric.previousKg += kg
      }
      if (bill.customerId) parties[category].add(bill.customerId)
    }
  }

  for (const category of Object.keys(parties) as Array<keyof MonthlyItemComparisons>) {
    if (mode === 'current') target[category].partyCount = parties[category].size
    else target[category].previousPartyCount = parties[category].size
  }
}

export function buildMonthlyItemComparisons({
  currentBills,
  currentItems,
  previousBills,
  previousItems,
  currentMonthKey,
  previousMonthKey,
  maxCurrentDate,
}: {
  currentBills: BillLike[]
  currentItems: BillItemLike[]
  previousBills: BillLike[]
  previousItems: BillItemLike[]
  currentMonthKey?: string
  previousMonthKey?: string
  maxCurrentDate?: string
}): MonthlyItemComparisons {
  const comparisons: MonthlyItemComparisons = {
    spindle: emptyMetric(),
    spindle75: emptyMetric(),
    spindle85: emptyMetric(),
    tapperPlug: emptyMetric(),
  }
  addItems(comparisons, billLookup(currentBills, currentMonthKey, maxCurrentDate), currentItems, 'current')
  addItems(comparisons, billLookup(previousBills, previousMonthKey), previousItems, 'previous')
  return comparisons
}
