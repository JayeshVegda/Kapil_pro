import type { EnrichedPurchaseBill, EnrichedSupplierPayment, SupplierSummary } from '@/data/suppliers'
import { normalizeItemName } from './purchase-item-name'
import { supplierPaymentActivity } from './purchase-log-metrics'
import { CREDIT_KINDS, computeSupplierPositions } from './supplier-settlement'
import { computeAgeingBuckets } from './records'

export type DashboardSnapshot = {
  totalWeOwePaise: number
  totalAdvancePaise: number
  aging: { bucket0to30: number; bucket31to60: number; bucket60plus: number }
  bardanPendingBills: number
  billCount: number
  totalProcuredKg: number
  totalProcuredPaise: number
  avgProcuredRate: number
  recentKg: number
  recentKgLabel: string
  totalPaidPaise: number
  suppliersDueCount: number
}

export type GradeRow = {
  name: string
  totalKg: number
  totalSpendRupees: number
  thisMonthKg: number
  lastMonthKg: number
  latestRate: number
  latestBillDate: string
  avgRate: number
  volumeShare: number
}

export type CadenceRow = {
  monthKey: string
  monthLabel: string
  billCount: number
  procuredKg: number
  procuredSpend: number
  procuredAvgRate: number
  paidRupees: number
}

export type MatrixTotals = {
  totalProcuredKg: number
  totalProcuredSpendRupees: number
  avgProcuredRate: number
  totalPaidRupees: number
}

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' })

export function formatMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return MONTH_FORMATTER.format(new Date(y, m - 1, 1))
}

