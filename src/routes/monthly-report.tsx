import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, CircleDollarSign, FileSpreadsheet, FileText, Landmark, ReceiptText, TrendingUp } from 'lucide-react'
import { CollectionEfficiencyGauge, GasSellingRateTrendChart, ReceivableAgingBars, SalesCollectionTrendChart, WeeklySalesChart } from '@/components/reports/company-charts'
import { useMemo, useState, type ReactNode } from 'react'
import { loadDashboardCollections } from '@/data/dashboard'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { buildGasSalesReport, type GasSalesGroup, type GasSalesMetrics } from '@/domain/gas-sales-reporting'
import { computeCustomerOutstanding, type CanonicalBillRecord, type CanonicalPaymentRecord } from '@/domain/records'
import { formatFullDate, formatMonthYear, getLocalIsoDate } from '@/lib/date'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/monthly-report')({
  component: ReportPage,
})

function ReportPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [selectedAgingBucket, setSelectedAgingBucket] = useState<'current' | 'days31to60' | 'days61to90' | 'above90'>('above90')
  const [selectedGasMonth, setSelectedGasMonth] = useState(() => today.slice(0, 7))
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

  const gasSales = useMemo(() => {
    const data = reportQuery.data
    if (!data) {
      const empty = buildGasSalesReport({ bills: [], lines: [] })
      return { all: empty, selected: empty, previous: empty }
    }
    const customerNameById = new Map(data.customersRaw.map((row) => [row.id, formatCustomerDisplayName(row.company_name, row.name)]))
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
  async function downloadReportPdf() {
    const { createStyledPdf } = await import('@/lib/exports/pdf-engine')
    const doc = await createStyledPdf({
      title: 'Company Report',
      subtitle: `As of ${formatFullDate(today)} | Kapil Products`,
      summary: [
        { label: 'Total Sales', value: formatInrInteger(report.overall.totalSales) },
        { label: 'Collections', value: formatInrInteger(report.overall.totalCollections) },
        { label: 'Receivable', value: formatInrInteger(report.overall.receivable) },
        { label: 'Efficiency', value: `${Math.round(report.overall.collectionEfficiencyPct)}%` },
      ],
      sections: [
        {
          kind: 'table',
          title: 'Monthly sales vs collections',
          columns: [
            { header: 'Month' },
            { header: 'Sales', align: 'right' },
            { header: 'Collections', align: 'right' },
            { header: 'Gap', align: 'right' },
          ],
          rows: report.monthlyTrend.map((row) => [
            formatMonthYear(row.month),
            formatInrInteger(row.sales),
            formatInrInteger(row.collections),
            formatInrInteger(row.sales - row.collections),
          ]),
        },
        {
          kind: 'table',
          title: 'Receivable aging',
          columns: [{ header: 'Bucket' }, { header: 'Outstanding', align: 'right' }, { header: 'Parties', align: 'right' }],
          rows: [
            ['0-30 days', formatInrInteger(report.receivableAging.current), report.receivableAgingCustomers.current.length],
            ['31-60 days', formatInrInteger(report.receivableAging.days31to60), report.receivableAgingCustomers.days31to60.length],
            ['61-90 days', formatInrInteger(report.receivableAging.days61to90), report.receivableAgingCustomers.days61to90.length],
            ['Above 90 days', formatInrInteger(report.receivableAging.above90), report.receivableAgingCustomers.above90.length],
          ],
        },
        {
          kind: 'table',
          title: 'Top parties by outstanding',
          columns: [{ header: 'Party' }, { header: 'Outstanding', align: 'right' }],
          rows: report.topCustomersByOutstanding.map((row) => [row.name, formatInrInteger(row.value)]),
        },
      ],
    })
    doc.save(`company-report-${today}.pdf`)
  }

  async function downloadReportExcel() {
    const { createXlsxBlob } = await import('@/lib/exports/xlsx-workbook')
    const blob = await createXlsxBlob([
      {
        name: 'Monthly Trend',
        totalsLabel: 'Total',
        columns: [
          { header: 'Month', type: 'text' },
          { header: 'Sales', type: 'currency', total: true },
          { header: 'Collections', type: 'currency', total: true },
          { header: 'Gap', type: 'currency' },
        ],
        rows: report.monthlyTrend.map((row) => [formatMonthYear(row.month), row.sales, row.collections, row.sales - row.collections]),
      },
      {
        name: 'Receivable Aging',
        columns: [
          { header: 'Party', type: 'text' },
          { header: 'Bucket', type: 'text' },
          { header: 'Due days', type: 'integer' },
          { header: 'Outstanding', type: 'currency', total: true },
        ],
        totalsLabel: 'Total',
        rows: (['current', 'days31to60', 'days61to90', 'above90'] as const).flatMap((bucket) =>
          report.receivableAgingCustomers[bucket].map((row) => [
            row.name,
            bucket === 'current' ? '0-30d' : bucket === 'days31to60' ? '31-60d' : bucket === 'days61to90' ? '61-90d' : '90d+',
            row.dueDays,
            row.amount,
          ]),
        ),
      },
      {
        name: 'Top by Sales',
        columns: [
          { header: 'Party', type: 'text' },
          { header: 'Sales', type: 'currency', total: true },
        ],
        totalsLabel: 'Total',
        rows: report.topCustomersBySales.map((row) => [row.name, row.value]),
      },
      {
        name: 'FY Summary',
        columns: [
          { header: 'Financial Year', type: 'text' },
          { header: 'Sales', type: 'currency', total: true },
          { header: 'Collections', type: 'currency', total: true },
          { header: 'Gap', type: 'currency' },
        ],
        totalsLabel: 'Total',
        rows: report.financialYearSummary.map((fy) => [fy.label, fy.sales, fy.collections, fy.gap]),
      },
    ])
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `company-report-${today}.xlsx`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {reportQuery.isLoading && <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">Loading company report...</section>}
      {reportQuery.isError && <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">Unable to load company report.</section>}

      {!reportQuery.isLoading && !reportQuery.isError && (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3" aria-label="Report actions">
            <h2 className="text-base font-semibold text-slate-900">Company Report</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                onClick={() => void downloadReportPdf()}
              >
                <FileText size={13} /> PDF
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                onClick={() => void downloadReportExcel()}
              >
                <FileSpreadsheet size={13} /> Excel
              </button>
            </div>
          </section>

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

          <GasSalesPerformance
            month={selectedGasMonth}
            onMonthChange={setSelectedGasMonth}
            current={gasSales.selected.overall}
            previous={gasSales.previous.overall}
            monthlyTrend={gasSales.all.byMonth.slice(-12)}
            items={gasSales.selected.byItem}
            customers={gasSales.selected.byCustomer}
          />

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]" aria-label="Main analytics">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <SectionHeader eyebrow="Main analytics" title="Sales vs Collections Trend" subtitle="Monthly comparison with billing, collection, and cash gap." />
              <SalesCollectionTrendChart data={report.monthlyTrend} />
            </div>
            <div className="grid grid-cols-1 gap-6">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <SectionHeader eyebrow="Efficiency" title="Collection Progress" subtitle="Collected against billed value." />
                <CollectionEfficiencyGauge value={report.overall.collectionEfficiencyPct} tone={collectionEfficiencyStatus === 'Healthy' ? 'green' : collectionEfficiencyStatus === 'Warning' ? 'amber' : 'red'} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <SectionHeader eyebrow="Receivable" title="Aging Distribution" subtitle="Outstanding split by due age." />
                <ReceivableAgingBars aging={report.receivableAging} selected={selectedAgingBucket} onSelect={setSelectedAgingBucket} />
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2" aria-label="Customer intelligence">
            <CustomerRankingCard title="Top Customers by Sales" tone="blue" rows={report.topCustomersBySales} />
            <CustomerRankingCard title="Top Customers by Outstanding" tone="red" rows={report.topCustomersByOutstanding} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Weekly activity">
            <SectionHeader eyebrow="Weekly activity" title="Weekly Sales" subtitle="Last 12 weeks of selling, hover a bar for the exact amount." />
            <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <MiniMetric label="Best sales day" value={heatmapSummary.bestDay ? `${formatFullDate(heatmapSummary.bestDay.date)} · ${formatInrInteger(heatmapSummary.bestDay.sales)}` : '-'} />
              <MiniMetric label="Active days" value={`${heatmapSummary.activeDays}/${report.dailySalesHeatmap.length}`} />
              <MiniMetric label="Highest streak" value={`${heatmapSummary.highestStreak} days`} />
              <MiniMetric label="Activity status" value={heatmapSummary.activeDays < 20 ? 'Low activity warning' : 'Normal'} tone={heatmapSummary.activeDays < 20 ? 'orange' : 'green'} />
            </div>
            <WeeklySalesChart daily={report.dailySalesHeatmap} />
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

function GasSalesPerformance({
  month,
  onMonthChange,
  current,
  previous,
  monthlyTrend,
  items,
  customers,
}: {
  month: string
  onMonthChange: (month: string) => void
  current: GasSalesMetrics
  previous: GasSalesMetrics
  monthlyTrend: GasSalesGroup[]
  items: GasSalesGroup[]
  customers: GasSalesGroup[]
}) {
  const rateDelta =
    current.weightedSellingRate != null && previous.weightedSellingRate != null
      ? current.weightedSellingRate - previous.weightedSellingRate
      : null
  const premiumTone = current.premiumPerKg == null ? 'text-slate-500' : current.premiumPerKg >= 0 ? 'text-emerald-700' : 'text-rose-700'

  return (
    <section className="rounded-xl border border-blue-200 bg-white shadow-sm" aria-labelledby="gas-sales-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-blue-700">Gas sales performance</p>
          <h2 id="gas-sales-title" className="mt-1 text-lg font-semibold text-slate-950">Selling rate against the market</h2>
          <p className="mt-1 text-sm text-slate-500">Quantity-weighted rates from gas bill lines only; GST and transport are excluded.</p>
        </div>
        <label className="text-xs font-semibold text-slate-600">
          Report month
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value || month)}
            className="mt-1 block h-9 rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
      </div>

      {current.kg <= 0 ? (
        <div className="m-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-700">No gas sales in {formatMonthYear(month)}.</p>
          <p className="mt-1 text-xs text-slate-500">Other company sales and collection figures remain available below.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px bg-slate-200 lg:grid-cols-3 xl:grid-cols-6">
            <GasMetric label="Gas sales" value={formatInrInteger(current.sales)} detail={formatMetricDelta(current.sales, previous.sales, 'vs last month')} />
            <GasMetric label="Gas volume" value={`${formatNumber(current.kg)} kg`} detail={`${formatNumber(current.bags)} bags · ${formatMetricDelta(current.kg, previous.kg, '')}`} />
            <GasMetric label="Avg selling rate" value={formatRate(current.weightedSellingRate)} detail={rateDelta == null ? 'No previous-month rate' : `${formatSignedRate(rateDelta)} vs last month`} />
            <GasMetric label="Avg bill market" value={formatRate(current.weightedMarketRate)} detail="Weighted by sold kilograms" />
            <GasMetric label="Premium / discount" value={formatSignedRate(current.premiumPerKg)} detail={current.premiumPct == null ? 'Market comparison unavailable' : `${current.premiumPct >= 0 ? '+' : ''}${current.premiumPct.toFixed(1)}% vs market`} valueClassName={premiumTone} />
            <GasMetric label="Gas bills" value={formatNumber(current.billCount)} detail="Bills containing gas lines" />
          </div>

          <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[1.15fr_1fr]">
            <div className="min-w-0">
              <SectionHeader eyebrow="Rate movement" title="Selling Rate vs Bill Market" subtitle="Monthly weighted rates show how negotiated selling moved with the saved market rate." />
              <GasSellingRateTrendChart
                data={monthlyTrend.map((row) => ({
                  month: row.key,
                  sellingRate: row.weightedSellingRate,
                  marketRate: row.weightedMarketRate,
                  kg: row.kg,
                }))}
              />
            </div>
            <GasBreakdownTable title="Gas Items" rows={items} mode="item" />
          </div>

          <div className="border-t border-slate-200 p-4 sm:p-5">
            <GasBreakdownTable title="Customers by Gas Sales" rows={customers} mode="customer" />
          </div>
        </>
      )}
    </section>
  )
}

function GasMetric({ label, value, detail, valueClassName = 'text-slate-950' }: { label: string; value: string; detail: string; valueClassName?: string }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-1 truncate font-mono text-lg font-bold tabular-nums ${valueClassName}`}>{value}</p>
      <p className="mt-1 truncate text-[11px] text-slate-500" title={detail}>{detail}</p>
    </div>
  )
}

function GasBreakdownTable({ title, rows, mode }: { title: string; rows: GasSalesGroup[]; mode: 'item' | 'customer' }) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <span className="text-[11px] text-slate-500">{rows.length} {mode === 'customer' ? 'customers' : 'items'}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[760px] border-collapse text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.06em] text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left font-semibold">{mode === 'customer' ? 'Customer' : 'Item'}</th>
              <th className="px-3 py-2.5 text-right font-semibold">Gas sales</th>
              {mode === 'customer' ? <th className="px-3 py-2.5 text-right font-semibold">Share</th> : null}
              <th className="px-3 py-2.5 text-right font-semibold">Kg</th>
              <th className="px-3 py-2.5 text-right font-semibold">Bags</th>
              <th className="px-3 py-2.5 text-right font-semibold">Bills</th>
              <th className="px-3 py-2.5 text-right font-semibold">Avg sell</th>
              <th className="px-3 py-2.5 text-right font-semibold">Avg market</th>
              <th className="px-3 py-2.5 text-right font-semibold">Premium</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.key} className="bg-white hover:bg-blue-50/40">
                <td className="max-w-[220px] truncate px-3 py-2.5 font-semibold text-slate-800">
                  {mode === 'customer' ? <Link to="/ledger" search={{ customerId: row.key, focus: '' }} className="hover:text-blue-700">{row.label}</Link> : row.label}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">{formatInrInteger(row.sales)}</td>
                {mode === 'customer' ? <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">{row.salesSharePct.toFixed(1)}%</td> : null}
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatNumber(row.kg)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatNumber(row.bags)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{row.billCount}</td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-blue-700">{formatRate(row.weightedSellingRate)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-amber-700">{formatRate(row.weightedMarketRate)}</td>
                <td className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${row.premiumPerKg == null ? 'text-slate-400' : row.premiumPerKg >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {formatSignedRate(row.premiumPerKg)}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={mode === 'customer' ? 9 : 8} className="px-3 py-8 text-center text-sm text-slate-500">No gas sales in this period.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatRate(value: number | null) {
  return value == null ? '—' : `${formatInrInteger(value)}/kg`
}

function formatSignedRate(value: number | null) {
  if (value == null) return '—'
  return `${value >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(value))}/kg`
}

function formatMetricDelta(current: number, previous: number, suffix: string) {
  if (!(previous > 0)) return 'No previous-month base'
  const pct = ((current - previous) / previous) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% ${suffix}`.trim()
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 }).format(value)
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
