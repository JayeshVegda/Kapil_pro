import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, CircleDollarSign, Landmark, ReceiptText, TrendingUp } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { loadDashboardCollections } from '@/data/dashboard'
import { loadCurrentStock, type CurrentStockRecord } from '@/data/stock'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { computeCustomerOutstanding, type CanonicalBillRecord, type CanonicalPaymentRecord } from '@/domain/records'
import { formatBagCount, formatStockQty } from '@/components/stock/stock-inventory-strip'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { formatInQty, formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/monthly-report')({
  component: ReportPage,
})

function ReportPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [selectedAgingBucket, setSelectedAgingBucket] = useState<'current' | 'days31to60' | 'days61to90' | 'above90'>('above90')
  const reportQuery = useQuery({
    queryKey: ['company-report', today],
    queryFn: loadDashboardCollections,
  })
  const stockQuery = useQuery({
    queryKey: ['company-report-stock', today],
    queryFn: loadCurrentStock,
  })

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
        bills: canonicalBills.filter((bill) => bill.customerId === customerId).map((bill) => ({
          ...bill,
          total: calculateBillTotalFromBase(itemSumByBill.get(bill.id) ?? 0, bill.transport ?? 0, bill.gstRate ?? 0, bill.gstAmount),
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

    const receivable = Math.max(0, [...customerOutstandingMap.values()].reduce((sum, value) => sum + (value > 0 ? value : 0), 0))
    const advanceFromCustomers = Math.abs([...customerOutstandingMap.values()].reduce((sum, value) => sum + (value < 0 ? value : 0), 0))
    const averageBillValue = billCount > 0 ? totalSales / billCount : 0
    const recent30dSales = bills
      .filter((bill) => {
        const date = str(bill.date).slice(0, 10)
        const billDate = new Date(`${date}T00:00:00`)
        return date <= today && Number.isFinite(billDate.getTime()) && (nowDate.getTime() - billDate.getTime()) / (24 * 60 * 60 * 1000) <= 30
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

  const heatmapSummary = useMemo(() => buildHeatmapSummary(report.dailySalesHeatmap), [report.dailySalesHeatmap])
  const highestOutstandingCustomer = report.topCustomersByOutstanding[0] ?? null
  const overdueCustomersCount = report.receivableAgingCustomers.above90.length
  const monthlyCashGap = report.thisMonth.sales - report.thisMonth.collections
  const salesDelta = report.thisMonth.sales - report.lastMonth.sales
  const collectionEfficiencyStatus = getEfficiencyStatus(report.overall.collectionEfficiencyPct)
  const stockSummary = useMemo(() => buildStockSummary(stockQuery.data ?? []), [stockQuery.data])
  void stockSummary

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {reportQuery.isLoading && <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">Loading company report...</section>}
      {reportQuery.isError && <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">Unable to load company report.</section>}

      {!reportQuery.isLoading && !reportQuery.isError && (
        <>
          <section className="space-y-3" aria-label="Executive health overview">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <ExecutiveKpiCard title="Total Sales" value={formatInrInteger(report.overall.totalSales)} tone="blue" trend={report.thisMonth.sales - report.lastMonth.sales} trendLabel="vs last month" status={salesDelta >= 0 ? 'Healthy' : 'Warning'} icon={<TrendingUp size={18} />} sparkline={report.monthlyTrend.map((row) => row.sales)} />
              <ExecutiveKpiCard title="Total Collections" value={formatInrInteger(report.overall.totalCollections)} tone="green" trend={report.thisMonth.collections - report.lastMonth.collections} trendLabel="vs last month" status={report.thisMonth.collections >= report.lastMonth.collections ? 'Healthy' : 'Warning'} icon={<Landmark size={18} />} sparkline={report.monthlyTrend.map((row) => row.collections)} />
              <ExecutiveKpiCard title="Receivable" value={formatInrInteger(report.overall.receivable)} tone="red" trend={report.overall.receivable} trendLabel="open outstanding" status={report.receivableAging.above90 > 0 ? 'Risk' : report.overall.receivable > 0 ? 'Warning' : 'Healthy'} icon={<AlertTriangle size={18} />} progress={boundedPct(report.overall.receivable, Math.max(report.overall.totalSales, report.overall.receivable))} />
              <ExecutiveKpiCard title="Collection Efficiency" value={`${Math.round(report.overall.collectionEfficiencyPct)}%`} tone="green" trend={report.overall.collectionEfficiencyDeltaPct} trendLabel="pp vs last month" status={collectionEfficiencyStatus} icon={<CheckCircle2 size={18} />} progress={Math.min(100, report.overall.collectionEfficiencyPct)} />
              <ExecutiveKpiCard title="Monthly Cash Gap" value={formatDelta(monthlyCashGap)} tone={monthlyCashGap > 0 ? 'orange' : 'green'} trend={-monthlyCashGap} trendLabel="collections minus sales" status={monthlyCashGap > 0 ? 'Warning' : 'Healthy'} icon={<CircleDollarSign size={18} />} sparkline={report.monthlyTrend.map((row) => row.collections - row.sales)} />
            </div>
          </section>

          <ActionCenter
            overdueCustomersCount={overdueCustomersCount}
            highestOutstandingCustomer={highestOutstandingCustomer}
            salesDelta={salesDelta}
            collectionEfficiencyPct={report.overall.collectionEfficiencyPct}
            gstEstimate={report.thisMonth.gstEstimate}
          />

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]" aria-label="Main analytics">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Main analytics" title="Sales vs Collections Trend" subtitle="Monthly comparison with billing, collection, and cash gap." />
              <SalesCollectionChart data={report.monthlyTrend} />
            </div>
            <div className="grid grid-cols-1 gap-6">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <SectionHeader eyebrow="Efficiency" title="Collection Progress" subtitle="Collected against billed value." />
                <EfficiencyRadial value={report.overall.collectionEfficiencyPct} status={collectionEfficiencyStatus} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <SectionHeader eyebrow="Receivable" title="Aging Distribution" subtitle="Outstanding split by due age." />
                <ReceivableAgingChart aging={report.receivableAging} selected={selectedAgingBucket} onSelect={setSelectedAgingBucket} />
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2" aria-label="Customer intelligence">
            <CustomerRankingCard title="Top Customers by Sales" tone="blue" rows={report.topCustomersBySales} />
            <CustomerRankingCard title="Top Customers by Outstanding" tone="red" rows={report.topCustomersByOutstanding} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Daily activity">
            <SectionHeader eyebrow="Daily activity" title="Sales Heatmap" subtitle="Last 365 days of selling activity with intensity by sales value." />
            <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <MiniMetric label="Best sales day" value={heatmapSummary.bestDay ? `${formatFullDate(heatmapSummary.bestDay.date)} · ${formatInrInteger(heatmapSummary.bestDay.sales)}` : '-'} />
              <MiniMetric label="Active days" value={`${heatmapSummary.activeDays}/${report.dailySalesHeatmap.length}`} />
              <MiniMetric label="Highest streak" value={`${heatmapSummary.highestStreak} days`} />
              <MiniMetric label="Activity status" value={heatmapSummary.activeDays < 20 ? 'Low activity warning' : 'Normal'} tone={heatmapSummary.activeDays < 20 ? 'orange' : 'green'} />
            </div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span>Less</span>
                <span className="h-3 w-3 rounded bg-slate-100" />
                <span className="h-3 w-3 rounded bg-emerald-200" />
                <span className="h-3 w-3 rounded bg-emerald-400" />
                <span className="h-3 w-3 rounded bg-emerald-600" />
                <span className="h-3 w-3 rounded bg-emerald-800" />
                <span>More</span>
              </div>
              <p className="text-[11px] text-slate-500">Hover each day for sales and bags.</p>
            </div>
            <GithubSalesHeatmap daily={report.dailySalesHeatmap} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Financial year comparison">
            <SectionHeader eyebrow="Financial year" title="FY Comparison" subtitle="Compact view of sales, collections, and gap across Indian financial years." />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {report.financialYearSummary.map((fy) => <FinancialYearSummary key={fy.label} fy={fy} />)}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <Link
                to="/ledger"
                search={selectedAgingBucket === 'above90' ? { customerId: '', focus: 'overdue' } : { customerId: '', focus: '' }}
                className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                Collect from overdue parties
              </Link>
            </div>
            <div className="space-y-1">
              {report.receivableAgingCustomers[selectedAgingBucket].length === 0 && <p className="text-sm text-slate-500">No customers in this bucket.</p>}
              {report.receivableAgingCustomers[selectedAgingBucket].slice(0, 8).map((row) => (
                <div key={`${selectedAgingBucket}-${row.customerId}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{row.name}</p>
                    <p className="text-xs text-slate-500">{row.dueDays} days outstanding</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <RiskBadge dueDays={row.dueDays} />
                    <p className="text-sm font-mono font-semibold text-slate-900">{formatInrInteger(row.amount)}</p>
                    <Link to="/ledger" search={{ customerId: row.customerId, focus: '' }} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-white">
                      Open Ledger
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

type Tone = 'blue' | 'green' | 'red' | 'orange' | 'gray'
type HealthStatus = 'Healthy' | 'Warning' | 'Risk'
type AgingBucket = 'current' | 'days31to60' | 'days61to90' | 'above90'
type StockSummary = {
  currentStock: number
  stockInThisMonth: number
  soldThisMonth: number
  adjustmentThisMonth: number
  fastMovingRows: CurrentStockRecord[]
  attentionRows: CurrentStockRecord[]
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{eyebrow}</p>
      <h3 className="mt-1 text-base font-semibold text-slate-950">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  )
}

function ExecutiveKpiCard({
  title,
  value,
  tone,
  trend,
  trendLabel,
  status,
  icon,
  sparkline,
  progress,
}: {
  title: string
  value: string
  tone: Tone
  trend: number
  trendLabel: string
  status: HealthStatus
  icon: ReactNode
  sparkline?: number[]
  progress?: number
}) {
  const color = toneClasses(tone)
  const trendPositive = trend >= 0
  const TrendIcon = trendPositive ? ArrowUpRight : ArrowDownRight

  return (
    <article className={`group rounded-xl border bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${color.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-lg p-2 ${color.soft} ${color.text}`}>{icon}</div>
        <StatusBadge status={status} />
      </div>
      <p className="mt-4 text-xs font-medium text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-bold tracking-normal text-slate-950">{value}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className={`flex items-center gap-1 text-xs font-semibold ${trendPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
          <TrendIcon size={14} />
          <span>{typeof trend === 'number' && Math.abs(trend) < 100 ? `${trendPositive ? '+' : ''}${trend.toFixed(1)}` : formatDelta(trend)}</span>
        </p>
        <p className="text-[11px] text-slate-500">{trendLabel}</p>
      </div>
      <div className="mt-4 h-9">
        {sparkline ? <Sparkline values={sparkline} tone={tone} /> : <MiniProgress value={progress ?? 0} tone={tone} />}
      </div>
    </article>
  )
}

function StatusBadge({ status }: { status: HealthStatus }) {
  const classes =
    status === 'Healthy'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'Warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-rose-200 bg-rose-50 text-rose-700'
  return <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${classes}`}>{status}</span>
}

function Sparkline({ values, tone }: { values: number[]; tone: Tone }) {
  const width = 160
  const height = 36
  const normalized = values.length > 1 ? values : [0, values[0] ?? 0]
  const min = Math.min(...normalized)
  const max = Math.max(...normalized)
  const range = max - min || 1
  const step = width / Math.max(1, normalized.length - 1)
  const points = normalized.map((value, index) => {
    const x = index * step
    const y = height - ((value - min) / range) * 28 - 4
    return `${x},${y}`
  })
  const stroke = toneStroke(tone)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible" role="img" aria-label="Monthly mini trend">
      <polyline points={points.join(' ')} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={points.at(-1)?.split(',')[1] ?? 18} r="3" fill={stroke} />
    </svg>
  )
}

function MiniProgress({ value, tone }: { value: number; tone: Tone }) {
  return (
    <div className="flex h-full items-end">
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all duration-700 ${toneFill(tone)}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  )
}

function ActionCenter({
  overdueCustomersCount,
  highestOutstandingCustomer,
  salesDelta,
  collectionEfficiencyPct,
  gstEstimate,
}: {
  overdueCustomersCount: number
  highestOutstandingCustomer: { customerId: string; name: string; value: number } | null
  salesDelta: number
  collectionEfficiencyPct: number
  gstEstimate: number
}) {
  const efficiencyStatus = getEfficiencyStatus(collectionEfficiencyPct)
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="action-center-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Business action center</p>
          <h2 id="action-center-title" className="mt-1 text-base font-semibold text-slate-950">Priority signals</h2>
        </div>
        <Link to="/ledger" search={{ customerId: highestOutstandingCustomer?.customerId ?? '', focus: highestOutstandingCustomer ? '' : 'overdue' }} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100">
          Collect from overdue parties
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <ActionSignal icon={<AlertTriangle size={16} />} tone={overdueCustomersCount > 0 ? 'red' : 'green'} label="Overdue customers" value={`${overdueCustomersCount}`} detail={overdueCustomersCount > 0 ? '90+ day follow-up needed' : 'No high-risk overdue bucket'} />
        <ActionSignal icon={<CircleDollarSign size={16} />} tone="red" label="Highest outstanding" value={highestOutstandingCustomer ? formatInrInteger(highestOutstandingCustomer.value) : '-'} detail={highestOutstandingCustomer?.name ?? 'No outstanding customer'} />
        <ActionSignal icon={<TrendingUp size={16} />} tone={salesDelta >= 0 ? 'blue' : 'orange'} label="Sales movement" value={salesDelta >= 0 ? 'Rising' : 'Dropping'} detail={`${formatDelta(salesDelta)} vs previous month`} />
        <ActionSignal icon={<CheckCircle2 size={16} />} tone={efficiencyStatus === 'Healthy' ? 'green' : efficiencyStatus === 'Warning' ? 'orange' : 'red'} label="Collection efficiency" value={`${Math.round(collectionEfficiencyPct)}%`} detail={`${efficiencyStatus} collection pace`} />
        <ActionSignal icon={<ReceiptText size={16} />} tone="orange" label="GST reminder" value={formatInrInteger(gstEstimate)} detail="This month estimate" />
      </div>
    </section>
  )
}

function ActionSignal({ icon, tone, label, value, detail }: { icon: ReactNode; tone: Tone; label: string; value: string; detail: string }) {
  const color = toneClasses(tone)
  return (
    <div className={`rounded-lg border p-3 ${color.border} ${color.soft}`}>
      <div className="flex items-center gap-2">
        <span className={color.text}>{icon}</span>
        <p className="text-xs font-medium text-slate-600">{label}</p>
      </div>
      <p className="mt-2 text-lg font-bold text-slate-950">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{detail}</p>
    </div>
  )
}

function StockManagementPanel({ summary, isLoading, isError }: { summary: StockSummary; isLoading: boolean; isError: boolean }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Stock management">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Stock management</p>
          <h2 className="mt-1 text-base font-semibold text-slate-950">Inventory control</h2>
        </div>
        <Link to="/monthly-report" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100">
          Open Stock
        </Link>
      </div>
      {isLoading && <p className="text-sm text-slate-500">Loading stock summary...</p>}
      {isError && <p className="text-sm text-rose-700">Unable to load stock summary.</p>}
      {!isLoading && !isError && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.1fr]">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 xl:grid-cols-2">
            <MiniMetric label="Current stock" value={formatInQty(summary.currentStock, 'kg')} tone={summary.currentStock < 0 ? 'red' : 'blue'} />
            <MiniMetric label="Stock in this month" value={formatInQty(summary.stockInThisMonth, 'kg')} tone="green" />
            <MiniMetric label="Sold this month" value={formatInQty(summary.soldThisMonth, 'kg')} tone="red" />
            <MiniMetric label="Adjustments" value={formatInQty(summary.adjustmentThisMonth, 'kg')} tone={summary.adjustmentThisMonth < 0 ? 'orange' : 'gray'} />
            <MiniMetric label="Needs attention" value={`${summary.attentionRows.length}`} tone={summary.attentionRows.length > 0 ? 'orange' : 'green'} />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <StockList title="Fast moving stock" rows={summary.fastMovingRows} empty="No sold stock this month." />
            <StockList title="Stock attention" rows={summary.attentionRows} empty="No low or negative stock buckets." attention />
          </div>
        </div>
      )}
    </section>
  )
}

function StockList({ title, rows, empty, attention = false }: { title: string; rows: CurrentStockRecord[]; empty: string; attention?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.length === 0 && <p className="text-sm text-slate-500">{empty}</p>}
        {rows.map((row) => (
          <Link key={`${title}-${row.id}`} to="/monthly-report" className="block rounded-md border border-slate-200 bg-white px-3 py-2 hover:border-blue-200 hover:bg-blue-50/30 focus:outline-none focus:ring-2 focus:ring-blue-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{row.itemName}</p>
                <p className="truncate text-xs text-slate-500">{row.customerName}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`font-mono text-sm font-bold ${row.currentStock < 0 ? 'text-rose-700' : 'text-slate-950'}`}>{formatBagCount(row.currentStock, row)}</p>
                <p className="text-[11px] text-slate-500">{formatStockQty(row.currentStock, row)}</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
              <span>In {formatBagCount(row.stockInThisMonth, row)}</span>
              <span>Sold {formatBagCount(row.soldThisMonth, row)}</span>
              {attention && <span className={row.currentStock < 0 ? 'font-semibold text-rose-700' : 'font-semibold text-amber-700'}>{row.currentStock < 0 ? 'Negative stock' : 'Low stock'}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function SalesCollectionChart({ data }: { data: Array<{ month: string; sales: number; collections: number }> }) {
  if (data.length === 0) return <p className="text-sm text-slate-500">No monthly trend data available.</p>
  const width = 720
  const height = 260
  const padding = { top: 20, right: 24, bottom: 42, left: 58 }
  const max = Math.max(1, ...data.flatMap((row) => [row.sales, row.collections]))
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const xFor = (index: number) => padding.left + (plotWidth * index) / Math.max(1, data.length - 1)
  const yFor = (value: number) => padding.top + plotHeight - (value / max) * plotHeight
  const linePath = (key: 'sales' | 'collections') => data.map((row, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index)} ${yFor(row[key])}`).join(' ')
  const areaPath = (key: 'sales' | 'collections') => `${linePath(key)} L ${xFor(data.length - 1)} ${padding.top + plotHeight} L ${padding.left} ${padding.top + plotHeight} Z`

  return (
    <div className="overflow-hidden rounded-lg border border-slate-100 bg-slate-50/40">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[300px] w-full" role="img" aria-label="Sales and collections monthly trend chart">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = padding.top + plotHeight - tick * plotHeight
          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray={tick === 0 ? undefined : '4 5'} />
              <text x={14} y={y + 4} className="fill-slate-500 text-[10px]">{formatCompactMoney(max * tick)}</text>
            </g>
          )
        })}
        <path d={areaPath('sales')} fill="#3b82f6" opacity="0.10" />
        <path d={areaPath('collections')} fill="#10b981" opacity="0.12" />
        <path d={linePath('sales')} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={linePath('collections')} fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((row, index) => (
          <g key={row.month}>
            <circle cx={xFor(index)} cy={yFor(row.sales)} r="4" fill="#2563eb">
              <title>{`${formatMonthYear(row.month)} sales ${formatInrInteger(row.sales)}`}</title>
            </circle>
            <circle cx={xFor(index)} cy={yFor(row.collections)} r="4" fill="#059669">
              <title>{`${formatMonthYear(row.month)} collections ${formatInrInteger(row.collections)}`}</title>
            </circle>
            <text x={xFor(index)} y={height - 16} textAnchor="middle" className="fill-slate-500 text-[10px]">{formatMonthYear(row.month).slice(0, 3)}</text>
          </g>
        ))}
      </svg>
      <div className="flex items-center gap-4 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
        <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-blue-600" />Sales</span>
        <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-600" />Collections</span>
      </div>
    </div>
  )
}

function EfficiencyRadial({ value, status }: { value: number; status: HealthStatus }) {
  const pct = Math.min(100, Math.max(0, value))
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-2">
      <svg viewBox="0 0 140 140" className="h-44 w-44" role="img" aria-label={`Collection efficiency ${Math.round(pct)} percent`}>
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="14" />
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#059669" strokeWidth="14" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 70 70)" className="transition-all duration-700" />
        <text x="70" y="66" textAnchor="middle" className="fill-slate-950 text-2xl font-bold">{Math.round(pct)}%</text>
        <text x="70" y="88" textAnchor="middle" className="fill-slate-500 text-[11px]">Collected</text>
      </svg>
      <StatusBadge status={status} />
    </div>
  )
}

function ReceivableAgingChart({
  aging,
  selected,
  onSelect,
}: {
  aging: Record<AgingBucket, number>
  selected: AgingBucket
  onSelect: (bucket: AgingBucket) => void
}) {
  const buckets: Array<{ key: AgingBucket; label: string; color: string; className: string }> = [
    { key: 'current', label: '0-30', color: '#10b981', className: 'bg-emerald-500' },
    { key: 'days31to60', label: '31-60', color: '#f59e0b', className: 'bg-amber-500' },
    { key: 'days61to90', label: '61-90', color: '#f97316', className: 'bg-orange-500' },
    { key: 'above90', label: '90+', color: '#ef4444', className: 'bg-rose-500' },
  ]
  const total = Object.values(aging).reduce((sum, value) => sum + value, 0)
  let cursor = 0
  const gradient = total > 0
    ? buckets.map((bucket) => {
      const start = cursor
      const share = (aging[bucket.key] / total) * 100
      cursor += share
      return `${bucket.color} ${start}% ${cursor}%`
    }).join(', ')
    : '#e2e8f0 0% 100%'

  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[180px_1fr]">
      <div className="relative mx-auto h-40 w-40 rounded-full" style={{ background: `conic-gradient(${gradient})` }} aria-label="Receivable aging distribution">
        <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white shadow-inner">
          <span className="text-xs text-slate-500">Total</span>
          <span className="text-lg font-bold text-slate-950">{formatCompactMoney(total)}</span>
        </div>
      </div>
      <div className="space-y-2">
        {buckets.map((bucket) => {
          const amount = aging[bucket.key]
          const pct = total > 0 ? (amount / total) * 100 : 0
          return (
            <button
              key={bucket.key}
              type="button"
              onClick={() => onSelect(bucket.key)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 ${selected === bucket.key ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white'}`}
            >
              <span className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-medium text-slate-700"><span className={`h-2.5 w-2.5 rounded-full ${bucket.className}`} />{bucket.label} days</span>
                <span className="font-mono font-semibold text-slate-900">{formatInrInteger(amount)}</span>
              </span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                <span className={bucket.className} style={{ display: 'block', width: `${pct}%`, height: '100%' }} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CustomerRankingCard({ title, tone, rows }: { title: string; tone: Tone; rows: Array<{ customerId: string; name: string; value: number }> }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label={title}>
      <h3 className="mb-4 text-base font-semibold text-slate-950">{title}</h3>
      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-slate-500">No customer data available.</p>}
        {rows.map((row, index) => (
          <div key={row.customerId} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${toneClasses(tone).soft} ${toneClasses(tone).text}`}>{index + 1}</span>
                  <Link to="/ledger" search={{ customerId: row.customerId, focus: '' }} className="truncate hover:text-blue-700">{row.name}</Link>
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm font-bold text-slate-950">{formatInrInteger(row.value)}</p>
                {tone === 'red' ? <RiskBadge dueDays={index === 0 ? 91 : 61} /> : <span className="text-[11px] font-medium text-blue-700">Sales</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function MiniMetric({ label, value, tone = 'gray' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className={`rounded-lg border p-3 ${toneClasses(tone).border} ${toneClasses(tone).soft}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function FinancialYearSummary({ fy }: { fy: { label: string; sales: number; collections: number; gap: number } }) {
  const efficiency = fy.sales > 0 ? (fy.collections / fy.sales) * 100 : 0
  const status = getEfficiencyStatus(efficiency)
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-950">{fy.label}</h4>
        <StatusBadge status={status} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] text-slate-500">Sales</p>
          <p className="font-mono text-sm font-semibold text-blue-700">{formatInrInteger(fy.sales)}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Collections</p>
          <p className="font-mono text-sm font-semibold text-emerald-700">{formatInrInteger(fy.collections)}</p>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-[11px] text-slate-500">
          <span>Gap</span>
          <span>{formatInrInteger(fy.gap)}</span>
        </div>
        <MiniProgress value={Math.min(100, efficiency)} tone={status === 'Risk' ? 'red' : status === 'Warning' ? 'orange' : 'green'} />
      </div>
    </article>
  )
}

function RiskBadge({ dueDays }: { dueDays: number }) {
  const status: HealthStatus = dueDays > 90 ? 'Risk' : dueDays > 60 ? 'Warning' : 'Healthy'
  return <StatusBadge status={status} />
}

function buildStockSummary(rows: CurrentStockRecord[]): StockSummary {
  return {
    currentStock: rows.reduce((sum, row) => sum + row.currentStock, 0),
    stockInThisMonth: rows.reduce((sum, row) => sum + row.stockInThisMonth, 0),
    soldThisMonth: rows.reduce((sum, row) => sum + row.soldThisMonth, 0),
    adjustmentThisMonth: rows.reduce((sum, row) => sum + row.adjustmentThisMonth, 0),
    fastMovingRows: [...rows]
      .filter((row) => row.soldThisMonth > 0)
      .sort((a, b) => b.soldThisMonth - a.soldThisMonth)
      .slice(0, 3),
    attentionRows: [...rows]
      .filter((row) => row.currentStock <= 0 || (row.soldThisMonth > 0 && row.currentStock <= row.soldThisMonth))
      .sort((a, b) => a.currentStock - b.currentStock)
      .slice(0, 3),
  }
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

function formatCompactMoney(value: number) {
  const abs = Math.abs(value)
  if (abs >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`
  if (abs >= 100000) return `₹${(value / 100000).toFixed(1)}L`
  if (abs >= 1000) return `₹${(value / 1000).toFixed(1)}K`
  return formatInrInteger(value)
}

function toneClasses(tone: Tone) {
  switch (tone) {
    case 'blue':
      return { border: 'border-blue-100', soft: 'bg-blue-50', text: 'text-blue-700' }
    case 'green':
      return { border: 'border-emerald-100', soft: 'bg-emerald-50', text: 'text-emerald-700' }
    case 'red':
      return { border: 'border-rose-100', soft: 'bg-rose-50', text: 'text-rose-700' }
    case 'orange':
      return { border: 'border-amber-100', soft: 'bg-amber-50', text: 'text-amber-700' }
    default:
      return { border: 'border-slate-200', soft: 'bg-slate-50', text: 'text-slate-700' }
  }
}

function toneFill(tone: Tone) {
  switch (tone) {
    case 'blue':
      return 'bg-blue-600'
    case 'green':
      return 'bg-emerald-600'
    case 'red':
      return 'bg-rose-600'
    case 'orange':
      return 'bg-amber-500'
    default:
      return 'bg-slate-500'
  }
}

function toneStroke(tone: Tone) {
  switch (tone) {
    case 'blue':
      return '#2563eb'
    case 'green':
      return '#059669'
    case 'red':
      return '#e11d48'
    case 'orange':
      return '#f59e0b'
    default:
      return '#64748b'
  }
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

function GithubSalesHeatmap({ daily }: { daily: Array<{ date: string; sales: number; bags: number }> }) {
  if (daily.length === 0) {
    return <p className="text-sm text-slate-500">No daily sales data available.</p>
  }
  const salesByDate = new Map(daily.map((row) => [row.date, row.sales]))
  const bagsByDate = new Map(daily.map((row) => [row.date, row.bags]))
  const firstDate = fromIsoDate(daily[0].date)
  const lastDate = fromIsoDate(daily[daily.length - 1].date)
  const gridStart = alignToSunday(firstDate)
  const gridEnd = alignToSaturday(lastDate)
  const allDates = eachDayInclusive(gridStart, gridEnd)
  const maxSales = Math.max(1, ...daily.map((row) => row.sales))
  const weekColumns = chunkByWeek(allDates)
  const weekColumnCount = weekColumns.length
  const monthLabels = weekColumns.map((week) => {
    const first = week[0]
    return first.getDate() <= 7 ? formatMonthYear(toIsoDate(first).slice(0, 7)) : ''
  })

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="w-full min-w-[980px]">
        <div
          className="mb-1 grid gap-[3px]"
          style={{ gridTemplateColumns: `30px repeat(${weekColumnCount}, minmax(12px, 1fr))` }}
        >
          <span />
          {monthLabels.map((label, index) => (
            <span key={`month-${index}`} className="text-[10px] text-slate-500">
              {label}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-[30px_1fr] gap-1">
          <div className="grid grid-rows-7 gap-[3px] text-[10px] text-slate-500">
            <span />
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
          </div>
          <div className="flex w-full gap-[3px]">
            {weekColumns.map((week, weekIndex) => (
              <div key={`week-${weekIndex}`} className="grid flex-1 grid-rows-7 gap-[3px]">
                {week.map((date) => {
                  const key = toIsoDate(date)
                  const sales = salesByDate.get(key) ?? 0
                  const bags = bagsByDate.get(key) ?? 0
                  const intensity = Math.min(1, Math.max(0, sales) / maxSales)
                  return (
                    <span
                      key={key}
                      className={`h-[12px] w-full min-w-[11px] rounded-[2px] ${heatCellClass(intensity)}`}
                      title={`${formatFullDate(key)}: ${formatInrInteger(sales)} sales, ${Math.round(bags)} bags`}
                      aria-label={`${formatFullDate(key)} sales ${Math.round(sales)} and bags ${Math.round(bags)}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function chunkByWeek(dates: Date[]) {
  const weeks: Date[][] = []
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7))
  }
  return weeks
}

function alignToSunday(date: Date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function alignToSaturday(date: Date) {
  const d = new Date(date)
  d.setDate(d.getDate() + (6 - d.getDay()))
  return d
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

function fromIsoDate(iso: string) {
  const parsed = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return new Date()
  return parsed
}

function heatCellClass(intensity: number) {
  if (intensity <= 0) return 'bg-slate-100'
  if (intensity > 0.75) return 'bg-emerald-800'
  if (intensity > 0.5) return 'bg-emerald-600'
  if (intensity > 0.25) return 'bg-emerald-400'
  return 'bg-emerald-200'
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

void StockManagementPanel
