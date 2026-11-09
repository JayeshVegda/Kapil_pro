import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Plus,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useModuleSettings } from '@/lib/use-module-settings'
import { useDashboardData } from '@/domain/dashboard'
import { loadCastingSessions } from '@/data/casting'
import {
  purchaseBillsQueryOptions,
  supplierPaymentsQueryOptions,
  suppliersSummaryQueryOptions,
} from '@/data/purchase-queries'
import { computeSupplierPositions } from '@/domain/supplier-settlement'
import {
  summarizeCastingSessions,
  buildMonthlyCastingTrend,
} from '@/domain/casting-calculations'
import {
  buildPeriodRange,
  previousPeriod,
  deltaPct,
  diffDays,
  type PeriodMode,
} from '@/domain/period-helpers'
import { buildAttentionItems } from '@/domain/attention-rules'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatCompactInr, formatCompactKg, formatInrInteger } from '@/lib/inr-format'
import { DashboardToolbar } from '@/components/ui/dashboard-toolbar'
import { SectionCard } from '@/components/ui/business-kit'
import { Panel } from '@/components/ui/panel'
import { DeltaChip } from '@/components/charts/delta-chip'
import { Sparkline } from '@/components/charts/sparkline'
import { RankedBars, type RankedBarRow } from '@/components/charts/ranked-bars'
import { countPendingDrafts } from '@/data/bill-drafts'
import { countPendingPaymentDrafts } from '@/data/payment-drafts'
import { pb } from '@/data/pocketbase'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

