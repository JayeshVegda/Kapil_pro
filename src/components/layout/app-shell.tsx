import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Clock3, Loader2, Menu, RefreshCw, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SidebarNavPanel } from './sidebar-nav'

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Live business overview and pending actions' },
  '/new-bill': { title: 'Bills', subtitle: 'Create and preview new sale bills' },
  '/new-payment': { title: 'Payments', subtitle: 'Record collections and adjustments' },
  '/transactions': { title: 'Logs', subtitle: 'Manage recent bills and payments with CRUD actions' },
  '/ledger': { title: 'Party', subtitle: 'Single-party ledger and analytics' },
  '/monthly-report': { title: 'Report', subtitle: 'Company-level performance insights' },
  '/calendar': { title: 'Calendar', subtitle: 'Month view of sales, collections, and market rate' },
  '/customers': { title: 'Customers', subtitle: 'Manage customer master data' },
  '/items': { title: 'Items', subtitle: 'Manage item master and defaults' },
  '/backup': { title: 'Backup', subtitle: 'Export and validate data snapshots' },
  '/print-bill': { title: 'Print Bill', subtitle: 'Filter, preview, and print bills' },
  '/buying': { title: 'Buying Overview', subtitle: 'Procurement summary for suppliers and payable flow' },
  '/buying/suppliers': { title: 'Suppliers', subtitle: 'Supplier master and procurement context' },
  '/buying/new-purchase': { title: 'New Purchase', subtitle: 'Record scrap purchase with deductions' },
  '/buying/supplier-payments': { title: 'Supplier Payments', subtitle: 'Pay suppliers and reduce payable' },
  '/buying/purchase-logs': { title: 'Purchase Logs', subtitle: 'Purchases and supplier payment activity' },
  '/buying/supplier-ledger': { title: 'Supplier Ledger', subtitle: 'Supplier-wise payable movements' },
  '/casting': { title: 'Casting Overview', subtitle: 'Production summary and recent cost trends' },
  '/casting/new-session': { title: 'New Casting Session', subtitle: 'Daily furnace inputs, outputs, cost per kg' },
  '/casting/log': { title: 'Casting Log', subtitle: 'History of casting sessions' },
}

const DOC_TITLE_SUFFIX = 'Kapil Billing'

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const meta = pageMeta[pathname] ?? { title: 'Kapil Billing', subtitle: 'Business billing workspace' }

  useEffect(() => {
    document.title = `${meta.title} – ${DOC_TITLE_SUFFIX}`
  }, [meta.title])
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
      <SidebarNavPanel mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-slate-200/90 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-4 lg:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-700 lg:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={16} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg">{meta.title}</h1>
              <p className="hidden truncate text-xs text-slate-500 sm:block">{meta.subtitle}</p>
            </div>
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
              <span className="hidden md:inline-flex md:flex-col md:items-start md:leading-tight">
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
        <div className="w-full 2xl:mx-auto 2xl:max-w-[1680px]">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
