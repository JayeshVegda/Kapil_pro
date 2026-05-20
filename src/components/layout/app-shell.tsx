import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Clock3, Command, Loader2, Menu, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadQuickSearchResults, type QuickSearchResult } from '@/data/quick-search'
import { PENDING_COMMAND_STORAGE_KEY, splitCommandPrefix, inferCommandKind } from '@/lib/commands'
import { SidebarNavPanel } from './sidebar-nav'

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Live business overview and pending actions' },
  '/new-bill': { title: 'Bills', subtitle: 'Create and preview new sale bills' },
  '/new-payment': { title: 'Payments', subtitle: 'Record collections and adjustments' },
  '/stock': { title: 'Stock', subtitle: 'Finished goods stock control and audit' },
  '/stock-in': { title: 'Stock', subtitle: 'Finished goods stock control and audit' },
  '/transactions': { title: 'Logs', subtitle: 'Manage recent bills and payments with CRUD actions' },
  '/ledger': { title: 'Party', subtitle: 'Single-party ledger and analytics' },
  '/monthly-report': { title: 'Report', subtitle: 'Company-level performance insights' },
  '/calendar': { title: 'Calendar', subtitle: 'Month view of sales, collections, and market rate' },
  '/export-reports': { title: 'Exports', subtitle: 'Download ledger, company, stock, and backup reports' },
  '/customers': { title: 'Customers', subtitle: 'Manage customer master data' },
  '/items': { title: 'Items', subtitle: 'Manage item master and defaults' },
  '/data-health': { title: 'Data Health', subtitle: 'Find stock, bill, and setup data issues' },
  '/backup': { title: 'Backup', subtitle: 'Export and validate data snapshots' },
  '/print-bill': { title: 'Print Bill', subtitle: 'Filter, preview, and print bills' },
}

