import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ReportTable } from '@/components/reports/report-table'
import { loadPartyDashboard } from '@/data/ledger'
import { useDashboardData } from '@/domain/dashboard'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { KpiCard } from '@/components/ui/business-kit'

export const Route = createFileRoute('/reports/sales')({ beforeLoad: () => { throw redirect({ to: '/module-report', search: { module: 'sales', asOf: undefined } }) } })
export function SalesReportPage({ asOfDate }: { asOfDate?: string }) {
  const currentDate = useMemo(() => getLocalIsoDate(), [])
  const today = asOfDate ?? currentDate
  const dashboard = useDashboardData(today)
  const parties = useQuery({ queryKey: ['sales-report-parties', today], queryFn: () => loadPartyDashboard(today) })
  if (dashboard.isLoading || parties.isLoading) return <p className="p-6 text-sm text-slate-500">Loading Sales report…</p>
  if (dashboard.isError || parties.isError) return <p role="alert" className="p-6 text-sm text-rose-700">Sales report could not load.</p>
  const data = dashboard.data
  const rows = parties.data?.rows ?? []
  const ageing = [0, 0, 0]
  for (const row of data?.actionRequired.riskRows ?? []) ageing[row.dueDays <= 30 ? 0 : row.dueDays <= 60 ? 1 : 2] += row.amount
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3"><KpiCard label="Billed this month" value={formatInrInteger(data?.kpis.thisMonthSales ?? 0)} /><KpiCard label="Collected this month" value={formatInrInteger(data?.kpis.thisMonthCollection ?? 0)} /><KpiCard label="Receivable · current" value={formatInrInteger(data?.kpis.outstanding ?? 0)} /></div>
    <ReportTable title="Party-wise balances" headers={['Customer', 'Due', 'Status']} rows={rows.map((row) => [row.customerName, formatInrInteger(row.dueAmount), row.status])} />
    <ReportTable title="Item-wise sales this month" headers={['Item', 'Quantity', 'Line amount']} rows={(data?.thisMonthItemReport ?? []).map((row) => [row.itemName, `${row.quantity.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${row.unit}`, formatInrInteger(row.amount)])} />
    <ReportTable title="Monthly trend" headers={['Month', 'Billed', 'Collected']} rows={(data?.monthlyTrend ?? []).map((row) => [row.month, formatInrInteger(row.sales), formatInrInteger(row.collection)])} />
    <ReportTable title="Receivable age by latest bill" headers={['Age', 'Due']} rows={['0–30 days', '31–60 days', '60+ days'].map((label, index) => [label, formatInrInteger(ageing[index])])} />
  </div>
}