export function DashboardPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [mode, setMode] = useState<PeriodMode>('month')
  const [selectedMonth, setSelectedMonth] = useState<string>(today.slice(0, 7))

  // 1. Period ranges (fair comparison rule: same days)
  const currentRange = useMemo(
    () => buildPeriodRange(mode, selectedMonth, today),
    [mode, selectedMonth, today],
  )
  const prevRange = useMemo(() => previousPeriod(currentRange), [currentRange])

  // 2. Module settings
  const { purchaseEnabled, castingEnabled } = useModuleSettings()

  // 3. Sales full history & queries
  const salesQuery = useDashboardData(today)

  // 4. Purchase queries
  const purchaseBillsQuery = useQuery({
    ...purchaseBillsQueryOptions(),
    enabled: purchaseEnabled,
  })
  const purchasePaymentsQuery = useQuery({
    ...supplierPaymentsQueryOptions(),
    enabled: purchaseEnabled,
  })
  const supplierSummariesQuery = useQuery({
    ...suppliersSummaryQueryOptions(),
    enabled: purchaseEnabled,
  })

  // 5. Casting queries
  const castingSessionsQuery = useQuery({
    queryKey: ['casting-sessions-all', today],
    queryFn: () => loadCastingSessions(),
    enabled: castingEnabled,
  })

  // 6. Drafts & Rates for Attention rules
  const billDraftsCountQuery = useQuery({
    queryKey: ['bill-drafts-count'],
    queryFn: countPendingDrafts,
    staleTime: 60_000,
  })
  const paymentDraftsCountQuery = useQuery({
    queryKey: ['payment-drafts-count'],
    queryFn: countPendingPaymentDrafts,
    staleTime: 60_000,
  })
  const brassRateQuery = useQuery({
    queryKey: ['latest-brass-rate-date'],
    queryFn: async () => {
      try {
        const page = await pb.collection('brass_rates').getList(1, 1, {
          sort: '-date',
          fields: 'date',
        })
        return page.items[0]?.date ? String(page.items[0].date).slice(0, 10) : null
      } catch {
        return null
      }
    },
    staleTime: 60_000,
  })

  // ---------------- Computations ----------------

  // A. Sales Period Metrics
  const salesData = salesQuery.data
  const salesPeriodBills = useMemo(() => {
    if (!salesData?.allBills) return []
    return salesData.allBills.filter(
      (b) => b.date >= currentRange.from && b.date <= currentRange.to,
    )
  }, [salesData?.allBills, currentRange.from, currentRange.to])

  const salesPrevPeriodBills = useMemo(() => {
    if (!salesData?.allBills) return []
    return salesData.allBills.filter(
      (b) => b.date >= prevRange.from && b.date <= prevRange.to,
    )
  }, [salesData?.allBills, prevRange.from, prevRange.to])

  const salesPeriodPayments = useMemo(() => {
    if (!salesData?.allPayments) return []
    return salesData.allPayments.filter(
      (p) => p.date >= currentRange.from && p.date <= currentRange.to,
    )
  }, [salesData?.allPayments, currentRange.from, currentRange.to])

  const periodSales = useMemo(
    () => salesPeriodBills.reduce((sum, b) => sum + b.total, 0),
    [salesPeriodBills],
  )
  const prevPeriodSales = useMemo(
    () => salesPrevPeriodBills.reduce((sum, b) => sum + b.total, 0),
    [salesPrevPeriodBills],
  )
  const salesDeltaPct = useMemo(
    () => deltaPct(periodSales, prevPeriodSales),
    [periodSales, prevPeriodSales],
  )

  const periodCollected = useMemo(
    () => salesPeriodPayments.reduce((sum, p) => sum + p.amount, 0),
    [salesPeriodPayments],
  )

  const salesTrend6M = useMemo(
    () => (salesData?.monthlyTrend ?? []).map((r) => r.sales),
    [salesData?.monthlyTrend],
  )

  // B. Purchase Period Metrics & Supplier Positions
  const purchaseBills = purchaseBillsQuery.data ?? []
  const purchasePayments = purchasePaymentsQuery.data ?? []
  const supplierSummaries = supplierSummariesQuery.data ?? []

  const activePurchaseBills = useMemo(
    () => purchaseBills.filter((b) => !b.cancelled),
    [purchaseBills],
  )

  const periodPurchaseBills = useMemo(
    () =>
      activePurchaseBills.filter(
        (b) => b.date >= currentRange.from && b.date <= currentRange.to,
      ),
    [activePurchaseBills, currentRange.from, currentRange.to],
  )

  const prevPeriodPurchaseBills = useMemo(
    () =>
      activePurchaseBills.filter(
        (b) => b.date >= prevRange.from && b.date <= prevRange.to,
      ),
    [activePurchaseBills, prevRange.from, prevRange.to],
  )

  const periodBoughtKg = useMemo(
    () => periodPurchaseBills.reduce((sum, b) => sum + b.totalKg, 0),
    [periodPurchaseBills],
  )
  const prevPeriodBoughtKg = useMemo(
    () => prevPeriodPurchaseBills.reduce((sum, b) => sum + b.totalKg, 0),
    [prevPeriodPurchaseBills],
  )
  const boughtKgDeltaPct = useMemo(
    () => deltaPct(periodBoughtKg, prevPeriodBoughtKg),
    [periodBoughtKg, prevPeriodBoughtKg],
  )

  const periodBoughtPaise = useMemo(
    () => periodPurchaseBills.reduce((sum, b) => sum + b.netPaise, 0),
    [periodPurchaseBills],
  )

  const periodPurchasePaidPaise = useMemo(
    () =>
      purchasePayments
        .filter(
          (p) =>
            !p.cancelled &&
            p.kind !== 'refund_received' &&
            p.date >= currentRange.from &&
            p.date <= currentRange.to,
        )
        .reduce((sum, p) => sum + p.amountPaise, 0),
    [purchasePayments, currentRange.from, currentRange.to],
  )

  const purchasePositions = useMemo(
    () => computeSupplierPositions(supplierSummaries),
    [supplierSummaries],
  )

  const purchaseTrend6M = useMemo(() => {
    const monthlyMap = new Map<string, number>()
    for (const b of activePurchaseBills) {
      const m = b.date.slice(0, 7)
      monthlyMap.set(m, (monthlyMap.get(m) ?? 0) + b.netPaise / 100)
    }
    return [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([, val]) => val)
  }, [activePurchaseBills])

  // C. Casting Period Metrics
  const castingSessions = castingSessionsQuery.data ?? []

  const periodCastingSessions = useMemo(
    () =>
      castingSessions.filter(
        (s) => s.date && s.date >= currentRange.from && s.date <= currentRange.to,
      ),
    [castingSessions, currentRange.from, currentRange.to],
  )

  const prevPeriodCastingSessions = useMemo(
    () =>
      castingSessions.filter(
        (s) => s.date && s.date >= prevRange.from && s.date <= prevRange.to,
      ),
    [castingSessions, prevRange.from, prevRange.to],
  )

  const periodCasting = useMemo(
    () => summarizeCastingSessions(periodCastingSessions),
    [periodCastingSessions],
  )
  const prevPeriodCasting = useMemo(
    () => summarizeCastingSessions(prevPeriodCastingSessions),
    [prevPeriodCastingSessions],
  )
  const wireOutDeltaPct = useMemo(
    () => deltaPct(periodCasting.wire, prevPeriodCasting.wire),
    [periodCasting.wire, prevPeriodCasting.wire],
  )

  const castingTrend6M = useMemo(() => {
    const trend = buildMonthlyCastingTrend(castingSessions, 6)
    return trend.map((r) => r.wire)
  }, [castingSessions])

  // D. Needs Attention Items
  const bardanPendingBills = useMemo(() => {
    return activePurchaseBills
      .filter((b) => b.bardanPending)
      .map((b) => ({
        id: b.id,
        inNo: b.inNo,
        supplierName: b.supplierName,
        daysOld: diffDays(b.date, today),
      }))
  }, [activePurchaseBills, today])

  const totalPendingDrafts = (billDraftsCountQuery.data ?? 0) + (paymentDraftsCountQuery.data ?? 0)

  const attentionSummary = useMemo(() => {
    const customersForAttention = (salesData?.actionRequired?.riskRows ?? []).map((r) => ({
      id: r.customerId,
      name: r.customerName,
      dueDays: r.dueDays,
      dueAmount: r.amount,
    }))

    const suppliersForAttention = supplierSummaries.map((s) => ({
      id: s.supplier.id,
      name: s.supplier.companyName,
      oldestDueDays: s.oldestDueDays,
      duePaise: s.kachaDuePaise + s.gstDuePaise,
    }))

    return buildAttentionItems({
      customers: customersForAttention,
      suppliers: purchaseEnabled ? suppliersForAttention : [],
      bardanPendingBills: purchaseEnabled ? bardanPendingBills : [],
      pendingDraftsCount: totalPendingDrafts,
      latestBrassRateDate: brassRateQuery.data,
      asOfDate: today,
    })
  }, [
    salesData?.actionRequired?.riskRows,
    supplierSummaries,
    purchaseEnabled,
    bardanPendingBills,
    totalPendingDrafts,
    brassRateQuery.data,
    today,
  ])

  // E. Who to Receive From (Top 4 debtors)
  const whoToReceiveRows: RankedBarRow[] = useMemo(() => {
    return (salesData?.actionRequired?.riskRows ?? []).slice(0, 4).map((r) => ({
      id: r.customerId,
      label: r.customerName,
      value: r.amount,
      formattedValue: formatInrInteger(r.amount),
      subLabel: r.dueDays > 0 ? `${r.dueDays} days since last bill` : 'Current bill',
      ageDays: r.dueDays,
      ageLevel: r.dueDays > 60 ? 'overdue' : r.dueDays > 30 ? 'due' : 'watch',
      actionLabel: 'Collect',
      href: `/new-payment?customerId=${r.customerId}`,
    }))
  }, [salesData?.actionRequired?.riskRows])

  // F. Who to Pay Next (Top 4 suppliers)
  const whoToPayRows: RankedBarRow[] = useMemo(() => {
    return supplierSummaries
      .filter((s) => s.kachaDuePaise + s.gstDuePaise > 0)
      .sort((a, b) => b.kachaDuePaise + b.gstDuePaise - (a.kachaDuePaise + a.gstDuePaise))
      .slice(0, 4)
      .map((s) => {
        const duePaise = s.kachaDuePaise + s.gstDuePaise
        return {
          id: s.supplier.id,
          label: s.supplier.companyName,
          value: duePaise / 100,
          formattedValue: formatInrInteger(duePaise / 100),
          subLabel: s.oldestDueDays != null ? `${s.oldestDueDays} days oldest due` : 'Current due',
          ageDays: s.oldestDueDays,
          ageLevel: s.oldestDueDays != null && s.oldestDueDays > 30 ? 'due' : 'watch',
          actionLabel: 'Pay',
          href: `/new-supplier-payment?supplierId=${s.supplier.id}`,
        }
      })
  }, [supplierSummaries])

  // G. Latest Sale Bills (5 rows)
  const latestSaleBills = useMemo(() => {
    return (salesData?.recentBills ?? []).slice(0, 5)
  }, [salesData?.recentBills])

  // H. Latest Purchase Bills (5 rows)
  const latestPurchaseBills = useMemo(() => {
    return activePurchaseBills
      .sort((a, b) => `${b.date}|${b.created}|${b.id}`.localeCompare(`${a.date}|${a.created}|${a.id}`))
      .slice(0, 5)
  }, [activePurchaseBills])

  // ---------------- Loading / Error States ----------------
  if (salesQuery.isLoading) {
    return (
      <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
        <div data-card="true" className="h-14 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div data-card="true" className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div data-card="true" className="h-48 animate-pulse rounded-xl border border-slate-200 bg-white" />
          <div data-card="true" className="h-48 animate-pulse rounded-xl border border-slate-200 bg-white" />
          <div data-card="true" className="h-48 animate-pulse rounded-xl border border-slate-200 bg-white" />
        </div>
      </div>
    )
  }

  if (salesQuery.isError || !salesData) {
    return (
      <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
        <Panel className="rounded-xl border-rose-200 bg-rose-50 p-6 text-center">
          <AlertCircle className="mx-auto mb-2 text-rose-600" size={24} />
          <h2 className="text-sm font-semibold text-rose-800">Unable to load dashboard</h2>
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
      {purchaseEnabled && (
        <Link
          to="/new-purchase-bill"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <Plus size={14} /> New Purchase Bill
        </Link>
      )}
      {castingEnabled && (
        <Link
          to="/casting/new-session"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <Plus size={14} /> New Casting Heat
        </Link>
      )}
    </div>
  )

  const moduleGridCols =
    purchaseEnabled && castingEnabled
      ? 'lg:grid-cols-3'
      : purchaseEnabled || castingEnabled
        ? 'lg:grid-cols-2'
        : 'max-w-xl'

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

      {/* 2. Needs Attention Card (ExceptionList) */}
      <SectionCard
        title="Needs Attention"
        subtitle="Operational exceptions requiring operator review"
      >
        {attentionSummary.allClear ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>Nothing needs attention. All debtor balances, supplier dues, bardan, and drafts are within normal limits.</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {attentionSummary.items.map((item) => (
              <Link
                key={item.id}
                to={item.href}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors',
                  item.tone === 'rose'
                    ? 'border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
                    : 'border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
                )}
                title={item.detail}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    item.tone === 'rose' ? 'bg-rose-500' : 'bg-amber-500',
                  )}
                />
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 3. Three Module Overview Cards Side by Side */}
      <div className={cn('grid grid-cols-1 gap-4', moduleGridCols)}>
        {/* Sales Module Card */}
        <SectionCard
          title="Sales"
          subtitle="Volume and receivables position"
          actions={
            <Link
              to="/sales-dashboard"
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Open <ArrowRight size={12} />
            </Link>
          }
        >
          {/* Hero: Billed */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Billed <span className="text-[11px] font-mono text-slate-400">({currentRange.label})</span></span>
              <Sparkline values={salesTrend6M} color="#0f172a" width={80} height={24} />
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <strong
                className="font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-3xl"
                title={`Exact: ₹${periodSales.toLocaleString('en-IN')}`}
              >
                {formatCompactInr(periodSales)}
              </strong>
              <DeltaChip delta={salesDeltaPct} goodDirection="up" />
            </div>
          </div>

          {/* Supporting Metrics */}
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div>
              <p className="text-[11px] font-medium text-slate-500">Collected</p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                {formatCompactInr(periodCollected)}
              </p>
              <p className="text-[10px] text-slate-400">This period</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Still to receive</p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                {formatCompactInr(salesData.kpis.outstanding)}
              </p>
              <p className="text-[10px] text-slate-400">Balance now ({salesData.actionRequired.pendingParties} parties)</p>
            </div>
          </div>
        </SectionCard>

        {/* Purchase Module Card */}
        {purchaseEnabled && (
          <SectionCard
            title="Purchase"
            subtitle="Scrap procurement and payables"
            actions={
              <Link
                to="/purchase-dashboard"
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                Open <ArrowRight size={12} />
              </Link>
            }
          >
            {/* Hero: Bought */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Bought <span className="text-[11px] font-mono text-slate-400">({currentRange.label})</span></span>
                <Sparkline values={purchaseTrend6M} color="#0f172a" width={80} height={24} />
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <strong
                    className="font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-3xl"
                    title={`Exact: ${periodBoughtKg.toLocaleString('en-IN')} kg`}
                  >
                    {formatCompactKg(periodBoughtKg)}
                  </strong>
                  <span className="ml-2 font-mono text-sm text-slate-600">
                    · {formatCompactInr(periodBoughtPaise / 100)}
                  </span>
                </div>
                <DeltaChip delta={boughtKgDeltaPct} goodDirection="up" />
              </div>
            </div>

            {/* Supporting Metrics */}
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div>
                <p className="text-[11px] font-medium text-slate-500">Paid out</p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                  {formatCompactInr(periodPurchasePaidPaise / 100)}
                </p>
                <p className="text-[10px] text-slate-400">This period</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500">We owe</p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                  {formatCompactInr(purchasePositions.totalPayablePaise / 100)}
                </p>
                <p className="text-[10px] text-slate-400">
                  Kacha: {formatCompactInr(purchasePositions.kachaPayablePaise / 100)} · GST: {formatCompactInr(purchasePositions.gstPayablePaise / 100)}
                </p>
                {purchasePositions.totalAdvancePaise > 0 && (
                  <p className="text-[10px] font-medium text-emerald-700">
                    Advance held: {formatCompactInr(purchasePositions.totalAdvancePaise / 100)}
                  </p>
                )}
              </div>
            </div>
          </SectionCard>
        )}

        {/* Casting Module Card */}
        {castingEnabled && (
          <SectionCard
            title="Casting"
            subtitle="Foundry heats and loaded cost"
            actions={
              <Link
                to="/casting"
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                Open <ArrowRight size={12} />
              </Link>
            }
          >
            {/* Hero: Wire out kg */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Wire out <span className="text-[11px] font-mono text-slate-400">({currentRange.label})</span></span>
                <Sparkline values={castingTrend6M} color="#0f172a" width={80} height={24} />
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <strong
                  className="font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-3xl"
                  title={`Exact: ${periodCasting.wire.toLocaleString('en-IN')} kg`}
                >
                  {formatCompactKg(periodCasting.wire)}
                </strong>
                <DeltaChip delta={wireOutDeltaPct} goodDirection="up" />
              </div>
            </div>

            {/* Supporting Metrics */}
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div>
                <p className="text-[11px] font-medium text-slate-500">Loaded cost / kg</p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                  {periodCasting.avgLoadedCostKg > 0 ? `₹${Math.round(periodCasting.avgLoadedCostKg)}` : '—'}
                </p>
                <p className="text-[10px] text-slate-400">This period</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500">Active heats</p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                  {periodCasting.count} heats
                </p>
                <p className="text-[10px] text-slate-400">{periodCasting.daysRunning} foundry days</p>
              </div>
            </div>
          </SectionCard>
        )}
      </div>

      {/* 4. Who to Receive & Who to Pay (Side by Side) */}
      <div className={cn('grid grid-cols-1 gap-4', purchaseEnabled ? 'xl:grid-cols-2' : '')}>
        {/* Who to Receive From */}
        <SectionCard
          title="Who to Receive From"
          subtitle="Top customer balances requiring collection"
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
          <RankedBars
            rows={whoToReceiveRows}
            tone="slate"
            emptyText="No customer balance overdue."
          />
        </SectionCard>

        {/* Who to Pay Next */}
        {purchaseEnabled && (
          <SectionCard
            title="Who to Pay Next"
            subtitle="Top supplier balances awaiting payment"
            actions={
              <Link
                to="/ledger"
                search={{ tab: 'suppliers' }}
                className="text-xs font-semibold text-slate-700 hover:text-slate-900"
              >
                Supplier ledger →
              </Link>
            }
          >
            <RankedBars
              rows={whoToPayRows}
              tone="slate"
              emptyText="No supplier balance due."
            />
          </SectionCard>
        )}
      </div>

      {/* 5. Latest Sale Bills & Latest Purchase Bills (Side by Side) */}
      <div className={cn('grid grid-cols-1 gap-4', purchaseEnabled ? 'xl:grid-cols-2' : '')}>
        {/* Latest Sale Bills */}
        <SectionCard
          title="Latest Sale Bills"
          subtitle="Recent customer sales"
          actions={
            <Link
              to="/transactions"
              search={{ focusKind: '', focusId: '' }}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900"
            >
              All transactions →
            </Link>
          }
        >
          {latestSaleBills.length === 0 ? (
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
                  {latestSaleBills.map((b) => (
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

        {/* Latest Purchase Bills */}
        {purchaseEnabled && (
          <SectionCard
            title="Latest Purchase Bills"
            subtitle="Recent inward scrap lots"
            actions={
              <Link
                to="/purchase-bills"
                className="text-xs font-semibold text-slate-700 hover:text-slate-900"
              >
                All purchase bills →
              </Link>
            }
          >
            {latestPurchaseBills.length === 0 ? (
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
                      <th className="pb-2 text-right font-normal">Net Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                    {latestPurchaseBills.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 font-mono">
                          <Link
                            to="/purchase-bills/$billId"
                            params={{ billId: b.id }}
                            className="hover:underline text-slate-900 font-semibold"
                          >
                            {b.inNo}
                          </Link>
                        </td>
                        <td className="py-2.5 text-slate-500 font-mono text-[11px]">{formatFullDate(b.date)}</td>
                        <td className="py-2.5 truncate max-w-[140px] text-slate-900" title={b.supplierName}>
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
        )}
      </div>
    </div>
  )
}
