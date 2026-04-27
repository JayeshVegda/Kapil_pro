import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw, Search } from 'lucide-react'
import { SidebarNav } from './sidebar-nav'

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Live business overview and pending actions' },
  '/new-bill': { title: 'Bills', subtitle: 'Create and preview new sale bills' },
  '/new-payment': { title: 'Payments', subtitle: 'Record collections and adjustments' },
  '/ledger': { title: 'Party', subtitle: 'Single-party ledger and analytics' },
  '/monthly-report': { title: 'Report', subtitle: 'Company-level performance insights' },
  '/customers': { title: 'Customers', subtitle: 'Manage customer master data' },
  '/items': { title: 'Items', subtitle: 'Manage item master and defaults' },
  '/backup': { title: 'Backup', subtitle: 'Export and validate data snapshots' },
  '/print-bill': { title: 'Print Bill', subtitle: 'Filter, preview, and print bills' },
}

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const meta = pageMeta[pathname] ?? { title: 'Kapil Billing', subtitle: 'Business billing workspace' }
  const queryClient = useQueryClient()
  const fetchCount = useIsFetching()
  const isSyncing = fetchCount > 0
  const queryStates = queryClient
    .getQueryCache()
    .getAll()
    .map((q) => q.state)
  const lastUpdatedAt = queryStates.reduce((max, s) => Math.max(max, s.dataUpdatedAt ?? 0), 0)
  const hasError = queryStates.some((s) => s.status === 'error')
  const hasSynced = lastUpdatedAt > 0
  const ageMs = hasSynced ? Date.now() - lastUpdatedAt : Infinity
  const isOutdated = hasSynced ? ageMs > 5 * 60_000 : true
  const syncState: 'syncing' | 'error' | 'outdated' | 'synced' = isSyncing ? 'syncing' : hasError ? 'error' : isOutdated ? 'outdated' : 'synced'

  return (
    <div className="flex min-h-dvh bg-slate-100">
      <SidebarNav />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-50 flex items-center justify-between gap-4 border-b border-slate-200/90 bg-white/95 px-5 py-2.5 backdrop-blur">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">{meta.title}</h1>
            <p className="text-xs text-slate-500">{meta.subtitle}</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <label className="relative hidden lg:block">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Quick search party, bill, payment..."
                className="h-9 w-[300px] rounded-full border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300"
              />
            </label>
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                void queryClient.invalidateQueries()
              }}
              title={syncState === 'syncing' ? 'Sync in progress' : 'Refresh now'}
              aria-label="Refresh app data"
              disabled={syncState === 'syncing'}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full ${
                  syncState === 'error' ? 'bg-red-100 text-red-700' : syncState === 'outdated' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                }`}
              >
                {syncState === 'syncing' && <Loader2 size={13} className="animate-spin" />}
                {syncState === 'synced' && <CheckCircle2 size={13} />}
                {syncState === 'error' && <AlertTriangle size={13} />}
                {syncState === 'outdated' && <Clock3 size={13} />}
              </span>
              <span className="inline-flex flex-col items-start leading-tight">
                <span className="text-xs font-semibold text-slate-700">
                  {syncState === 'syncing' ? 'Syncing' : syncState === 'error' ? 'Sync Error' : syncState === 'outdated' ? 'Outdated' : 'Synced'}
                </span>
                <span className="max-w-48 truncate text-[11px] text-slate-500">
                  {syncState === 'syncing'
                    ? 'Updating data...'
                    : hasSynced
                      ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString()}`
                      : 'Waiting for first sync'}
                </span>
              </span>
              <span className="grid h-5 w-5 place-items-center text-slate-500">
                <RefreshCw size={13} className={syncState === 'syncing' ? 'animate-spin' : ''} />
              </span>
            </button>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  )
}
