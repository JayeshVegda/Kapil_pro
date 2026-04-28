export type BalanceLabel = 'Due' | 'Advance' | 'Clear'

export function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function computeNetBalance(openingBalance: number, billedTotal: number, paidTotal: number) {
  return safeNumber(openingBalance) + safeNumber(billedTotal) - safeNumber(paidTotal)
}

export function splitBalance(netBalance: number): { dueAmount: number; advanceAmount: number; balanceLabel: BalanceLabel } {
  const dueAmount = netBalance > 0 ? netBalance : 0
  const advanceAmount = netBalance < 0 ? Math.abs(netBalance) : 0
  const balanceLabel: BalanceLabel = dueAmount > 0 ? 'Due' : advanceAmount > 0 ? 'Advance' : 'Clear'
  return { dueAmount, advanceAmount, balanceLabel }
}

export function toDayKey(isoLike: string) {
  return String(isoLike ?? '').slice(0, 10)
}

export function isOnOrBeforeDay(leftIsoLike: string, rightIsoLike: string) {
  const left = toDayKey(leftIsoLike)
  const right = toDayKey(rightIsoLike)
  if (!left || !right) return false
  return left <= right
}
