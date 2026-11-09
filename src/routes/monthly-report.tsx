import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  CircleDollarSign,
  Download,
  Landmark,
  ReceiptText,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadDashboardCollections } from '@/data/dashboard'
import { purchaseReadModelQueryOptions } from '@/data/purchase-queries'
import { loadCastingSessions } from '@/data/casting'
import { useModuleSettings } from '@/lib/use-module-settings'
import { computeBillNet } from '@/domain/supplier-purchases'
import { computeSupplierPositions } from '@/domain/supplier-settlement'
import { computeSafeRecoveryAndWastage } from '@/domain/casting-dashboard-calculations'
import { fiscalYearStart } from '@/domain/dashboard'
import { formatCompactInr, formatCompactKg, formatInrInteger, formatPaiseInr } from '@/lib/inr-format'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { buildGasSalesReport, type GasSalesGroup } from '@/domain/gas-sales-reporting'
import { computeCustomerOutstanding, type CanonicalBillRecord, type CanonicalPaymentRecord } from '@/domain/records'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { exportNodeAsJpg } from '@/lib/image-export'
import { Panel } from '@/components/ui/panel'
import { SectionCard } from '@/components/ui/business-kit'
import { Sparkline } from '@/components/charts/sparkline'
import {
  CollectionEfficiencyGauge,
  GasSellingRateTrendChart,
  ReceivableAgingBars,
  SalesCollectionTrendChart,
  WeeklySalesChart,
  type AgingBucketKey,
} from '@/components/reports/company-charts'

export const Route = createFileRoute('/monthly-report')({
  component: ReportPage,
})

