import { useQuery } from '@tanstack/react-query'
import { loadDashboardCollections } from '@/data/dashboard'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { getLocalIsoDate, toMonthKey } from '@/lib/date'

export const DASHBOARD_QUERY_KEY = ['dashboard-data'] as const

type DashboardBill = {
  id: string
  date: string
  customerName: string
  billNo: number
  bookNo: number
  total: number
  status: 'Pending' | 'Paid'
}

type DashboardPayment = {
  id: string
  date: string
  customerName: string
  amount: number
  mode: string
  status: 'Collected'
}

export type DashboardData = {
  kpis: {
    outstanding: number
    thisMonthSales: number
    thisMonthCollection: number
    totalBills: number
    pendingParties: number
    activeCustomers: number
    collectionRate: number
    averageBillValue: number
    thisMonthNet: number
    salesVsLastMonth: number
    collectionVsLastMonth: number
  }
  recentBills: DashboardBill[]
  recentPayments: DashboardPayment[]
  actionRequired: {
    pendingAmount: number
    pendingParties: number
    highRiskParties: number
  }
  monthlyTrend: Array<{ month: string; sales: number; collection: number }>
}

const num = (v: unknown) => (Number.isFinite(Number(v ?? 0)) ? Number(v) : 0)
const datePart = (v: unknown) => String(v ?? '').slice(0, 10)
const monthKey = (d: string) => toMonthKey(d)
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'short' })
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const { billsRaw, billItemsRaw, paymentsRaw, customersRaw } = await loadDashboardCollections()

  const itemSumByBill = new Map<string, number>()
  for (const row of billItemsRaw) {
    const billId = String(row.bill ?? '')
    itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(row.amount))
  }

  const bills = billsRaw.map((row) => {
    const itemsTotal = itemSumByBill.get(row.id) ?? 0
    return {
      id: row.id,
      date: datePart(row.date),
      customerName: String(row.customer_name ?? 'Unknown'),
      billNo: num(row.bill_no),
      bookNo: num(row.book_no),
      total: calculateBillTotalFromBase(itemsTotal, num(row.transport), num(row.gst_rate)),
      status: 'Pending' as const,
    }
  })

  const payments = paymentsRaw.map((row) => ({
    id: row.id,
    date: datePart(row.date),
    customerName: String(row.customer_name ?? 'Unknown'),
    amount: num(row.amount),
    mode: String(row.mode ?? 'Bank'),
    status: 'Collected' as const,
  }))

  const nowMonth = monthKey(getLocalIsoDate())
  const prev = new Date()
  prev.setMonth(prev.getMonth() - 1)
  const prevMonth = monthKey(getLocalIsoDate(prev))
  const thisMonthSales = bills.filter((b) => monthKey(b.date) === nowMonth).reduce((s, b) => s + b.total, 0)
  const thisMonthCollection = payments.filter((p) => monthKey(p.date) === nowMonth).reduce((s, p) => s + p.amount, 0)
  const previousMonthSales = bills.filter((b) => monthKey(b.date) === prevMonth).reduce((s, b) => s + b.total, 0)
  const previousMonthCollection = payments.filter((p) => monthKey(p.date) === prevMonth).reduce((s, p) => s + p.amount, 0)

  const totalSales = bills.reduce((s, b) => s + b.total, 0)
  const totalCollection = payments.reduce((s, p) => s + p.amount, 0)
  const outstanding = totalSales - totalCollection
  const collectionRate = totalSales > 0 ? (totalCollection / totalSales) * 100 : 0
  const averageBillValue = bills.length > 0 ? totalSales / bills.length : 0
  const thisMonthNet = thisMonthSales - thisMonthCollection
  const salesVsLastMonth = thisMonthSales - previousMonthSales
  const collectionVsLastMonth = thisMonthCollection - previousMonthCollection

  const outstandingByParty = new Map<string, number>()
  for (const b of bills) outstandingByParty.set(b.customerName, (outstandingByParty.get(b.customerName) ?? 0) + b.total)
  for (const p of payments) outstandingByParty.set(p.customerName, (outstandingByParty.get(p.customerName) ?? 0) - p.amount)
  const pendingParties = [...outstandingByParty.values()].filter((v) => v > 0).length
  const pendingAmount = [...outstandingByParty.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0)
  const avgPartyPending = pendingParties > 0 ? pendingAmount / pendingParties : 0
  const highRiskParties = [...outstandingByParty.values()].filter((v) => v > avgPartyPending * 1.5).length

  const billsWithStatus = bills.map((b) => ({ ...b, status: (outstandingByParty.get(b.customerName) ?? 0) > 0 ? ('Pending' as const) : ('Paid' as const) }))
  const allMonths = new Set<string>()
  bills.forEach((b) => allMonths.add(monthKey(b.date)))
  payments.forEach((p) => allMonths.add(monthKey(p.date)))
  const monthlyTrend = [...allMonths].sort().slice(-6).map((m) => ({
    month: monthLabel(m),
    sales: bills.filter((b) => monthKey(b.date) === m).reduce((s, b) => s + b.total, 0),
    collection: payments.filter((p) => monthKey(p.date) === m).reduce((s, p) => s + p.amount, 0),
  }))

  return {
    kpis: {
      outstanding,
      thisMonthSales,
      thisMonthCollection,
      totalBills: bills.length,
      pendingParties,
      activeCustomers: customersRaw.length,
      collectionRate,
      averageBillValue,
      thisMonthNet,
      salesVsLastMonth,
      collectionVsLastMonth,
    },
    recentBills: billsWithStatus.slice(0, 8),
    recentPayments: payments.slice(0, 8),
    actionRequired: { pendingAmount, pendingParties, highRiskParties },
    monthlyTrend,
  }
}

export function useDashboardData() {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: fetchDashboardData,
    staleTime: 60_000,
    // Disable polling to avoid automatic UI refresh loops.
    refetchInterval: false,
  })
}
