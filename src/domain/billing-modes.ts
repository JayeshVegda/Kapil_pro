export type BillingItemType = 'gas' | 'electronic'
export type BillingGstMode = 'none' | 'percent18' | 'manual'

export type BillingItemMeta = {
  type?: string
  unit?: string
  bagWeight?: number
}

export type LastRateContext = {
  rate: number
  mktRate: number
  gstRate: number
}

const GST_MARKET_RATE_DISCOUNT = 30

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function getBillingItemType(item: BillingItemMeta): BillingItemType {
  return String(item.type ?? '').trim().toLowerCase() === 'electronic' ? 'electronic' : 'gas'
}

export function isGasBillingItem(item: BillingItemMeta) {
  return getBillingItemType(item) === 'gas'
}

export function getBillingUnit(item: BillingItemMeta) {
  if (getBillingItemType(item) === 'electronic') return item.unit?.trim() || 'piece'
  return 'kg'
}

export function getBillingBagWeight(item: BillingItemMeta) {
  const weight = num(item.bagWeight)
  return weight > 0 ? weight : 50
}

export function calculateBillingLineAmount(input: { qty: number; rate: number }) {
  return num(input.qty) * num(input.rate)
}

export function calculateBillingLineBags(input: { qty: number; item: BillingItemMeta }) {
  if (!isGasBillingItem(input.item)) return 0
  const qty = num(input.qty)
  if (!(qty > 0)) return 0
  return Math.round(qty / getBillingBagWeight(input.item))
}

export function getGstMarketRateDiscount(gstModeOrRate: BillingGstMode | number) {
  if (typeof gstModeOrRate === 'number') return gstModeOrRate === 18 ? GST_MARKET_RATE_DISCOUNT : 0
  return gstModeOrRate === 'percent18' ? GST_MARKET_RATE_DISCOUNT : 0
}

export function calculateGasFinalRate(defaultRate: number, mktRate: number, gstMode: BillingGstMode) {
  return Math.max(0, num(defaultRate) + num(mktRate) - getGstMarketRateDiscount(gstMode))
}

export function calculateGasDefaultRateFromFinal(finalRate: number, mktRate: number, gstModeOrRate: BillingGstMode | number) {
  return Math.max(0, num(finalRate) - num(mktRate) + getGstMarketRateDiscount(gstModeOrRate))
}

export function suggestBillingRate(input: {
  item: BillingItemMeta & { defaultRate?: number }
  mktRate: number
  gstMode: BillingGstMode
  lastRate?: LastRateContext | null
}) {
  const itemType = getBillingItemType(input.item)
  if (itemType === 'electronic') {
    const unitPrice = input.lastRate?.rate ?? input.item.defaultRate ?? 0
    return {
      defaultRate: unitPrice,
      rate: unitPrice,
      rateBasis: 'unit_price' as const,
    }
  }

  const defaultRate =
    input.lastRate != null
      ? calculateGasDefaultRateFromFinal(input.lastRate.rate, input.lastRate.mktRate, input.lastRate.gstRate)
      : num(input.item.defaultRate)
  return {
    defaultRate,
    rate: calculateGasFinalRate(defaultRate, input.mktRate, input.gstMode),
    rateBasis: 'market_margin' as const,
  }
}

