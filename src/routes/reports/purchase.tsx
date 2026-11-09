import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ReportTable } from '@/components/reports/report-table'
import { purchaseReadModelQueryOptions } from '@/data/purchase-queries'
import { loadVilaityHistory } from '@/data/suppliers'
import { computeBillNet } from '@/domain/supplier-purchases'
import { computePurchaseItemMarketPremium } from '@/domain/supplier-market-premium'
import { computeAgeingBuckets } from '@/domain/records'
import { formatPaiseInr } from '@/lib/inr-format'
import { getLocalIsoDate } from '@/lib/date'

export const Route = createFileRoute('/reports/purchase')({ component: PurchaseReportPage })
function PurchaseReportPage() {
  const model = useQuery(purchaseReadModelQueryOptions())
  const rates = useQuery({ queryKey: ['purchase-report-vilaity'], queryFn: loadVilaityHistory })
  if (model.isLoading || rates.isLoading) return <p className="p-6 text-sm text-slate-500">Loading Purchase report…</p>
  if (model.isError || rates.isError) return <p role="alert" className="p-6 text-sm text-rose-700">Purchase report could not load.</p>
  const data = model.data!
  const today = getLocalIsoDate()
  const activeBills = data.bills.filter((entry) => !entry.cancelled)
  const itemPremiums = computePurchaseItemMarketPremium(activeBills, rates.data ?? [])

  const ageRows = activeBills.filter((b) => b.duePaise > 0).map((b) => {
    const days = Math.max(0, Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${b.date}T00:00:00Z`).getTime()) / 86_400_000))
    return { amount: b.duePaise, dueDays: days }
  })
  const ageing = computeAgeingBuckets(ageRows)

  const bardanCounts = [0, 0, 0]
  const rcm = new Map<string, number>()
  for (const bill of activeBills) {
    const days = Math.max(0, Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${bill.date}T00:00:00Z`).getTime()) / 86_400_000))
    const bucket = days <= 30 ? 0 : days <= 60 ? 1 : 2
    if (bill.bardanPending) bardanCounts[bucket] += 1
    if (bill.taxMode === 'rcm') {
      const result = computeBillNet(bill.lines, bill.adjustments, bill.bardan, bill.taxMode, bill.gstRateBp)
      rcm.set(bill.date.slice(0, 7), (rcm.get(bill.date.slice(0, 7)) ?? 0) + result.rcmLiabilityPaise)
    }
  }

  return <div className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
    <ReportTable title="Supplier-wise payable" headers={['Supplier', 'Payable', 'Advance', 'Oldest due']} rows={data.summaries.map((row) => [row.supplier.companyName, formatPaiseInr(row.outstandingPaise), formatPaiseInr(row.advancePaise), row.oldestDueDays == null ? '—' : `${row.oldestDueDays} days`])} />
    <ReportTable title="Item-wise purchases" headers={['Item', 'Kg', 'Average rate', 'Vs vilaity (internal only)']} rows={itemPremiums.map((row) => [row.itemName, row.totalKg.toLocaleString('en-IN', { maximumFractionDigits: 2 }), row.totalKg ? `₹${row.avgRateRupees.toFixed(2)}` : '—', row.premiumKg ? `₹${row.premiumRupeesPerKg.toFixed(2)}/kg` : '—'])} />
    <ReportTable title="Payable and bardan ageing" headers={['Age', 'Payable', 'Bardan pending bills']} rows={ageing.buckets.map((b, index) => [b.label, formatPaiseInr(b.amount), bardanCounts[index]])} />
    <ReportTable title="RCM liability by month" headers={['Month', 'Liability']} rows={[...rcm].sort((a, b) => b[0].localeCompare(a[0])).map(([month, paise]) => [month, formatPaiseInr(paise)])} />
  </div>
}

