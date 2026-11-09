import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Download,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { loadDashboardCollections } from '@/data/dashboard'
import { purchaseReadModelQueryOptions } from '@/data/purchase-queries'
import { loadCastingSessions } from '@/data/casting'
import { useModuleSettings } from '@/lib/use-module-settings'
import { computeSupplierPositions } from '@/domain/supplier-settlement'
import { computeSafeRecoveryAndWastage } from '@/domain/casting-dashboard-calculations'
import { fiscalYearStart } from '@/domain/dashboard'
import {
  formatCompactInr,
  formatCompactKg,
  formatInrInteger,
} from '@/lib/inr-format'
import {
  formatFullDate,
  formatMonthYear,
  getLocalIsoDate,
} from '@/lib/date'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { exportNodeAsJpg } from '@/lib/image-export'
import { Panel } from '@/components/ui/panel'
import { SectionCard, KpiCard } from '@/components/ui/business-kit'
import { Sparkline } from '@/components/charts/sparkline'
import { RankedBars } from '@/components/charts/ranked-bars'
import { StackedBar } from '@/components/charts/stacked-bar'
import { TrendChart } from '@/components/charts/trend-chart'
import { CHART_THEME } from '@/components/charts/chart-theme'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/monthly-report')({
  component: CompanyReportPage,
})

export type ReportPeriodMode = 'month' | 'last_month' | 'fy' | 'prev_fy'
export type AgingBucketKey = 'current' | 'days31to60' | 'days61to90' | 'above90'

type ReportRange = {
  from: string
  to: string
  label: string
  comparisonNote: string
}

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m, 0)
  return `${yearMonth}-${String(d.getDate()).padStart(2, '0')}`
}

function calculateBillTotal(base: number, transport: number, gstRate: number, gstAmount: number): number {
  const effectiveGst = gstAmount > 0 ? gstAmount : (base * gstRate) / 100
  return Math.round(base + transport + effectiveGst)
}

function dateDiffDays(fromIso: string, toIso: string): number {
  if (!fromIso || !toIso) return 0
  const f = new Date(`${fromIso.slice(0, 10)}T00:00:00`).getTime()
  const t = new Date(`${toIso.slice(0, 10)}T00:00:00`).getTime()
  if (isNaN(f) || isNaN(t)) return 0
  return Math.max(0, Math.floor((t - f) / (24 * 60 * 60 * 1000)))
}

