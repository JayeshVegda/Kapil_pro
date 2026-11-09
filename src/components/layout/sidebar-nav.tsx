import { Link, useRouterState } from '@tanstack/react-router'
import { useMemo, useState, type ComponentType } from 'react'
import { BookOpen, Boxes, Calendar, CalendarDays, ChevronDown, ChevronRight, ClipboardList, CreditCard, Database, Download, FilePlus2, Flame, HeartPulse, LayoutDashboard, MoreHorizontal, Printer, ReceiptText, ScrollText, ShieldAlert, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { isPathHiddenByModules } from '@/lib/module-settings'
import { useModuleSettings } from '@/lib/use-module-settings'

type NavItem = {
  to: string
  title: string
  icon: ComponentType<{ size?: number; className?: string }>
  badge?: number | string
}

type NavGroup = {
  label: string
  collapsible?: boolean
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  { label: '', items: [
    { to: '/', title: 'Dashboard', icon: LayoutDashboard },
    { to: '/drafts', title: 'AI Drafts', icon: Sparkles },
    { to: '/ledger', title: 'Party Ledger', icon: BookOpen },
  ] },
  {
    label: 'Sales',
    collapsible: true,
    items: [
      { to: '/sales-dashboard', title: 'Sales Dashboard', icon: LayoutDashboard },
      { to: '/new-bill', title: 'Sale Bills', icon: FilePlus2 },
      { to: '/new-payment', title: 'Sales Payment', icon: CreditCard },
      { to: '/transactions', title: 'Sales Logs', icon: ScrollText },
      { to: '/print-bill', title: 'Print Sale Bills', icon: Printer },
    ],
  },
  {
    label: 'Purchase',
    collapsible: true,
    items: [
      { to: '/purchase-dashboard', title: 'Purchase Dashboard', icon: LayoutDashboard },
      { to: '/new-purchase-bill', title: 'New Purchase Bill', icon: FilePlus2 },
      { to: '/new-supplier-payment', title: 'New Purchase Payment', icon: CreditCard },
      { to: '/purchase-bills', title: 'Purchase Bills', icon: ReceiptText },
      { to: '/purchase-logs', title: 'Purchase Logs', icon: ScrollText },
    ],
  },
  {
    label: 'Casting',
    collapsible: true,
    items: [
      { to: '/casting', title: 'Casting Dashboard', icon: LayoutDashboard },
      { to: '/casting/new-session', title: 'New Casting Session', icon: Flame },
      { to: '/casting/log', title: 'Casting Logs', icon: ClipboardList },
      { to: '/casting/bill', title: 'Casting Bill', icon: ReceiptText },
    ],
  },
  {
    label: 'Reports',
    collapsible: true,
    items: [
      { to: '/monthly-sales-calendar', title: 'Calendar', icon: Calendar },
      { to: '/monthly-report', title: 'Company Report', icon: CalendarDays },
      { to: '/reports/sales', title: 'Sales Report', icon: ScrollText },
      { to: '/reports/purchase', title: 'Purchase Report', icon: ScrollText },
      { to: '/reports/casting', title: 'Casting Report', icon: ScrollText },
      { to: '/export-reports', title: 'Exports', icon: Download },
    ],
  },
  {
    label: 'Setup',
    collapsible: true,
    items: [
      { to: '/items', title: 'Items', icon: Boxes },
      { to: '/issues', title: 'Issues', icon: ShieldAlert },
      { to: '/data-health', title: 'Data Health', icon: HeartPulse },
      { to: '/backup', title: 'Backup', icon: Database },
      { to: '/settings', title: 'Settings', icon: SlidersHorizontal },
    ],
  },
]

const mobilePrimaryItems = [
  { to: '/', title: 'Home', icon: LayoutDashboard },
  { to: '/new-bill', title: 'Bill', icon: FilePlus2 },
  { to: '/new-payment', title: 'Pay', icon: CreditCard },
  { to: '/casting/new-session', title: 'Cast', icon: Flame },
]

export function SidebarNav() {
  return <SidebarNavPanel />
}

/** Nav groups with switched-off modules removed, dropping any group left empty. */
function useVisibleNavGroups() {
  const moduleSettings = useModuleSettings()

  return useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !isPathHiddenByModules(item.to, moduleSettings)),
        }))
        .filter((group) => group.items.length > 0),
    [moduleSettings],
  )
}

const DEFAULT_COLLAPSED: Record<string, boolean> = {
  Reports: true,
  Setup: true,
  Casting: true,
}

const STORAGE_KEY = 'kapil-sidebar-collapsed-groups'

function loadSavedCollapsed(): Record<string, boolean> {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (raw) return { ...DEFAULT_COLLAPSED, ...JSON.parse(raw) }
  } catch (error) {
    console.warn('[sidebar-nav] failed to read saved collapsed groups', error)
  }
  return DEFAULT_COLLAPSED
}

