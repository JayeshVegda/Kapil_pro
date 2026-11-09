export { formatMonthLabel } from '@/domain/purchase-dashboard'

export function fmtKg(kg: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(kg)
}

export function fmtRate(rate: number): string {
  return `₹${rate.toFixed(2)}`
}
