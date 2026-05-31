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
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { buildMonthlyItemComparisons, type MonthlyItemComparisons } from '@/domain/monthly-item-rollup'

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
  itemComparisons: MonthlyItemComparisons
  kpis: {
    outstanding: number
    allTimeSales: number
    allTimeCollection: number
    allTimeSpindleBags: number
    allTimeSpindleKg: number
    allTimeTapperPlugBags: number
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
  thisMonthSummary: {
    sales: number
    collection: number
    spindleBags: number
    spindleKg: number
    tapperPlugBags: number
    tapperPlugKg: number
    avgMarketRate: number
    topBuyer: {
      customerName: string
      sales: number
      bills: number
      avgBillValue: number
      sharePct: number
    } | null
    lastSale: {
      customerName: string
      amount: number
      date: string
    } | null
    lastCollection: {
      customerName: string
      amount: number
      date: string
    } | null
    avgMarketRateVsLastMonth: number
  }
  recentBills: DashboardBill[]
  recentPayments: DashboardPayment[]
  actionRequired: {
    pendingAmount: number
    pendingParties: number
    highRiskParties: number
    highestPending: {
      customerId: string
      customerName: string
      amount: number
    } | null
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
const shiftMonthKey = (key: string, delta: number) => {
  const [yearRaw, monthRaw] = key.split('-').map(Number)
  const date = new Date(yearRaw, monthRaw - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
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
  const customerDisplayById = new Map(customersRaw.map((row) => [row.id, formatCustomerDisplayName(row.company_name, row.name)]))

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
      customerName: customerDisplayById.get(String(row.customer ?? '')) ?? String(row.customer_name ?? 'Unknown'),
      billNo: num(row.bill_no),
      bookNo: num(row.book_no),
      total: calculateBillTotalFromBase(itemsTotal, num(row.transport), num(row.gst_rate), num(row.gst_amount)),
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
      customerName: customerDisplayById.get(String(row.customer ?? '')) ?? String(row.customer_name ?? 'Unknown'),
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
  const prevMonth = shiftMonthKey(nowMonth, -1)
  const billDateById = new Map<string, string>()
  for (const row of billsRaw) {
    const d = datePart(row.date)
    if (d <= asOfDate) billDateById.set(String(row.id), d)
  }
  const thisMonthItemAgg = new Map<string, { bags: number; kg: number }>()
  let allTimeSpindleBags = 0
  let allTimeSpindleKg = 0
  let allTimeTapperPlugBags = 0
  for (const row of billItemsRaw) {
    const billId = String(row.bill ?? '')
    const billDate = billDateById.get(billId)
    if (!billDate) continue
    const name = String(row.item_name ?? '').trim()
    if (!name) continue
    const bags = num(row.bags)
    const kg = num(row.qty)
    const nameLower = name.toLowerCase()
    if (nameLower.includes('spindle')) {
      allTimeSpindleBags += bags
      allTimeSpindleKg += kg
    }
    if (nameLower.includes('tapper') && nameLower.includes('plug')) allTimeTapperPlugBags += bags

    if (monthKey(billDate) === nowMonth) {
      const cur = thisMonthItemAgg.get(name) ?? { bags: 0, kg: 0 }
      cur.bags += bags
      cur.kg += kg
      thisMonthItemAgg.set(name, cur)
    }
  }
  const thisMonthItemBags: ThisMonthItemBagsRow[] = [...thisMonthItemAgg.entries()]
    .map(([itemName, v]) => ({ itemName, bags: v.bags, kg: v.kg }))
    .sort((a, b) => b.bags - a.bags || b.kg - a.kg)
    .slice(0, 12)

  const itemComparisons = buildMonthlyItemComparisons({
    currentBills: billsRaw,
    currentItems: billItemsRaw,
    previousBills: billsRaw,
    previousItems: billItemsRaw,
    currentMonthKey: nowMonth,
    previousMonthKey: prevMonth,
    maxCurrentDate: asOfDate,
  })
  const thisMonthBills = bills.filter((b) => monthKey(b.businessDate) === nowMonth)
  const thisMonthPayments = payments.filter((p) => monthKey(p.businessDate) === nowMonth)
  const thisMonthSales = thisMonthBills.reduce((s, b) => s + b.total, 0)
  const thisMonthCollection = thisMonthPayments.reduce((s, p) => s + p.amount, 0)
  const previousMonthSales = bills.filter((b) => monthKey(b.businessDate) === prevMonth).reduce((s, b) => s + b.total, 0)
  const previousMonthCollection = payments.filter((p) => monthKey(p.businessDate) === prevMonth).reduce((s, p) => s + p.amount, 0)
  const thisMonthAvgMarketRate = (() => {
    const rates = thisMonthBills.map((b) => b.mktRate).filter((v) => v > 0)
    if (rates.length === 0) return 0
    return rates.reduce((sum, rate) => sum + rate, 0) / rates.length
  })()
  const thisMonthBuyerAgg = new Map<string, { customerName: string; sales: number; bills: number }>()
  for (const bill of thisMonthBills) {
    const cur = thisMonthBuyerAgg.get(bill.customerId) ?? { customerName: bill.customerName, sales: 0, bills: 0 }
    cur.sales += bill.total
    cur.bills += 1
    thisMonthBuyerAgg.set(bill.customerId, cur)
  }
  const thisMonthTopBuyer = [...thisMonthBuyerAgg.values()].sort((a, b) => b.sales - a.sales || b.bills - a.bills)[0] ?? null
  let thisMonthSpindleBags = 0
  let thisMonthSpindleKg = 0
  let thisMonthTapperPlugBags = 0
  let thisMonthTapperPlugKg = 0
  for (const row of billItemsRaw) {
    const billId = String(row.bill ?? '')
    const billDate = billDateById.get(billId)
    if (!billDate || monthKey(billDate) !== nowMonth) continue
    const name = String(row.item_name ?? '').trim().toLowerCase()
    if (!name) continue
    const bags = num(row.bags)
    const kg = num(row.qty)
    if (name.includes('spindle')) thisMonthSpindleBags += bags
    if (name.includes('tapper') && name.includes('plug')) thisMonthTapperPlugBags += bags
    if (name.includes('spindle')) thisMonthSpindleKg += kg
    if (name.includes('tapper') && name.includes('plug')) thisMonthTapperPlugKg += kg
  }
  const lastSale = thisMonthBills
    .slice()
    .sort(compareBusinessDateThenCreatedDesc)[0]
  const lastCollection = thisMonthPayments
    .slice()
    .sort(compareBusinessDateThenCreatedDesc)[0]
  const prevMonthAvgMarketRate = (() => {
    const rates = bills
      .filter((b) => monthKey(b.businessDate) === prevMonth)
      .map((b) => b.mktRate)
      .filter((v) => v > 0)
    if (rates.length === 0) return 0
    return rates.reduce((sum, rate) => sum + rate, 0) / rates.length
  })()
  const enrichedTopBuyer =
    thisMonthTopBuyer == null
      ? null
      : {
          ...thisMonthTopBuyer,
          avgBillValue: thisMonthTopBuyer.bills > 0 ? thisMonthTopBuyer.sales / thisMonthTopBuyer.bills : 0,
          sharePct: thisMonthSales > 0 ? (thisMonthTopBuyer.sales / thisMonthSales) * 100 : 0,
        }

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

  const pendingRows = [...outstandingByParty.entries()]
    .filter(([, value]) => value > 0)
    .map(([customerId, amount]) => ({
      customerId,
      customerName: customerDisplayById.get(customerId) ?? customerId,
      amount,
    }))
    .sort((a, b) => b.amount - a.amount)
  const pendingParties = pendingRows.length
  const pendingAmount = pendingRows.reduce((s, row) => s + row.amount, 0)
  const avgPartyPending = pendingParties > 0 ? pendingAmount / pendingParties : 0
  const highRiskParties = pendingRows.filter((row) => row.amount > avgPartyPending * 1.5).length

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
    itemComparisons,
    kpis: {
      outstanding,
      allTimeSales: totalSales,
      allTimeCollection: totalCollection,
      allTimeSpindleBags,
      allTimeSpindleKg,
      allTimeTapperPlugBags,
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
    thisMonthSummary: {
      sales: thisMonthSales,
      collection: thisMonthCollection,
      spindleBags: thisMonthSpindleBags,
      spindleKg: thisMonthSpindleKg,
      tapperPlugBags: thisMonthTapperPlugBags,
      tapperPlugKg: thisMonthTapperPlugKg,
      avgMarketRate: thisMonthAvgMarketRate,
      topBuyer: enrichedTopBuyer,
      lastSale: lastSale ? { customerName: lastSale.customerName, amount: lastSale.total, date: lastSale.businessDate } : null,
      lastCollection: lastCollection
        ? { customerName: lastCollection.customerName, amount: lastCollection.amount, date: lastCollection.businessDate }
        : null,
      avgMarketRateVsLastMonth:
        thisMonthAvgMarketRate > 0 && prevMonthAvgMarketRate > 0 ? thisMonthAvgMarketRate - prevMonthAvgMarketRate : 0,
    },
    recentBills: bills.sort(compareBusinessDateThenCreatedDesc).slice(0, 8),
    recentPayments: payments.sort(compareBusinessDateThenCreatedDesc).slice(0, 8),
    actionRequired: { pendingAmount, pendingParties, highRiskParties, highestPending: pendingRows[0] ?? null },
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
