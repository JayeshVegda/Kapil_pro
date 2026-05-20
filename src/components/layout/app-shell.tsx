import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Clock3, Command, HelpCircle, Loader2, Menu, RefreshCw, Search, TerminalSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { pb } from '@/data/pocketbase'
import { loadQuickSearchResults, type QuickSearchResult } from '@/data/quick-search'
import { useMarketRate } from '@/domain/market-rate'
import { getAdminControlSettings, subscribeAdminControlSettings } from '@/lib/admin-control'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger, formatInQty } from '@/lib/inr-format'
import { PENDING_COMMAND_STORAGE_KEY, splitCommandPrefix, inferCommandKind, getCommandRegistry, parseContextCommand, parseAmountToken } from '@/lib/commands'
import { filterRankedNameMatches, findBestNameMatch } from '@/lib/search'
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
const COMMAND_HISTORY_STORAGE_KEY = 'kapil-command-history-v1'
const COMMAND_HISTORY_LIMIT = 20

const commandRoutes = [
  { label: 'Dashboard', path: '/' },
  { label: 'New Bill', path: '/new-bill' },
  { label: 'New Payment', path: '/new-payment' },
  { label: 'Stock', path: '/stock' },
  { label: 'Transactions', path: '/transactions' },
  { label: 'Ledger', path: '/ledger' },
  { label: 'Calendar', path: '/calendar' },
  { label: 'Customers', path: '/customers' },
  { label: 'Items', path: '/items' },
  { label: 'Data Health', path: '/data-health' },
  { label: 'Backup', path: '/backup' },
  { label: 'Control Room', path: '/control-room' },
]

type CommandDraft = {
  mode: string
  lines: Array<{ label: string; value: string }>
  suggestions: string[]
}

type CommandMode = 'command' | 'search' | 'help' | 'action'

type CommandSuggestion = {
  id: string
  label: string
  detail: string
  kind: 'customer' | 'item' | 'mode' | 'help' | 'route' | 'action' | 'history'
  value?: string
  path?: string
}