function isItemActive(itemTo: string, currentPath: string): boolean {
  if (itemTo === '/') return currentPath === '/'
  if (currentPath === itemTo) return true
  if (itemTo === '/purchase-bills' && currentPath.startsWith('/purchase-bills')) return true
  if (itemTo === '/suppliers' && (currentPath.startsWith('/suppliers') || currentPath.startsWith('/supplier-ledger'))) return true
  if (itemTo === '/new-supplier-payment' && (currentPath.startsWith('/supplier-payments') || currentPath.startsWith('/new-supplier-payment'))) return true
  if (itemTo === '/purchase-dashboard' && currentPath === '/purchase-dashboard') return true
  if (itemTo === '/new-purchase-bill' && currentPath === '/new-purchase-bill') return true
  if (itemTo === '/purchase-logs' && currentPath === '/purchase-logs') return true
  if (itemTo === '/customers' && currentPath.startsWith('/customers')) return true
  if (itemTo === '/ledger' && currentPath.startsWith('/ledger')) return true
  if (itemTo === '/casting' && currentPath === '/casting') return true
  if (itemTo.startsWith('/casting/') && currentPath.startsWith(itemTo)) return true
  return false
}

function NavGroupsList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const currentPath = useRouterState({ select: (s) => s.location.pathname })
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(loadSavedCollapsed)

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch (error) {
        console.warn('[sidebar-nav] failed to persist collapsed groups', error)
      }
      return next
    })
  }

  return (
    <>
      {groups.map((group) => {
        const hasActiveItem = group.items.some((item) => isItemActive(item.to, currentPath))
        const isCollapsed = Boolean(group.collapsible && collapsedGroups[group.label] && !hasActiveItem)

        return (
          <div key={group.label} className="mb-2.5">
            {group.collapsible ? (
              <button
                type="button"
                className="mb-0.5 flex w-full items-center justify-between rounded-md px-2.5 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
                onClick={() => toggleGroup(group.label)}
              >
                <span>{group.label}</span>
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>
            ) : (
              group.label ? <p className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{group.label}</p> : null
            )}
            {!isCollapsed && group.items.map((item) => {
              const Icon = item.icon
              const active = isItemActive(item.to, currentPath)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={`mb-px flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${
                    active
                      ? 'bg-blue-500/15 font-medium text-white'
                      : 'text-slate-300 hover:bg-white/5 hover:text-slate-100'
                  }`}
                >
                  <Icon size={16} className={active ? 'text-blue-300' : 'text-slate-400'} />
                  <span className="truncate">{item.title}</span>
                  {item.badge != null && (
                    <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-300">
                      {item.badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

function BrandBlock() {
  return (
    <div className="flex items-center gap-2">
      <img src="/favicon.png" alt="" className="h-10 w-10 rounded-lg object-cover" />
      <div>
        <p className="text-[15px] font-semibold leading-tight text-slate-100">Kapil Products</p>
        <p className="text-xs text-slate-400">Billing & Casting</p>
      </div>
    </div>
  )
}

export function SidebarNavPanel({
  mobileOpen = false,
  onMobileClose,
}: {
  mobileOpen?: boolean
  onMobileClose?: () => void
}) {
  const visibleGroups = useVisibleNavGroups()
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh max-h-dvh w-[224px] min-w-[224px] flex-col border-r border-white/10 bg-[#1e2a3b] text-slate-300 lg:flex overflow-hidden">
        <div className="shrink-0 border-b border-white/10 px-4 py-3.5">
          <BrandBlock />
        </div>
        <nav className="rail-scroll flex-1 min-h-0 overflow-y-auto px-2 py-3 overscroll-contain">
          <NavGroupsList groups={visibleGroups} />
        </nav>
      </aside>
      <div className={`fixed inset-0 z-[70] bg-slate-950/45 transition lg:hidden ${mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`} onClick={onMobileClose} />
      <aside
        className={`fixed inset-y-0 left-0 z-[80] flex h-dvh max-h-dvh w-[292px] max-w-[88vw] flex-col border-r border-white/10 bg-[#1e2a3b] text-slate-300 transition-transform duration-200 lg:hidden overflow-hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="shrink-0 flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3.5">
          <BrandBlock />
          <button
            type="button"
            aria-label="Close navigation menu"
            className="grid h-10 w-10 place-items-center rounded-md border border-white/20 text-slate-300 hover:bg-white/10"
            onClick={onMobileClose}
          >
            <X size={17} />
          </button>
        </div>
        <nav className="rail-scroll flex-1 min-h-0 overflow-y-auto px-2 py-3 overscroll-contain">
          <NavGroupsList groups={visibleGroups} onNavigate={onMobileClose} />
        </nav>
      </aside>
    </>
  )
}

export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const moduleSettings = useModuleSettings()
  const visibleItems = mobilePrimaryItems.filter((item) => !isPathHiddenByModules(item.to, moduleSettings))
  return (
    <nav className="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden" aria-label="Primary navigation">
      {/* Column count follows the visible items (plus More), so hiding a module leaves no gap. */}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${visibleItems.length + 1}, minmax(0, 1fr))` }}>
        {visibleItems.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              activeOptions={{ exact: true }}
              activeProps={{ className: 'bg-blue-50 text-blue-700' }}
            >
              <Icon size={18} />
              <span className="leading-none">{item.title}</span>
            </Link>
          )
        })}
        <button
          type="button"
          className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          onClick={onMore}
          aria-label="Open all navigation"
        >
          <MoreHorizontal size={18} />
          <span className="leading-none">More</span>
        </button>
      </div>
    </nav>
  )
}
