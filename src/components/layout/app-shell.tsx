import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Clock3, Command, Loader2, Menu, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { pb } from '@/data/pocketbase'
import { loadQuickSearchResults, type QuickSearchResult } from '@/data/quick-search'
import { useMarketRate } from '@/domain/market-rate'
import { getAdminControlSettings, subscribeAdminControlSettings } from '@/lib/admin-control'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger, formatInQty } from '@/lib/inr-format'
import { PENDING_COMMAND_STORAGE_KEY, splitCommandPrefix, inferCommandKind, getCommandRegistry, parseContextCommand } from '@/lib/commands'
import { findBestNameMatch } from '@/lib/search'
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
  '/control-room': { title: 'Control Room', subtitle: 'Admin operations, command workflows, and system controls' },
}

const DOC_TITLE_SUFFIX = 'Kapil Billing'

type CommandDraft = {
  mode: string
  lines: Array<{ label: string; value: string }>
  suggestions: string[]
}

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [quickSearch, setQuickSearch] = useState('')
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [activeQuickSearchIndex, setActiveQuickSearchIndex] = useState(0)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [commandError, setCommandError] = useState('')
  const [adminSettings, setAdminSettings] = useState(getAdminControlSettings)
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
  const commandRegistry = useMemo(() => getCommandRegistry(), [adminSettings])
  const today = useMemo(() => getLocalIsoDate(), [])
  const { marketRate } = useMarketRate(today)
  const commandDepsQuery = useQuery({
    queryKey: ['command-bar-deps'],
    enabled: commandOpen || commandInput.trim().length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [customersRaw, itemsRaw] = await Promise.all([
        pb.collection('customers').getFullList({ sort: 'company_name,name' }),
        pb.collection('items').getFullList({ sort: 'name' }),
      ])
      return {
        customers: customersRaw.map((r) => ({
          id: r.id,
          name: String(r.company_name ?? r.name ?? ''),
          companyName: String(r.company_name ?? ''),
          customerName: String(r.name ?? ''),
        })),
        items: itemsRaw.map((r) => ({
          id: r.id,
          name: String(r.name ?? ''),
          defaultRate: Number(r.default_rate ?? 0),
          type: String(r.type ?? ''),
          unit: String(r.unit ?? ''),
          bagWeight: Number(r.bag_weight ?? 50),
        })),
      }
    },
  })
  const commandPreview = useMemo(() => {
    if (!commandInput.trim()) return null
    return parseContextCommand(commandInput, inferCommandKind(pathname), {
      customers: commandDepsQuery.data?.customers ?? [],
      items: commandDepsQuery.data?.items ?? [],
      today,
      mktRate: marketRate.rate,
    })
  }, [commandDepsQuery.data, commandInput, marketRate.rate, pathname, today])
  const commandDraft = useMemo(
    () =>
      buildCommandDraft(commandInput, inferCommandKind(pathname), {
        customers: commandDepsQuery.data?.customers ?? [],
        items: commandDepsQuery.data?.items ?? [],
        today,
      }),
    [commandDepsQuery.data, commandInput, pathname, today],
  )

  useEffect(() => {
    document.title = `${meta.title} – ${DOC_TITLE_SUFFIX}`
  }, [meta.title])

  useEffect(() => subscribeAdminControlSettings(setAdminSettings), [])

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
      if (!adminSettings.controlKEnabled) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [adminSettings.controlKEnabled])

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
    if (commandPreview && !commandPreview.ok) {
      setCommandError(commandPreview.error)
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
              className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                if (adminSettings.controlKEnabled) setCommandOpen(true)
              }}
              title={adminSettings.controlKEnabled ? 'Command bar (Ctrl+K)' : 'Command bar disabled in Control Room'}
              aria-label="Open command bar"
              disabled={!adminSettings.controlKEnabled}
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
                  placeholder={
                    inferCommandKind(pathname) === 'neutral'
                      ? `${commandRegistry.bill.aliases[0]} sambhu 10, ${commandRegistry.payment.aliases[0]} sambhu 50k, ${commandRegistry.stock.aliases[0]} spindle 20, ${commandRegistry.print.aliases[0]} 51/24`
                      : 'Type command for this page, or use prefix for another action'
                  }
                />
              </div>
              {commandError && <p className="mt-2 text-xs text-red-600">{commandError}</p>}
            </div>
            <CommandLivePreview preview={commandPreview} draft={commandDraft} isLoading={commandDepsQuery.isFetching} />
            <div className="flex flex-wrap gap-2 p-3 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-2 py-1">{commandRegistry.bill.aliases.join(', ')} bill</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">{commandRegistry.payment.aliases.join(', ')} payment</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">{commandRegistry.stock.aliases.join(', ')} stock</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">{commandRegistry.print.aliases.join(', ')} print</span>
              <span className="ml-auto hidden sm:inline">Enter to review, Esc to close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CommandLivePreview({
  preview,
  draft,
  isLoading,
}: {
  preview: ReturnType<typeof parseContextCommand> | null
  draft: CommandDraft | null
  isLoading: boolean
}) {
  if (!preview) {
    return (
      <div className="border-b border-slate-100 px-3 py-3 text-sm text-slate-500">
        {isLoading ? 'Loading command context...' : 'Live details will appear as you type.'}
      </div>
    )
  }
  if (!preview.ok) {
    if (draft) {
      return (
        <div className="border-b border-slate-100 bg-slate-50 px-3 py-3">
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <PreviewLine label="Mode" value={draft.mode} />
            {draft.lines.map((line) => (
              <PreviewLine key={`${line.label}-${line.value}`} label={line.label} value={line.value} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {draft.suggestions.map((suggestion) => (
              <span key={suggestion} className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                {suggestion}
              </span>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-600">
        Keep typing. Try party, quantity, date, rate, GST, or transport.
      </div>
    )
  }
  const command = preview.command
  return (
    <div className="border-b border-slate-100 bg-slate-50 px-3 py-3">
      <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
        {command.kind === 'payment' && (
          <>
            <PreviewLine label="Mode" value="Payment" />
            <PreviewLine label="Party" value={command.customer.name} />
            <PreviewLine label="Amount" value={formatInrInteger(command.amount)} />
            <PreviewLine label="Date" value={formatFullDate(command.date)} />
            <PreviewLine label="Pay Mode" value={command.mode} />
            <PreviewLine label="Note" value={command.note || '-'} />
          </>
        )}
        {command.kind === 'bill' && (
          <>
            <PreviewLine label="Mode" value="Bill" />
            <PreviewLine label="Party" value={command.customer.name} />
            <PreviewLine label="Date" value={formatFullDate(command.date)} />
            <PreviewLine label="Transport" value={formatInrInteger(command.transport)} />
            <PreviewLine label="GST" value={command.gstMode === 'manual' ? `Manual ${formatInrInteger(command.gstAmount)}` : command.gstRate ? `${command.gstRate}%` : 'No GST'} />
            <PreviewLine label="Items" value={`${command.items.length}`} />
            <div className="md:col-span-2">
              <div className="mt-1 overflow-hidden rounded-md border border-slate-200 bg-white">
                {command.items.map((line, index) => (
                  <div key={`${line.item.id}-${index}`} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-t border-slate-100 px-2 py-1.5 first:border-t-0">
                    <span className="truncate font-medium text-slate-800">{line.item.name}</span>
                    <span className="font-mono text-slate-600">{line.displayQty}</span>
                    <span className="font-mono text-slate-600">D {formatInrInteger(line.defaultRate)}</span>
                    <span className="font-mono font-semibold text-slate-900">{formatInrInteger(line.rate)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {command.kind === 'stock' && (
          <>
            <PreviewLine label="Mode" value="Stock" />
            <PreviewLine label="Item" value={command.item.name} />
            <PreviewLine label="Qty" value={formatInQty(command.qty, command.item.unit || 'kg')} />
            <PreviewLine label="Date" value={formatFullDate(command.date)} />
            <PreviewLine label="Note" value={command.note || '-'} />
          </>
        )}
        {command.kind === 'print' && (
          <>
            <PreviewLine label="Mode" value="Print" />
            <PreviewLine label="Bill Ref" value={command.billRef} />
          </>
        )}
      </div>
    </div>
  )
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</span>
      <span className="min-w-0 truncate font-medium text-slate-900">{value}</span>
    </div>
  )
}

function buildCommandDraft(
  input: string,
  context: ReturnType<typeof inferCommandKind>,
  deps: {
    customers: Array<{ id: string; name: string; companyName?: string; customerName?: string }>
    items: Array<{ id: string; name: string; defaultRate?: number; type?: string; unit?: string; bagWeight?: number }>
    today: string
  },
): CommandDraft | null {
  const raw = input.trim()
  if (!raw) return null
  const resolved = splitCommandPrefix(raw, context)
  if (!resolved.kind) {
    return {
      mode: 'Command',
      lines: [],
      suggestions: ['Start with b bill', 'p payment', 's stock', 'pr print'],
    }
  }
  if (resolved.kind === 'payment') return buildPaymentDraft(resolved.body, deps)
  if (resolved.kind === 'bill') return buildBillDraft(resolved.body, deps)
  if (resolved.kind === 'stock') return buildStockDraft(resolved.body, deps)
  return {
    mode: 'Print',
    lines: resolved.body ? [{ label: 'Bill Ref', value: resolved.body }] : [],
    suggestions: resolved.body ? ['Enter to open print page'] : ['Add bill ref, e.g. 51/87'],
  }
}

function buildPaymentDraft(
  body: string,
  deps: {
    customers: Array<{ id: string; name: string; companyName?: string; customerName?: string }>
    today: string
  },
): CommandDraft {
  const tokens = body.trim().split(/\s+/).filter(Boolean)
  const amountIndex = tokens.findIndex((token) => parseAmountForDraft(token) > 0)
  const customerQuery = tokens.slice(0, amountIndex >= 0 ? amountIndex : tokens.length).join(' ')
  const customer = customerQuery ? findBestNameMatch(deps.customers, customerQuery, customerSearchTextForDraft) : null
  const amount = amountIndex >= 0 ? parseAmountForDraft(tokens[amountIndex]) : 0
  const lines = [
    ...(customer ? [{ label: 'Party', value: customer.name }] : customerQuery ? [{ label: 'Party', value: `Searching: ${customerQuery}` }] : []),
    ...(amount > 0 ? [{ label: 'Amount', value: formatInrInteger(amount) }] : []),
  ]
  return {
    mode: 'Payment',
    lines,
    suggestions: [
      !customer ? 'Choose party name' : '',
      amount <= 0 ? 'Add amount, e.g. 5l or 50000' : '',
      'Optional: cash, bank',
      'Optional: yday, yesterday, 15-may',
    ].filter(Boolean),
  }
}

function buildBillDraft(
  body: string,
  deps: {
    customers: Array<{ id: string; name: string; companyName?: string; customerName?: string }>
    items: Array<{ id: string; name: string; defaultRate?: number; type?: string; unit?: string; bagWeight?: number }>
  },
): CommandDraft {
  const tokens = body.trim().split(/\s+/).filter(Boolean)
  const customerMatch = resolveBestPrefixForDraft(deps.customers, body, customerSearchTextForDraft)
  const remaining = tokens.slice(customerMatch.usedWords)
  const lines: CommandDraft['lines'] = []
  const suggestions: string[] = []
  if (customerMatch.record) lines.push({ label: 'Party', value: customerMatch.record.name })
  else suggestions.push('Choose party name')

  const segments = splitDraftSegments(remaining)
  let detectedItems = 0
  for (const segment of segments) {
    const qtyIndex = segment.findIndex((token) => parseAmountForDraft(token) > 0 && !isRateMarkerPrevious(segment, token))
    const itemTokens = segment.slice(0, qtyIndex >= 0 ? qtyIndex : segment.length).filter((token) => !isBillModifierToken(token))
    const itemQuery = itemTokens.join(' ')
    const item = itemQuery ? findBestNameMatch(deps.items, itemQuery, (row) => row.name) : null
    if (item) {
      detectedItems += 1
      const qty = qtyIndex >= 0 ? parseAmountForDraft(segment[qtyIndex]) : 0
      lines.push({ label: detectedItems === 1 ? 'Item' : `Item ${detectedItems}`, value: qty > 0 ? `${item.name} x ${segment[qtyIndex]}` : item.name })
      if (qty <= 0) suggestions.push(`Add quantity for ${item.name}`)
    } else if (itemQuery) {
      lines.push({ label: 'Item', value: `Searching: ${itemQuery}` })
      suggestions.push('Pick item name, then quantity')
    }
  }

  if (detectedItems === 0) suggestions.push('Add item, e.g. spindle')
  suggestions.push('Optional: dr 80', 'Optional: rate 620', 'Optional: gst or cgst 1200', 'Optional: +t 500', 'Optional: yday or 15-may')
  return { mode: 'Bill', lines, suggestions: Array.from(new Set(suggestions)) }
}

function buildStockDraft(
  body: string,
  deps: {
    items: Array<{ id: string; name: string; defaultRate?: number; type?: string; unit?: string; bagWeight?: number }>
  },
): CommandDraft {
  const tokens = body.trim().split(/\s+/).filter(Boolean)
  const qtyIndex = tokens.findIndex((token) => parseAmountForDraft(token) > 0)
  const itemQuery = tokens.slice(0, qtyIndex >= 0 ? qtyIndex : tokens.length).join(' ')
  const item = itemQuery ? findBestNameMatch(deps.items, itemQuery, (row) => row.name) : null
  const qty = qtyIndex >= 0 ? parseAmountForDraft(tokens[qtyIndex]) : 0
  return {
    mode: 'Stock',
    lines: [
      ...(item ? [{ label: 'Item', value: item.name }] : itemQuery ? [{ label: 'Item', value: `Searching: ${itemQuery}` }] : []),
      ...(qty > 0 ? [{ label: 'Qty', value: String(qty) }] : []),
    ],
    suggestions: [!item ? 'Add stock item' : '', qty <= 0 ? 'Add quantity' : '', 'Optional: yday or 15-may', 'Optional: "note"'].filter(Boolean),
  }
}

function splitDraftSegments(tokens: string[]) {
  const segments: string[][] = [[]]
  for (const token of tokens) {
    if (token === ',' || token === '+' || token.toLowerCase() === 'and' || token === '&' || token === '|') {
      if (segments[segments.length - 1].length > 0) segments.push([])
      continue
    }
    segments[segments.length - 1].push(token)
  }
  return segments.filter((segment) => segment.length > 0)
}

function isBillModifierToken(token: string) {
  return ['dr', 'default', 'base', 'rate', 'final', 'f', 'fr', 'gst', 'cgst', 'customgst', 'manualgst', 'gstamt', '+t', 't', 'transport'].includes(token.toLowerCase())
}

function isRateMarkerPrevious(segment: string[], token: string) {
  const index = segment.indexOf(token)
  const previous = segment[index - 1]?.toLowerCase()
  return ['dr', 'default', 'base', 'rate', 'final', 'f', 'fr', 'cgst', 'customgst', 'manualgst', 'gstamt', '+t', 't', 'transport'].includes(previous)
}

function parseAmountForDraft(token: string) {
  const normalized = token.toLowerCase().replaceAll(',', '')
  if (normalized.endsWith('k')) return Number(normalized.slice(0, -1)) * 1000
  if (normalized.endsWith('l')) return Number(normalized.slice(0, -1)) * 100000
  if (normalized.endsWith('c')) return Number(normalized.slice(0, -1)) * 10000000
  return Number(normalized.replace(/(bag|bags|kg|pc|pcs|piece|pieces)$/i, ''))
}

function customerSearchTextForDraft(customer: { name: string; companyName?: string; customerName?: string }) {
  return [customer.name, customer.companyName, customer.customerName].filter(Boolean).join(' ')
}

function resolveBestPrefixForDraft<T>(records: T[], input: string, getName: (record: T) => string) {
  const words = input.split(/\s+/).filter(Boolean)
  for (let take = words.length; take >= 1; take -= 1) {
    const query = words.slice(0, take).join(' ')
    const record = findBestNameMatch(records, query, getName)
    if (record) return { record, usedWords: take }
  }
  return { record: null, usedWords: 0 }
}
