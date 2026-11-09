import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, FileSpreadsheet, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDashboardData } from '@/domain/dashboard'
import { loadPartyDashboard } from '@/data/ledger'
import { computeAgeingBuckets } from '@/domain/records'
import {
  aggregatePaymentModes,
  selectTopItemsWithFallback,
} from '@/domain/sales-dashboard'
import {
  buildPeriodRange,
  previousPeriod,
  deltaPct,
  type PeriodMode,
} from '@/domain/period-helpers'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatCompactInr, formatCompactKg, formatInrInteger } from '@/lib/inr-format'
import { DashboardToolbar } from '@/components/ui/dashboard-toolbar'
import { SectionCard, KpiCard } from '@/components/ui/business-kit'
import { Panel } from '@/components/ui/panel'
import { DeltaChip } from '@/components/charts/delta-chip'
import { Sparkline } from '@/components/charts/sparkline'
import { TrendChart } from '@/components/charts/trend-chart'
import { StackedBar } from '@/components/charts/stacked-bar'
import { DonutSplit } from '@/components/charts/donut-split'
import { RankedBars, type RankedBarRow } from '@/components/charts/ranked-bars'

export const Route = createFileRoute('/sales-dashboard')({
  component: SalesDashboardPage,
})

export function SalesDashboardPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [mode, setMode] = useState<PeriodMode>('month')
  const [selectedMonth, setSelectedMonth] = useState<string>(today.slice(0, 7))

  // 1. Fair period ranges (same days comparison rule)
  const currentRange = useMemo(
    () => buildPeriodRange(mode, selectedMonth, today),
    [mode, selectedMonth, today],
  )
  const prevRange = useMemo(() => previousPeriod(currentRange), [currentRange])

  // Rolling 6-month timeline window ending at selectedMonth
  const past6Months = useMemo(() => {
    const months: string[] = []
    const [y, m] = selectedMonth.split('-').map(Number)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return months
  }, [selectedMonth])

  // 2. Data queries
  const salesQuery = useDashboardData(today)
  const partiesQuery = useQuery({
    queryKey: ['sales-dashboard-parties', today],
    queryFn: () => loadPartyDashboard(today),
    staleTime: 60_000,
  })

  // 3. Period filtering for bills and payments
  const salesData = salesQuery.data
  const allBills = salesData?.allBills ?? []
  const allPayments = salesData?.allPayments ?? []

  const periodBills = useMemo(() => {
    return allBills.filter(
      (b) => b.date >= currentRange.from && b.date <= currentRange.to,
    )
  }, [allBills, currentRange.from, currentRange.to])

  const prevPeriodBills = useMemo(() => {
    return allBills.filter(
      (b) => b.date >= prevRange.from && b.date <= prevRange.to,
    )
  }, [allBills, prevRange.from, prevRange.to])

  const periodPayments = useMemo(() => {
    return allPayments.filter(
      (p) => p.date >= currentRange.from && p.date <= currentRange.to,
    )
  }, [allPayments, currentRange.from, currentRange.to])

  const prevPeriodPayments = useMemo(() => {
    return allPayments.filter(
      (p) => p.date >= prevRange.from && p.date <= prevRange.to,
    )
  }, [allPayments, prevRange.from, prevRange.to])

  // 4. Primary Metrics
  const periodSales = useMemo(
    () => periodBills.reduce((sum, b) => sum + b.total, 0),
    [periodBills],
  )
  const prevPeriodSales = useMemo(
    () => prevPeriodBills.reduce((sum, b) => sum + b.total, 0),
    [prevPeriodBills],
  )
  const salesDelta = useMemo(
    () => deltaPct(periodSales, prevPeriodSales),
    [periodSales, prevPeriodSales],
  )

  const periodCollected = useMemo(
    () => periodPayments.reduce((sum, p) => sum + p.amount, 0),
    [periodPayments],
  )
  const prevPeriodCollected = useMemo(
    () => prevPeriodPayments.reduce((sum, p) => sum + p.amount, 0),
    [prevPeriodPayments],
  )
  const collectedDelta = useMemo(
    () => deltaPct(periodCollected, prevPeriodCollected),
    [periodCollected, prevPeriodCollected],
  )

  const periodAvgBill = useMemo(
    () => (periodBills.length > 0 ? periodSales / periodBills.length : 0),
    [periodBills.length, periodSales],
  )
  const prevPeriodAvgBill = useMemo(
    () => (prevPeriodBills.length > 0 ? prevPeriodSales / prevPeriodBills.length : 0),
    [prevPeriodBills.length, prevPeriodSales],
  )
  const avgBillDelta = useMemo(
    () => deltaPct(periodAvgBill, prevPeriodAvgBill),
    [periodAvgBill, prevPeriodAvgBill],
  )

  const billsCountDelta = useMemo(
    () => deltaPct(periodBills.length, prevPeriodBills.length),
    [periodBills.length, prevPeriodBills.length],
  )

  const activeCustomersCount = useMemo(
    () => new Set(periodBills.map((b) => b.customerId)).size,
    [periodBills],
  )

  // 5. 6-Month rolling timelines & Sparklines
  const salesTrend6M = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of allBills) {
      const m = b.date.slice(0, 7)
      map.set(m, (map.get(m) ?? 0) + b.total)
    }
    return past6Months.map((m) => map.get(m) ?? 0)
  }, [allBills, past6Months])

  const collectionsTrend6M = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of allPayments) {
      const m = p.date.slice(0, 7)
      map.set(m, (map.get(m) ?? 0) + p.amount)
    }
    return past6Months.map((m) => map.get(m) ?? 0)
  }, [allPayments, past6Months])

  const monthlyTimeline = useMemo(() => {
    const salesMap = new Map<string, number>()
    for (const b of allBills) {
      const m = b.date.slice(0, 7)
      salesMap.set(m, (salesMap.get(m) ?? 0) + b.total)
    }
    const collectionsMap = new Map<string, number>()
    for (const p of allPayments) {
      const m = p.date.slice(0, 7)
      collectionsMap.set(m, (collectionsMap.get(m) ?? 0) + p.amount)
    }
    return past6Months.map((m) => {
      const [year, mo] = m.split('-')
      const label = new Date(Number(year), Number(mo) - 1, 1).toLocaleDateString('en-IN', {
        month: 'short',
      })
      return {
        month: label,
        sales: salesMap.get(m) ?? 0,
        collections: collectionsMap.get(m) ?? 0,
      }
    })
  }, [allBills, allPayments, past6Months])

  // 6. Receivable Ageing
  const ageing = useMemo(() => {
    return computeAgeingBuckets(salesData?.actionRequired?.riskRows ?? [])
  }, [salesData?.actionRequired?.riskRows])

  const ageingSegments = useMemo(() => {
    return ageing.buckets.map((b) => ({
      key: b.key,
      label: `${b.label} (${b.count} ${b.count === 1 ? 'party' : 'parties'})`,
      value: b.amount,
      color: b.key === '60_plus' ? '#e11d48' : b.key === '31_60' ? '#f59e0b' : '#94a3b8',
    }))
  }, [ageing])

  // 7. Payment Modes Breakdown
  const paymentModeSlices = useMemo(() => {
    return aggregatePaymentModes(periodPayments)
  }, [periodPayments])

  // 8. Top Items by Volume
  const topItemsResult = useMemo(() => {
    const periodItems = (salesData?.thisMonthItemBags ?? []).map((i) => ({
      itemName: i.itemName,
      kg: i.kg,
      bags: i.bags,
    }))
    const comp = salesData?.itemComparisons
    const fallbackItems: Array<{ itemName: string; kg: number; bags: number }> = []
    if (comp) {
      if (comp.spindle.previousKg > 0 || comp.spindle.previousBags > 0) {
        fallbackItems.push({
          itemName: 'Spindle',
          kg: comp.spindle.previousKg,
          bags: comp.spindle.previousBags,
        })
      }
      if (comp.tapperPlug.previousKg > 0 || comp.tapperPlug.previousBags > 0) {
        fallbackItems.push({
          itemName: 'Tapper Plug',
          kg: comp.tapperPlug.previousKg,
          bags: comp.tapperPlug.previousBags,
        })
      }
    }
    return selectTopItemsWithFallback(periodItems, fallbackItems)
  }, [salesData?.thisMonthItemBags, salesData?.itemComparisons])

  const topItemsRows: RankedBarRow[] = useMemo(() => {
    return topItemsResult.items.slice(0, 5).map((i) => ({
      id: i.itemName,
      label: i.itemName,
      value: i.kg,
      formattedValue: `${formatCompactKg(i.kg)} (${i.bags.toLocaleString('en-IN')} bags)`,
      subLabel: `${i.bags.toLocaleString('en-IN')} bags shipped`,
    }))
  }, [topItemsResult.items])

  // 9. Top Customers by Outstanding
  const topCustomersRows: RankedBarRow[] = useMemo(() => {
    return (partiesQuery.data?.rows ?? [])
      .filter((r) => r.dueAmount > 0)
      .sort((a, b) => b.dueAmount - a.dueAmount)
      .slice(0, 5)
      .map((r) => ({
        id: r.customerId,
        label: r.customerName,
        value: r.dueAmount,
        formattedValue: formatInrInteger(r.dueAmount),
        subLabel: r.overdueDays > 0 ? `${r.overdueDays} days since last bill` : 'Current bill',
        ageDays: r.overdueDays,
        ageLevel: r.overdueDays > 60 ? 'overdue' : r.overdueDays > 30 ? 'due' : 'watch',
        actionLabel: 'Collect',
        href: `/new-payment?customerId=${r.customerId}`,
      }))
  }, [partiesQuery.data?.rows])

  // 10. Recent Sale Bills & Recent Payments
  const recentBills = useMemo(() => (salesData?.recentBills ?? []).slice(0, 5), [salesData?.recentBills])
  const recentPayments = useMemo(() => (salesData?.recentPayments ?? []).slice(0, 5), [salesData?.recentPayments])

  // ---------------- Loading / Error States ----------------
  if (salesQuery.isLoading || partiesQuery.isLoading) {
    return (
      <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
        <div data-card="true" className="h-14 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} data-card="true" className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      </div>
    )
  }

  if (salesQuery.isError || !salesData) {
    return (
      <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
        <Panel className="rounded-xl border-rose-200 bg-rose-50 p-6 text-center">
          <AlertCircle className="mx-auto mb-2 text-rose-600" size={24} />
          <h2 className="text-sm font-semibold text-rose-800">Unable to load Sales Dashboard</h2>
          <p className="mt-1 text-xs text-rose-600">
            {salesQuery.error instanceof Error ? salesQuery.error.message : 'Unknown error'}
          </p>
        </Panel>
      </div>
    )
  }

  // Quick Action Buttons for DashboardToolbar
  const toolbarActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        to="/new-bill"
        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
      >
        <Plus size={14} /> New Sale Bill
      </Link>
      <Link
        to="/new-payment"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        <Plus size={14} /> Record Payment
      </Link>
      <Link
        to="/export-reports"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        <FileSpreadsheet size={14} /> Export Statements
      </Link>
    </div>
  )

  return (
    <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {/* 1. Dashboard Toolbar (Cards Rule compliant) */}
      <DashboardToolbar
        mode={mode}
        onModeChange={setMode}
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        comparisonNote={prevRange.comparisonNote}
        actions={toolbarActions}
      />

      {/* 2. KPI Cards Row (5 Cards) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Billed */}
        <KpiCard
          label="Billed"
          hint={currentRange.label}
          value={formatCompactInr(periodSales)}
          delta={<DeltaChip delta={salesDelta} goodDirection="up" />}
          sparkline={
            <Sparkline
              values={salesTrend6M}
              trend={salesDelta != null ? (salesDelta < 0 ? 'down' : 'up') : undefined}
              width={90}
              height={32}
              showArea
              id="sales-kpi-billed"
            />
          }
          subtext={`Exact: ₹${periodSales.toLocaleString('en-IN')}`}
        />

        {/* Collected */}
        <KpiCard
          label="Collected"
          hint="Receipts"
          value={formatCompactInr(periodCollected)}
          delta={<DeltaChip delta={collectedDelta} goodDirection="up" />}
          sparkline={
            <Sparkline
              values={collectionsTrend6M}
              trend={collectedDelta != null ? (collectedDelta < 0 ? 'down' : 'up') : undefined}
              width={90}
              height={32}
              showArea
              id="sales-kpi-collected"
            />
          }
          subtext={`${periodPayments.length} payments received`}
        />

        {/* Avg Bill Size */}
        <KpiCard
          label="Avg Bill Size"
          hint="Ticket"
          value={periodAvgBill > 0 ? formatCompactInr(periodAvgBill) : '—'}
          delta={<DeltaChip delta={avgBillDelta} goodDirection="up" />}
          subtext={`${periodBills.length} bills billed`}
        />

        {/* Bills Count */}
        <KpiCard
          label="Bills Billed"
          hint="Volume"
          value={periodBills.length.toLocaleString('en-IN')}
          delta={<DeltaChip delta={billsCountDelta} goodDirection="up" />}
          subtext={`${activeCustomersCount} unique customers`}
        />

        {/* Still to Receive (Balance Now) */}
        <KpiCard
          label="Still to Receive"
          hint="Balance now"
          value={formatCompactInr(salesData.kpis.outstanding)}
          tone={salesData.actionRequired.highRiskParties > 0 ? 'warning' : 'neutral'}
          subtext={`${salesData.actionRequired.pendingParties} customer balances`}
          href="/ledger?tab=customers"
        />
      </div>

      {/* 3. Main Trend & Ageing Row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Billed vs Collected Trend */}
        <SectionCard
          title="Billed vs Collected"
          actions={
            <span className="text-[11px] font-mono text-slate-400">Last 6 Months</span>
          }
        >
          <TrendChart
            data={monthlyTimeline}
            xKey="month"
            series={[
              { dataKey: 'sales', name: 'Billed', color: '#1e293b', type: 'bar' },
              { dataKey: 'collections', name: 'Collected', color: '#059669', type: 'bar' },
            ]}
            height={240}
            formatY={(v) => formatCompactInr(v)}
            formatTooltip={(v) => formatInrInteger(v)}
            ariaLabel="Billed vs Collected 6-month trend"
          />
        </SectionCard>

        {/* Receivable Ageing */}
        <SectionCard
          title="Receivable Ageing"
          actions={
            <Link
              to="/ledger"
              search={{ tab: 'customers' }}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900"
            >
              Customer ledger →
            </Link>
          }
        >
          <div className="space-y-4 pt-1">
            <StackedBar
              segments={ageingSegments}
              formatValue={(val) => formatCompactInr(val)}
              emptyText="No customer receivables pending."
            />
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
              <span className="font-semibold text-slate-900">Total Outstanding: </span>
              <strong className="font-mono text-slate-900 font-bold">
                {formatInrInteger(ageing.totalAmount)}
              </strong>
              <span className="ml-1 text-slate-400">
                across {salesData.actionRequired.pendingParties} parties
              </span>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* 4. Payment Modes & Top Items Row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* How Customers Pay */}
        <SectionCard
          title="How Customers Pay"
          actions={
            <span className="text-[11px] font-mono text-slate-400">
              {currentRange.label}
            </span>
          }
        >
          <DonutSplit
            slices={paymentModeSlices}
            centerLabel="Collected"
            formatValue={(v) => formatCompactInr(v)}
            formatTotal={(t) => formatCompactInr(t)}
            emptyText="No collection records for this period."
          />
        </SectionCard>

        {/* Top Items by Weight */}
        <SectionCard
          title="Top Items"
          actions={
            topItemsResult.isFallback ? (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                Recent 30 days
              </span>
            ) : (
              <span className="text-[11px] font-mono text-slate-400">
                {currentRange.label}
              </span>
            )
          }
        >
          <RankedBars
            rows={topItemsRows}
            tone="slate"
            emptyText="No item shipments recorded."
          />
        </SectionCard>
      </div>

      {/* 5. Top Customers by Outstanding */}
      <SectionCard
        title="Top Customers by Outstanding"
        actions={
          <Link
            to="/ledger"
            search={{ tab: 'customers' }}
            className="text-xs font-semibold text-slate-700 hover:text-slate-900"
          >
            All debtors →
          </Link>
        }
      >
        <RankedBars
          rows={topCustomersRows}
          tone="slate"
          emptyText="All customer balances are clear."
        />
      </SectionCard>

      {/* 6. Recent Bills & Recent Payments */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Recent Sale Bills */}
        <SectionCard
          title="Recent Sale Bills"
          actions={
            <Link
              to="/transactions"
              search={{ focusKind: '', focusId: '' }}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900"
            >
              All bills →
            </Link>
          }
        >
          {recentBills.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No sale bills recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-medium">
                    <th className="pb-2 font-normal">Bill No</th>
                    <th className="pb-2 font-normal">Date</th>
                    <th className="pb-2 font-normal">Customer</th>
                    <th className="pb-2 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {recentBills.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 font-mono">
                        <Link
                          to="/print-bill"
                          search={{ billId: b.id, billRef: '' }}
                          className="hover:underline text-slate-900 font-semibold"
                        >
                          #{b.billNo}
                        </Link>
                      </td>
                      <td className="py-2.5 text-slate-500 font-mono text-[11px]">{formatFullDate(b.businessDate)}</td>
                      <td className="py-2.5 truncate max-w-[140px] text-slate-900" title={b.customerName}>
                        {b.customerName}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-slate-900 font-semibold">
                        {formatInrInteger(b.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Recent Payments */}
        <SectionCard
          title="Recent Payments"
          actions={
            <Link
              to="/transactions"
              search={{ focusKind: '', focusId: '' }}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900"
            >
              All receipts →
            </Link>
          }
        >
          {recentPayments.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No payment receipts recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-medium">
                    <th className="pb-2 font-normal">Date</th>
                    <th className="pb-2 font-normal">Customer</th>
                    <th className="pb-2 font-normal">Mode</th>
                    <th className="pb-2 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {recentPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 text-slate-500 font-mono text-[11px]">{formatFullDate(p.businessDate)}</td>
                      <td className="py-2.5 truncate max-w-[140px] text-slate-900 font-medium" title={p.customerName}>
                        {p.customerName}
                      </td>
                      <td className="py-2.5 font-mono text-[11px] text-slate-500 uppercase">
                        {p.mode || 'Cash'}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                        {formatInrInteger(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
