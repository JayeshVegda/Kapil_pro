import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMemo } from 'react'
import { TabBar } from '@/components/ui/business-kit'
import { useModuleSettings } from '@/lib/use-module-settings'
import { loadModuleSettingsForGuard } from '@/data/module-settings'
import { getLocalIsoDate } from '@/lib/date'
import { SalesReportPage } from './reports/sales'
import { PurchaseReportPage } from './reports/purchase'
import { CastingReportPage } from './reports/casting'
import { BrassRateReport } from '@/components/reports/brass-rate-report'

type ReportModule = 'sales' | 'purchase' | 'casting' | 'brass-rate'

export const Route = createFileRoute('/module-report')({
  validateSearch: (search: Record<string, unknown>) => ({
    module: (search.module === 'purchase' || search.module === 'casting' || search.module === 'brass-rate' ? search.module : 'sales') as ReportModule,
    asOf: typeof search.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.asOf) ? search.asOf : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const settings = await loadModuleSettingsForGuard().catch(() => null)
    if (settings && ((search.module === 'purchase' && !settings.purchaseEnabled) || (search.module === 'casting' && !settings.castingEnabled))) throw redirect({ to: '/module-report', search: { module: 'sales', asOf: undefined }, replace: true })
  },
  component: ModuleReportPage,
})

function ModuleReportPage() {
  const { purchaseEnabled, castingEnabled } = useModuleSettings()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const today = useMemo(() => getLocalIsoDate(), [])
  const module = search.module === 'purchase' && !purchaseEnabled || search.module === 'casting' && !castingEnabled ? 'sales' : search.module
  const asOf = search.asOf ?? today
  const tabs = [
    { value: 'sales' as const, label: 'Sales' },
    ...(purchaseEnabled ? [{ value: 'purchase' as const, label: 'Purchase' }] : []),
    ...(castingEnabled ? [{ value: 'casting' as const, label: 'Casting' }] : []),
    { value: 'brass-rate' as const, label: 'Brass Rate' },
  ]
  return <main className="space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <TabBar label="Report module" options={tabs} value={module} onChange={(next) => void navigate({ search: { module: next, asOf: search.asOf }, replace: true })} />
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">{module === 'brass-rate' ? 'Rates through' : 'Activity through'} <input aria-label={module === 'brass-rate' ? 'Brass rates through date' : 'Report activity through date'} type="date" max={today} value={asOf} onChange={(event) => void navigate({ search: { module, asOf: event.target.value || undefined }, replace: true })} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" /></label>
    </div>
    {module !== 'brass-rate' && <p className="text-xs text-slate-500">Activity uses the selected date. Supplier payable is the current settled balance.</p>}
    {module === 'brass-rate' ? <BrassRateReport key={asOf} asOfDate={asOf} />
      : module === 'sales' ? <SalesReportPage asOfDate={asOf} />
      : module === 'purchase' ? <PurchaseReportPage asOfDate={asOf} />
      : <CastingReportPage asOfDate={asOf} />}
  </main>
}
