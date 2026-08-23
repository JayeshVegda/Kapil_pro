export type GasSalesBillInput = {
  id: string
  date: string
  customerId: string
  customerName: string
  marketRate: number
  gstRate?: number
  gstAmount?: number
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
  /** GST-billed stream — rates are never blended with non-GST. Null when absent. */
  gst: GasRateBasis | null
  /** Non-GST stream — rates are never blended with GST. Null when absent. */
  nonGst: GasRateBasis | null
}

/** One pricing stream (GST or non-GST). Rates from different streams must never be merged. */
export type GasRateBasis = {
  sales: number
  salesWithGst: number
  kg: number
  bags: number
  weightedSellingRate: number | null
  weightedSellingRateWithGst: number | null
  weightedMarketRate: number | null
  premiumPerKg: number | null
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

const finiteNumber = (value?: number) => (value != null && Number.isFinite(value) ? value : 0)

type BasisAccumulator = {
  sales: number
  salesWithGst: number
  kg: number
  bags: number
  marketValue: number
  marketKg: number
}

const emptyBasis = (): BasisAccumulator => ({
  sales: 0,
  salesWithGst: 0,
  kg: 0,
  bags: 0,
  marketValue: 0,
  marketKg: 0,
})

type Accumulator = {
  sales: number
  kg: number
  bags: number
  marketValue: number
  marketKg: number
  billIds: Set<string>
  gst: BasisAccumulator
  nonGst: BasisAccumulator
}

const emptyAccumulator = (): Accumulator => ({
  sales: 0,
  kg: 0,
  bags: 0,
  marketValue: 0,
  marketKg: 0,
  billIds: new Set<string>(),
  gst: emptyBasis(),
  nonGst: emptyBasis(),
})

export function isGstBill(bill: Pick<GasSalesBillInput, 'gstRate' | 'gstAmount'>) {
  return finiteNumber(bill.gstRate) > 0 || finiteNumber(bill.gstAmount) > 0
}

function addLine(accumulator: Accumulator, line: GasSalesLineInput, bill: GasSalesBillInput) {
  const qty = finiteNumber(line.qty)
  const amount = finiteNumber(line.amount)
  accumulator.sales += amount
  accumulator.bags += finiteNumber(line.bags)
  accumulator.billIds.add(bill.id)
  if (qty > 0) {
    accumulator.kg += qty
    if (bill.marketRate > 0) {
      accumulator.marketValue += qty * bill.marketRate
      accumulator.marketKg += qty
    }
  }

  // Route the line into exactly one pricing stream so rates never blend.
  const basis = isGstBill(bill) ? accumulator.gst : accumulator.nonGst
  basis.sales += amount
  basis.bags += finiteNumber(line.bags)
  if (qty > 0) {
    basis.kg += qty
    if (bill.marketRate > 0) {
      basis.marketValue += qty * bill.marketRate
      basis.marketKg += qty
    }
  }
}

/**
 * Allocates a bill's GST across its gas lines proportionally to amount share.
 * Call after all lines of the bill are accumulated; mutates the gst basis only.
 */
function toRateBasis(basis: BasisAccumulator): GasRateBasis {
  const weightedSellingRate = basis.kg > 0 ? basis.sales / basis.kg : null
  const weightedSellingRateWithGst = basis.kg > 0 ? (basis.sales + basis.salesWithGst) / basis.kg : null
  const weightedMarketRate = basis.marketKg > 0 ? basis.marketValue / basis.marketKg : null
  return {
    sales: basis.sales,
    salesWithGst: basis.sales + basis.salesWithGst,
    kg: basis.kg,
    bags: basis.bags,
    weightedSellingRate,
    weightedSellingRateWithGst,
    weightedMarketRate,
    premiumPerKg: weightedSellingRate != null && weightedMarketRate != null ? weightedSellingRate - weightedMarketRate : null,
  }
}

function hasActivity(basis: BasisAccumulator) {
  return basis.sales > 0 || basis.kg > 0 || basis.bags > 0
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
    gst: hasActivity(accumulator.gst) ? toRateBasis(accumulator.gst) : null,
    nonGst: hasActivity(accumulator.nonGst) ? toRateBasis(accumulator.nonGst) : null,
  }
}

/**
 * Builds the gas sales report with rates split into GST and non-GST streams.
 * Each bill's tax is allocated across its lines by amount share so incl-GST
 * per-kg rates stay honest; ex-GST and incl-GST figures never blend across streams.
 */
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

  // Allocate each GST bill's tax into its lines' gst-basis salesWithGst across every group.
  const gstLinesByBill = new Map<string, GasSalesLineInput[]>()
  for (const line of lines) {
    if (line.itemType.trim().toLowerCase() !== 'gas') continue
    const bill = billById.get(line.billId)
    if (!bill || !isGstBill(bill)) continue
    const list = gstLinesByBill.get(line.billId) ?? []
    list.push(line)
    gstLinesByBill.set(line.billId, list)
  }
  for (const [billId, billLines] of gstLinesByBill) {
    const bill = billById.get(billId)
    if (!bill) continue
    const linesTotal = billLines.reduce((sum, line) => sum + finiteNumber(line.amount), 0)
    if (!(linesTotal > 0)) continue
    const gstAmount =
      finiteNumber(bill.gstAmount) > 0
        ? finiteNumber(bill.gstAmount)
        : (finiteNumber(bill.gstRate) / 100) * linesTotal
    if (!(gstAmount > 0)) continue
    const dayKey = bill.date.slice(0, 10)
    const monthKey = dayKey.slice(0, 7)
    const monthAccumulator = monthAccumulators.get(monthKey)
    const dayAccumulator = dayAccumulators.get(dayKey)
    const customerAccumulator = customerAccumulators.get(bill.customerId)
    for (const line of billLines) {
      if (!(finiteNumber(line.qty) > 0)) continue
      const allocated = (gstAmount * finiteNumber(line.amount)) / linesTotal
      overallAccumulator.gst.salesWithGst += allocated
      if (monthAccumulator) monthAccumulator.gst.salesWithGst += allocated
      if (dayAccumulator) dayAccumulator.gst.salesWithGst += allocated
      const itemAccumulator = itemAccumulators.get(itemIdOf(line))
      if (itemAccumulator) itemAccumulator.accumulator.gst.salesWithGst += allocated
      if (customerAccumulator) customerAccumulator.accumulator.gst.salesWithGst += allocated
    }
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
      .sort((a, b) => b.kg - a.kg || b.sales - a.sales || a.label.localeCompare(b.label)),
  }
}

function itemIdOf(line: GasSalesLineInput) {
  return line.itemId || line.itemName.trim().toLowerCase()
}
