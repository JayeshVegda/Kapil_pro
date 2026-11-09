import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { loadPartyDashboard } from '@/data/ledger'
import { useDashboardData } from '@/domain/dashboard'
import { computeAgeingBuckets } from '@/domain/records'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { ReportTable } from '@/components/reports/report-table'
import { SalesCollectionTrendChart } from '@/components/reports/company-charts'

export const Route = createFileRoute('/sales-dashboard')({ component: SalesDashboardPage })
function SalesDashboardPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const dashboard = useDashboardData(today)
  const parties = useQuery({ queryKey: ['sales-dashboard-parties', today], queryFn: () => loadPartyDashboard(today) })
  if (dashboard.isLoading || parties.isLoading) return <div className="space-y-4 p-4"><div className="h-24 animate-pulse rounded-xl bg-white" /><div className="h-60 animate-pulse rounded-xl bg-white" /></div>
  if (dashboard.isError || parties.isError || !dashboard.data) return <p role="alert" className="p-6 text-sm text-rose-700">Sales Dashboard could not load.</p>
  const data = dashboard.data
  const due = [...(parties.data?.rows ?? [])].filter((row) => row.dueAmount > 0).sort((a, b) => b.dueAmount - a.dueAmount).slice(0, 10)
  const ageing = computeAgeingBuckets(data.actionRequired.riskRows)
  return <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Billed this month', formatInrInteger(data.thisMonthSummary.sales), '/transactions'], ['Collected this month', formatInrInteger(data.thisMonthSummary.collection), '/new-payment'], ['Still to receive', formatInrInteger(data.kpis.outstanding), '/ledger'], ['Bills all time', data.kpis.totalBills.toLocaleString('en-IN'), '/transactions']].map(([label, value, href]) => <Link key={label} to={href} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900">{value}</p></Link>)}</div>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="mb-3 text-sm font-semibold text-slate-900">Monthly sales and collections</h2><SalesCollectionTrendChart data={data.monthlyTrend.map((row) => ({ month: row.month, sales: row.sales, collections: row.collection }))} /></section>
    <div className="grid gap-4 xl:grid-cols-2"><ReportTable title="Top 10 customers by outstanding" headers={['Customer', 'Due']} rows={due.map((row) => [row.customerName, formatInrInteger(row.dueAmount)])} /><ReportTable title="Top items by kg this month" headers={['Item', 'Kg', 'Bags']} rows={data.thisMonthItemBags.slice(0, 10).map((row) => [row.itemName, row.kg.toLocaleString('en-IN'), row.bags.toLocaleString('en-IN')])} /></div>
    <ReportTable title="Receivable ageing" headers={['Age', 'Due']} rows={ageing.buckets.map((b) => [b.label, formatInrInteger(b.amount)])} />
    <div className="grid gap-4 xl:grid-cols-2"><ReportTable title="Recent bills" headers={['Date', 'Customer', 'Amount']} rows={data.recentBills.slice(0, 5).map((bill) => [bill.businessDate, bill.customerName, formatInrInteger(bill.total)])} /><ReportTable title="Recent payments" headers={['Date', 'Customer', 'Amount']} rows={data.recentPayments.slice(0, 5).map((payment) => [payment.businessDate, payment.customerName, formatInrInteger(payment.amount)])} /></div>
  </div>
}

