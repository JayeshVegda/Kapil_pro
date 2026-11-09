/**
 * Pure calculation helpers for the Sales Dashboard.
 */

export type PaymentModeSlice = {
  key: string
  label: string
  value: number
  color?: string
}

export type SalesItemRow = {
  itemName: string
  kg: number
  bags: number
}

const KNOWN_MODES: Record<string, string> = {
  cash: 'Cash',
  cheque: 'Cheque',
  rtgs: 'RTGS',
  neft: 'NEFT',
  bank: 'Bank Transfer',
  online: 'Online',
  upi: 'UPI',
}

/**
 * Aggregates payments by mode for DonutSplit visualization.
 * Invariant: sum of slice values equals total payment amount.
 */
export function aggregatePaymentModes(
  payments: ReadonlyArray<{ amount: number; mode?: string | null }>,
): PaymentModeSlice[] {
  if (!payments || payments.length === 0) return []

  const modeTotals = new Map<string, number>()
  for (const p of payments) {
    if (!p.amount || p.amount <= 0) continue
    const raw = String(p.mode ?? '').trim().toLowerCase()
    const label = KNOWN_MODES[raw] ?? (raw ? raw.toUpperCase() : 'Other')
    modeTotals.set(label, (modeTotals.get(label) ?? 0) + p.amount)
  }

  const sorted = [...modeTotals.entries()]
    .map(([label, value]) => ({ key: label.toLowerCase().replace(/\s+/g, '_'), label, value }))
    .sort((a, b) => b.value - a.value)

  // If more than 6 slices, collapse tail into "Other"
  if (sorted.length <= 6) return sorted

  const head = sorted.slice(0, 5)
  const tailSum = sorted.slice(5).reduce((sum, s) => sum + s.value, 0)
  head.push({ key: 'other', label: 'Other', value: tailSum })
  return head
}

/**
 * Selects top items for the period, falling back to a secondary list (e.g. last 30 days)
 * when the active period has zero shipments.
 */
export function selectTopItemsWithFallback(
  periodItems: ReadonlyArray<SalesItemRow>,
  fallbackItems: ReadonlyArray<SalesItemRow> = [],
): { items: SalesItemRow[]; isFallback: boolean } {
  const usablePeriodItems = (periodItems ?? []).filter((i) => i.kg > 0 || i.bags > 0)
  if (usablePeriodItems.length > 0) {
    return { items: usablePeriodItems, isFallback: false }
  }

  const usableFallbackItems = (fallbackItems ?? []).filter((i) => i.kg > 0 || i.bags > 0)
  if (usableFallbackItems.length > 0) {
    return { items: usableFallbackItems, isFallback: true }
  }

  return { items: [], isFallback: false }
}