const DOC_TITLE_SUFFIX = 'Kapil Billing'

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [quickSearch, setQuickSearch] = useState('')
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [activeQuickSearchIndex, setActiveQuickSearchIndex] = useState(0)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [commandError, setCommandError] = useState('')
  const quickSearchRef = useRef<HTMLLabelElement | null>(null)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const meta = pageMeta[pathname] ?? { title: 'Kapil Billing', subtitle: 'Business billing workspace' }
  const normalizedQuickSearch = quickSearch.trim()
  const quickSearchQuery = useQuery({
    queryKey: ['quick-search', normalizedQuickSearch],
    queryFn: () => loadQuickSearchResults(normalizedQuickSearch),
    enabled: normalizedQuickSearch.length >= 2,
    staleTime: 30_000,
  })
  const quickSearchResults = useMemo(() => quickSearchQuery.data ?? [], [quickSearchQuery.data])

  useEffect(() => {
    document.title = `${meta.title} – ${DOC_TITLE_SUFFIX}`
  }, [meta.title])

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!quickSearchRef.current?.contains(event.target as Node)) setQuickSearchOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(() => {
    setActiveQuickSearchIndex(0)
  }, [normalizedQuickSearch, quickSearchResults.length])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!commandOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setCommandOpen(false)
      setCommandError('')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandOpen])

  function openQuickSearchResult(result: QuickSearchResult | undefined) {
    if (!result) return
    setQuickSearch('')
    setQuickSearchOpen(false)
    if (result.kind === 'Bill' && result.billId) {
      void navigate({ to: '/print-bill', search: { billId: result.billId, billRef: '' } })
      return
    }
    if (result.kind === 'Payment' && result.paymentId) {
      void navigate({ to: '/transactions', search: { focusKind: 'payment', focusId: result.paymentId } })
      return
    }
    void navigate({ to: '/ledger', search: { customerId: result.customerId, focus: '' } })
  }

  function runGlobalCommand() {
    const context = inferCommandKind(pathname)
    const parsed = splitCommandPrefix(commandInput, context)
    if (!parsed.kind) {
      setCommandError('Use prefix from this page: b bill, p payment, s stock, pr print.')
      return
    }
    const body = parsed.body.trim()
    if (!body) {
      setCommandError('Type command details after the prefix.')
      return
    }
    setCommandError('')
    setCommandOpen(false)
    setCommandInput('')
    if (parsed.kind === 'print') {
      void navigate({ to: '/print-bill', search: { billRef: body, billId: '' } })
      return
    }
    window.sessionStorage.setItem(PENDING_COMMAND_STORAGE_KEY, JSON.stringify({ kind: parsed.kind, body, createdAt: Date.now() }))
    if (parsed.kind === 'bill') void navigate({ to: '/new-bill' })
    if (parsed.kind === 'payment') void navigate({ to: '/new-payment' })
    if (parsed.kind === 'stock') void navigate({ to: '/stock' })
  }

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
            <label ref={quickSearchRef} className="relative hidden lg:block">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Quick search party, bill, payment..."
                value={quickSearch}
                onChange={(event) => {
                  setQuickSearch(event.target.value)
                  setQuickSearchOpen(true)
                }}
                onFocus={() => setQuickSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setQuickSearchOpen(true)
                    setActiveQuickSearchIndex((index) => (quickSearchResults.length === 0 ? 0 : (index + 1) % quickSearchResults.length))
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setQuickSearchOpen(true)
                    setActiveQuickSearchIndex((index) => (quickSearchResults.length === 0 ? 0 : index <= 0 ? quickSearchResults.length - 1 : index - 1))
                    return
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    openQuickSearchResult(quickSearchResults[activeQuickSearchIndex] ?? quickSearchResults[0])
                    return
                  }
                  if (event.key === 'Escape') setQuickSearchOpen(false)
                }}
                className="h-9 w-[300px] rounded-full border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300"
              />
              {quickSearchOpen && normalizedQuickSearch.length >= 2 && (
                <div className="absolute right-0 z-[80] mt-2 w-[420px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                  {quickSearchQuery.isLoading && <div className="px-3 py-2 text-sm text-slate-500">Searching...</div>}
                  {quickSearchQuery.isError && <div className="px-3 py-2 text-sm text-red-600">Unable to search right now.</div>}
                  {!quickSearchQuery.isLoading && !quickSearchQuery.isError && quickSearchResults.length === 0 && (
                    <div className="px-3 py-2 text-sm text-slate-500">No matching party, bill, or payment.</div>
                  )}
                  {!quickSearchQuery.isLoading &&
                    !quickSearchQuery.isError &&
                    quickSearchResults.map((result, index) => (
                      <button
                        key={result.id}
                        type="button"
                        className={`block w-full px-3 py-2.5 text-left transition ${
                          index === activeQuickSearchIndex ? 'bg-blue-50 text-slate-950' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveQuickSearchIndex(index)}
                        onClick={() => openQuickSearchResult(result)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-medium">{result.title}</span>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                            {result.kind}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{result.subtitle}</p>
                      </button>
                    ))}
                </div>
              )}
            </label>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
              onClick={() => setCommandOpen(true)}
              title="Command bar (Ctrl+K)"
              aria-label="Open command bar"
            >
              <Command size={15} />
            </button>
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
      {commandOpen && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-900/50 px-4 pt-24" onMouseDown={() => setCommandOpen(false)}>
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-100 p-3">
              <div className="relative">
                <Command size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                  value={commandInput}
                  onChange={(event) => {
                    setCommandInput(event.target.value)
                    setCommandError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setCommandOpen(false)
                      setCommandError('')
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      runGlobalCommand()
                    }
                  }}
                  placeholder={inferCommandKind(pathname) === 'neutral' ? 'b sambhu 10, p sambhu 50k, s spindle 20, pr 51/24' : 'Type command for this page, or use prefix for another action'}
                />
              </div>
              {commandError && <p className="mt-2 text-xs text-red-600">{commandError}</p>}
            </div>
            <div className="flex flex-wrap gap-2 p-3 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-2 py-1">b bill</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">p payment</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">s stock</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">pr print</span>
              <span className="ml-auto hidden sm:inline">Enter to review, Esc to close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