function ReportPage() {
  const reportRef = useRef<HTMLDivElement>(null)
  const [exportError, setExportError] = useState('')
  const { purchaseEnabled, castingEnabled } = useModuleSettings()
  const actualToday = useMemo(() => getLocalIsoDate(), [])
  const currentFiscalYear = Number(fiscalYearStart(actualToday.slice(0, 7)).slice(0, 4))
  const [selectedFiscalYear, setSelectedFiscalYear] = useState(currentFiscalYear)
  const today = selectedFiscalYear === currentFiscalYear ? actualToday : `${selectedFiscalYear + 1}-03-31`
  const periodFrom = `${selectedFiscalYear}-04-01`
  const [selectedAgingBucket, setSelectedAgingBucket] = useState<AgingBucketKey>('above90')
  const [selectedGasMonth, setSelectedGasMonth] = useState(() => today.slice(0, 7))

  useEffect(() => setSelectedGasMonth(today.slice(0, 7)), [today])

  // Queries
  const reportQuery = useQuery({
    queryKey: ['company-report', today],
    queryFn: loadDashboardCollections,
  })

  const purchaseQuery = useQuery({
    ...purchaseReadModelQueryOptions(),
    enabled: purchaseEnabled,
  })

  const castingQuery = useQuery({
    queryKey: ['company-report-casting', periodFrom, today],
    queryFn: () => loadCastingSessions({ from: periodFrom, to: today }),
    enabled: castingEnabled,
  })

  // Module summaries
  const purchaseSummary = useMemo(() => {
    const data = purchaseQuery.data
    if (!data) return null
    const positions = computeSupplierPositions(data.summaries)
    let rcm = 0
    for (const bill of data.bills) {
      if (!bill.cancelled && bill.date >= periodFrom && bill.date <= today && bill.taxMode === 'rcm') {
        rcm += computeBillNet(bill.lines, bill.adjustments, bill.bardan, bill.taxMode, bill.gstRateBp).rcmLiabilityPaise
      }
    }
    return {
      kacha: positions.kachaPayablePaise,
      gst: positions.gstPayablePaise,
      totalOwed: positions.kachaPayablePaise + positions.gstPayablePaise,
      rcm,
      bills: data.bills.filter((bill) => !bill.cancelled && bill.date >= periodFrom && bill.date <= today).length,
    }
  }, [purchaseQuery.data, periodFrom, today])

  const castingSummary = useMemo(() => {
    const rows = castingQuery.data ?? []
    const input = rows.reduce((sum, row) => sum + row.totalInputKg, 0)
    const output = rows.reduce((sum, row) => sum + row.totalWireOut, 0)
    const cost = rows.reduce((sum, row) => sum + row.totalInputCost, 0)
    const mel = rows.reduce((sum, row) => sum + (row.totalMel || row.wastage || 0), 0)
    const chol = rows.reduce((sum, row) => sum + row.cholIn, 0)
    const costPerKg = output > 0 ? cost / output : 0
    return {
      sessions: rows.length,
      input,
      output,
      wastageKg: mel,
      chol,
      costPerKg,
    }
  }, [castingQuery.data])

  const safeCastingYield = useMemo(
    () =>
      computeSafeRecoveryAndWastage(
        castingSummary.output,
        castingSummary.wastageKg,
        castingSummary.input,
      ),
    [castingSummary.output, castingSummary.wastageKg, castingSummary.input],
  )

  // Report calculations
  const report = useMemo(() => {
    const data = reportQuery.data
    if (!data) {
      return {
        overall: {
          totalSales: 0,
          totalCollections: 0,
          receivable: 0,
          advanceFromCustomers: 0,
          activeCustomers: 0,
          customerCount: 0,
          billCount: 0,
          averageBillValue: 0,
          averageCollectionDays: 0,
          collectionEfficiencyPct: 0,
          collectionEfficiencyDeltaPct: 0,
          gstCollectedEstimate: 0,
        },
        thisMonth: { sales: 0, collections: 0, gstEstimate: 0, bills: 0 },
        lastMonth: { sales: 0, collections: 0 },
        thisFinancialYear: { sales: 0, collections: 0 },
        monthlyTrend: [] as Array<{ month: string; sales: number; collections: number }>,
        financialYearSummary: [] as Array<{ label: string; sales: number; collections: number; gap: number }>,
        dailySalesHeatmap: [] as Array<{ date: string; sales: number; bags: number }>,
        receivableAging: { current: 0, days31to60: 0, days61to90: 0, above90: 0 },
        receivableAgingCustomers: {
          current: [] as Array<{ customerId: string; name: string; amount: number; dueDays: number }>,
          days31to60: [] as Array<{ customerId: string; name: string; amount: number; dueDays: number }>,
          days61to90: [] as Array<{ customerId: string; name: string; amount: number; dueDays: number }>,
          above90: [] as Array<{ customerId: string; name: string; amount: number; dueDays: number }>,
        },
        topCustomersBySales: [] as Array<{ customerId: string; name: string; value: number }>,
        topCustomersByOutstanding: [] as Array<{ customerId: string; name: string; value: number }>,
      }
    }

    const nowDate = new Date(`${today}T00:00:00`)
    const monthKey = today.slice(0, 7)
    const lastMonthKey = shiftMonth(monthKey, -1)

    const bills = data.billsRaw
    const billItems = data.billItemsRaw
    const payments = data.paymentsRaw
    const customers = data.customersRaw
    const canonicalBills: CanonicalBillRecord[] = bills.map((bill) => ({
      id: bill.id,
      businessDate: str(bill.date).slice(0, 10),
      createdAt: str(bill.created),
      customerId: str(bill.customer),
      customerName: str(bill.customer_name),
      bookNo: num(bill.book_no),
      billNo: num(bill.bill_no),
      total: 0,
      mktRate: num(bill.mkt),
      transport: num(bill.transport),
      gstRate: num(bill.gst_rate),
      gstAmount: num(bill.gst_amount),
      lrNo: str(bill.lr_no),
    }))
    const canonicalPayments: CanonicalPaymentRecord[] = payments.map((payment) => ({
      id: payment.id,
      businessDate: str(payment.date).slice(0, 10),
      createdAt: str(payment.created),
      customerId: str(payment.customer),
      customerName: str(payment.customer_name),
      amount: num(payment.amount),
      mode: str(payment.mode),
      note: str(payment.note),
    }))

    const itemSumByBill = new Map<string, number>()
    const itemBagsByBill = new Map<string, number>()
    for (const item of billItems) {
      const billId = str(item.bill)
      itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(item.amount))
      itemBagsByBill.set(billId, (itemBagsByBill.get(billId) ?? 0) + num(item.bags))
    }

    const customerNameById = new Map<string, string>()
    const openingByCustomer = new Map<string, number>()
    const openingDateByCustomer = new Map<string, string>()
    let activeCustomers = 0
    for (const customer of customers) {
      const id = customer.id
      customerNameById.set(id, formatCustomerDisplayName(customer.company_name, customer.name))
      openingByCustomer.set(id, num(customer.opening_balance))
      openingDateByCustomer.set(id, str(customer.opening_balance_date).slice(0, 10))
      if (customer.active) activeCustomers += 1
    }

    let totalSales = 0
    let totalCollections = 0
    let totalGst = 0
    let billCount = 0
    const monthlyMap = new Map<string, { sales: number; collections: number }>()
    const dailySalesMap = new Map<string, number>()
    const dailyBagsMap = new Map<string, number>()
    const customerSalesMap = new Map<string, number>()
    const customerOutstandingMap = new Map<string, number>()
    const customerLatestBillDate = new Map<string, string>()

    for (const [customerId, opening] of openingByCustomer.entries()) {
      customerOutstandingMap.set(customerId, opening)
      customerLatestBillDate.set(customerId, openingDateByCustomer.get(customerId) ?? '')
    }

    for (const bill of bills) {
      const billDate = str(bill.date).slice(0, 10)
      if (!billDate || billDate > today) continue
      const base = itemSumByBill.get(bill.id) ?? 0
      const transport = num(bill.transport)
      const gstRate = num(bill.gst_rate)
      const gstAmount = num(bill.gst_amount) > 0 ? num(bill.gst_amount) : (base * gstRate) / 100
      const billTotal = calculateBillTotalFromBase(base, transport, gstRate, gstAmount)
      const customerId = str(bill.customer)
      const billMonth = billDate.slice(0, 7)

      totalSales += billTotal
      totalGst += gstAmount
      billCount += 1
      dailySalesMap.set(billDate, (dailySalesMap.get(billDate) ?? 0) + billTotal)
      dailyBagsMap.set(billDate, (dailyBagsMap.get(billDate) ?? 0) + (itemBagsByBill.get(bill.id) ?? 0))
      customerSalesMap.set(customerId, (customerSalesMap.get(customerId) ?? 0) + billTotal)
      const monthly = monthlyMap.get(billMonth) ?? { sales: 0, collections: 0 }
      monthly.sales += billTotal
      monthlyMap.set(billMonth, monthly)
      const latest = customerLatestBillDate.get(customerId) ?? ''
      if (!latest || billDate > latest) customerLatestBillDate.set(customerId, billDate)
    }

    for (const payment of payments) {
      const paymentDate = str(payment.date).slice(0, 10)
      if (!paymentDate || paymentDate > today) continue
      const amount = num(payment.amount)
      const paymentMonth = paymentDate.slice(0, 7)
      totalCollections += amount
      const monthly = monthlyMap.get(paymentMonth) ?? { sales: 0, collections: 0 }
      monthly.collections += amount
      monthlyMap.set(paymentMonth, monthly)
    }

    for (const [customerId, openingBalance] of openingByCustomer.entries()) {
      const rollup = computeCustomerOutstanding({
        openingBalance,
        bills: canonicalBills
          .filter((bill) => bill.customerId === customerId)
          .map((bill) => ({
            ...bill,
            total: calculateBillTotalFromBase(
              itemSumByBill.get(bill.id) ?? 0,
              bill.transport ?? 0,
              bill.gstRate ?? 0,
              bill.gstAmount,
            ),
          })),
        payments: canonicalPayments.filter((payment) => payment.customerId === customerId),
        asOfDate: today,
      })
      customerOutstandingMap.set(customerId, rollup.netBalance)
    }

    const monthlyTrend = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, values]) => ({
        month,
        sales: values.sales,
        collections: values.collections,
      }))

    const thisMonth = monthlyMap.get(monthKey) ?? { sales: 0, collections: 0 }
    const lastMonth = monthlyMap.get(lastMonthKey) ?? { sales: 0, collections: 0 }
    const thisMonthEfficiency = thisMonth.sales > 0 ? (thisMonth.collections / thisMonth.sales) * 100 : 0
    const lastMonthEfficiency = lastMonth.sales > 0 ? (lastMonth.collections / lastMonth.sales) * 100 : 0
    const currentFyStartYear = getFinancialYearStartYear(monthKey)
    const thisFinancialYear = monthlyTrend.reduce(
      (acc, row) => {
        if (getFinancialYearStartYear(row.month) === currentFyStartYear) {
          acc.sales += row.sales
          acc.collections += row.collections
        }
        return acc
      },
      { sales: 0, collections: 0 },
    )

    const fyStartYears = [currentFyStartYear, currentFyStartYear - 1, currentFyStartYear - 2]
    const financialYearSummary = fyStartYears.map((startYear) => {
      const months = getFinancialYearMonths(startYear)
      const totals = months.reduce(
        (acc, m) => {
          const values = monthlyMap.get(m) ?? { sales: 0, collections: 0 }
          acc.sales += values.sales
          acc.collections += values.collections
          return acc
        },
        { sales: 0, collections: 0 },
      )
      return {
        label: `FY ${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`,
        sales: totals.sales,
        collections: totals.collections,
        gap: Math.max(0, totals.sales - totals.collections),
      }
    })

    const heatmapStart = new Date(`${today}T00:00:00`)
    heatmapStart.setDate(heatmapStart.getDate() - 364)
    const dailySalesHeatmap: Array<{ date: string; sales: number; bags: number }> = []
    for (const date of eachDayInclusive(heatmapStart, new Date(`${today}T00:00:00`))) {
      const key = toIsoDate(date)
      dailySalesHeatmap.push({ date: key, sales: dailySalesMap.get(key) ?? 0, bags: dailyBagsMap.get(key) ?? 0 })
    }

    const receivable = Math.max(
      0,
      [...customerOutstandingMap.values()].reduce((sum, value) => sum + (value > 0 ? value : 0), 0),
    )
    const advanceFromCustomers = Math.abs(
      [...customerOutstandingMap.values()].reduce((sum, value) => sum + (value < 0 ? value : 0), 0),
    )
    const averageBillValue = billCount > 0 ? totalSales / billCount : 0
    const recent30dSales = bills
      .filter((bill) => {
        const date = str(bill.date).slice(0, 10)
        const billDate = new Date(`${date}T00:00:00`)
        return (
          date <= today &&
          Number.isFinite(billDate.getTime()) &&
          (nowDate.getTime() - billDate.getTime()) / (24 * 60 * 60 * 1000) <= 30
        )
      })
      .reduce((sum, bill) => {
        const base = itemSumByBill.get(bill.id) ?? 0
        return sum + calculateBillTotalFromBase(base, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount))
      }, 0)
    const avgDailyRecentSales = recent30dSales / 30
    const averageCollectionDays = avgDailyRecentSales > 0 ? receivable / avgDailyRecentSales : 0
    const collectionEfficiencyPct = totalSales > 0 ? (totalCollections / totalSales) * 100 : 0
    const collectionEfficiencyDeltaPct = thisMonthEfficiency - lastMonthEfficiency

    const receivableAging = { current: 0, days31to60: 0, days61to90: 0, above90: 0 }
    const receivableAgingCustomers = {
      current: [] as Array<{ customerId: string; name: string; amount: number; dueDays: number }>,
      days31to60: [] as Array<{ customerId: string; name: string; amount: number; dueDays: number }>,
      days61to90: [] as Array<{ customerId: string; name: string; amount: number; dueDays: number }>,
      above90: [] as Array<{ customerId: string; name: string; amount: number; dueDays: number }>,
    }
    for (const [customerId, outstanding] of customerOutstandingMap.entries()) {
      if (outstanding <= 0) continue
      const dueDays = dateDiffDays(customerLatestBillDate.get(customerId) ?? today, today)
      const row = { customerId, name: customerNameById.get(customerId) ?? 'Unknown', amount: outstanding, dueDays }
      if (dueDays <= 30) {
        receivableAging.current += outstanding
        receivableAgingCustomers.current.push(row)
      } else if (dueDays <= 60) {
        receivableAging.days31to60 += outstanding
        receivableAgingCustomers.days31to60.push(row)
      } else if (dueDays <= 90) {
        receivableAging.days61to90 += outstanding
        receivableAgingCustomers.days61to90.push(row)
      } else {
        receivableAging.above90 += outstanding
        receivableAgingCustomers.above90.push(row)
      }
    }
    receivableAgingCustomers.current.sort((a, b) => b.amount - a.amount)
    receivableAgingCustomers.days31to60.sort((a, b) => b.amount - a.amount)
    receivableAgingCustomers.days61to90.sort((a, b) => b.amount - a.amount)
    receivableAgingCustomers.above90.sort((a, b) => b.amount - a.amount)

    const topCustomersBySales = [...customerSalesMap.entries()]
      .map(([id, value]) => ({ customerId: id, name: customerNameById.get(id) ?? 'Unknown', value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
    const topCustomersByOutstanding = [...customerOutstandingMap.entries()]
      .filter(([, value]) => value > 0)
      .map(([id, value]) => ({ customerId: id, name: customerNameById.get(id) ?? 'Unknown', value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    return {
      overall: {
        totalSales,
        totalCollections,
        receivable,
        advanceFromCustomers,
        activeCustomers,
        customerCount: customers.length,
        billCount,
        averageBillValue,
        averageCollectionDays,
        collectionEfficiencyPct,
        collectionEfficiencyDeltaPct,
        gstCollectedEstimate: totalGst,
      },
      thisMonth: {
        sales: thisMonth.sales,
        collections: thisMonth.collections,
        gstEstimate: thisMonth.sales > 0 && totalSales > 0 ? (thisMonth.sales / totalSales) * totalGst : 0,
        bills: bills.filter((bill) => str(bill.date).slice(0, 7) === monthKey).length,
      },
      lastMonth,
      thisFinancialYear,
      monthlyTrend,
      financialYearSummary,
      dailySalesHeatmap,
      receivableAging,
      receivableAgingCustomers,
      topCustomersBySales,
      topCustomersByOutstanding,
    }
  }, [reportQuery.data, today])

  const gasSales = useMemo(() => {
    const data = reportQuery.data
    if (!data) {
      const empty = buildGasSalesReport({ bills: [], lines: [] })
      return { all: empty, selected: empty, previous: empty }
    }
    const customerNameById = new Map(
      data.customersRaw.map((row) => [row.id, formatCustomerDisplayName(row.company_name, row.name)]),
    )
    const itemById = new Map(data.itemsRaw.map((row) => [row.id, row]))
    const itemByName = new Map(data.itemsRaw.map((row) => [str(row.name).trim().toLowerCase(), row]))
    const bills = data.billsRaw
      .filter((bill) => str(bill.date).slice(0, 10) <= today)
      .map((bill) => ({
        id: bill.id,
        date: str(bill.date).slice(0, 10),
        customerId: str(bill.customer),
        customerName: customerNameById.get(str(bill.customer)) ?? str(bill.customer_name) ?? 'Unknown customer',
        marketRate: num(bill.mkt),
        gstRate: num(bill.gst_rate),
        gstAmount: num(bill.gst_amount),
      }))
    const validBillIds = new Set(bills.map((bill) => bill.id))
    const lines = data.billItemsRaw
      .filter((line) => validBillIds.has(str(line.bill)))
      .map((line) => {
        const item = itemById.get(str(line.item)) ?? itemByName.get(str(line.item_name).trim().toLowerCase())
        return {
          billId: str(line.bill),
          itemId: str(line.item) || str(line.item_name).trim().toLowerCase(),
          itemName: str(line.item_name) || str(item?.name) || 'Unknown item',
          itemType: str(item?.type) || 'gas',
          qty: num(line.qty),
          bags: num(line.bags),
          amount: num(line.amount),
        }
      })
    const previousMonth = shiftMonth(selectedGasMonth, -1)
    return {
      all: buildGasSalesReport({ bills, lines }),
      selected: buildGasSalesReport({
        bills: bills.filter((bill) => bill.date.startsWith(selectedGasMonth)),
        lines,
      }),
      previous: buildGasSalesReport({
        bills: bills.filter((bill) => bill.date.startsWith(previousMonth)),
        lines,
      }),
    }
  }, [reportQuery.data, selectedGasMonth, today])

  const heatmapSummary = useMemo(() => buildHeatmapSummary(report.dailySalesHeatmap), [report.dailySalesHeatmap])
  const highestOutstandingCustomer = report.topCustomersByOutstanding[0] ?? null
  const overdueCustomersCount = report.receivableAgingCustomers.above90.length
  const monthlyCashGap = report.thisMonth.sales - report.thisMonth.collections
  const salesDelta = report.thisMonth.sales - report.lastMonth.sales
  const collectionEfficiencyStatus = getEfficiencyStatus(report.overall.collectionEfficiencyPct)

  function downloadSummaryCsv() {
    const rows: Array<[string, string]> = [
      ['Metric', 'Value'],
      ['Financial Year', `${selectedFiscalYear}-${selectedFiscalYear + 1}`],
      ['Sales to date', String(report.overall.totalSales)],
      ['Collections to date', String(report.overall.totalCollections)],
      ['Receivable as of date', String(report.overall.receivable)],
      ['FY Sales', String(report.thisFinancialYear.sales)],
      ['FY Collections', String(report.thisFinancialYear.collections)],
    ]
    if (purchaseEnabled && purchaseSummary) {
      rows.push(
        ['Current Kacha payable paise', String(purchaseSummary.kacha)],
        ['Current GST payable paise', String(purchaseSummary.gst)],
        ['FY RCM liability paise', String(purchaseSummary.rcm)],
        ['FY Purchase bills', String(purchaseSummary.bills)],
      )
    }
    if (castingEnabled) {
      rows.push(
        ['FY Casting sessions', String(castingSummary.sessions)],
        ['FY Wire out kg', String(castingSummary.output)],
        ['FY Wastage percent', String(safeCastingYield.wastagePct ?? 0)],
        ['FY Chol in kg', String(castingSummary.chol)],
        ['FY Casting cost per kg', String(castingSummary.costPerKg)],
      )
    }
    const content = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `company-report-fy-${selectedFiscalYear}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function downloadReportJpg() {
    if (!reportRef.current) return
    setExportError('')
    try {
      await exportNodeAsJpg(reportRef.current, {
        filename: `company-report-fy-${selectedFiscalYear}.jpg`,
        backgroundColor: '#f1f5f9',
        preferredWidthPx: 1600,
      })
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not export the report image.')
    }
  }

  const selectedBucketLabel =
    selectedAgingBucket === 'above90'
      ? '90+ Days (High Risk)'
      : selectedAgingBucket === 'days61to90'
        ? '61–90 Days'
        : selectedAgingBucket === 'days31to60'
          ? '31–60 Days'
          : '0–30 Days (Current)'

  return (
    <div ref={reportRef} className="w-full space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {/* 1. Executive Top Bar Card */}
      <Panel className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
              <Landmark size={15} />
            </span>
            <h1 className="text-base font-bold text-slate-950">Company Executive Report</h1>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Consolidated performance, cross-module financial standing, and executive health intelligence.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600">
            <Calendar size={13} className="text-blue-600" />
            As of {formatFullDate(today)}
          </span>

          <div className="flex items-center gap-1.5">
            <label htmlFor="company-report-fy" className="text-xs font-semibold text-slate-700">
              FY:
            </label>
            <select
              id="company-report-fy"
              value={selectedFiscalYear}
              onChange={(event) => setSelectedFiscalYear(Number(event.target.value))}
              aria-label="Financial Year"
              className="h-8.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400/30"
            >
              {Array.from({ length: 5 }, (_, index) => currentFiscalYear - index).map((year) => (
                <option key={year} value={year}>
                  FY {year}–{String(year + 1).slice(-2)}
                  {year === currentFiscalYear ? ' to date' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadSummaryCsv}
              className="inline-flex h-8.5 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Download size={13} /> Summary CSV
            </button>
            <button
              type="button"
              onClick={() => void downloadReportJpg()}
              className="inline-flex h-8.5 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <Download size={13} /> Export JPG
            </button>
          </div>
        </div>
      </Panel>

      {exportError && (
        <Panel role="alert" className="rounded-xl border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          {exportError}
        </Panel>
      )}

      {/* 2. Three Modules Snapshot (Sales, Purchase, Casting side by side) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Sales Module Overview */}
        <SectionCard
          title="Sales Position"
          subtitle="Customer billing & receivables"
          actions={
            <Link
              to="/sales-dashboard"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
            >
              Sales Dashboard <ArrowRight size={12} />
            </Link>
          }
        >
          <div className="space-y-3">
            <div>
              <span className="text-xs font-medium text-slate-500">FY Billed Turnover</span>
              <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                {formatInrInteger(report.thisFinancialYear.sales)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 text-xs">
              <div>
                <span className="text-[11px] text-slate-500">Collections</span>
                <p className="font-mono font-semibold text-emerald-700">
                  {formatInrInteger(report.thisFinancialYear.collections)}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-slate-500">Open Receivable</span>
                <p className="font-mono font-semibold text-slate-900">
                  {formatInrInteger(report.overall.receivable)}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-slate-500">Efficiency</span>
                <p className="font-mono font-semibold text-blue-700">
                  {Math.round(report.overall.collectionEfficiencyPct)}%
                </p>
              </div>
              <div>
                <span className="text-[11px] text-slate-500">Active Customers</span>
                <p className="font-mono font-semibold text-slate-700">
                  {report.overall.activeCustomers} / {report.overall.customerCount}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Purchase Module Overview */}
        {purchaseEnabled && (
          <SectionCard
            title="Purchase Position"
            subtitle="Procurement & supplier dues"
            actions={
              <Link
                to="/purchase-dashboard"
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                Purchase Dashboard <ArrowRight size={12} />
              </Link>
            }
          >
            {purchaseQuery.isError ? (
              <p className="text-xs text-rose-600">Failed to load purchase figures.</p>
            ) : purchaseSummary ? (
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-medium text-slate-500">Total Supplier Dues</span>
                  <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                    {formatPaiseInr(purchaseSummary.totalOwed)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-500">Kacha Pool</span>
                    <p className="font-mono font-semibold text-slate-800">
                      {formatPaiseInr(purchaseSummary.kacha)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">GST Pool</span>
                    <p className="font-mono font-semibold text-slate-800">
                      {formatPaiseInr(purchaseSummary.gst)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">FY RCM Liability</span>
                    <p className="font-mono font-semibold text-amber-700">
                      {formatPaiseInr(purchaseSummary.rcm)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">FY Purchases</span>
                    <p className="font-mono font-semibold text-slate-700">
                      {purchaseSummary.bills} bills
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
            )}
          </SectionCard>
        )}

        {/* Casting Module Overview */}
        {castingEnabled && (
          <SectionCard
            title="Casting Position"
            subtitle="Foundry heats & loaded cost"
            actions={
              <Link
                to="/casting"
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                Casting Dashboard <ArrowRight size={12} />
              </Link>
            }
          >
            {castingQuery.isError ? (
              <p className="text-xs text-rose-600">Failed to load casting figures.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-medium text-slate-500">Wire Output (FY)</span>
                  <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                    {formatCompactKg(castingSummary.output)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-500">Foundry Runs</span>
                    <p className="font-mono font-semibold text-slate-800">
                      {castingSummary.sessions} sessions
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">Metal Charged</span>
                    <p className="font-mono font-semibold text-slate-800">
                      {formatCompactKg(castingSummary.input)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">Loaded Cost</span>
                    <p className="font-mono font-semibold text-blue-700">
                      {castingSummary.costPerKg > 0 ? `₹${castingSummary.costPerKg.toFixed(2)}/kg` : '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">Wastage %</span>
                    <p className="font-mono font-semibold text-amber-700">
                      {safeCastingYield.wastagePct != null ? `${safeCastingYield.wastagePct}%` : '—'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        )}
      </div>

      {reportQuery.isLoading && (
        <Panel className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading executive report metrics...
        </Panel>
      )}

      {reportQuery.isError && (
        <Panel role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">
          <AlertCircle className="mx-auto mb-2 text-rose-600" size={24} />
          Unable to load company report. Please check server connectivity.
        </Panel>
      )}

      {!reportQuery.isLoading && !reportQuery.isError && (
        <>
          {/* 3. Executive KPI Health Tiles Row (5 Cards) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <ExecutiveKpiTile
              title="Total Sales"
              value={formatInrInteger(report.overall.totalSales)}
              trend={report.thisMonth.sales - report.lastMonth.sales}
              trendLabel="vs last month"
              status={salesDelta >= 0 ? 'Healthy' : 'Warning'}
              icon={<TrendingUp size={18} />}
              sparkline={report.monthlyTrend.map((row) => row.sales)}
            />
            <ExecutiveKpiTile
              title="Total Collections"
              value={formatInrInteger(report.overall.totalCollections)}
              trend={report.thisMonth.collections - report.lastMonth.collections}
              trendLabel="vs last month"
              status={report.thisMonth.collections >= report.lastMonth.collections ? 'Healthy' : 'Warning'}
              icon={<Landmark size={18} />}
              sparkline={report.monthlyTrend.map((row) => row.collections)}
            />
            <ExecutiveKpiTile
              title="Receivable"
              value={formatInrInteger(report.overall.receivable)}
              trend={report.overall.receivable}
              trendLabel="open balance"
              status={report.receivableAging.above90 > 0 ? 'Risk' : report.overall.receivable > 0 ? 'Warning' : 'Healthy'}
              icon={<AlertTriangle size={18} />}
              progress={boundedPct(report.overall.receivable, Math.max(report.overall.totalSales, report.overall.receivable))}
            />
            <ExecutiveKpiTile
              title="Collection Efficiency"
              value={`${Math.round(report.overall.collectionEfficiencyPct)}%`}
              trend={report.overall.collectionEfficiencyDeltaPct}
              trendLabel="pp vs last month"
              status={collectionEfficiencyStatus}
              icon={<CheckCircle2 size={18} />}
              progress={Math.min(100, report.overall.collectionEfficiencyPct)}
            />
            <ExecutiveKpiTile
              title="Monthly Cash Gap"
              value={formatDelta(monthlyCashGap)}
              trend={-monthlyCashGap}
              trendLabel="collections - sales"
              status={monthlyCashGap > 0 ? 'Warning' : 'Healthy'}
              icon={<CircleDollarSign size={18} />}
              sparkline={report.monthlyTrend.map((row) => row.collections - row.sales)}
            />
          </div>

          {/* 4. Priority Action Center */}
          <SectionCard
            title="Priority Signals"
            subtitle="Executive action triggers and overdue exposure"
            actions={
              <Link
                to="/ledger"
                search={{
                  customerId: highestOutstandingCustomer?.customerId ?? '',
                  focus: 'overdue',
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Collect from Overdue Parties <ArrowRight size={13} />
              </Link>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <PrioritySignalTile
                icon={<AlertTriangle size={16} />}
                status={overdueCustomersCount > 0 ? 'Risk' : 'Healthy'}
                label="Overdue Customers"
                value={`${overdueCustomersCount}`}
                detail={overdueCustomersCount > 0 ? '90+ day follow-up required' : 'No high-risk overdue bucket'}
              />
              <PrioritySignalTile
                icon={<CircleDollarSign size={16} />}
                status="Warning"
                label="Highest Outstanding"
                value={highestOutstandingCustomer ? formatInrInteger(highestOutstandingCustomer.value) : '—'}
                detail={highestOutstandingCustomer?.name ?? 'No debtor recorded'}
              />
              <PrioritySignalTile
                icon={<TrendingUp size={16} />}
                status={salesDelta >= 0 ? 'Healthy' : 'Warning'}
                label="Sales Movement"
                value={salesDelta >= 0 ? 'Rising' : 'Dropping'}
                detail={`${formatDelta(salesDelta)} vs previous month`}
              />
              <PrioritySignalTile
                icon={<CheckCircle2 size={16} />}
                status={collectionEfficiencyStatus}
                label="Collection Pace"
                value={`${Math.round(report.overall.collectionEfficiencyPct)}%`}
                detail={`${collectionEfficiencyStatus} collection efficiency`}
              />
              <PrioritySignalTile
                icon={<ReceiptText size={16} />}
                status="Neutral"
                label="GST Collected (Est.)"
                value={formatInrInteger(report.thisMonth.gstEstimate)}
                detail="Estimated for this month"
              />
            </div>
          </SectionCard>

          {/* 5. Main Analytics: Sales vs Collections Trend & Receivables Ageing */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            {/* Sales vs Collections Trend (8 cols, spans 2 rows) */}
            <SectionCard
              title="Sales vs Collections Trend"
              subtitle="Monthly comparison of billed turnover, cash realization, and cash gap"
              className="xl:col-span-8 xl:row-span-2"
            >
              <SalesCollectionTrendChart data={report.monthlyTrend} />
            </SectionCard>

            {/* Collection Efficiency (4 cols) */}
            <SectionCard
              title="Collection Progress"
              subtitle="Collected against billed turnover"
              className="xl:col-span-4"
            >
              <CollectionEfficiencyGauge
                value={report.overall.collectionEfficiencyPct}
                tone={
                  collectionEfficiencyStatus === 'Healthy'
                    ? 'green'
                    : collectionEfficiencyStatus === 'Warning'
                      ? 'amber'
                      : 'red'
                }
              />
            </SectionCard>

            {/* Ageing Distribution (4 cols) */}
            <SectionCard
              title="Receivable Ageing Distribution"
              subtitle="Click a bucket to filter customer drill-down below"
              className="xl:col-span-4"
            >
              <ReceivableAgingBars
                aging={report.receivableAging}
                selected={selectedAgingBucket}
                onSelect={setSelectedAgingBucket}
              />
            </SectionCard>
          </div>

          {/* 6. Customer Intelligence */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* Top Customers by Sales */}
            <SectionCard
              title="Top Customers by Sales Volume"
              subtitle="Highest turnover accounts this financial year"
            >
              <div className="space-y-2.5">
                {report.topCustomersBySales.map((row, index) => (
                  <div
                    key={row.customerId}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 transition hover:bg-blue-50/40"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 font-mono text-xs font-bold text-blue-700">
                        {index + 1}
                      </span>
                      <Link
                        to="/ledger"
                        search={{ customerId: row.customerId, focus: '' }}
                        className="truncate text-xs font-semibold text-slate-800 hover:text-blue-700"
                      >
                        {row.name}
                      </Link>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-xs font-bold tabular-nums text-slate-900">
                        {formatInrInteger(row.value)}
                      </span>
                      <p className="text-[11px] text-blue-600">Billed</p>
                    </div>
                  </div>
                ))}
                {report.topCustomersBySales.length === 0 && (
                  <p className="py-4 text-center text-xs text-slate-400">No customer sales recorded.</p>
                )}
              </div>
            </SectionCard>

            {/* Top Debtors by Outstanding */}
            <SectionCard
              title="Top Debtors by Outstanding"
              subtitle="Largest open balances requiring collection"
            >
              <div className="space-y-2.5">
                {report.topCustomersByOutstanding.map((row, index) => (
                  <div
                    key={row.customerId}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 transition hover:bg-rose-50/30"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 font-mono text-xs font-bold text-slate-700">
                        {index + 1}
                      </span>
                      <Link
                        to="/ledger"
                        search={{ customerId: row.customerId, focus: '' }}
                        className="truncate text-xs font-semibold text-slate-800 hover:text-blue-700"
                      >
                        {row.name}
                      </Link>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-xs font-bold tabular-nums text-slate-900">
                        {formatInrInteger(row.value)}
                      </span>
                      <div className="mt-0.5">
                        <StatusChip
                          label={index === 0 ? 'High Risk' : 'Due'}
                          status={index === 0 ? 'Risk' : 'Warning'}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                {report.topCustomersByOutstanding.length === 0 && (
                  <p className="py-4 text-center text-xs text-slate-400">No outstanding customer balances.</p>
                )}
              </div>
            </SectionCard>
          </div>

          {/* 7. Receivable Ageing Customers Drill-Down */}
          <SectionCard
            title={`Receivable Ageing Customers (${selectedBucketLabel})`}
            subtitle="Customer list filtered by selected ageing bracket"
            actions={
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                {(['above90', 'days61to90', 'days31to60', 'current'] as const).map((key) => {
                  const label = key === 'above90' ? '90d+' : key === 'days61to90' ? '61–90d' : key === 'days31to60' ? '31–60d' : '0–30d'
                  const isActive = selectedAgingBucket === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedAgingBucket(key)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        isActive ? 'bg-white text-blue-700 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2 text-right">Outstanding</th>
                    <th className="px-3 py-2 text-right">Age</th>
                    <th className="px-3 py-2 text-right">Status</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.receivableAgingCustomers[selectedAgingBucket].slice(0, 10).map((row) => (
                    <tr key={`${selectedAgingBucket}-${row.customerId}`} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2.5 font-medium text-slate-900">{row.name}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {formatInrInteger(row.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">
                        {row.dueDays} days
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <StatusChip
                          label={row.dueDays > 90 ? '90d+ Risk' : row.dueDays > 60 ? '61–90d' : 'Active'}
                          status={row.dueDays > 90 ? 'Risk' : row.dueDays > 60 ? 'Warning' : 'Healthy'}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link
                          to="/ledger"
                          search={{ customerId: row.customerId, focus: '' }}
                          className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          Ledger
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {report.receivableAgingCustomers[selectedAgingBucket].length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-xs text-slate-400">
                        No customer accounts in the {selectedBucketLabel} bracket.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* 8. Weekly Sales Rhythm & 3-Year Comparison */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            {/* Weekly Sales Rhythm (7 cols) */}
            <SectionCard
              title="Weekly Sales Rhythm"
              subtitle="Last 12 weeks of commercial selling activity"
              className="xl:col-span-7"
            >
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniMetricTile
                  label="Best Sales Day"
                  value={
                    heatmapSummary.bestDay
                      ? `${formatFullDate(heatmapSummary.bestDay.date)} · ${formatInrInteger(heatmapSummary.bestDay.sales)}`
                      : '—'
                  }
                />
                <MiniMetricTile
                  label="Active Days"
                  value={`${heatmapSummary.activeDays} / ${report.dailySalesHeatmap.length}`}
                />
                <MiniMetricTile label="Highest Streak" value={`${heatmapSummary.highestStreak} days`} />
                <MiniMetricTile
                  label="Selling Rhythm"
                  value={heatmapSummary.activeDays < 20 ? 'Slow' : 'Regular'}
                  highlight={heatmapSummary.activeDays >= 20}
                />
              </div>
              <WeeklySalesChart daily={report.dailySalesHeatmap} />
            </SectionCard>

            {/* Financial Year Comparison (5 cols) */}
            <SectionCard
              title="3-Year Financial Comparison"
              subtitle="Cross-year billing, collections, and net gap"
              className="xl:col-span-5"
            >
              <div className="space-y-3">
                {report.financialYearSummary.map((fy) => {
                  const efficiency = fy.sales > 0 ? (fy.collections / fy.sales) * 100 : 0
                  return (
                    <div
                      key={fy.label}
                      className="rounded-lg border border-slate-100 bg-slate-50/70 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 text-xs">{fy.label}</span>
                        <StatusChip
                          label={`${Math.round(efficiency)}% collected`}
                          status={efficiency >= 85 ? 'Healthy' : efficiency >= 60 ? 'Warning' : 'Risk'}
                        />
                      </div>
                      <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-[11px] text-slate-500">Sales</p>
                          <p className="font-mono font-semibold text-blue-700">
                            {formatCompactInr(fy.sales)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-slate-500">Collections</p>
                          <p className="font-mono font-semibold text-emerald-700">
                            {formatCompactInr(fy.collections)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-slate-500">Gap</p>
                          <p className="font-mono font-semibold text-slate-800">
                            {formatCompactInr(fy.gap)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-blue-600 transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(0, efficiency))}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          </div>

          {/* 9. Gas Sales Performance */}
          <SectionCard
            title="Gas Sales Performance"
            subtitle="Quantity-weighted gas selling rates vs saved bill market rate"
            actions={
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                Month:
                <input
                  type="month"
                  value={selectedGasMonth}
                  onChange={(event) => setSelectedGasMonth(event.target.value || selectedGasMonth)}
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-400/30"
                />
              </label>
            }
          >
            {gasSales.selected.overall.kg <= 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                <p className="text-xs font-semibold text-slate-700">
                  No gas shipments recorded in {formatMonthYear(selectedGasMonth)}.
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Company-level sales, collection, purchase, and casting figures remain available above.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6 rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-500">Gas Sales</span>
                    <p className="font-mono font-semibold text-slate-900">
                      {formatInrInteger(gasSales.selected.overall.sales)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">Gas Volume</span>
                    <p className="font-mono font-semibold text-slate-900">
                      {formatCompactKg(gasSales.selected.overall.kg)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">Avg Selling Rate</span>
                    <p className="font-mono font-semibold text-blue-700">
                      {formatRate(gasSales.selected.overall.weightedSellingRate)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">Avg Bill Market</span>
                    <p className="font-mono font-semibold text-slate-700">
                      {formatRate(gasSales.selected.overall.weightedMarketRate)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">Premium / Discount</span>
                    <p
                      className={`font-mono font-semibold ${
                        gasSales.selected.overall.premiumPerKg == null
                          ? 'text-slate-500'
                          : gasSales.selected.overall.premiumPerKg >= 0
                            ? 'text-emerald-700'
                            : 'text-rose-700'
                      }`}
                    >
                      {formatSignedRate(gasSales.selected.overall.premiumPerKg)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">Gas Bills</span>
                    <p className="font-mono font-semibold text-slate-900">
                      {gasSales.selected.overall.billCount} bills
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-xs font-semibold text-slate-900">Selling Rate vs Bill Market</h3>
                    <GasSellingRateTrendChart
                      data={gasSales.all.byMonth.slice(-12).map((row) => ({
                        month: row.key,
                        sellingRate: row.weightedSellingRate,
                        marketRate: row.weightedMarketRate,
                        kg: row.kg,
                      }))}
                    />
                  </div>
                  <GasBreakdownTable title="Gas Items" rows={gasSales.selected.byItem} mode="item" />
                </div>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Component Helpers (Cards Rule & Blue Theme compliant)
// -----------------------------------------------------------------------------

type HealthStatus = 'Healthy' | 'Warning' | 'Risk' | 'Neutral'

function StatusChip({ label, status }: { label: string; status: HealthStatus }) {
  const styles =
    status === 'Healthy'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'Warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : status === 'Risk'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-blue-100 bg-blue-50 text-blue-700'

  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-normal ${styles}`}>
      {label}
    </span>
  )
}

function ExecutiveKpiTile({
  title,
  value,
  trend,
  trendLabel,
  status,
  icon,
  sparkline,
  progress,
}: {
  title: string
  value: string
  trend: number
  trendLabel: string
  status: HealthStatus
  icon: ReactNode
  sparkline?: number[]
  progress?: number
}) {
  const trendPositive = trend >= 0
  const TrendIcon = trendPositive ? ArrowUpRight : ArrowDownRight

  return (
    <article
      data-card="true"
      className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="rounded-lg bg-blue-50 p-2 text-blue-700">{icon}</div>
        <StatusChip label={status} status={status} />
      </div>

      <p className="mt-3 text-xs font-medium text-slate-500">{title}</p>
      <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>

      <div className="mt-2.5 flex items-center justify-between text-xs">
        <span
          className={`inline-flex items-center gap-0.5 font-semibold font-mono ${
            trendPositive ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          <TrendIcon size={13} />
          {typeof trend === 'number' && Math.abs(trend) < 100
            ? `${trendPositive ? '+' : ''}${trend.toFixed(1)}`
            : formatDelta(trend)}
        </span>
        <span className="text-[11px] text-slate-400">{trendLabel}</span>
      </div>

      <div className="mt-3 h-8">
        {sparkline && sparkline.length >= 2 ? (
          <Sparkline
            values={sparkline}
            width={120}
            height={32}
            trend={trendPositive ? 'up' : 'down'}
            showArea
            id={`report-kpi-${title.toLowerCase().replace(/\s+/g, '-')}`}
          />
        ) : progress != null ? (
          <div className="flex h-full items-end pb-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-700"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function PrioritySignalTile({
  icon,
  status,
  label,
  value,
  detail,
}: {
  icon: ReactNode
  status: HealthStatus
  label: string
  value: string
  detail: string
}) {
  const borderBg =
    status === 'Risk'
      ? 'border-rose-200 bg-rose-50/40 text-rose-800'
      : status === 'Warning'
        ? 'border-amber-200 bg-amber-50/40 text-amber-800'
        : status === 'Healthy'
          ? 'border-emerald-200 bg-emerald-50/40 text-emerald-800'
          : 'border-blue-100 bg-blue-50/40 text-blue-800'

  return (
    <div className={`rounded-lg border p-3 ${borderBg}`}>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0">{icon}</span>
        <p className="text-xs font-medium text-slate-700">{label}</p>
      </div>
      <p className="mt-2 font-mono text-lg font-bold tabular-nums text-slate-950">{value}</p>
      <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{detail}</p>
    </div>
  )
}

function MiniMetricTile({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-1 truncate font-mono text-xs font-semibold tabular-nums ${highlight ? 'text-blue-700' : 'text-slate-900'}`}>
        {value}
      </p>
    </div>
  )
}

function GasBreakdownTable({
  title,
  rows,
  mode,
}: {
  title: string
  rows: GasSalesGroup[]
  mode: 'item' | 'customer'
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-semibold text-slate-900">{title}</h4>
        <span className="text-[11px] text-slate-500">
          {rows.length} {mode === 'customer' ? 'customers' : 'items'}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[500px] border-collapse text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">{mode === 'customer' ? 'Customer' : 'Item'}</th>
              <th className="px-3 py-2 text-right font-semibold">Sales</th>
              <th className="px-3 py-2 text-right font-semibold">Kg</th>
              <th className="px-3 py-2 text-right font-semibold">Avg Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.key} className="bg-white hover:bg-blue-50/40">
                <td className="max-w-[180px] truncate px-3 py-2 font-medium text-slate-800">
                  {mode === 'customer' ? (
                    <Link to="/ledger" search={{ customerId: row.key, focus: '' }} className="hover:text-blue-700">
                      {row.label}
                    </Link>
                  ) : (
                    row.label
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-slate-900">
                  {formatInrInteger(row.sales)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                  {formatCompactKg(row.kg)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-blue-700">
                  {formatRate(row.weightedSellingRate)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-400">
                  No records.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatRate(value: number | null) {
  return value == null ? '—' : `₹${formatInrInteger(value)}/kg`
}

function formatSignedRate(value: number | null) {
  if (value == null) return '—'
  return `${value >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(value))}/kg`
}

function buildHeatmapSummary(daily: Array<{ date: string; sales: number; bags: number }>) {
  let activeDays = 0
  let currentStreak = 0
  let highestStreak = 0
  let bestDay: { date: string; sales: number } | null = null
  for (const row of daily) {
    if (row.sales > 0) {
      activeDays += 1
      currentStreak += 1
      highestStreak = Math.max(highestStreak, currentStreak)
      if (!bestDay || row.sales > bestDay.sales) bestDay = { date: row.date, sales: row.sales }
    } else {
      currentStreak = 0
    }
  }
  return { activeDays, highestStreak, bestDay }
}

function getEfficiencyStatus(value: number): HealthStatus {
  if (value >= 85) return 'Healthy'
  if (value >= 65) return 'Warning'
  return 'Risk'
}

function boundedPct(value: number, maxValue: number) {
  if (maxValue <= 0) return 0
  return Math.min(100, Math.max(0, (value / maxValue) * 100))
}

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function str(value: unknown) {
  return String(value ?? '')
}

function shiftMonth(monthKey: string, delta: number) {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey
  const d = new Date(year, month - 1 + delta, 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function dateDiffDays(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00`)
  const to = new Date(`${toDate}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)))
}

function formatDelta(amount: number) {
  if (amount >= 0) return `+${formatInrInteger(amount)}`
  return `-${formatInrInteger(Math.abs(amount))}`
}

function eachDayInclusive(startDate: Date, endDate: Date) {
  const days: Date[] = []
  const cursor = new Date(startDate)
  while (cursor <= endDate) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getFinancialYearStartYear(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return new Date().getFullYear()
  return month >= 4 ? year : year - 1
}

function getFinancialYearMonths(startYear: number) {
  const months: string[] = []
  for (let month = 4; month <= 12; month += 1) {
    months.push(`${startYear}-${String(month).padStart(2, '0')}`)
  }
  for (let month = 1; month <= 3; month += 1) {
    months.push(`${startYear + 1}-${String(month).padStart(2, '0')}`)
  }
  return months
}
