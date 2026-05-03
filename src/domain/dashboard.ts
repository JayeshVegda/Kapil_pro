import { useQuery } from '@tanstack/react-query'
import { loadDashboardCollections } from '@/data/dashboard'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import {
  compareBusinessDateThenCreatedDesc,
  computeCustomerOutstanding,
  type CanonicalBillRecord,
  type CanonicalCustomerBalanceRecord,
  type CanonicalPaymentRecord,
} from '@/domain/records'
import { formatMonthYear, getLocalIsoDate, toMonthKey } from '@/lib/date'

export const DASHBOARD_QUERY_KEY = ['dashboard-data'] as const

type DashboardBill = CanonicalBillRecord & {
  businessDate: string
  customerId: string
  customerName: string
  total: number
  status: 'Pending' | 'Partial' | 'Paid'
}
type DashboardPayment = CanonicalPaymentRecord & {
  businessDate: string
  customerId: string
  customerName: string
  amount: number
  status: 'Collected'
}

export type ThisMonthItemBagsRow = {
  itemName: string
  bags: number
  kg: number
}

export type DashboardData = {
  /** Bill lines in the current calendar month: bags primary, kg for context. */
  thisMonthItemBags: ThisMonthItemBagsRow[]
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
const normalizeBillStatus = (value: unknown): DashboardBill['status'] => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'paid') return 'Paid'
  if (raw === 'partial') return 'Partial'
  return 'Pending'
}
const monthKey = (d: string) => toMonthKey(d)
const monthLabel = (m: string) => {
  return formatMonthYear(m)
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const { billsRaw, billItemsRaw, paymentsRaw, customersRaw } = await loadDashboardCollections()
  const asOfDate = getLocalIsoDate()

  const itemSumByBill = new Map<string, number>()
  for (const row of billItemsRaw) {
    const billId = String(row.bill ?? '')
    itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(row.amount))
  }

  const bills = billsRaw
    .filter((row) => datePart(row.date) <= asOfDate)
    .map((row) => {
    const itemsTotal = itemSumByBill.get(row.id) ?? 0
    return {
      id: row.id,
      businessDate: datePart(row.date),
      createdAt: String(row.created ?? ''),
      date: datePart(row.date),
      customerId: String(row.customer ?? ''),
      customerName: String(row.customer_name ?? 'Unknown'),
      billNo: num(row.bill_no),
      bookNo: num(row.book_no),
      total: calculateBillTotalFromBase(itemsTotal, num(row.transport), num(row.gst_rate)),
      transport: num(row.transport),
      gstRate: num(row.gst_rate),
      mktRate: num(row.mkt),
      lrNo: String(row.lr_no ?? ''),
      status: normalizeBillStatus(row.status),
    }
    })

  const payments = paymentsRaw
    .filter((row) => datePart(row.date) <= asOfDate)
    .map((row) => ({
      id: row.id,
      businessDate: datePart(row.date),
      createdAt: String(row.created ?? ''),
      date: datePart(row.date),
      customerId: String(row.customer ?? ''),
      customerName: String(row.customer_name ?? 'Unknown'),
      amount: num(row.amount),
      mode: String(row.mode ?? 'Bank'),
      note: String(row.note ?? ''),
      status: 'Collected' as const,
    }))
  const customers = customersRaw.map(
    (row): CanonicalCustomerBalanceRecord => ({
      customerId: row.id,
      openingBalance: num(row.opening_balance),
    }),
  )

  const nowMonth = monthKey(getLocalIsoDate())
  const billDateById = new Map<string, string>()
  for (const row of billsRaw) {
    const d = datePart(row.date)
    if (d <= asOfDate) billDateById.set(String(row.id), d)
  }
  const thisMonthItemAgg = new Map<string, { bags: number; kg: number }>()
  for (const row of billItemsRaw) {
    const billId = String(row.bill ?? '')
    const billDate = billDateById.get(billId)
    if (!billDate || monthKey(billDate) !== nowMonth) continue
    const name = String(row.item_name ?? '').trim()
    if (!name) continue
    const bags = num(row.bags)
    const kg = num(row.qty)
    const cur = thisMonthItemAgg.get(name) ?? { bags: 0, kg: 0 }
    cur.bags += bags
    cur.kg += kg
    thisMonthItemAgg.set(name, cur)
  }
  const thisMonthItemBags: ThisMonthItemBagsRow[] = [...thisMonthItemAgg.entries()]
    .map(([itemName, v]) => ({ itemName, bags: v.bags, kg: v.kg }))
    .sort((a, b) => b.bags - a.bags || b.kg - a.kg)
    .slice(0, 12)

  const prev = new Date()
  prev.setMonth(prev.getMonth() - 1)
  const prevMonth = monthKey(getLocalIsoDate(prev))
  const thisMonthSales = bills.filter((b) => monthKey(b.businessDate) === nowMonth).reduce((s, b) => s + b.total, 0)
  const thisMonthCollection = payments.filter((p) => monthKey(p.businessDate) === nowMonth).reduce((s, p) => s + p.amount, 0)
  const previousMonthSales = bills.filter((b) => monthKey(b.businessDate) === prevMonth).reduce((s, b) => s + b.total, 0)
  const previousMonthCollection = payments.filter((p) => monthKey(p.businessDate) === prevMonth).reduce((s, p) => s + p.amount, 0)

  const outstandingByParty = new Map<string, number>()
  let totalSales = 0
  let totalCollection = 0
  for (const customer of customers) {
    const customerBills = bills.filter((bill) => bill.customerId === customer.customerId)
    const customerPayments = payments.filter((payment) => payment.customerId === customer.customerId)
    const rollup = computeCustomerOutstanding({
      openingBalance: customer.openingBalance,
      bills: customerBills,
      payments: customerPayments,
      asOfDate,
    })
    totalSales += rollup.billedTotal
    totalCollection += rollup.paidTotal
    outstandingByParty.set(customer.customerId, rollup.netBalance)
  }
  const outstanding = [...outstandingByParty.values()].reduce((sum, value) => sum + value, 0)
  const collectionRate = totalSales > 0 ? (totalCollection / totalSales) * 100 : 0
  const averageBillValue = bills.length > 0 ? totalSales / bills.length : 0
  const thisMonthNet = thisMonthSales - thisMonthCollection
  const salesVsLastMonth = thisMonthSales - previousMonthSales
  const collectionVsLastMonth = thisMonthCollection - previousMonthCollection

  const pendingParties = [...outstandingByParty.values()].filter((v) => v > 0).length
  const pendingAmount = [...outstandingByParty.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0)
  const avgPartyPending = pendingParties > 0 ? pendingAmount / pendingParties : 0
  const highRiskParties = [...outstandingByParty.values()].filter((v) => v > avgPartyPending * 1.5).length

  const allMonths = new Set<string>()
  bills.forEach((b) => allMonths.add(monthKey(b.businessDate)))
  payments.forEach((p) => allMonths.add(monthKey(p.businessDate)))
  const monthlyTrend = [...allMonths].sort().slice(-6).map((m) => ({
    month: monthLabel(m),
    sales: bills.filter((b) => monthKey(b.businessDate) === m).reduce((s, b) => s + b.total, 0),
    collection: payments.filter((p) => monthKey(p.businessDate) === m).reduce((s, p) => s + p.amount, 0),
  }))

  return {
    thisMonthItemBags,
    kpis: {
      outstanding,
      thisMonthSales,
      thisMonthCollection,
      totalBills: bills.length,
      pendingParties,
      activeCustomers: customersRaw.filter((customer) => Boolean(customer.active)).length,
      collectionRate,
      averageBillValue,
      thisMonthNet,
      salesVsLastMonth,
      collectionVsLastMonth,
    },
    recentBills: bills.sort(compareBusinessDateThenCreatedDesc).slice(0, 8),
    recentPayments: payments.sort(compareBusinessDateThenCreatedDesc).slice(0, 8),
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
