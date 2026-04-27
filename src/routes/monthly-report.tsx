import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { loadDashboardCollections } from '@/data/dashboard'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

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

    const itemSumByBill = new Map<string, number>()
    const itemBagsByBill = new Map<string, number>()
    for (const item of billItems) {
      const billId = str(item.bill)
      itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(item.amount))
      itemBagsByBill.set(billId, (itemBagsByBill.get(billId) ?? 0) + num(item.bags))
    }

    const customerNameById = new Map<string, string>()
    const openingByCustomer = new Map<string, number>()
    let activeCustomers = 0
    for (const customer of customers) {
      const id = customer.id
      customerNameById.set(id, str(customer.name))
      openingByCustomer.set(id, num(customer.opening_balance))
      if (Boolean(customer.active)) activeCustomers += 1
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
    }

    for (const bill of bills) {
      const billDate = str(bill.date).slice(0, 10)
      if (!billDate || billDate > today) continue
      const base = itemSumByBill.get(bill.id) ?? 0
      const transport = num(bill.transport)
      const gstRate = num(bill.gst_rate)
      const billTotal = calculateBillTotalFromBase(base, transport, gstRate)
      const gstAmount = (base * gstRate) / 100
      const customerId = str(bill.customer)
      const billMonth = billDate.slice(0, 7)

      totalSales += billTotal
      totalGst += gstAmount
      billCount += 1
      dailySalesMap.set(billDate, (dailySalesMap.get(billDate) ?? 0) + billTotal)
      dailyBagsMap.set(billDate, (dailyBagsMap.get(billDate) ?? 0) + (itemBagsByBill.get(bill.id) ?? 0))
      customerSalesMap.set(customerId, (customerSalesMap.get(customerId) ?? 0) + billTotal)
      customerOutstandingMap.set(customerId, (customerOutstandingMap.get(customerId) ?? 0) + billTotal)

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
      const customerId = str(payment.customer)
      const paymentMonth = paymentDate.slice(0, 7)
      totalCollections += amount
      customerOutstandingMap.set(customerId, (customerOutstandingMap.get(customerId) ?? 0) - amount)

      const monthly = monthlyMap.get(paymentMonth) ?? { sales: 0, collections: 0 }
      monthly.collections += amount
      monthlyMap.set(paymentMonth, monthly)
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
        return sum + calculateBillTotalFromBase(base, num(bill.transport), num(bill.gst_rate))
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

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {reportQuery.isLoading && <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">Loading company report...</section>}
      {reportQuery.isError && <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">Unable to load company report.</section>}

      {!reportQuery.isLoading && !reportQuery.isError && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Executive Summary</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
              <Metric label="Total Sales" value={formatInrInteger(report.overall.totalSales)} emphasized />
              <Metric label="Total Collections" value={formatInrInteger(report.overall.totalCollections)} />
              <Metric label="Receivable" value={formatInrInteger(report.overall.receivable)} emphasized={report.overall.receivable > 0} />
              <Metric label="Customer Advance" value={formatInrInteger(report.overall.advanceFromCustomers)} />
              <Metric label="GST Estimate" value={formatInrInteger(report.overall.gstCollectedEstimate)} />
              <Metric label="Collection Efficiency (of billed)" value={`${Math.round(report.overall.collectionEfficiencyPct)}%`} />
              <Metric label="Active Customers" value={`${report.overall.activeCustomers}/${report.overall.customerCount}`} />
              <Metric label="Bill Count" value={String(report.overall.billCount)} />
              <Metric label="Avg Bill Value" value={formatInrInteger(report.overall.averageBillValue)} />
              <Metric label="Avg Collection Days (DSO Est.)" value={`${Math.round(report.overall.averageCollectionDays)} days`} emphasized={report.overall.averageCollectionDays > 45} />
              <Metric label="This Month Sales" value={formatInrInteger(report.thisMonth.sales)} />
              <Metric label="This Month Collections" value={formatInrInteger(report.thisMonth.collections)} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Efficiency trend: {report.overall.collectionEfficiencyDeltaPct >= 0 ? '+' : ''}
              {Math.round(report.overall.collectionEfficiencyDeltaPct)} pp vs last month.
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Period Comparison</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
              <Metric label="This Month Bills" value={String(report.thisMonth.bills)} />
              <Metric label="This Month GST Est." value={formatInrInteger(report.thisMonth.gstEstimate)} />
              <Metric label="Month Sales Delta (vs last month)" value={formatDelta(report.thisMonth.sales - report.lastMonth.sales)} emphasized={report.thisMonth.sales < report.lastMonth.sales} />
              <Metric label="Month Collection Delta (vs last month)" value={formatDelta(report.thisMonth.collections - report.lastMonth.collections)} emphasized={report.thisMonth.collections < report.lastMonth.collections} />
              <Metric label="This FY Sales" value={formatInrInteger(report.thisFinancialYear.sales)} />
              <Metric label="This FY Collections" value={formatInrInteger(report.thisFinancialYear.collections)} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Financial Year View (Indian FY Apr-Mar)</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {report.financialYearSummary.map((fy) => (
                <div key={fy.label} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">{fy.label}</p>
                  <p className="mt-2 text-sm text-slate-700">Sales: <span className="font-mono font-semibold text-slate-900">{formatInrInteger(fy.sales)}</span></p>
                  <p className="text-sm text-slate-700">Collections: <span className="font-mono font-semibold text-slate-900">{formatInrInteger(fy.collections)}</span></p>
                  <p className="text-sm text-slate-700">Gap: <span className="font-mono font-semibold text-amber-700">{formatInrInteger(fy.gap)}</span></p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Receivable Aging (Company)</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
              <button type="button" className="text-left" onClick={() => setSelectedAgingBucket('current')}>
                <Metric label="0-30 Days" value={formatInrInteger(report.receivableAging.current)} />
              </button>
              <button type="button" className="text-left" onClick={() => setSelectedAgingBucket('days31to60')}>
                <Metric label="31-60 Days" value={formatInrInteger(report.receivableAging.days31to60)} />
              </button>
              <button type="button" className="text-left" onClick={() => setSelectedAgingBucket('days61to90')}>
                <Metric label="61-90 Days" value={formatInrInteger(report.receivableAging.days61to90)} emphasized />
              </button>
              <button type="button" className="text-left" onClick={() => setSelectedAgingBucket('above90')}>
                <Metric label="90+ Days" value={formatInrInteger(report.receivableAging.above90)} emphasized />
              </button>
            </div>
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
                  {selectedAgingBucket === 'current'
                    ? '0-30 Days'
                    : selectedAgingBucket === 'days31to60'
                      ? '31-60 Days'
                      : selectedAgingBucket === 'days61to90'
                        ? '61-90 Days'
                        : '90+ Days'}{' '}
                  Customers
                </p>
                <Link
                  to="/ledger"
                  search={selectedAgingBucket === 'above90' ? { customerId: '', focus: 'overdue' } : { customerId: '', focus: '' }}
                  className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
                >
                  Collect from overdue parties
                </Link>
              </div>
              <div className="space-y-1">
                {report.receivableAgingCustomers[selectedAgingBucket].length === 0 && <p className="text-sm text-slate-500">No customers in this bucket.</p>}
                {report.receivableAgingCustomers[selectedAgingBucket].slice(0, 8).map((row) => (
                  <div key={`${selectedAgingBucket}-${row.customerId}`} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1.5">
                    <div>
                      <p className="text-sm text-slate-700">{row.name}</p>
                      <p className="text-xs text-slate-500">{row.dueDays} days</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-mono font-semibold text-slate-900">{formatInrInteger(row.amount)}</p>
                      <Link to="/ledger" search={{ customerId: row.customerId, focus: '' }} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
                        Open Ledger
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">12-Month Sales vs Collections Trend</h3>
            <div className="space-y-2">
              {report.monthlyTrend.length === 0 && <p className="text-sm text-slate-500">No trend data yet.</p>}
              {report.monthlyTrend.map((row) => (
                <div key={row.month} className="grid grid-cols-[90px_1fr_1fr_1fr] items-center gap-2 text-xs">
                  <span className="font-medium text-slate-700">{formatMonthYear(row.month)}</span>
                  <span className="rounded bg-blue-100 px-2 py-1 text-right font-mono text-blue-700">{formatInrInteger(row.sales)}</span>
                  <span className="rounded bg-emerald-100 px-2 py-1 text-right font-mono text-emerald-700">{formatInrInteger(row.collections)}</span>
                  <span className={`rounded px-2 py-1 text-right font-mono ${row.sales - row.collections > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {formatInrInteger(Math.abs(row.sales - row.collections))}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">GitHub-Style Daily Sales Heatmap</h3>
            <p className="mb-3 text-xs text-slate-500">Day-by-day sales for the last 365 days. Darker green means higher sales for that day.</p>
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
              <p className="text-[11px] text-slate-500">Last 365 days</p>
            </div>
            <GithubSalesHeatmap daily={report.dailySalesHeatmap} />
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Top Customers by Sales</h3>
              <div className="space-y-2">
                {report.topCustomersBySales.length === 0 && <p className="text-sm text-slate-500">No sales data available.</p>}
                {report.topCustomersBySales.map((row, index) => (
                  <div key={`${row.name}-${index}`} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <Link to="/ledger" search={{ customerId: row.customerId, focus: '' }} className="text-sm text-blue-700 hover:text-blue-800 hover:underline">
                      {row.name}
                    </Link>
                    <p className="text-sm font-mono font-semibold text-slate-900">{formatInrInteger(row.value)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Top Customers by Outstanding</h3>
              <div className="space-y-2">
                {report.topCustomersByOutstanding.length === 0 && <p className="text-sm text-slate-500">No outstanding receivable.</p>}
                {report.topCustomersByOutstanding.map((row, index) => (
                  <div key={`${row.name}-${index}`} className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
                    <Link to="/ledger" search={{ customerId: row.customerId, focus: '' }} className="text-sm text-rose-800 hover:text-rose-900 hover:underline">
                      {row.name}
                    </Link>
                    <p className="text-sm font-mono font-semibold text-rose-900">{formatInrInteger(row.value)}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Metric({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-md border p-2.5 ${emphasized ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono tabular-nums ${emphasized ? 'text-lg font-bold text-amber-800' : 'text-base font-semibold text-slate-900'}`}>{value}</p>
    </div>
  )
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