export function CompanyReportPage() {
  const reportRef = useRef<HTMLDivElement>(null)
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)

  const today = useMemo(() => getLocalIsoDate(), [])
  const currentMonthKey = useMemo(() => today.slice(0, 7), [today])
  const currentFyStartYear = useMemo(() => Number(fiscalYearStart(currentMonthKey).slice(0, 4)), [currentMonthKey])

  const [mode, setMode] = useState<ReportPeriodMode>('month')
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthKey)
  const [selectedAgingBucket, setSelectedAgingBucket] = useState<AgingBucketKey>('above90')

  const { purchaseEnabled, castingEnabled } = useModuleSettings()

  // 1. Calculate Active Period & Fair Comparison Range
  const range: ReportRange = useMemo(() => {
    if (mode === 'month') {
      const from = `${selectedMonth}-01`
      const isCurrentMonth = selectedMonth === currentMonthKey
      const to = isCurrentMonth ? today : lastDayOfMonth(selectedMonth)
      const daysElapsed = isCurrentMonth ? Number(today.slice(8, 10)) : 30
      return {
        from,
        to,
        label: formatMonthYear(selectedMonth),
        comparisonNote: isCurrentMonth
          ? `vs same ${daysElapsed} days of last month`
          : 'vs preceding month',
      }
    }
    if (mode === 'last_month') {
      const lmKey = shiftMonth(currentMonthKey, -1)
      return {
        from: `${lmKey}-01`,
        to: lastDayOfMonth(lmKey),
        label: formatMonthYear(lmKey),
        comparisonNote: 'vs preceding month',
      }
    }
    if (mode === 'prev_fy') {
      const prevFy = currentFyStartYear - 1
      return {
        from: `${prevFy}-04-01`,
        to: `${prevFy + 1}-03-31`,
        label: `FY ${prevFy}–${String(prevFy + 1).slice(2)}`,
        comparisonNote: `vs FY ${prevFy - 1}–${String(prevFy).slice(2)}`,
      }
    }
    // FY to date
    return {
      from: `${currentFyStartYear}-04-01`,
      to: today,
      label: `FY ${currentFyStartYear}–${String(currentFyStartYear + 1).slice(2)} to date`,
      comparisonNote: 'vs same period last FY',
    }
  }, [mode, selectedMonth, currentMonthKey, today, currentFyStartYear])

  // Rolling 12-Month array ending at range.to
  const past12Months = useMemo(() => {
    const months: string[] = []
    const [y, m] = range.to.slice(0, 7).split('-').map(Number)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return months
  }, [range.to])

  // 2. Data Queries
  const salesQuery = useQuery({
    queryKey: ['company-report-sales-data', today],
    queryFn: loadDashboardCollections,
    staleTime: 60_000,
  })

  const purchaseQuery = useQuery({
    ...purchaseReadModelQueryOptions(),
    enabled: purchaseEnabled,
    staleTime: 60_000,
  })

  const castingQuery = useQuery({
    queryKey: ['company-report-casting-data', today],
    queryFn: () => loadCastingSessions(),
    enabled: castingEnabled,
    staleTime: 60_000,
  })

  const isLoading = salesQuery.isLoading || (purchaseEnabled && purchaseQuery.isLoading) || (castingEnabled && castingQuery.isLoading)
  const isError = salesQuery.isError

  // ---------------- Computations ----------------

  // A. Sales Engine
  const salesData = useMemo(() => {
    const raw = salesQuery.data
    if (!raw) return null

    const billsRaw = raw.billsRaw ?? []
    const billItemsRaw = raw.billItemsRaw ?? []
    const paymentsRaw = raw.paymentsRaw ?? []
    const customersRaw = raw.customersRaw ?? []

    // Map item amounts & bags to bills
    const itemSumByBill = new Map<string, number>()
    const itemBagsByBill = new Map<string, number>()
    const gasLinesByBill = new Map<string, Array<{ qty: number; amount: number; rate: number }>>()

    for (const line of billItemsRaw) {
      const billId = String(line.bill ?? '')
      const amt = Number(line.amount ?? 0)
      const bags = Number(line.bags ?? 0)
      const qty = Number(line.qty ?? 0)
      const rate = Number(line.rate ?? 0)
      const itemName = String(line.item_name ?? '').toLowerCase()

      itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + amt)
      itemBagsByBill.set(billId, (itemBagsByBill.get(billId) ?? 0) + bags)

      if (itemName.includes('gas') || itemName.includes('oxygen') || itemName.includes('argon')) {
        const list = gasLinesByBill.get(billId) ?? []
        list.push({ qty, amount: amt, rate })
        gasLinesByBill.set(billId, list)
      }
    }

    // Customers directory & initial opening balances
    const customerDirectory = new Map<string, { name: string; opening: number; openingDate: string }>()
    for (const c of customersRaw) {
      const id = String(c.id ?? '')
      const name = formatCustomerDisplayName(c.company_name, c.name)
      const opening = Number(c.opening_balance ?? 0)
      const openingDate = String(c.opening_balance_date ?? '').slice(0, 10)
      customerDirectory.set(id, { name, opening, openingDate })
    }

    // Canonical Bills with totals
    const canonicalBills = billsRaw.map((b) => {
      const id = String(b.id ?? '')
      const date = String(b.date ?? '').slice(0, 10)
      const customerId = String(b.customer ?? '')
      const custInfo = customerDirectory.get(customerId)
      const base = itemSumByBill.get(id) ?? 0
      const transport = Number(b.transport ?? 0)
      const gstRate = Number(b.gst_rate ?? 0)
      const gstAmount = Number(b.gst_amount ?? 0)
      const total = calculateBillTotal(base, transport, gstRate, gstAmount)
      const mktRate = Number(b.mkt ?? 0)
      const bags = itemBagsByBill.get(id) ?? 0
      const gasLines = gasLinesByBill.get(id) ?? []

      return {
        id,
        date,
        billNo: Number(b.bill_no ?? 0),
        customerId,
        customerName: custInfo?.name || String(b.customer_name ?? 'Unknown'),
        total,
        transport,
        gstAmount,
        mktRate,
        bags,
        gasLines,
      }
    })

    // Canonical Payments
    const canonicalPayments = paymentsRaw.map((p) => ({
      id: String(p.id ?? ''),
      date: String(p.date ?? '').slice(0, 10),
      customerId: String(p.customer ?? ''),
      customerName: customerDirectory.get(String(p.customer ?? ''))?.name || String(p.customer_name ?? 'Unknown'),
      amount: Number(p.amount ?? 0),
      mode: String(p.mode ?? 'cash'),
    }))

    // Period filtered
    const periodBills = canonicalBills.filter((b) => b.date >= range.from && b.date <= range.to)
    const periodPayments = canonicalPayments.filter((p) => p.date >= range.from && p.date <= range.to)

    const billedSales = periodBills.reduce((sum, b) => sum + b.total, 0)
    const collectionsRealized = periodPayments.reduce((sum, p) => sum + p.amount, 0)
    const realizationRate = billedSales > 0 ? (collectionsRealized / billedSales) * 100 : 0
    const activeCustomers = new Set(periodBills.map((b) => b.customerId)).size

    // Customer running ledger balances as of range.to
    const customerBalances = new Map<string, number>()
    const customerLastBillDate = new Map<string, string>()

    for (const [cid, cdata] of customerDirectory.entries()) {
      customerBalances.set(cid, cdata.opening)
      if (cdata.openingDate) customerLastBillDate.set(cid, cdata.openingDate)
    }

    for (const b of canonicalBills) {
      if (b.date <= range.to) {
        customerBalances.set(b.customerId, (customerBalances.get(b.customerId) ?? 0) + b.total)
        customerLastBillDate.set(b.customerId, b.date)
      }
    }

    for (const p of canonicalPayments) {
      if (p.date <= range.to) {
        customerBalances.set(p.customerId, (customerBalances.get(p.customerId) ?? 0) - p.amount)
      }
    }

    let totalReceivable = 0
    let totalCustomerAdvance = 0
    const debtorList: Array<{ id: string; name: string; amount: number; lastDate: string; days: number }> = []

    for (const [cid, bal] of customerBalances.entries()) {
      const cname = customerDirectory.get(cid)?.name || 'Unknown'
      if (bal > 0) {
        totalReceivable += bal
        const lastDate = customerLastBillDate.get(cid) || range.to
        const days = dateDiffDays(lastDate, range.to)
        debtorList.push({ id: cid, name: cname, amount: bal, lastDate, days })
      } else if (bal < 0) {
        totalCustomerAdvance += Math.abs(bal)
      }
    }

    debtorList.sort((a, b) => b.amount - a.amount)

    // Ageing classification
    const ageingBuckets = { current: 0, days31to60: 0, days61to90: 0, above90: 0 }
    const ageingDebtors = {
      current: [] as typeof debtorList,
      days31to60: [] as typeof debtorList,
      days61to90: [] as typeof debtorList,
      above90: [] as typeof debtorList,
    }

    for (const d of debtorList) {
      if (d.days <= 30) {
        ageingBuckets.current += d.amount
        ageingDebtors.current.push(d)
      } else if (d.days <= 60) {
        ageingBuckets.days31to60 += d.amount
        ageingDebtors.days31to60.push(d)
      } else if (d.days <= 90) {
        ageingBuckets.days61to90 += d.amount
        ageingDebtors.days61to90.push(d)
      } else {
        ageingBuckets.above90 += d.amount
        ageingDebtors.above90.push(d)
      }
    }

    // Top 5 Customers by Billed in Period
    const customerSpendMap = new Map<string, { name: string; amount: number; bags: number }>()
    for (const b of periodBills) {
      const curr = customerSpendMap.get(b.customerId) ?? { name: b.customerName, amount: 0, bags: 0 }
      curr.amount += b.total
      curr.bags += b.bags
      customerSpendMap.set(b.customerId, curr)
    }

    const topCustomersBySales = [...customerSpendMap.entries()]
      .map(([id, data]) => ({ id, name: data.name, value: data.amount, bags: data.bags }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    // Gas Selling Margin Analysis in Period
    let gasTotalKg = 0
    let gasTotalAmount = 0
    let gasMarketWeightedSum = 0
    let gasKgWithMarket = 0

    for (const b of periodBills) {
      for (const line of b.gasLines) {
        gasTotalKg += line.qty
        gasTotalAmount += line.amount
        if (b.mktRate > 0 && line.qty > 0) {
          gasMarketWeightedSum += line.qty * b.mktRate
          gasKgWithMarket += line.qty
        }
      }
    }

    const gasAvgSellingRate = gasTotalKg > 0 ? gasTotalAmount / gasTotalKg : 0
    const gasAvgMarketRate = gasKgWithMarket > 0 ? gasMarketWeightedSum / gasKgWithMarket : 0
    const gasNetMarginPerKg = gasAvgSellingRate > 0 && gasAvgMarketRate > 0 ? gasAvgSellingRate - gasAvgMarketRate : 0

    return {
      allBills: canonicalBills,
      allPayments: canonicalPayments,
      periodBills,
      periodPayments,
      billedSales,
      collectionsRealized,
      realizationRate,
      activeCustomers,
      totalReceivable,
      totalCustomerAdvance,
      ageingBuckets,
      ageingDebtors,
      debtorList,
      topCustomersBySales,
      topDebtors: debtorList.slice(0, 5),
      gasMetrics: {
        totalKg: gasTotalKg,
        totalAmount: gasTotalAmount,
        avgSellingRate: gasAvgSellingRate,
        avgMarketRate: gasAvgMarketRate,
        marginPerKg: gasNetMarginPerKg,
      },
    }
  }, [salesQuery.data, range.from, range.to])

  // B. Purchase Engine
  const purchaseData = useMemo(() => {
    if (!purchaseEnabled || !purchaseQuery.data) return null
    const model = purchaseQuery.data
    const allBills = model.bills.filter((b) => !b.cancelled)
    const allPayments = model.payments

    const periodBills = allBills.filter((b) => b.date >= range.from && b.date <= range.to)
    const periodPayments = allPayments.filter((p) => p.date >= range.from && p.date <= range.to)

    const totalBoughtPaise = periodBills.reduce((sum, b) => sum + (b.netPaise || 0), 0)
    const totalBoughtKg = periodBills.reduce((sum, b) => sum + (b.totalKg || 0), 0)
    const totalPaidPaise = periodPayments.reduce((sum, p) => sum + p.amountPaise, 0)
    const avgProcuredRateKg = totalBoughtKg > 0 ? (totalBoughtPaise / 100) / totalBoughtKg : 0

    const positions = computeSupplierPositions(model.summaries)
    const totalWeOwePaise = positions.kachaPayablePaise + positions.gstPayablePaise

    // Bardan pending audit
    const billsWithPendingBardan = allBills.filter((b) => b.bardanPending)
    let oldestBardanDays = 0
    let totalPendingBags = 0
    for (const b of billsWithPendingBardan) {
      const age = dateDiffDays(b.date, range.to)
      if (age > oldestBardanDays) oldestBardanDays = age
      totalPendingBags += (b.bagsAtReceiptKg ? Math.round(b.bagsAtReceiptKg) : 1)
    }

    // Top Suppliers by Spend in Period
    const supplierSpendMap = new Map<string, { name: string; amount: number; kg: number }>()
    for (const b of periodBills) {
      const sid = b.supplierId
      const sname = b.supplierName || 'Unknown'
      const cur = supplierSpendMap.get(sid) ?? { name: sname, amount: 0, kg: 0 }
      cur.amount += (b.netPaise || 0) / 100
      cur.kg += (b.totalKg || 0)
      supplierSpendMap.set(sid, cur)
    }

    const topSuppliersBySpend = [...supplierSpendMap.entries()]
      .map(([id, d]) => ({ id, name: d.name, value: d.amount, kg: d.kg }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    // Pay Next (Top Suppliers Owed)
    const topSuppliersOwed = model.summaries
      .filter((s) => s.outstandingPaise > 0)
      .map((s) => ({
        id: s.supplier.id,
        name: s.supplier.companyName,
        amount: s.outstandingPaise / 100,
        kacha: s.kachaDuePaise / 100,
        gst: s.gstDuePaise / 100,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)

    return {
      allBills,
      allPayments,
      periodBills,
      periodPayments,
      totalBoughtPaise,
      totalBoughtKg,
      totalPaidPaise,
      avgProcuredRateKg,
      positions,
      totalWeOwePaise,
      bardanSummary: {
        pendingLots: billsWithPendingBardan.length,
        totalBags: totalPendingBags,
        oldestDays: oldestBardanDays,
        bills: billsWithPendingBardan.slice(0, 5),
      },
      topSuppliersBySpend,
      topSuppliersOwed,
    }
  }, [purchaseEnabled, purchaseQuery.data, range.from, range.to])

  // C. Casting Engine
  const castingData = useMemo(() => {
    if (!castingEnabled || !castingQuery.data) return null
    const allSessions = castingQuery.data

    const periodSessions = allSessions.filter((s) => s.date >= range.from && s.date <= range.to)

    const metalChargedKg = periodSessions.reduce((sum, s) => sum + (s.totalInputKg || 0), 0)
    const wireOutKg = periodSessions.reduce((sum, s) => sum + (s.totalWireOut || s.wireOut || 0), 0)
    const totalMelWastageKg = periodSessions.reduce((sum, s) => sum + (s.totalMel || s.wastage || 0), 0)
    const totalCholInKg = periodSessions.reduce((sum, s) => sum + (s.cholIn || 0), 0)

    const totalInputCost = periodSessions.reduce((sum, s) => sum + (s.totalInputCost || 0), 0)
    const totalCoalCost = periodSessions.reduce((sum, s) => sum + ((s.coalKg || 0) * (s.coalRate || 0)), 0)
    const totalLaborCost = periodSessions.reduce((sum, s) => sum + (s.workerSalary || 0), 0)
    const totalLoadedCost = totalInputCost + totalCoalCost + totalLaborCost
    const loadedCostPerKg = wireOutKg > 0 ? totalLoadedCost / wireOutKg : 0

    const safeYield = computeSafeRecoveryAndWastage(wireOutKg, totalMelWastageKg, metalChargedKg)

    const totalBatches = periodSessions.reduce((sum, s) => sum + (s.unit || s.batches?.length || 1), 0)
    const foundryActiveDays = new Set(periodSessions.map((s) => s.date)).size

    // Best & Worst session by costPerKg
    const validSessions = periodSessions.filter((s) => s.costPerKg > 0)
    const bestSession = validSessions.length > 0
      ? validSessions.reduce((min, s) => (s.costPerKg < min.costPerKg ? s : min), validSessions[0])
      : null
    const worstSession = validSessions.length > 0
      ? validSessions.reduce((max, s) => (s.costPerKg > max.costPerKg ? s : max), validSessions[0])
      : null

    return {
      allSessions,
      periodSessions,
      metalChargedKg,
      wireOutKg,
      totalMelWastageKg,
      totalCholInKg,
      totalLoadedCost,
      loadedCostPerKg,
      safeYield,
      totalBatches,
      foundryActiveDays,
      bestSession,
      worstSession,
    }
  }, [castingEnabled, castingQuery.data, range.from, range.to])

  // D. Working Capital & Cash Realization
  const cashFlow = useMemo(() => {
    const cashIn = salesData?.collectionsRealized ?? 0
    const cashOut = (purchaseData?.totalPaidPaise ?? 0) / 100
    const netCash = cashIn - cashOut
    const openReceivables = salesData?.totalReceivable ?? 0
    const openPayables = (purchaseData?.totalWeOwePaise ?? 0) / 100

    return {
      cashIn,
      cashOut,
      netCash,
      openReceivables,
      openPayables,
    }
  }, [salesData, purchaseData])

  // E. 12-Month Multi-Stream Company Trend Timeline
  const company12MTrend = useMemo(() => {
    const allBills = salesData?.allBills ?? []
    const allPayments = salesData?.allPayments ?? []
    const allPurchaseBills = purchaseData?.allBills ?? []
    const allPurchasePayments = purchaseData?.allPayments ?? []
    const allCasting = castingData?.allSessions ?? []

    return past12Months.map((m) => {
      const sales = allBills
        .filter((b) => b.date.slice(0, 7) === m)
        .reduce((sum, b) => sum + b.total, 0)
      const collections = allPayments
        .filter((p) => p.date.slice(0, 7) === m)
        .reduce((sum, p) => sum + p.amount, 0)
      const purchases = allPurchaseBills
        .filter((b) => b.date.slice(0, 7) === m)
        .reduce((sum, b) => sum + (b.netPaise || 0), 0) / 100
      const paidOut = allPurchasePayments
        .filter((p) => p.date.slice(0, 7) === m)
        .reduce((sum, p) => sum + p.amountPaise, 0) / 100
      const wireOut = allCasting
        .filter((s) => s.date.slice(0, 7) === m)
        .reduce((sum, s) => sum + (s.totalWireOut || s.wireOut || 0), 0)

      return {
        month: m,
        sales,
        collections,
        purchases,
        paidOut,
        wireOut,
        netCash: collections - paidOut,
      }
    })
  }, [past12Months, salesData, purchaseData, castingData])

  // 6-Month rolling sparklines for the top 4 scorecards
  const sparklines6M = useMemo(() => {
    const last6 = past12Months.slice(-6)
    return {
      sales: last6.map((m) => company12MTrend.find((t) => t.month === m)?.sales ?? 0),
      purchases: last6.map((m) => company12MTrend.find((t) => t.month === m)?.purchases ?? 0),
      casting: last6.map((m) => company12MTrend.find((t) => t.month === m)?.wireOut ?? 0),
      netCash: last6.map((m) => company12MTrend.find((t) => t.month === m)?.netCash ?? 0),
    }
  }, [past12Months, company12MTrend])

  // F. 3-Year Financial Year Performance Comparison
  const fy3YearBenchmark = useMemo(() => {
    const allBills = salesData?.allBills ?? []
    const allPayments = salesData?.allPayments ?? []
    const allPurchaseBills = purchaseData?.allBills ?? []
    const allPurchasePayments = purchaseData?.allPayments ?? []
    const allCasting = castingData?.allSessions ?? []

    const fyYears = [currentFyStartYear, currentFyStartYear - 1, currentFyStartYear - 2]

    return fyYears.map((fyYear) => {
      const from = `${fyYear}-04-01`
      const to = fyYear === currentFyStartYear ? today : `${fyYear + 1}-03-31`
      const label = `FY ${fyYear}–${String(fyYear + 1).slice(2)}`

      const sales = allBills
        .filter((b) => b.date >= from && b.date <= to)
        .reduce((sum, b) => sum + b.total, 0)
      const collections = allPayments
        .filter((p) => p.date >= from && p.date <= to)
        .reduce((sum, p) => sum + p.amount, 0)
      const purchases = allPurchaseBills
        .filter((b) => b.date >= from && b.date <= to)
        .reduce((sum, b) => sum + (b.netPaise || 0), 0) / 100
      const paidOut = allPurchasePayments
        .filter((p) => p.date >= from && p.date <= to)
        .reduce((sum, p) => sum + p.amountPaise, 0) / 100
      const wireOut = allCasting
        .filter((s) => s.date >= from && s.date <= to)
        .reduce((sum, s) => sum + (s.totalWireOut || s.wireOut || 0), 0)

      const efficiency = sales > 0 ? (collections / sales) * 100 : 0
      const netCash = collections - paidOut

      return {
        label,
        isCurrent: fyYear === currentFyStartYear,
        sales,
        collections,
        efficiency,
        purchases,
        paidOut,
        netCash,
        wireOut,
      }
    })
  }, [currentFyStartYear, today, salesData, purchaseData, castingData])

  // Handlers for Exports
  const handleExportJpg = async () => {
    if (!reportRef.current) return
    setExporting(true)
    setExportError('')
    try {
      await exportNodeAsJpg(reportRef.current, {
        filename: `Company-Report-${range.label.replace(/\s+/g, '_')}.jpg`,
      })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export image')
    } finally {
      setExporting(false)
    }
  }

  const handleExportCsv = () => {
    const rows = [
      ['Metric', 'Value', 'Unit', 'Notes'],
      ['Report Period', range.label, '', range.comparisonNote],
      ['Billed Sales', salesData?.billedSales ?? 0, 'INR', `${salesData?.periodBills.length ?? 0} bills`],
      ['Collections Realized', salesData?.collectionsRealized ?? 0, 'INR', `${salesData?.periodPayments.length ?? 0} payments`],
      ['Collection Efficiency', `${(salesData?.realizationRate ?? 0).toFixed(1)}%`, '%', 'Collections / Sales'],
      ['Ending Receivables', salesData?.totalReceivable ?? 0, 'INR', 'Open customer dues'],
      ['Scrap Purchases', (purchaseData?.totalBoughtPaise ?? 0) / 100, 'INR', `${purchaseData?.totalBoughtKg ?? 0} kg`],
      ['Supplier Payouts', (purchaseData?.totalPaidPaise ?? 0) / 100, 'INR', `${purchaseData?.periodPayments.length ?? 0} payments`],
      ['Ending Payables (We Owe)', (purchaseData?.totalWeOwePaise ?? 0) / 100, 'INR', 'Open supplier dues'],
      ['Finished Wire Output', castingData?.wireOutKg ?? 0, 'kg', 'Manufacturing output'],
      ['Foundry Metal Recovery', castingData?.safeYield.recoveryPct != null ? `${castingData.safeYield.recoveryPct}%` : '—', '%', 'Mass conservation recovery'],
      ['Foundry Loaded Cost', (castingData?.loadedCostPerKg ?? 0).toFixed(2), 'INR/kg', 'Metal + Coal + Labour'],
      ['Net Operating Cash Flow', cashFlow.netCash, 'INR', 'Collections In - Payouts Out'],
    ]

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.map((c) => `"${c}"`).join(',')).join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `Company_Report_${range.label.replace(/\s+/g, '_')}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (isLoading) {
    return (
      <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
        <Panel className="rounded-xl border border-blue-100 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="mt-3 text-xs font-semibold text-slate-700">Loading consolidated Company Report...</p>
        </Panel>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
        <Panel className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-2 text-rose-600" size={24} />
          <h2 className="text-sm font-semibold text-rose-800">Unable to load Company Report</h2>
          <p className="mt-1 text-xs text-rose-600">Failed to fetch required database collections.</p>
        </Panel>
      </div>
    )
  }

  return (
    <div ref={reportRef} className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {/* 1. Executive Toolbar & Period Controller (Cards Rule compliant) */}
      <Panel className="rounded-xl border border-blue-100/80 bg-gradient-to-r from-blue-50/40 via-white to-slate-50/40 p-3.5 shadow-sm">
        <div className="flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between">
          {/* Left: Brand Executive Badge & Title */}
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
              <Building2 size={16} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">
                  Company Performance Report
                </h1>
                <span className="rounded-md border border-blue-200 bg-blue-50/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-blue-700">
                  {range.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Consolidated Operating & Financial Review · {range.comparisonNote}
              </p>
            </div>
          </div>

          {/* Right: Period Controller Tabs + Exports */}
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <div
              role="tablist"
              aria-label="Report period"
              className="inline-flex rounded-lg border border-blue-200/60 bg-blue-50/40 p-0.5 text-xs font-semibold"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'month'}
                onClick={() => setMode('month')}
                className={cn(
                  'rounded-md px-2.5 py-1.5 transition-all text-xs font-medium',
                  mode === 'month'
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-blue-900 hover:bg-white/80',
                )}
              >
                This Month
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'last_month'}
                onClick={() => setMode('last_month')}
                className={cn(
                  'rounded-md px-2.5 py-1.5 transition-all text-xs font-medium',
                  mode === 'last_month'
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-blue-900 hover:bg-white/80',
                )}
              >
                Last Month
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'fy'}
                onClick={() => setMode('fy')}
                className={cn(
                  'rounded-md px-2.5 py-1.5 transition-all text-xs font-medium',
                  mode === 'fy'
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-blue-900 hover:bg-white/80',
                )}
              >
                FY to Date
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'prev_fy'}
                onClick={() => setMode('prev_fy')}
                className={cn(
                  'rounded-md px-2.5 py-1.5 transition-all text-xs font-medium',
                  mode === 'prev_fy'
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-blue-900 hover:bg-white/80',
                )}
              >
                Last FY
              </button>
            </div>

            {mode === 'month' && (
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                aria-label="Select report month"
                className="h-8 rounded-md border border-blue-200 bg-white px-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              />
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/50 hover:text-blue-700"
            >
              <Download size={13} /> Summary CSV
            </button>

            <button
              type="button"
              onClick={handleExportJpg}
              disabled={exporting}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
            >
              <Download size={13} /> {exporting ? 'Generating...' : 'Export JPG'}
            </button>
          </div>
        </div>
      </Panel>

      {exportError && (
        <Panel className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          {exportError}
        </Panel>
      )}

      {/* 2. Executive Scorecard: The 4 Core Enterprise Pillars */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Pillar 1: Commercial Turnover */}
        <KpiCard
          label="Commercial Turnover"
          hint="Sales Engine"
          value={salesData ? formatCompactInr(salesData.billedSales) : '—'}
          sparkline={
            <Sparkline
              values={sparklines6M.sales}
              width={85}
              height={32}
              showArea
              id="report-kpi-sales"
            />
          }
          subtext={
            salesData
              ? `${salesData.periodBills.length} bills · ${salesData.activeCustomers} unique buyers`
              : 'Loading billings...'
          }
          href="/sales-dashboard"
        />

        {/* Pillar 2: Procurement Spend */}
        <KpiCard
          label="Procurement Spend"
          hint="Supply Chain"
          value={purchaseData ? formatCompactInr(purchaseData.totalBoughtPaise / 100) : '—'}
          sparkline={
            <Sparkline
              values={sparklines6M.purchases}
              width={85}
              height={32}
              showArea
              id="report-kpi-purchases"
            />
          }
          subtext={
            purchaseData
              ? `${formatCompactKg(purchaseData.totalBoughtKg)} scrap inward · Avg ₹${Math.round(purchaseData.avgProcuredRateKg)}/kg`
              : 'Module not active'
          }
          href="/purchase-dashboard"
        />

        {/* Pillar 3: Foundry Production */}
        <KpiCard
          label="Foundry Production"
          hint="Manufacturing"
          value={castingData ? formatCompactKg(castingData.wireOutKg) : '—'}
          sparkline={
            <Sparkline
              values={sparklines6M.casting}
              width={85}
              height={32}
              showArea
              id="report-kpi-casting"
            />
          }
          subtext={
            castingData
              ? `${castingData.safeYield.recoveryPct != null ? `${castingData.safeYield.recoveryPct}%` : '—'} recovery · Loaded ₹${Math.round(castingData.loadedCostPerKg)}/kg`
              : 'Module not active'
          }
          href="/casting"
        />

        {/* Pillar 4: Working Capital Liquidity */}
        <KpiCard
          label="Net Operating Cash"
          hint="Cash Realization"
          value={formatCompactInr(cashFlow.netCash)}
          tone={cashFlow.netCash >= 0 ? 'positive' : 'warning'}
          sparkline={
            <Sparkline
              values={sparklines6M.netCash}
              width={85}
              height={32}
              showArea
              id="report-kpi-cashflow"
            />
          }
          subtext={`In: ₹${formatCompactInr(cashFlow.cashIn)} · Out: ₹${formatCompactInr(cashFlow.cashOut)}`}
          href="/ledger"
        />
      </div>

      {/* 3. Three Operating Engines Side by Side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Engine 1: Sales Position */}
        <SectionCard
          title="Sales Position"
          actions={
            <Link
              to="/sales-dashboard"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 transition hover:text-blue-800"
            >
              Sales Dashboard <ArrowRight size={12} />
            </Link>
          }
        >
          <div className="space-y-3.5">
            <div className="flex items-baseline justify-between border-b border-slate-100 pb-2.5">
              <div>
                <p className="text-[11px] text-slate-500">Billed in Period</p>
                <p className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {salesData ? formatCompactInr(salesData.billedSales) : '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-slate-500">Collected</p>
                <p className="font-mono text-lg font-bold text-emerald-700 tabular-nums">
                  {salesData ? formatCompactInr(salesData.collectionsRealized) : '—'}
                </p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">Collection Realization</span>
                <span className="font-mono font-bold text-blue-700 tabular-nums">
                  {salesData ? `${salesData.realizationRate.toFixed(1)}%` : '0%'}
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-500"
                  style={{ width: `${Math.min(100, salesData?.realizationRate ?? 0)}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-lg border border-blue-50/70 bg-blue-50/20 p-2.5 text-xs">
              <div>
                <p className="text-[11px] text-slate-500">Open Receivables</p>
                <p className="font-mono font-bold text-slate-900 tabular-nums">
                  {salesData ? formatCompactInr(salesData.totalReceivable) : '—'}
                </p>
                <p className="text-[10px] text-slate-400">{salesData?.debtorList.length ?? 0} debtors</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Risk Overdue (&gt;60d)</p>
                <p className="font-mono font-bold text-rose-600 tabular-nums">
                  {salesData ? formatCompactInr(salesData.ageingBuckets.days61to90 + salesData.ageingBuckets.above90) : '—'}
                </p>
                <p className="text-[10px] text-slate-400">High priority collection</p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Engine 2: Purchase Position */}
        <SectionCard
          title="Purchase Position"
          actions={
            purchaseEnabled ? (
              <Link
                to="/purchase-dashboard"
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 transition hover:text-blue-800"
              >
                Purchase Dashboard <ArrowRight size={12} />
              </Link>
            ) : null
          }
        >
          {purchaseEnabled && purchaseData ? (
            <div className="space-y-3.5">
              <div className="flex items-baseline justify-between border-b border-slate-100 pb-2.5">
                <div>
                  <p className="text-[11px] text-slate-500">Scrap Procured</p>
                  <p className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {formatCompactInr(purchaseData.totalBoughtPaise / 100)}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400">{formatCompactKg(purchaseData.totalBoughtKg)} scrap</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-500">Paid Out</p>
                  <p className="font-mono text-lg font-bold text-emerald-700 tabular-nums">
                    {formatCompactInr(purchaseData.totalPaidPaise / 100)}
                  </p>
                  <p className="text-[10px] text-slate-400">{purchaseData.periodPayments.length} disbursements</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-[11px] text-slate-500">We Owe Suppliers</p>
                  <p className="font-mono font-bold text-blue-700 tabular-nums">
                    {formatCompactInr(purchaseData.totalWeOwePaise / 100)}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    K: {formatCompactInr(purchaseData.positions.kachaPayablePaise / 100)} · G: {formatCompactInr(purchaseData.positions.gstPayablePaise / 100)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Advance Held</p>
                  <p className="font-mono font-bold text-slate-900 tabular-nums">
                    {formatCompactInr(purchaseData.positions.totalAdvancePaise / 100)}
                  </p>
                  <p className="text-[10px] text-slate-400">With suppliers</p>
                </div>
              </div>

              <div className="rounded-lg border border-blue-50/70 bg-blue-50/20 p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-600 font-medium">Bardan Accountability</span>
                  <span className={cn(
                    'font-mono text-[11px] font-bold',
                    purchaseData.bardanSummary.oldestDays > 10 ? 'text-amber-700' : 'text-slate-600'
                  )}>
                    {purchaseData.bardanSummary.pendingLots} lots ({purchaseData.bardanSummary.totalBags} bags)
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {purchaseData.bardanSummary.oldestDays > 0 ? `Oldest unreturned lot: ${purchaseData.bardanSummary.oldestDays} days old` : 'All bardan reconciled'}
                </p>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              Purchase module is disabled in settings.
            </div>
          )}
        </SectionCard>

        {/* Engine 3: Casting Position */}
        <SectionCard
          title="Casting Position"
          actions={
            castingEnabled ? (
              <Link
                to="/casting"
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 transition hover:text-blue-800"
              >
                Casting Dashboard <ArrowRight size={12} />
              </Link>
            ) : null
          }
        >
          {castingEnabled && castingData ? (
            <div className="space-y-3.5">
              <div className="flex items-baseline justify-between border-b border-slate-100 pb-2.5">
                <div>
                  <p className="text-[11px] text-slate-500">Metal Charged</p>
                  <p className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {formatCompactKg(castingData.metalChargedKg)}
                  </p>
                  <p className="text-[10px] text-slate-400">{castingData.totalBatches} heats in period</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-500">Finished Wire Out</p>
                  <p className="font-mono text-lg font-bold text-blue-700 tabular-nums">
                    {formatCompactKg(castingData.wireOutKg)}
                  </p>
                  <p className="text-[10px] text-slate-400">{castingData.foundryActiveDays} operating days</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-600">Safe Metal Recovery</span>
                  <span className="font-mono font-bold text-emerald-700 tabular-nums">
                    {castingData.safeYield.recoveryPct != null ? `${castingData.safeYield.recoveryPct}%` : '—'}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all duration-500"
                    style={{ width: `${Math.min(100, castingData.safeYield.recoveryPct ?? 0)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  Melting loss: {castingData.safeYield.wastagePct != null ? `${castingData.safeYield.wastagePct}%` : '—'} ({formatCompactKg(castingData.totalMelWastageKg)})
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-lg border border-blue-50/70 bg-blue-50/20 p-2.5 text-xs">
                <div>
                  <p className="text-[11px] text-slate-500">Loaded Cost / kg</p>
                  <p className="font-mono font-bold text-slate-900 tabular-nums">
                    {castingData.loadedCostPerKg > 0 ? `₹${castingData.loadedCostPerKg.toFixed(2)}` : '—'}
                  </p>
                  <p className="text-[10px] text-slate-400">Metal + Coal + Labour</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Lowest Heat Run</p>
                  <p className="font-mono font-bold text-emerald-700 tabular-nums">
                    {castingData.bestSession ? `₹${castingData.bestSession.costPerKg.toFixed(2)}/kg` : '—'}
                  </p>
                  <p className="text-[10px] text-slate-400">Peak heat efficiency</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              Casting module is disabled in settings.
            </div>
          )}
        </SectionCard>
      </div>

      {/* 4. 12-Month Multi-Stream Company Rhythm */}
      <SectionCard
        title="12-Month Multi-Stream Company Rhythm"
        subtitle="Consolidated trajectory across commercial sales, procurement spend, and cash realization"
        actions={
          <span className="text-[11px] font-mono text-slate-400">
            {past12Months[0]} → {past12Months[past12Months.length - 1]}
          </span>
        }
      >
        <div className="space-y-4 pt-1">
          <TrendChart
            data={company12MTrend}
            xKey="month"
            series={[
              { dataKey: 'sales', name: 'Sales Billed (₹)', color: '#2563eb', type: 'bar' },
              { dataKey: 'purchases', name: 'Scrap Bought (₹)', color: '#f59e0b', type: 'bar' },
              { dataKey: 'collections', name: 'Collections In (₹)', color: '#059669', type: 'line' },
              { dataKey: 'paidOut', name: 'Disbursed Out (₹)', color: '#e11d48', type: 'line' },
            ]}
            height={260}
            formatY={(v) => formatCompactInr(v)}
            formatTooltip={(v) => formatInrInteger(v)}
            ariaLabel="12-Month Multi-Stream Company Trajectory"
          />

          {/* Monthly Breakdown Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2 text-right">Sales Billed</th>
                  <th className="px-3 py-2 text-right">Collections</th>
                  <th className="px-3 py-2 text-right">Scrap Purchases</th>
                  <th className="px-3 py-2 text-right">Payouts</th>
                  <th className="px-3 py-2 text-right">Wire Output</th>
                  <th className="px-3 py-2 text-right">Net Cash Flow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                {company12MTrend.map((row) => (
                  <tr key={row.month} className="hover:bg-blue-50/40 transition-colors">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-900 font-semibold">
                      {formatMonthYear(row.month)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-blue-700">
                      {formatInrInteger(row.sales)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-700">
                      {formatInrInteger(row.collections)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-700">
                      {formatInrInteger(row.purchases)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                      {formatInrInteger(row.paidOut)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                      {formatCompactKg(row.wireOut)}
                    </td>
                    <td className={cn(
                      'px-3 py-2 text-right font-mono tabular-nums font-bold',
                      row.netCash >= 0 ? 'text-emerald-700' : 'text-rose-600'
                    )}>
                      {row.netCash >= 0 ? `+${formatInrInteger(row.netCash)}` : `-${formatInrInteger(Math.abs(row.netCash))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>

      {/* 5. Commercial Intelligence & Supply Chain Deep-Dive */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Commercial & Customer Insights */}
        <SectionCard
          title="Top Commercial Customers & Debtors"
          subtitle="Top revenue contributors and largest active receivables requiring collection"
          actions={
            <Link
              to="/ledger"
              search={{ tab: 'customers' }}
              className="text-xs font-semibold text-blue-600 transition hover:text-blue-800"
            >
              Customer ledger →
            </Link>
          }
        >
          <div className="space-y-4 pt-1">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Top Customers by Sales Volume ({range.label})
              </p>
              <RankedBars
                rows={salesData?.topCustomersBySales.map((c) => ({
                  id: c.id,
                  label: c.name,
                  value: c.value,
                  subLabel: `${c.bags} bags billed`,
                  href: `/ledger?customerId=${c.id}&tab=customers`,
                })) ?? []}
                tone="blue"
                emptyText="No customer sales recorded for this period."
              />
            </div>

            <div className="border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Largest Outstanding Balances
              </p>
              <RankedBars
                rows={salesData?.topDebtors.map((d) => ({
                  id: d.id,
                  label: d.name,
                  value: d.amount,
                  ageDays: d.days,
                  ageLevel: d.days > 60 ? 'overdue' : d.days > 30 ? 'due' : 'watch',
                  href: `/ledger?customerId=${d.id}&tab=customers`,
                })) ?? []}
                tone="blue"
                emptyText="All customer balances are clear."
              />
            </div>

            {salesData && salesData.gasMetrics.totalKg > 0 && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">Gas Selling Margin vs Vilaity</span>
                  <span className={cn(
                    'font-mono font-bold',
                    salesData.gasMetrics.marginPerKg >= 0 ? 'text-emerald-700' : 'text-rose-600'
                  )}>
                    {salesData.gasMetrics.marginPerKg >= 0 ? `+₹${salesData.gasMetrics.marginPerKg.toFixed(2)}/kg premium` : `-₹${Math.abs(salesData.gasMetrics.marginPerKg).toFixed(2)}/kg discount`}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {formatCompactKg(salesData.gasMetrics.totalKg)} sold at avg ₹{salesData.gasMetrics.avgSellingRate.toFixed(2)}/kg (Vilaity benchmark: ₹{salesData.gasMetrics.avgMarketRate.toFixed(2)}/kg)
                </p>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Supply Chain & Supplier Intelligence */}
        <SectionCard
          title="Procurement & Supplier Settlements"
          subtitle="Top inward scrap vendors and outstanding payout priorities"
          actions={
            purchaseEnabled ? (
              <Link
                to="/ledger"
                search={{ tab: 'suppliers' }}
                className="text-xs font-semibold text-blue-600 transition hover:text-blue-800"
              >
                Supplier ledger →
              </Link>
            ) : null
          }
        >
          {purchaseEnabled && purchaseData ? (
            <div className="space-y-4 pt-1">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Top Scrap Vendors by Procurement Volume ({range.label})
                </p>
                <RankedBars
                  rows={purchaseData.topSuppliersBySpend.map((s) => ({
                    id: s.id,
                    label: s.name,
                    value: s.value,
                    subLabel: `${formatCompactKg(s.kg)} scrap inward`,
                    href: `/supplier-ledger/${s.id}`,
                  }))}
                  tone="blue"
                  emptyText="No scrap procurement recorded this period."
                />
              </div>

              <div className="border-t border-slate-100 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Pay Next: Largest Supplier Dues
                </p>
                <RankedBars
                  rows={purchaseData.topSuppliersOwed.map((s) => ({
                    id: s.id,
                    label: s.name,
                    value: s.amount,
                    subLabel: `Kacha ₹${formatCompactInr(s.kacha)} · GST ₹${formatCompactInr(s.gst)}`,
                    href: `/supplier-ledger/${s.id}`,
                  }))}
                  tone="blue"
                  emptyText="No supplier dues pending."
                />
              </div>

              {purchaseData.bardanSummary.pendingLots > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-900">Bardan (Gunny Bags) Action Required</span>
                    <span className="font-mono font-bold text-amber-800">
                      {purchaseData.bardanSummary.totalBags} bags pending return
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-amber-700">
                    Across {purchaseData.bardanSummary.pendingLots} inward lots · Oldest lot is {purchaseData.bardanSummary.oldestDays} days old
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-400">
              Purchase module is disabled in settings.
            </div>
          )}
        </SectionCard>
      </div>

      {/* 6. Working Capital Ageing Audit & Debtor Drilldown */}
      <SectionCard
        title="Receivable Ageing & Debtor Audit"
        subtitle="Distribution of outstanding customer balances by invoice maturity date"
        actions={
          <span className="text-xs font-semibold text-blue-700 font-mono">
            Total Outstanding: ₹{formatInrInteger(salesData?.totalReceivable ?? 0)}
          </span>
        }
      >
        <div className="space-y-4 pt-1">
          {/* Stacked Proportional Ageing Bar */}
          <StackedBar
            segments={[
              { key: '0-30', label: '0–30d (Current)', value: salesData?.ageingBuckets.current ?? 0, color: CHART_THEME.ageing.b0to30 },
              { key: '31-60', label: '31–60d (Due)', value: salesData?.ageingBuckets.days31to60 ?? 0, color: CHART_THEME.ageing.b31to60 },
              { key: '61-90', label: '61–90d (Watch)', value: salesData?.ageingBuckets.days61to90 ?? 0, color: '#ea580c' },
              { key: '90+', label: '90d+ (Overdue Risk)', value: salesData?.ageingBuckets.above90 ?? 0, color: CHART_THEME.ageing.b60plus },
            ]}
            formatValue={(v) => formatCompactInr(v)}
            emptyText="No customer receivables pending."
          />

          {/* Bucket Switcher */}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="text-xs font-semibold text-slate-500 mr-1">Filter Bucket:</span>
            {[
              { key: 'above90', label: '90d+ (Risk)', count: salesData?.ageingDebtors.above90.length ?? 0, color: 'text-rose-700 border-rose-200 bg-rose-50' },
              { key: 'days61to90', label: '61–90d', count: salesData?.ageingDebtors.days61to90.length ?? 0, color: 'text-orange-700 border-orange-200 bg-orange-50' },
              { key: 'days31to60', label: '31–60d', count: salesData?.ageingDebtors.days31to60.length ?? 0, color: 'text-amber-700 border-amber-200 bg-amber-50' },
              { key: 'current', label: '0–30d', count: salesData?.ageingDebtors.current.length ?? 0, color: 'text-blue-700 border-blue-200 bg-blue-50' },
            ].map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setSelectedAgingBucket(b.key as AgingBucketKey)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition-all',
                  selectedAgingBucket === b.key
                    ? `${b.color} font-bold shadow-sm ring-1 ring-blue-300`
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {b.label} <span className="font-mono text-[11px] opacity-75">({b.count})</span>
              </button>
            ))}
          </div>

          {/* Filtered Debtor Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">Customer Name</th>
                  <th className="px-3 py-2 text-right">Age (Days)</th>
                  <th className="px-3 py-2 text-right">Last Bill Date</th>
                  <th className="px-3 py-2 text-right">Outstanding Amount</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                {(salesData?.ageingDebtors[selectedAgingBucket] ?? []).slice(0, 10).map((row) => (
                  <tr key={row.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="px-3 py-2 text-slate-900 font-semibold">{row.name}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-bold',
                        row.days > 90 ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                        row.days > 60 ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                        row.days > 30 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-600'
                      )}>
                        {row.days}d
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500 text-[11px]">
                      {formatFullDate(row.lastDate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-blue-700">
                      {formatInrInteger(row.amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to="/ledger"
                        search={{ tab: 'customers' }}
                        className="rounded border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-medium text-blue-700 transition hover:bg-blue-50"
                      >
                        Ledger
                      </Link>
                    </td>
                  </tr>
                ))}
                {(salesData?.ageingDebtors[selectedAgingBucket]?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">
                      No customer balances in this ageing tier.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>

      {/* 7. Three-Year Financial Year Performance Comparison */}
      <SectionCard
        title="3-Year Financial Year Benchmark (Indian Fiscal Year)"
        subtitle="Annual multi-stream growth comparison across commercial turnover, procurement, and foundry operations"
        actions={
          <span className="text-[11px] font-mono text-slate-400">April 01 → March 31 Boundaries</span>
        }
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200 pt-1">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5">Financial Year</th>
                <th className="px-3 py-2.5 text-right">Sales Billed</th>
                <th className="px-3 py-2.5 text-right">Collections</th>
                <th className="px-3 py-2.5 text-right">Realization</th>
                <th className="px-3 py-2.5 text-right">Scrap Purchases</th>
                <th className="px-3 py-2.5 text-right">Supplier Payouts</th>
                <th className="px-3 py-2.5 text-right">Net Operating Cash</th>
                <th className="px-3 py-2.5 text-right">Finished Wire</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {fy3YearBenchmark.map((fy) => (
                <tr key={fy.label} className={cn('transition-colors', fy.isCurrent ? 'bg-blue-50/20 hover:bg-blue-50/50' : 'hover:bg-slate-50/60')}>
                  <td className="whitespace-nowrap px-3 py-3 font-mono font-bold text-slate-900">
                    {fy.label} {fy.isCurrent && <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Current</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums text-blue-700">
                    {formatInrInteger(fy.sales)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums text-emerald-700">
                    {formatInrInteger(fy.collections)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-700">
                    {fy.efficiency.toFixed(1)}%
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-amber-700">
                    {formatInrInteger(fy.purchases)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-700">
                    {formatInrInteger(fy.paidOut)}
                  </td>
                  <td className={cn(
                    'px-3 py-3 text-right font-mono font-bold tabular-nums',
                    fy.netCash >= 0 ? 'text-emerald-700' : 'text-rose-600'
                  )}>
                    {fy.netCash >= 0 ? `+${formatInrInteger(fy.netCash)}` : `-${formatInrInteger(Math.abs(fy.netCash))}`}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-600">
                    {formatCompactKg(fy.wireOut)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}
