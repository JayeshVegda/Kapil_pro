import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Package, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  purchaseBillsQueryOptions,
  supplierPaymentsQueryOptions,
  suppliersSummaryQueryOptions,
} from '@/data/purchase-queries'
import { computeSupplierPositions } from '@/domain/supplier-settlement'
import { computeAgeingBuckets } from '@/domain/records'
import {
  computeBardanPendingSummary,
  type VilaityEntry,
} from '@/domain/supplier-market-premium'
import {
  aggregatePurchasedItems,
  buildItemRateVsMarketTimeline,
} from '@/domain/purchase-dashboard-calculations'
import {
  buildPeriodRange,
  previousPeriod,
  deltaPct,
  type PeriodMode,
} from '@/domain/period-helpers'
import { pb } from '@/data/pocketbase'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatCompactInr, formatCompactKg, formatInrInteger } from '@/lib/inr-format'
import { DashboardToolbar } from '@/components/ui/dashboard-toolbar'
import { SectionCard, KpiCard } from '@/components/ui/business-kit'
import { Panel } from '@/components/ui/panel'
import { DeltaChip } from '@/components/charts/delta-chip'
import { Sparkline } from '@/components/charts/sparkline'
import { TrendChart } from '@/components/charts/trend-chart'
import { StackedBar } from '@/components/charts/stacked-bar'
import { RankedBars, type RankedBarRow } from '@/components/charts/ranked-bars'

export const Route = createFileRoute('/purchase-dashboard')({
  component: PurchaseDashboardPage,
})

function PurchaseDashboardPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [mode, setMode] = useState<PeriodMode>('month')
  const [selectedMonth, setSelectedMonth] = useState<string>(today.slice(0, 7))
  const [selectedItemForRate, setSelectedItemForRate] = useState<string>('')

  // 1. Period ranges (fair comparison rule: same days)
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
  const billsQuery = useQuery(purchaseBillsQueryOptions())
  const paymentsQuery = useQuery(supplierPaymentsQueryOptions())
  const summariesQuery = useQuery(suppliersSummaryQueryOptions())

  const brassRatesQuery = useQuery({
    queryKey: ['brass-rates-history'],
    queryFn: async (): Promise<VilaityEntry[]> => {
      try {
        const records = await pb.collection('brass_rates').getFullList({
          sort: 'date',
          fields: 'date,vilaity',
        })
        return records.map((r) => ({
          date: String(r.date).slice(0, 10),
          vilaityMilli: Number(r.vilaity || 0) * 1000,
        }))
      } catch {
        return []
      }
    },
    staleTime: 60_000,
  })

  // 3. Purchase Bills & Payments Filtering
  const allBills = billsQuery.data ?? []
  const allPayments = paymentsQuery.data ?? []
  const supplierSummaries = summariesQuery.data ?? []
  const vilaityHistory = brassRatesQuery.data ?? []

  const activeBills = useMemo(() => allBills.filter((b) => !b.cancelled), [allBills])
  const activePayments = useMemo(
    () => allPayments.filter((p) => !p.cancelled && p.kind !== 'refund_received'),
    [allPayments],
  )

  const periodBills = useMemo(() => {
    return activeBills.filter(
      (b) => b.date >= currentRange.from && b.date <= currentRange.to,
    )
  }, [activeBills, currentRange.from, currentRange.to])

  const prevPeriodBills = useMemo(() => {
    return activeBills.filter(
      (b) => b.date >= prevRange.from && b.date <= prevRange.to,
    )
  }, [activeBills, prevRange.from, prevRange.to])

  const periodPayments = useMemo(() => {
    return activePayments.filter(
      (p) => p.date >= currentRange.from && p.date <= currentRange.to,
    )
  }, [activePayments, currentRange.from, currentRange.to])

  const prevPeriodPayments = useMemo(() => {
    return activePayments.filter(
      (p) => p.date >= prevRange.from && p.date <= prevRange.to,
    )
  }, [activePayments, prevRange.from, prevRange.to])

  // 4. Primary Metrics
  const periodBoughtKg = useMemo(
    () => periodBills.reduce((sum, b) => sum + b.totalKg, 0),
    [periodBills],
  )
  const prevPeriodBoughtKg = useMemo(
    () => prevPeriodBills.reduce((sum, b) => sum + b.totalKg, 0),
    [prevPeriodBills],
  )
  const boughtKgDelta = useMemo(
    () => deltaPct(periodBoughtKg, prevPeriodBoughtKg),
    [periodBoughtKg, prevPeriodBoughtKg],
  )

  const periodBoughtPaise = useMemo(
    () => periodBills.reduce((sum, b) => sum + b.netPaise, 0),
    [periodBills],
  )

  const periodPaidPaise = useMemo(
    () => periodPayments.reduce((sum, p) => sum + p.amountPaise, 0),
    [periodPayments],
  )
  const prevPeriodPaidPaise = useMemo(
    () => prevPeriodPayments.reduce((sum, p) => sum + p.amountPaise, 0),
    [prevPeriodPayments],
  )
  const paidDelta = useMemo(
    () => deltaPct(periodPaidPaise, prevPeriodPaidPaise),
    [periodPaidPaise, prevPeriodPaidPaise],
  )

  const avgProcuredRate = useMemo(() => {
    return periodBoughtKg > 0 ? (periodBoughtPaise / 100) / periodBoughtKg : 0
  }, [periodBoughtKg, periodBoughtPaise])

  // 5. Positions (Kacha & GST payables strictly isolated; advance never subtracted)
  const positions = useMemo(
    () => computeSupplierPositions(supplierSummaries),
    [supplierSummaries],
  )

  const advanceSuppliersCount = useMemo(
    () => supplierSummaries.filter((s) => s.advancePaise > 0).length,
    [supplierSummaries],
  )

  // 6. Bardan Pending Summary
  const bardanSummary = useMemo(
    () => computeBardanPendingSummary(activeBills, today),
    [activeBills, today],
  )

  // 7. 6-Month rolling timelines & Sparklines
  const boughtKgTrend6M = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of activeBills) {
      const m = b.date.slice(0, 7)
      map.set(m, (map.get(m) ?? 0) + b.totalKg)
    }
    return past6Months.map((m) => map.get(m) ?? 0)
  }, [activeBills, past6Months])

  const paidTrend6M = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of activePayments) {
      const m = p.date.slice(0, 7)
      map.set(m, (map.get(m) ?? 0) + p.amountPaise / 100)
    }
    return past6Months.map((m) => map.get(m) ?? 0)
  }, [activePayments, past6Months])

  const monthlyTimeline = useMemo(() => {
    const boughtMap = new Map<string, number>()
    for (const b of activeBills) {
      const m = b.date.slice(0, 7)
      boughtMap.set(m, (boughtMap.get(m) ?? 0) + b.netPaise / 100)
    }
    const paidMap = new Map<string, number>()
    for (const p of activePayments) {
      const m = p.date.slice(0, 7)
      paidMap.set(m, (paidMap.get(m) ?? 0) + p.amountPaise / 100)
    }
    return past6Months.map((m) => {
      const [year, mo] = m.split('-')
      const label = new Date(Number(year), Number(mo) - 1, 1).toLocaleDateString('en-IN', {
        month: 'short',
      })
      return {
        month: label,
        bought: boughtMap.get(m) ?? 0,
        paid: paidMap.get(m) ?? 0,
      }
    })
  }, [activeBills, activePayments, past6Months])

  // 8. Payable Ageing (0-30d, 31-60d, 60+d)
  const payableAgeing = useMemo(() => {
    const rows = supplierSummaries
      .filter((s) => s.kachaDuePaise + s.gstDuePaise > 0)
      .map((s) => ({
        amount: (s.kachaDuePaise + s.gstDuePaise) / 100,
        dueDays: s.oldestDueDays ?? 0,
      }))
    return computeAgeingBuckets(rows)
  }, [supplierSummaries])

  const ageingSegments = useMemo(() => {
    return payableAgeing.buckets.map((b) => ({
      key: b.key,
      label: `${b.label} (${b.count} ${b.count === 1 ? 'supplier' : 'suppliers'})`,
      value: b.amount,
      color: b.key === '60_plus' ? '#e11d48' : b.key === '31_60' ? '#f59e0b' : '#94a3b8',
    }))
  }, [payableAgeing])

  // 9. What We Buy (Aggregated by scrap item)
  const itemPurchaseStats = useMemo(() => {
    // In our read model, each bill summary has totalKg and netPaise.
    // If lines are loaded on the bill, aggregate by line item.
    // Otherwise fallback to bill-level volume or top items.
    return aggregatePurchasedItems(periodBills)
  }, [periodBills])

  const whatWeBuyRows: RankedBarRow[] = useMemo(() => {
    if (itemPurchaseStats.length > 0) {
      return itemPurchaseStats.slice(0, 5).map((i) => ({
        id: i.itemName,
        label: i.itemName,
        value: i.kg,
        formattedValue: `${formatCompactKg(i.kg)} (₹${Math.round(i.avgRateRupees)}/kg)`,
        subLabel: `Total spend: ${formatCompactInr(i.amountPaise / 100)}`,
      }))
    }
    // Fallback if bills don't carry split lines
    return periodBills.slice(0, 5).map((b) => ({
      id: b.id,
      label: b.supplierName,
      value: b.totalKg,
      formattedValue: `${formatCompactKg(b.totalKg)}`,
      subLabel: `Bill #${b.inNo} · ${formatCompactInr(b.netPaise / 100)}`,
    }))
  }, [itemPurchaseStats, periodBills])

  // 10. Rate vs Market Timeline
  const distinctItemNames = useMemo(() => {
    const set = new Set<string>()
    for (const b of activeBills) {
      for (const l of (b as unknown as { lines?: Array<{ itemName?: string }> }).lines ?? []) {
        if (l.itemName) set.add(l.itemName)
      }
    }
    return [...set]
  }, [activeBills])

  const activeRateItem = selectedItemForRate || distinctItemNames[0] || 'Honey Brass'

  const rateVsMarketTimeline = useMemo(() => {
    return buildItemRateVsMarketTimeline(activeBills as unknown as Parameters<typeof buildItemRateVsMarketTimeline>[0], activeRateItem, vilaityHistory)
  }, [activeBills, activeRateItem, vilaityHistory])

  // 11. Pay Next (Top 5 suppliers by payable)
  const payNextRows: RankedBarRow[] = useMemo(() => {
    return supplierSummaries
      .filter((s) => s.kachaDuePaise + s.gstDuePaise > 0)
      .sort((a, b) => b.kachaDuePaise + b.gstDuePaise - (a.kachaDuePaise + a.gstDuePaise))
      .slice(0, 5)
      .map((s) => {
        const due = (s.kachaDuePaise + s.gstDuePaise) / 100
        return {
          id: s.supplier.id,
          label: s.supplier.companyName,
          value: due,
          formattedValue: formatInrInteger(due),
          subLabel:
            s.oldestDueDays != null
              ? `${s.oldestDueDays} days oldest due`
              : 'Current due',
          ageDays: s.oldestDueDays,
          ageLevel: s.oldestDueDays != null && s.oldestDueDays > 30 ? 'due' : 'watch',
          actionLabel: 'Pay',
          href: `/new-supplier-payment?supplierId=${s.supplier.id}`,
        }
      })
  }, [supplierSummaries])

  // 12. Recent Bills (5 rows) & Recent Payments (5 rows)
  const recentBills = useMemo(() => {
    return activeBills
      .sort((a, b) => `${b.date}|${b.created}|${b.id}`.localeCompare(`${a.date}|${a.created}|${a.id}`))
      .slice(0, 5)
  }, [activeBills])

  const recentPayments = useMemo(() => {
    return activePayments
      .sort((a, b) => `${b.date}|${b.created}|${b.id}`.localeCompare(`${a.date}|${a.created}|${a.id}`))
      .slice(0, 5)
  }, [activePayments])

  // ---------------- Loading / Error States ----------------
  const isLoading = billsQuery.isLoading || paymentsQuery.isLoading || summariesQuery.isLoading
  if (isLoading) {
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

  const isError = billsQuery.isError || paymentsQuery.isError || summariesQuery.isError
  if (isError) {
    return (
      <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
        <Panel role="alert" className="rounded-xl border-rose-200 bg-rose-50 p-6 text-center">
          <AlertCircle className="mx-auto mb-2 text-rose-600" size={24} />
          <h2 className="text-sm font-semibold text-rose-800">Unable to load purchase dashboard</h2>
          <p className="mt-1 text-xs text-rose-600">Failed to fetch supplier or bill data.</p>
        </Panel>
      </div>
    )
  }

  // Quick Action Buttons for DashboardToolbar
  const toolbarActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        to="/new-purchase-bill"
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
      >
        <Plus size={14} /> New Purchase Bill
      </Link>
      <Link
        to="/new-supplier-payment"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/50 hover:text-blue-700"
      >
        <Plus size={14} /> Record Payment
      </Link>
    </div>
  )

  return (
    <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {/* 1. Dashboard Toolbar (Cards Rule compliant) */}
      <DashboardToolbar
        title="Purchase Dashboard"
        subtitle="Scrap procurement, payables & settlements"
        icon={<Package size={15} />}
        mode={mode}
        onModeChange={setMode}
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        comparisonNote={prevRange.comparisonNote}
        actions={toolbarActions}
      />

      {/* 2. KPI Cards Row (5 Cards) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Bought */}
        <KpiCard
          label="Bought"
          hint={currentRange.label}
          value={formatCompactKg(periodBoughtKg)}
          delta={<DeltaChip delta={boughtKgDelta} goodDirection="up" />}
          sparkline={
            <Sparkline
              values={boughtKgTrend6M}
              trend={boughtKgDelta != null ? (boughtKgDelta < 0 ? 'down' : 'up') : undefined}
              width={90}
              height={32}
              showArea
              id="purchase-kpi-bought"
            />
          }
          subtext={`${formatCompactInr(periodBoughtPaise / 100)} · Avg ₹${Math.round(avgProcuredRate)}/kg`}
        />

        {/* Paid Out */}
        <KpiCard
          label="Paid Out"
          hint="Disbursed"
          value={formatCompactInr(periodPaidPaise / 100)}
          delta={<DeltaChip delta={paidDelta} goodDirection="up" />}
          sparkline={
            <Sparkline
              values={paidTrend6M}
              trend={paidDelta != null ? (paidDelta < 0 ? 'down' : 'up') : undefined}
              width={90}
              height={32}
              showArea
              id="purchase-kpi-paid"
            />
          }
          subtext={`${periodPayments.length} payouts this period`}
        />

        {/* We Owe (Kacha + GST shown apart) */}
        <KpiCard
          label="We Owe"
          hint="Balance now"
          value={formatCompactInr(positions.totalPayablePaise / 100)}
          tone="blue"
          subtext={`K: ${formatCompactInr(positions.kachaPayablePaise / 100)} · G: ${formatCompactInr(positions.gstPayablePaise / 100)}`}
          href="/ledger?tab=suppliers"
        />

        {/* Advance Held (Shown separately, never subtracted) */}
        <KpiCard
          label="Advance Held"
          hint="Balance now"
          value={formatCompactInr(positions.totalAdvancePaise / 100)}
          tone={positions.totalAdvancePaise > 0 ? 'positive' : 'neutral'}
          subtext={
            positions.totalAdvancePaise > 0
              ? `With ${advanceSuppliersCount} suppliers`
              : 'No advance balance'
          }
          href="/ledger?tab=suppliers"
        />

        {/* Bardan Pending */}
        <KpiCard
          label="Bardan Pending"
          hint="Bardan"
          value={`${bardanSummary.count} lots`}
          tone={bardanSummary.oldestDays > 10 ? 'warning' : 'neutral'}
          subtext={
            bardanSummary.count > 0
              ? `Oldest: ${bardanSummary.oldestDays} days old`
              : 'All bardan returned'
          }
        />
      </div>

      {/* 3. Bought vs Paid Out & Payable Ageing */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Bought vs Paid Out Trend */}
        <SectionCard
          title="Bought vs Paid Out"
          actions={
            <span className="text-[11px] font-mono text-slate-400">Last 6 Months</span>
          }
        >
          <TrendChart
            data={monthlyTimeline}
            xKey="month"
            series={[
              { dataKey: 'bought', name: 'Bought', color: '#2563eb', type: 'bar' },
              { dataKey: 'paid', name: 'Paid Out', color: '#059669', type: 'bar' },
            ]}
            height={240}
            formatY={(v) => formatCompactInr(v)}
            formatTooltip={(v) => formatInrInteger(v)}
            ariaLabel="Bought vs Paid Out 6-month trend"
          />
        </SectionCard>

        {/* Payable Ageing */}
        <SectionCard
          title="Payable Ageing"
          actions={
            <Link
              to="/ledger"
              search={{ tab: 'suppliers' }}
              className="text-xs font-semibold text-blue-600 transition hover:text-blue-800"
            >
              Supplier ledger →
            </Link>
          }
        >
          <div className="space-y-4 pt-1">
            <StackedBar
              segments={ageingSegments}
              formatValue={(val) => formatCompactInr(val)}
              emptyText="No supplier payables pending."
            />
            <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-3 text-xs text-slate-700">
              <span className="font-semibold text-slate-900">Total We Owe: </span>
              <strong className="font-mono text-blue-700 font-bold">
                {formatInrInteger(positions.totalPayablePaise / 100)}
              </strong>
              <span className="ml-2 text-slate-500">
                (Kacha ₹{formatCompactInr(positions.kachaPayablePaise / 100)} · GST ₹{formatCompactInr(positions.gstPayablePaise / 100)})
              </span>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* 4. What We Buy & Rate vs Market */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* What We Buy */}
        <SectionCard
          title="What We Buy"
          actions={
            <span className="text-[11px] font-mono text-slate-400">
              {currentRange.label}
            </span>
          }
        >
          <RankedBars
            rows={whatWeBuyRows}
            tone="blue"
            emptyText="No scrap procurement recorded this period."
          />
        </SectionCard>

        {/* Rate vs Market (Internal Management Signal) */}
        <SectionCard
          title="Rate vs Market (Internal)"
          actions={
            distinctItemNames.length > 1 ? (
              <select
                value={activeRateItem}
                onChange={(e) => setSelectedItemForRate(e.target.value)}
                className="rounded border border-blue-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              >
                {distinctItemNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] font-mono text-slate-400">
                {activeRateItem}
              </span>
            )
          }
        >
          {rateVsMarketTimeline.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">
              No market comparison points recorded for {activeRateItem}.
            </p>
          ) : (
            <TrendChart
              data={rateVsMarketTimeline}
              xKey="date"
              series={[
                { dataKey: 'ourRate', name: 'Our Rate (₹)', color: '#2563eb', type: 'line' },
                { dataKey: 'marketRate', name: 'Vilaity Mkt (₹)', color: '#94a3b8', type: 'line', dashed: true },
              ]}
              height={220}
              formatY={(v) => `₹${v}`}
              formatTooltip={(v) => `₹${v} / kg`}
              ariaLabel="Rate vs Vilaity market rate trend"
            />
          )}
        </SectionCard>
      </div>

      {/* 5. Pay Next & Bardan Pending */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Pay Next */}
        <SectionCard
          title="Pay Next"
          actions={
            <Link
              to="/ledger"
              search={{ tab: 'suppliers' }}
              className="text-xs font-semibold text-blue-600 transition hover:text-blue-800"
            >
              All suppliers →
            </Link>
          }
        >
          <RankedBars
            rows={payNextRows}
            tone="blue"
            emptyText="No supplier balance due."
          />
        </SectionCard>

        {/* Bardan Pending */}
        <SectionCard
          title="Bardan Pending"
          actions={
            <span className="text-[11px] font-mono text-slate-400">
              {bardanSummary.count} lots pending
            </span>
          }
        >
          {bardanSummary.bills.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              No recorded bardan pending return.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-medium">
                    <th className="pb-2 font-normal">IN No</th>
                    <th className="pb-2 font-normal">Date</th>
                    <th className="pb-2 font-normal">Supplier</th>
                    <th className="pb-2 text-right font-normal">Age</th>
                    <th className="pb-2 text-right font-normal">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {bardanSummary.bills.slice(0, 5).map((b) => (
                    <tr key={b.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="py-2.5 font-mono">
                        <Link
                          to="/purchase-bills/$billId"
                          params={{ billId: b.id }}
                          className="hover:underline hover:text-blue-700 text-slate-900 font-semibold transition"
                        >
                          {b.inNo}
                        </Link>
                      </td>
                      <td className="py-2.5 text-slate-500 font-mono text-[11px]">{formatFullDate(b.date)}</td>
                      <td className="py-2.5 truncate max-w-[130px] text-slate-900" title={b.supplierName}>
                        {b.supplierName}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        <span
                          className={
                            b.daysOld > 10
                              ? 'rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700'
                              : 'text-slate-500 text-[11px]'
                          }
                        >
                          {b.daysOld}d
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <Link
                          to="/purchase-bills/$billId"
                          params={{ billId: b.id }}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                        >
                          Add Bardan
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* 6. Recent Bills & Recent Payments */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Recent Purchase Bills */}
        <SectionCard
          title="Recent Purchase Bills"
          actions={
            <Link
              to="/purchase-bills"
              className="text-xs font-semibold text-blue-600 transition hover:text-blue-800"
            >
              All bills →
            </Link>
          }
        >
          {recentBills.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No purchase bills recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-medium">
                    <th className="pb-2 font-normal">IN No</th>
                    <th className="pb-2 font-normal">Date</th>
                    <th className="pb-2 font-normal">Supplier</th>
                    <th className="pb-2 text-right font-normal">Weight</th>
                    <th className="pb-2 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {recentBills.map((b) => (
                    <tr key={b.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="py-2.5 font-mono">
                        <Link
                          to="/purchase-bills/$billId"
                          params={{ billId: b.id }}
                          className="hover:underline hover:text-blue-700 text-slate-900 font-semibold transition"
                        >
                          {b.inNo}
                        </Link>
                      </td>
                      <td className="py-2.5 text-slate-500 font-mono text-[11px]">{formatFullDate(b.date)}</td>
                      <td className="py-2.5 truncate max-w-[130px] text-slate-900" title={b.supplierName}>
                        {b.supplierName}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-slate-600">
                        {b.totalKg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-slate-900 font-semibold">
                        {formatInrInteger(b.netPaise / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Recent Supplier Payments */}
        <SectionCard
          title="Recent Payments"
          actions={
            <Link
              to="/supplier-payments"
              className="text-xs font-semibold text-blue-600 transition hover:text-blue-800"
            >
              All payments →
            </Link>
          }
        >
          {recentPayments.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No supplier payouts recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-medium">
                    <th className="pb-2 font-normal">Date</th>
                    <th className="pb-2 font-normal">Supplier</th>
                    <th className="pb-2 font-normal">Pool</th>
                    <th className="pb-2 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {recentPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="py-2.5 text-slate-500 font-mono text-[11px]">{formatFullDate(p.date)}</td>
                      <td className="py-2.5 truncate max-w-[130px] text-slate-900 font-medium" title={p.supplierName}>
                        {p.supplierName}
                      </td>
                      <td className="py-2.5 font-mono text-[11px] uppercase text-slate-500">
                        {p.pool}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-slate-900 font-semibold">
                        {formatInrInteger(p.amountPaise / 100)}
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