type BillSession = {
  customer: { id: string; name: string }
  lines: string[]
  modifiers: string[]
}

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [quickSearch, setQuickSearch] = useState('')
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [activeQuickSearchIndex, setActiveQuickSearchIndex] = useState(0)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [commandError, setCommandError] = useState('')
  const [activeCommandSuggestionIndex, setActiveCommandSuggestionIndex] = useState(0)
  const [billSession, setBillSession] = useState<BillSession | null>(null)
  const [commandHistory, setCommandHistory] = useState<string[]>(() => loadCommandHistory())
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
  const commandMode = useMemo(() => inferCommandMode(commandInput), [commandInput])
  const effectiveCommandInput = useMemo(() => buildEffectiveCommandInput(commandInput, billSession), [billSession, commandInput])
  const commandPreview = useMemo(() => {
    if (!effectiveCommandInput.trim() || commandMode !== 'command') return null
    return parseContextCommand(effectiveCommandInput, inferCommandKind(pathname), {
      customers: commandDepsQuery.data?.customers ?? [],
      items: commandDepsQuery.data?.items ?? [],
      today,
      mktRate: marketRate.rate,
    })
  }, [commandDepsQuery.data, effectiveCommandInput, commandMode, marketRate.rate, pathname, today])
  const commandDraft = useMemo(
    () =>
      buildCommandDraft(effectiveCommandInput, inferCommandKind(pathname), {
        customers: commandDepsQuery.data?.customers ?? [],
        items: commandDepsQuery.data?.items ?? [],
        today,
      }, billSession, commandMode),
    [commandDepsQuery.data, effectiveCommandInput, pathname, today, billSession, commandMode],
  )
  const commandSuggestions = useMemo(
    () =>
      buildCommandSuggestions(commandInput, commandMode, billSession, {
        customers: commandDepsQuery.data?.customers ?? [],
        items: commandDepsQuery.data?.items ?? [],
        history: commandHistory,
      }),
    [billSession, commandDepsQuery.data, commandHistory, commandInput, commandMode],
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
    setActiveCommandSuggestionIndex(0)
  }, [commandInput, commandSuggestions.length, commandMode])

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
    const raw = commandInput.trim()
    if (maybeClearHistoryCommand(raw)) {
      setCommandHistory(clearCommandHistory())
      setCommandInput('')
      setCommandError('Command history cleared.')
      return
    }
    if (commandMode === 'search') {
      if (raw.length > 1) rememberCommand(raw)
      runModeSuggestion(commandSuggestions[activeCommandSuggestionIndex] ?? commandSuggestions[0])
      return
    }
    if (commandMode === 'help') {
      setCommandError('')
      return
    }
    if (commandMode === 'action') {
      if (raw.length > 1) rememberCommand(raw)
      runModeSuggestion(commandSuggestions[activeCommandSuggestionIndex] ?? commandSuggestions[0])
      return
    }
    if (billSession) {
      if (!raw || ['done', 'review', 'open', 'bill'].includes(raw.toLowerCase())) {
        submitBillSession()
        return
      }
      if (['clear', 'reset', 'cancel'].includes(raw.toLowerCase())) {
        setBillSession(null)
        setCommandInput('')
        setCommandError('')
        return
      }
      setBillSession((session) => {
        if (!session) return session
        const nextLine = normalizeBillSessionLine(raw)
        if (!nextLine) return session
        if (isBillModifierLine(nextLine)) return { ...session, modifiers: [...session.modifiers, nextLine] }
        return { ...session, lines: [...session.lines, nextLine] }
      })
      setCommandInput('')
      setCommandError('')
      return
    }
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
    if (parsed.kind === 'bill') {
      const starter = tryStartBillSession(body, commandDepsQuery.data?.customers ?? [])
      if (starter) {
        setBillSession({ customer: { id: starter.id, name: starter.name }, lines: [], modifiers: [] })
        setCommandInput('')
        setCommandError('')
        return
      }
    }
    if (commandPreview && !commandPreview.ok) {
      setCommandError(commandPreview.error)
      return
    }
    setCommandError('')
    setCommandOpen(false)
    setCommandInput('')
    rememberCommand(raw)
    if (parsed.kind === 'print') {
      void navigate({ to: '/print-bill', search: { billRef: body, billId: '' } })
      return
    }
    window.sessionStorage.setItem(PENDING_COMMAND_STORAGE_KEY, JSON.stringify({ kind: parsed.kind, body, createdAt: Date.now() }))
    if (parsed.kind === 'bill') void navigate({ to: '/new-bill' })
    if (parsed.kind === 'payment') void navigate({ to: '/new-payment' })
    if (parsed.kind === 'stock') void navigate({ to: '/stock' })
  }

  function submitBillSession() {
    if (!billSession) return
    if (billSession.lines.length === 0) {
      setCommandError('Add at least one bill item, for example: 2 spindle.')
      return
    }
    const body = [billSession.customer.name, ...billSession.lines, ...billSession.modifiers].join(' ')
    const historyCommand = `b ${body}`
    setCommandError('')
    setCommandOpen(false)
    setCommandInput('')
    setBillSession(null)
    rememberCommand(historyCommand)
    window.sessionStorage.setItem(PENDING_COMMAND_STORAGE_KEY, JSON.stringify({ kind: 'bill', body, createdAt: Date.now() }))
    void navigate({ to: '/new-bill' })
  }

  function rememberCommand(command: string) {
    const next = saveCommandHistory(command)
    setCommandHistory(next)
  }

  function runModeSuggestion(suggestion: CommandSuggestion | undefined) {
    if (!suggestion) return
    if (suggestion.path) {
      setCommandOpen(false)
      setCommandInput('')
      setCommandError('')
      void navigate({ to: suggestion.path })
      return
    }
    if (suggestion.kind === 'customer') {
      setCommandOpen(false)
      setCommandInput('')
      setCommandError('')
      void navigate({ to: '/ledger', search: { customerId: suggestion.id.replace(/^customer-/, ''), focus: '' } })
      return
    }
    applyCommandSuggestion(suggestion)
  }

  function applyCommandSuggestion(suggestion: CommandSuggestion | undefined) {
    if (!suggestion) return
    if (suggestion.kind === 'action' && suggestion.value === 'clear history') {
      setCommandHistory(clearCommandHistory())
      setCommandInput('')
      setCommandError('Command history cleared.')
      return
    }
    if (suggestion.kind === 'history') {
      setCommandInput(suggestion.value ?? '')
      setCommandError('')
      return
    }
    if (billSession && suggestion.kind === 'action') {
      applyBillSessionAction(suggestion.value ?? '')
      return
    }
    if (suggestion.kind === 'mode') {
      setCommandInput(suggestion.value ?? '')
      return
    }
    if (suggestion.kind === 'customer') {
      setCommandInput(suggestion.value ?? '')
      setCommandError('')
      return
    }
    if (suggestion.value) setCommandInput((value) => replaceLastCommandToken(value, suggestion.value ?? ''))
  }

  function applyBillSessionAction(value: string) {
    if (!billSession) return
    if (value === 'review') {
      submitBillSession()
      return
    }
    if (value === 'clear') {
      setBillSession(null)
      setCommandInput('')
      setCommandError('')
      return
    }
    if (value === '+t ') {
      setCommandInput('+t ')
      setCommandError('')
      return
    }
    if (value) {
      setBillSession((session) => (session ? { ...session, modifiers: [...session.modifiers, value] } : session))
      setCommandInput('')
      setCommandError('')
    }
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
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setActiveCommandSuggestionIndex((index) => (commandSuggestions.length === 0 ? 0 : (index + 1) % commandSuggestions.length))
                      return
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setActiveCommandSuggestionIndex((index) => (commandSuggestions.length === 0 ? 0 : index <= 0 ? commandSuggestions.length - 1 : index - 1))
                      return
                    }
                    if (event.key === 'Tab') {
                      const suggestion = commandSuggestions[activeCommandSuggestionIndex] ?? commandSuggestions[0]
                      if (suggestion) {
                        event.preventDefault()
                        applyCommandSuggestion(suggestion)
                      }
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setCommandOpen(false)
                      setCommandError('')
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      if ((commandMode === 'search' || commandMode === 'action') && commandSuggestions.length > 0) {
                        runModeSuggestion(commandSuggestions[activeCommandSuggestionIndex] ?? commandSuggestions[0])
                        return
                      }
                      runGlobalCommand()
                    }
                  }}
                  placeholder={
                    billSession
                      ? 'Add item: 2 spindle, gst, +t 500, or Enter to review'
                      : inferCommandKind(pathname) === 'neutral'
                      ? `${commandRegistry.bill.aliases[0]} sambhu 10, ${commandRegistry.payment.aliases[0]} sambhu 50k, ${commandRegistry.stock.aliases[0]} spindle 20, ${commandRegistry.print.aliases[0]} 51/24`
                      : 'Type command for this page, or use prefix for another action'
                  }
                />
              </div>
              {commandError && <p className="mt-2 text-xs text-red-600">{commandError}</p>}
            </div>
            <CommandLivePreview preview={commandPreview} draft={commandDraft} isLoading={commandDepsQuery.isFetching} billSession={billSession} mode={commandMode} input={commandInput} />
            <CommandSuggestionList
              suggestions={commandSuggestions}
              activeIndex={activeCommandSuggestionIndex}
              onHover={setActiveCommandSuggestionIndex}
              onChoose={(suggestion) => {
                if (commandMode === 'search' || commandMode === 'action') runModeSuggestion(suggestion)
                else if (billSession && suggestion.kind === 'action') applyBillSessionAction(suggestion.value ?? '')
                else applyCommandSuggestion(suggestion)
              }}
            />
            <div className="flex flex-wrap gap-2 p-3 text-xs text-slate-500">
              <span className="rounded-full bg-slate-900 px-2 py-1 text-white">/ search</span>
              <span className="rounded-full bg-slate-900 px-2 py-1 text-white">? help</span>
              <span className="rounded-full bg-slate-900 px-2 py-1 text-white">: actions</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">{commandRegistry.bill.aliases.join(', ')} bill</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">{commandRegistry.payment.aliases.join(', ')} payment</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">{commandRegistry.stock.aliases.join(', ')} stock</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">{commandRegistry.print.aliases.join(', ')} print</span>
              <span className="ml-auto hidden sm:inline">Arrows select, Tab fills, Enter runs</span>
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
  billSession,
  mode,
  input,
}: {
  preview: ReturnType<typeof parseContextCommand> | null
  draft: CommandDraft | null
  isLoading: boolean
  billSession: BillSession | null
  mode: CommandMode
  input: string
}) {
  if (mode === 'help') {
    return <CommandHelpPanel inputMode="help" input={input} />
  }
  if (mode === 'search') {
    return (
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-600">
        Search mode finds parties and opens their ledger. Use arrows and Enter for the selected result.
      </div>
    )
  }
  if (mode === 'action') {
    return (
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-600">
        Action mode jumps to app pages and system tools. Type a page name like stock, backup, or control.
      </div>
    )
  }
  if (billSession && !preview) {
    return (
      <div className="border-b border-slate-100 bg-blue-50 px-3 py-3">
        <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <PreviewLine label="Mode" value="Bill Session" />
          <PreviewLine label="Party" value={billSession.customer.name} />
          <PreviewLine label="Items" value={String(billSession.lines.length)} />
          <PreviewLine label="Next" value="Type item line or Enter to review" />
        </div>
        {(billSession.lines.length > 0 || billSession.modifiers.length > 0) && (
          <div className="mt-3 overflow-hidden rounded-md border border-blue-100 bg-white">
            {billSession.lines.map((line, index) => (
              <div key={`${line}-${index}`} className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2 first:border-t-0">
                <span className="text-sm font-medium text-slate-800">{line}</span>
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">item</span>
              </div>
            ))}
            {billSession.modifiers.map((modifier, index) => (
              <div key={`${modifier}-${index}`} className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2 first:border-t-0">
                <span className="text-sm font-medium text-slate-800">{modifier}</span>
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">option</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
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

function CommandSuggestionList({
  suggestions,
  activeIndex,
  onHover,
  onChoose,
}: {
  suggestions: CommandSuggestion[]
  activeIndex: number
  onHover: (index: number) => void
  onChoose: (suggestion: CommandSuggestion) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <div className="max-h-72 overflow-auto border-b border-slate-100 bg-white p-2">
      {suggestions.map((suggestion, index) => (
        <button
          key={`${suggestion.kind}-${suggestion.id}`}
          type="button"
          className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition ${
            index === activeIndex ? 'bg-blue-50 text-slate-950' : 'text-slate-700 hover:bg-slate-50'
          }`}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(suggestion)}
        >
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${index === activeIndex ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
            {suggestion.kind === 'history' ? <Clock3 size={15} /> : suggestion.kind === 'help' ? <HelpCircle size={15} /> : suggestion.kind === 'mode' || suggestion.kind === 'action' || suggestion.kind === 'route' ? <TerminalSquare size={15} /> : <Search size={15} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{suggestion.label}</span>
            <span className="block truncate text-xs text-slate-500">{suggestion.detail}</span>
          </span>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{suggestion.kind}</span>
        </button>
      ))}
    </div>
  )
}

function CommandHelpPanel({ input }: { inputMode: 'help'; input: string }) {
  const topic = input.replace(/^\?+\s*/, '').replace(/^help\s+/i, '').trim().toLowerCase()
  const help = getCommandHelp(topic)
  return (
    <div className="border-b border-slate-100 bg-slate-50 px-3 py-3">
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-900 text-white">
            <HelpCircle size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-950">{help.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{help.description}</p>
            <div className="mt-3 grid gap-2 text-sm">
              <PreviewLine label="Format" value={help.format} />
              <PreviewLine label="Example" value={help.example} />
              <PreviewLine label="Meaning" value={help.meaning} />
            </div>
          </div>
        </div>
      </div>
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
  billSession: BillSession | null,
  mode: CommandMode,
): CommandDraft | null {
  const raw = input.trim()
  if (mode === 'search') return { mode: 'Search', lines: [], suggestions: ['Type / followed by party name', 'Enter opens selected ledger'] }
  if (mode === 'help') return { mode: 'Help', lines: [], suggestions: ['Try ? b', '? payment', '? session'] }
  if (mode === 'action') return { mode: 'Actions', lines: [], suggestions: ['Type :stock, :backup, :control'] }
  if (billSession && !raw) {
    return {
      mode: 'Bill Session',
      lines: [
        { label: 'Party', value: billSession.customer.name },
        { label: 'Items', value: String(billSession.lines.length) },
      ],
      suggestions: ['Type 2 spindle', 'Add gst or +t 500', 'Enter on empty input to review'],
    }
  }
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

function inferCommandMode(input: string): CommandMode {
  const trimmed = input.trimStart()
  if (trimmed.startsWith('/')) return 'search'
  if (trimmed.startsWith('?') || /^help(\s|$)/i.test(trimmed)) return 'help'
  if (trimmed.startsWith(':')) return 'action'
  return 'command'
}

function buildEffectiveCommandInput(input: string, billSession: BillSession | null) {
  const raw = input.trim()
  if (!billSession) return raw
  if (!raw) return ''
  if (['done', 'review', 'open', 'bill', 'clear', 'reset', 'cancel'].includes(raw.toLowerCase())) return ''
  const line = normalizeBillSessionLine(raw)
  const nextLines = isBillModifierLine(line) ? billSession.lines : [...billSession.lines, line]
  const nextModifiers = isBillModifierLine(line) ? [...billSession.modifiers, line] : billSession.modifiers
  return [billSession.customer.name, ...nextLines, ...nextModifiers].join(' ')
}

function buildCommandSuggestions(
  input: string,
  mode: CommandMode,
  billSession: BillSession | null,
  deps: {
    customers: Array<{ id: string; name: string; companyName?: string; customerName?: string }>
    items: Array<{ id: string; name: string; defaultRate?: number; type?: string; unit?: string; bagWeight?: number }>
    history: string[]
  },
): CommandSuggestion[] {
  const raw = input.trim()
  if (!raw && !billSession) {
    return [
      ...buildHistorySuggestions('', deps.history).slice(0, 5),
      { id: 'mode-search', label: '/ search', detail: 'Find party ledger quickly', kind: 'mode', value: '/' },
      { id: 'mode-help', label: '? help', detail: 'Explain command formats for staff', kind: 'mode', value: '?' },
      { id: 'mode-action', label: ': actions', detail: 'Jump to pages and tools', kind: 'mode', value: ':' },
      { id: 'mode-bill', label: 'b bill', detail: 'Start bill command or bill session', kind: 'mode', value: 'b ' },
    ]
  }
  if (mode === 'search') return buildSearchSuggestions(raw.slice(1).trim(), deps.customers)
  if (mode === 'help') return buildHelpSuggestions(raw)
  if (mode === 'action') return buildActionSuggestions(raw.slice(1).trim())

  if (billSession) {
    const line = raw.trim()
    if (!line) {
      return [
        ...(billSession.lines.length > 0 ? [{ id: 'session-review', label: 'Review bill', detail: `Open bill for ${billSession.customer.name}`, kind: 'action' as const, value: 'review' }] : []),
        { id: 'session-gst', label: 'Add GST', detail: 'Apply 18% GST to this bill session', kind: 'action', value: 'gst' },
        { id: 'session-transport', label: 'Add transport', detail: 'Type amount after selecting, e.g. +t 500', kind: 'action', value: '+t ' },
        { id: 'session-clear', label: 'Clear session', detail: 'Cancel this remembered customer and items', kind: 'action', value: 'clear' },
      ]
    }
    return buildItemSuggestions(getBillItemQuery(line), deps.items)
  }

  const resolved = splitCommandPrefix(raw, 'neutral')
  if (resolved.kind === 'bill') {
    const customerMatch = resolveBestPrefixForDraft(deps.customers, resolved.body, customerSearchTextForDraft)
    const bodyHasTrailingSpace = /\s$/.test(input)
    const bodyWords = resolved.body.trim().split(/\s+/).filter(Boolean)
    if (!resolved.body.trim() || !customerMatch.record || (customerMatch.usedWords >= bodyWords.length && !bodyHasTrailingSpace)) return buildCustomerSuggestions(resolved.body, deps.customers, 'b ')
    const remainingBody = resolved.body.trim().split(/\s+/).slice(customerMatch.usedWords).join(' ')
    return buildItemSuggestions(getBillItemQuery(remainingBody), deps.items)
  }
  if (resolved.kind === 'payment') return buildCustomerSuggestions(resolved.body, deps.customers, 'p ')
  if (resolved.kind === 'stock') return buildItemSuggestions(getBillItemQuery(resolved.body), deps.items)
  if (!resolved.kind) return [...buildHistorySuggestions(raw, deps.history), ...buildCommandStarterSuggestions(raw, deps.history)].slice(0, 8)
  return [...buildHistorySuggestions(raw, deps.history).slice(0, 3)]
}

function buildHistorySuggestions(query: string, history: string[]): CommandSuggestion[] {
  const clean = query.trim()
  const matches = clean ? filterRankedNameMatches(history, clean, (entry) => entry) : history
  return matches.slice(0, 6).map((entry, index) => ({
    id: `history-${index}-${entry}`,
    label: entry,
    detail: 'Recent command - Tab to fill, Enter to run after filling',
    kind: 'history' as const,
    value: entry,
  }))
}

function loadCommandHistory() {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMAND_HISTORY_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry ?? '').trim()).filter(Boolean).slice(0, COMMAND_HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function saveCommandHistory(command: string) {
  const clean = command.trim().replace(/\s+/g, ' ')
  if (!clean || typeof window === 'undefined') return loadCommandHistory()
  const next = [clean, ...loadCommandHistory().filter((entry) => entry.toLowerCase() !== clean.toLowerCase())].slice(0, COMMAND_HISTORY_LIMIT)
  window.localStorage.setItem(COMMAND_HISTORY_STORAGE_KEY, JSON.stringify(next))
  return next
}

function clearCommandHistory() {
  if (typeof window === 'undefined') return []
  window.localStorage.removeItem(COMMAND_HISTORY_STORAGE_KEY)
  return []
}

function maybeClearHistoryCommand(input: string) {
  const normalized = input.trim().toLowerCase()
  return normalized === 'clear history' || normalized === ':clear history' || normalized === ':history clear'
}

function shouldShowClearHistory(input: string) {
  const normalized = input.trim().toLowerCase()
  return normalized === 'clear' || normalized === 'clear h' || normalized === ':clear' || normalized === ':history'
}

function buildHistoryControlSuggestion(input: string, history: string[]): CommandSuggestion[] {
  if (history.length === 0 || !shouldShowClearHistory(input)) return []
  return [{ id: 'history-clear', label: 'Clear command history', detail: 'Remove saved Ctrl+K history from this browser', kind: 'action' as const, value: 'clear history' }]
}

function buildCommandStarterSuggestions(query: string, history: string[] = []): CommandSuggestion[] {
  const starters = [
    ...buildHistoryControlSuggestion(query, history),
    { id: 'start-bill', label: 'b bill', detail: 'Create bill or start bill session', kind: 'mode' as const, value: 'b ' },
    { id: 'start-payment', label: 'p payment', detail: 'Record customer payment', kind: 'mode' as const, value: 'p ' },
    { id: 'start-stock', label: 's stock', detail: 'Add stock in', kind: 'mode' as const, value: 's ' },
    { id: 'start-search', label: '/ search', detail: 'Find party ledger', kind: 'mode' as const, value: '/ ' },
    { id: 'start-help', label: '? help', detail: 'Show command examples', kind: 'mode' as const, value: '? ' },
    { id: 'start-action', label: ': actions', detail: 'Jump to app page', kind: 'mode' as const, value: ': ' },
  ]
  return filterRankedNameMatches(starters, query, (starter) => `${starter.label} ${starter.detail}`).slice(0, 6)
}

function buildCustomerSuggestions(
  query: string,
  customers: Array<{ id: string; name: string; companyName?: string; customerName?: string }>,
  prefix: string,
): CommandSuggestion[] {
  const clean = query.trim()
  return filterRankedNameMatches(customers, clean, customerSearchTextForDraft)
    .slice(0, 6)
    .map((customer) => ({
      id: `customer-${customer.id}`,
      label: customer.name,
      detail: customer.customerName && customer.customerName !== customer.name ? customer.customerName : 'Customer',
      kind: 'customer' as const,
      value: `${prefix}${customer.name} `,
    }))
}

function buildItemSuggestions(
  query: string,
  items: Array<{ id: string; name: string; defaultRate?: number; type?: string; unit?: string; bagWeight?: number }>,
): CommandSuggestion[] {
  const clean = query.trim()
  return filterRankedNameMatches(items, clean, (row) => row.name)
    .slice(0, 6)
    .map((item) => ({
      id: `item-${item.id}`,
      label: item.name,
      detail: item.defaultRate ? `Default ${formatInrInteger(Number(item.defaultRate))}` : 'Item',
      kind: 'item' as const,
      value: item.name,
    }))
}

function buildSearchSuggestions(query: string, customers: Array<{ id: string; name: string; companyName?: string; customerName?: string }>): CommandSuggestion[] {
  return buildCustomerSuggestions(query, customers, '')
}

function buildHelpSuggestions(input: string): CommandSuggestion[] {
  const query = input.replace(/^\?+\s*/, '').replace(/^help\s*/i, '').trim()
  const topics = [
    { id: 'bill', label: 'Bill command', detail: 'b <customer> <item> <qty> [rate] [gst] [+t amount]', value: '? b' },
    { id: 'session', label: 'Bill session memory', detail: 'b mukesh, then 2 spindle, 3 motor, Enter', value: '? session' },
    { id: 'payment', label: 'Payment command', detail: 'p <customer> <amount> [cash|bank] [date]', value: '? payment' },
    { id: 'stock', label: 'Stock command', detail: 's <item> <qty> [date]', value: '? stock' },
    { id: 'modes', label: 'Command modes', detail: '/ search, ? help, : actions', value: '? modes' },
  ]
  return filterRankedNameMatches(topics, query, (topic) => `${topic.label} ${topic.detail}`)
    .slice(0, 6)
    .map((topic) => ({ ...topic, kind: 'help' as const }))
}

function buildActionSuggestions(query: string): CommandSuggestion[] {
  return filterRankedNameMatches(commandRoutes, query, (route) => `${route.label} ${route.path}`)
    .slice(0, 8)
    .map((route) => ({
      id: `route-${route.path}`,
      label: route.label,
      detail: route.path,
      kind: 'route' as const,
      path: route.path,
      value: `:${route.label.toLowerCase()}`,
    }))
}

function getCommandHelp(topic: string) {
  if (topic === 'p' || topic.includes('payment')) {
    return {
      title: 'Payment Command',
      description: 'Records a customer payment with optional mode and date.',
      format: 'p <customer> <amount> [cash|bank] [date]',
      example: 'p mukesh 5l bank yday',
      meaning: 'Mukesh paid ₹5,00,000 by bank yesterday',
    }
  }
  if (topic === 's' || topic.includes('stock')) {
    return {
      title: 'Stock Command',
      description: 'Adds stock for a gas item with optional backdate and note.',
      format: 's <item> <qty> [date] ["note"]',
      example: 's spindle 20 yday',
      meaning: 'Add 20 bags of spindle stock for yesterday',
    }
  }
  if (topic.includes('session') || topic.includes('memory')) {
    return {
      title: 'Bill Session Memory',
      description: 'Start once with the customer, then keep adding item lines without repeating the party.',
      format: 'b <customer>, then <qty> <item>, then Enter',
      example: 'b mukesh -> 2 spindle -> 3 motor -> Enter',
      meaning: 'Creates one Mukesh bill with multiple item rows',
    }
  }
  if (topic.includes('mode') || topic === '/' || topic === ':' || topic === '?') {
    return {
      title: 'Command Modes',
      description: 'Modes keep the command system scalable as more workflows are added.',
      format: '/ search, ? help, : actions',
      example: '/ mukesh or : stock or ? b',
      meaning: 'Search parties, explain commands, or jump to tools',
    }
  }
  return {
    title: 'Bill Command',
    description: 'Creates sale bill drafts through ultra-fast workflow execution.',
    format: 'b <customer> <item> <qty> [rate|dr default] [gst] [+t amount]',
    example: 'b mukesh spindle 2 gst +t 500',
    meaning: 'Mukesh bill, 2 bags spindle, GST enabled, ₹500 transport',
  }
}

function tryStartBillSession(body: string, customers: Array<{ id: string; name: string; companyName?: string; customerName?: string }>) {
  const words = body.trim().split(/\s+/).filter(Boolean)
  const match = resolveBestPrefixForDraft(customers, body, customerSearchTextForDraft)
  return match.record && match.usedWords === words.length ? match.record : null
}

function getBillItemQuery(input: string) {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  const lastSeparator = Math.max(tokens.lastIndexOf(','), tokens.lastIndexOf('+'), tokens.lastIndexOf('and'), tokens.lastIndexOf('&'), tokens.lastIndexOf('|'))
  const segment = tokens.slice(lastSeparator + 1)
  const withoutNumbers = segment.filter((token, index) => parseAmountToken(token) <= 0 && !isRateMarkerPrevious(segment, segment[index]))
  return withoutNumbers.filter((token) => !isBillModifierToken(token)).join(' ')
}

function normalizeBillSessionLine(input: string) {
  const raw = input.trim()
  const tokens = raw.split(/\s+/).filter(Boolean)
  if (tokens.length >= 2 && parseAmountForDraft(tokens[0]) > 0) return [...tokens.slice(1), tokens[0]].join(' ')
  return raw
}

function isBillModifierLine(input: string) {
  const lower = input.trim().toLowerCase()
  return lower === 'gst' || lower === 'nogst' || lower === 'no-gst' || lower.startsWith('+t ') || lower.startsWith('t ') || lower.startsWith('transport ')
}

function replaceLastCommandToken(input: string, value: string) {
  const leadingMode = input.match(/^([/?:]\s*)/)?.[0] ?? ''
  if (leadingMode) {
    const prefix = input.slice(0, leadingMode.length)
    if (prefix.startsWith(':')) return value.startsWith(':') ? value : `:${value}`
    if (prefix.startsWith('/')) return `/${value} `
    if (prefix.startsWith('?')) return value.startsWith('?') ? value : `? ${value}`
    return `${prefix}${value} `
  }
  const trimmedEnd = input.replace(/\s+$/, '')
  const lastSpace = trimmedEnd.lastIndexOf(' ')
  if (lastSpace < 0) return `${value} `
  return `${trimmedEnd.slice(0, lastSpace + 1)}${value} `
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
