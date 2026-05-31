export type BillItemInput = {
  qty: number
  rate: number
}

export type BillTotalsInput = {
  items: BillItemInput[]
  transport: number
  gstRate: number
  gstAmountOverride?: number | null
}

const toFiniteNumber = (value: unknown) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

export function calculateLineAmount(item: BillItemInput): number {
  return toFiniteNumber(item.qty) * toFiniteNumber(item.rate)
}

export function calculateBillTotals(input: BillTotalsInput) {
  const itemsTotal = input.items.reduce((sum, item) => sum + calculateLineAmount(item), 0)
  const transport = toFiniteNumber(input.transport)
  const gstRate = toFiniteNumber(input.gstRate)
  const fixedGstAmount = toFiniteNumber(input.gstAmountOverride)
  const gstAmount = fixedGstAmount > 0 ? fixedGstAmount : (itemsTotal * gstRate) / 100
  const grandTotal = itemsTotal + transport + gstAmount
  const totalQty = input.items.reduce((sum, item) => sum + toFiniteNumber(item.qty), 0)

  return {
    totalQty,
    itemsTotal,
    transport,
    gstRate,
    gstAmount,
    grandTotal,
  }
}

export function calculateGstAmountFromBase(itemsTotal: number, gstRate: number, gstAmountOverride?: number | null) {
  return calculateBillTotals({
    items: [{ qty: 1, rate: itemsTotal }],
    transport: 0,
    gstRate,
    gstAmountOverride,
  }).gstAmount
}

export function calculateBillTotalFromBase(
  itemsTotal: number,
  transport: number,
  gstRate: number,
  gstAmountOverride?: number | null,
) {
  return calculateBillTotals({
    items: [{ qty: 1, rate: itemsTotal }],
    transport,
    gstRate,
    gstAmountOverride,
  }).grandTotal
}