export function buildPurchaseDashboard({ bills, payments, summaries, today }: {
  bills: readonly EnrichedPurchaseBill[]
  payments: readonly EnrichedSupplierPayment[]
  summaries: readonly SupplierSummary[]
  today: string
}) {
  const currentMonth = today.slice(0, 7)
  const activeBills = bills.filter((bill) => !bill.cancelled)
  const creditPayments = payments.filter((payment) => !payment.cancelled && CREDIT_KINDS.has(payment.kind))
  const outgoingPayments = creditPayments.filter((payment) => supplierPaymentActivity(payment.kind).direction === 'outgoing')
  const positions = computeSupplierPositions(summaries)
  const totalWeOwePaise = positions.totalPayablePaise
  const totalAdvancePaise = positions.totalAdvancePaise
  const suppliersDueCount = positions.suppliersCountWithDue
  const bardanPendingBills = activeBills.filter((bill) => bill.bardanPending).length

  const billAgeingRows = activeBills
    .filter((bill) => bill.duePaise > 0)
    .map((bill) => {
      const billTime = new Date(`${bill.date}T00:00:00`).getTime()
      const nowTime = new Date(`${today}T00:00:00`).getTime()
      const dueDays = Math.max(0, Math.floor((nowTime - billTime) / (1000 * 60 * 60 * 24)))
      return { amount: bill.duePaise, dueDays }
    })
  const ageingSummary = computeAgeingBuckets(billAgeingRows)
  const aging = {
    bucket0to30: ageingSummary.bucket0to30,
    bucket31to60: ageingSummary.bucket31to60,
    bucket60plus: ageingSummary.bucket60plus,
  }

  const totalProcuredKg = activeBills.reduce((sum, bill) => sum + bill.totalKg, 0)
  const totalProcuredPaise = activeBills.reduce((sum, bill) => sum + bill.netPaise, 0)
  const avgProcuredRate = totalProcuredKg > 0 ? totalProcuredPaise / 100 / totalProcuredKg : 0
  const totalPaidPaise = outgoingPayments.reduce((sum, payment) => sum + payment.amountPaise, 0)
  const thisMonthKg = activeBills.filter((bill) => bill.date.startsWith(currentMonth)).reduce((sum, bill) => sum + bill.totalKg, 0)
  const otherMonths = [...new Set(activeBills.map((bill) => bill.date.slice(0, 7)).filter((month) => month !== currentMonth))].sort()
  const previousMonth = otherMonths[otherMonths.length - 1]
  const previousMonthKg = previousMonth
    ? activeBills.filter((bill) => bill.date.startsWith(previousMonth)).reduce((sum, bill) => sum + bill.totalKg, 0)
    : 0
  const recentKg = thisMonthKg > 0 ? thisMonthKg : previousMonthKg
  const recentKgLabel = thisMonthKg > 0 ? 'this month' : previousMonth ? `in ${formatMonthLabel(previousMonth)}` : ''

  const grades = new Map<string, Omit<GradeRow, 'avgRate' | 'volumeShare'>>()
  for (const bill of activeBills) {
    for (const line of bill.lines) {
      const name = normalizeItemName(line.itemName)
      const key = name.toLowerCase()
      const row = grades.get(key) ?? {
        name, totalKg: 0, totalSpendRupees: 0, thisMonthKg: 0, lastMonthKg: 0,
        latestRate: 0, latestBillDate: '',
      }
      const kg = line.weightG / 1000
      row.totalKg += kg
      row.totalSpendRupees += line.amountPaise / 100
      if (bill.date.startsWith(currentMonth)) row.thisMonthKg += kg
      else if (previousMonth && bill.date.startsWith(previousMonth)) row.lastMonthKg += kg
      if (!row.latestBillDate || bill.date >= row.latestBillDate) {
        row.latestBillDate = bill.date
        row.latestRate = line.rateMilli / 1000
      }
      grades.set(key, row)
    }
  }
  const gradeRows: GradeRow[] = [...grades.values()].map((row) => ({
    ...row,
    avgRate: row.totalKg > 0 ? row.totalSpendRupees / row.totalKg : 0,
    volumeShare: totalProcuredKg > 0 ? (row.totalKg / totalProcuredKg) * 100 : 0,
  })).sort((a, b) => b.totalKg - a.totalKg)

  const monthKeys = new Set<string>()
  for (const bill of activeBills) monthKeys.add(bill.date.slice(0, 7))
  for (const payment of creditPayments) monthKeys.add(payment.date.slice(0, 7))
  const cadenceRows: CadenceRow[] = [...monthKeys].sort().reverse().map((month) => {
    const monthBills = activeBills.filter((bill) => bill.date.startsWith(month))
    const procuredKg = monthBills.reduce((sum, bill) => sum + bill.totalKg, 0)
    const procuredSpend = monthBills.reduce((sum, bill) => sum + bill.netPaise, 0) / 100
    return {
      monthKey: month, monthLabel: formatMonthLabel(month), billCount: monthBills.length,
      procuredKg, procuredSpend, procuredAvgRate: procuredKg > 0 ? procuredSpend / procuredKg : 0,
      paidRupees: outgoingPayments.filter((payment) => payment.date.startsWith(month)).reduce((sum, payment) => sum + payment.amountPaise, 0) / 100,
    }
  })

  const snapshot: DashboardSnapshot = {
    totalWeOwePaise, totalAdvancePaise, aging, bardanPendingBills, billCount: activeBills.length,
    totalProcuredKg, totalProcuredPaise, avgProcuredRate, recentKg, recentKgLabel,
    totalPaidPaise, suppliersDueCount,
  }
  const materialTotals: MatrixTotals = {
    totalProcuredKg, totalProcuredSpendRupees: totalProcuredPaise / 100, avgProcuredRate,
    totalPaidRupees: totalPaidPaise / 100,
  }
  return {
    snapshot, gradeRows, cadenceRows, materialTotals,
    payNext: summaries.filter((row) => row.outstandingPaise > 0).sort((a, b) => b.outstandingPaise - a.outstandingPaise).slice(0, 6),
    recentBills: [...bills].sort((a, b) => `${b.date}|${b.created}`.localeCompare(`${a.date}|${a.created}`)).slice(0, 5),
    recentPayments: [...payments].sort((a, b) => `${b.date}|${b.created}`.localeCompare(`${a.date}|${a.created}`)).slice(0, 5),
    todayProcurement: {
      bills: activeBills.filter((bill) => bill.date === today).length,
      kg: activeBills.filter((bill) => bill.date === today).reduce((sum, bill) => sum + bill.totalKg, 0),
    },
    todayPaid: outgoingPayments.filter((payment) => payment.date === today)
      .reduce((total, payment) => ({ count: total.count + 1, paise: total.paise + payment.amountPaise }), { count: 0, paise: 0 }),
  }
}
