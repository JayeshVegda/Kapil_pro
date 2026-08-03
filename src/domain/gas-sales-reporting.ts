export type GasSalesBillInput = {
  id: string
  date: string
  customerId: string
  customerName: string
  marketRate: number
}

export type GasSalesLineInput = {
  billId: string
  itemId: string
  itemName: string
  itemType: string
  qty: number
  bags: number
  amount: number
}

export type GasSalesMetrics = {
  sales: number
  kg: number
  bags: number
  billCount: number
  weightedSellingRate: number | null
  weightedMarketRate: number | null
  premiumPerKg: number | null
  premiumPct: number | null
}

export type GasSalesGroup = GasSalesMetrics & {
  key: string
  label: string
  salesSharePct: number
}

export type GasSalesReport = {
  overall: GasSalesMetrics
  byMonth: GasSalesGroup[]
  byDay: GasSalesGroup[]
  byItem: GasSalesGroup[]
  byCustomer: GasSalesGroup[]
}

const finiteNumber = (value: number) => (Number.isFinite(value) ? value : 0)

type Accumulator = {
  sales: number
  kg: number
  bags: number
  marketValue: number
  marketKg: number
  billIds: Set<string>
}

const emptyAccumulator = (): Accumulator => ({
  sales: 0,
  kg: 0,
  bags: 0,
  marketValue: 0,
  marketKg: 0,
  billIds: new Set<string>(),
})

function addLine(accumulator: Accumulator, line: GasSalesLineInput, bill: GasSalesBillInput) {
  const qty = finiteNumber(line.qty)
  accumulator.sales += finiteNumber(line.amount)
  accumulator.bags += finiteNumber(line.bags)
  accumulator.billIds.add(bill.id)
  if (qty > 0) {
    accumulator.kg += qty
    if (bill.marketRate > 0) {
      accumulator.marketValue += qty * bill.marketRate
      accumulator.marketKg += qty
    }
  }
}

function toMetrics(accumulator: Accumulator): GasSalesMetrics {
  const weightedSellingRate = accumulator.kg > 0 ? accumulator.sales / accumulator.kg : null
  const weightedMarketRate = accumulator.marketKg > 0 ? accumulator.marketValue / accumulator.marketKg : null
  const premiumPerKg = weightedSellingRate != null && weightedMarketRate != null ? weightedSellingRate - weightedMarketRate : null
  const premiumPct = premiumPerKg != null && weightedMarketRate != null ? (premiumPerKg / weightedMarketRate) * 100 : null
  return {
    sales: accumulator.sales,
    kg: accumulator.kg,
    bags: accumulator.bags,
    billCount: accumulator.billIds.size,
    weightedSellingRate,
    weightedMarketRate,
    premiumPerKg,
    premiumPct,
  }
}

export function buildGasSalesReport({
  bills,
  lines,
}: {
  bills: GasSalesBillInput[]
  lines: GasSalesLineInput[]
}): GasSalesReport {
  const billById = new Map(bills.map((bill) => [bill.id, bill]))
  const overallAccumulator = emptyAccumulator()
  const monthAccumulators = new Map<string, Accumulator>()
  const dayAccumulators = new Map<string, Accumulator>()
  const itemAccumulators = new Map<string, { label: string; accumulator: Accumulator }>()
  const customerAccumulators = new Map<string, { label: string; accumulator: Accumulator }>()

  for (const line of lines) {
    if (line.itemType.trim().toLowerCase() !== 'gas') continue
    const bill = billById.get(line.billId)
    if (!bill) continue
    addLine(overallAccumulator, line, bill)

    const dayKey = bill.date.slice(0, 10)
    const monthKey = dayKey.slice(0, 7)
    const monthAccumulator = monthAccumulators.get(monthKey) ?? emptyAccumulator()
    const dayAccumulator = dayAccumulators.get(dayKey) ?? emptyAccumulator()
    addLine(monthAccumulator, line, bill)
    addLine(dayAccumulator, line, bill)
    monthAccumulators.set(monthKey, monthAccumulator)
    dayAccumulators.set(dayKey, dayAccumulator)

    const itemKey = line.itemId || line.itemName.trim().toLowerCase()
    const item = itemAccumulators.get(itemKey) ?? { label: line.itemName || 'Unknown item', accumulator: emptyAccumulator() }
    addLine(item.accumulator, line, bill)
    itemAccumulators.set(itemKey, item)

    const customer = customerAccumulators.get(bill.customerId) ?? { label: bill.customerName || 'Unknown customer', accumulator: emptyAccumulator() }
    addLine(customer.accumulator, line, bill)
    customerAccumulators.set(bill.customerId, customer)
  }

  const overall = toMetrics(overallAccumulator)
  const makeGroup = (key: string, label: string, accumulator: Accumulator): GasSalesGroup => ({
    key,
    label,
    ...toMetrics(accumulator),
    salesSharePct: overall.sales > 0 ? (accumulator.sales / overall.sales) * 100 : 0,
  })

  return {
    overall,
    byMonth: [...monthAccumulators.entries()]
      .map(([key, accumulator]) => makeGroup(key, key, accumulator))
      .sort((a, b) => a.key.localeCompare(b.key)),
    byDay: [...dayAccumulators.entries()]
      .map(([key, accumulator]) => makeGroup(key, key, accumulator))
      .sort((a, b) => a.key.localeCompare(b.key)),
    byItem: [...itemAccumulators.entries()]
      .map(([key, value]) => makeGroup(key, value.label, value.accumulator))
      .sort((a, b) => b.kg - a.kg || b.sales - a.sales || a.label.localeCompare(b.label)),
    byCustomer: [...customerAccumulators.entries()]
      .map(([key, value]) => makeGroup(key, value.label, value.accumulator))
      .sort((a, b) => b.sales - a.sales || b.kg - a.kg || a.label.localeCompare(b.label)),
  }
}
