import { Link, useRouterState } from '@tanstack/react-router'
import type { ComponentType } from 'react'
import { useEffect, useMemo } from 'react'
import { BookOpen, Boxes, Calendar, CalendarDays, ClipboardList, CreditCard, Database, Download, FilePlus2, Flame, HeartPulse, LayoutDashboard, MoreHorizontal, PackagePlus, Printer, ScrollText, Truck, Users, X } from 'lucide-react'
import type { AppModuleId } from '@/domain/app-modules'
import { appModuleFromPathname, persistAppModule } from '@/domain/app-modules'

type NavGroup = {
  label: string
  items: Array<{ to: string; title: string; icon: ComponentType<{ size?: number; className?: string }> }>
}

const sellingGroups: NavGroup[] = [
  { label: 'Dashboard', items: [{ to: '/', title: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Transactions',
    items: [
      { to: '/new-bill', title: 'Bills', icon: FilePlus2 },
      { to: '/stock', title: 'Stock', icon: PackagePlus },
      { to: '/new-payment', title: 'Payments', icon: CreditCard },
      { to: '/transactions', title: 'Logs', icon: ScrollText },
      { to: '/print-bill', title: 'Print Bill', icon: Printer },
    ],
  },
  {
    label: 'Customers',
    items: [
      { to: '/customers', title: 'Customers', icon: Users },
      { to: '/ledger', title: 'Party Ledger', icon: BookOpen },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/calendar', title: 'Calendar', icon: Calendar },
      { to: '/monthly-report', title: 'Company Report', icon: CalendarDays },
      { to: '/export-reports', title: 'Exports', icon: Download },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/items', title: 'Items', icon: Boxes },
      { to: '/data-health', title: 'Data Health', icon: HeartPulse },
      { to: '/backup', title: 'Backup', icon: Database },
    ],
  },
]

const buyingGroups: NavGroup[] = [
  { label: 'Dashboard', items: [{ to: '/buying', title: 'Buying Overview', icon: LayoutDashboard }] },
  { label: 'Suppliers', items: [{ to: '/buying/suppliers', title: 'Suppliers', icon: Truck }] },
  {
    label: 'Purchases',
    items: [
      { to: '/buying/new-purchase', title: 'New Purchase', icon: FilePlus2 },
      { to: '/buying/supplier-payments', title: 'Supplier Payments', icon: CreditCard },
      { to: '/buying/purchase-logs', title: 'Purchase Logs', icon: ScrollText },
    ],
  },
  { label: 'Ledger', items: [{ to: '/buying/supplier-ledger', title: 'Supplier Ledger', icon: BookOpen }] },
]

const castingGroups: NavGroup[] = [
  { label: 'Dashboard', items: [{ to: '/casting', title: 'Casting Overview', icon: LayoutDashboard }] },
  { label: 'Session', items: [{ to: '/casting/new-session', title: 'New Session', icon: Flame }] },
  {
    label: 'Records',
    items: [
      { to: '/casting/log', title: 'Casting Log', icon: ClipboardList },
      { to: '/casting/materials', title: 'Materials', icon: Boxes },
    ],
  },
]

const modules: Array<{ id: AppModuleId; label: string; defaultTo: string }> = [
  { id: 'selling', label: 'Selling', defaultTo: '/' },
  { id: 'buying', label: 'Buying', defaultTo: '/buying' },
  { id: 'casting', label: 'Casting', defaultTo: '/casting' },
]

const moduleSubtitle: Record<AppModuleId, string> = {
  selling: 'Billing & Ledger',
  buying: 'Scrap procurement',
  casting: 'Furnace & output',
}

function groupsForModule(moduleId: AppModuleId) {
  if (moduleId === 'buying') return buyingGroups
  if (moduleId === 'casting') return castingGroups
  return sellingGroups
}

export function SidebarNav() {
  return <SidebarNavPanel />
}

function ModuleSwitcherRow({ activeModule }: { activeModule: AppModuleId }) {
  return (
    <div className="border-b border-white/10 px-2 py-2">
      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Module</p>
      <div className="grid grid-cols-3 gap-1">
        {modules.map((module) => {
          const isActive = activeModule === module.id
          return (
            <Link
              key={module.id}
              to={module.defaultTo}
              title={module.label}
              className={`rounded-md px-1.5 py-1.5 text-center text-[11px] font-semibold leading-tight transition ${
                isActive ? 'bg-white text-slate-900 ring-1 ring-white/80 shadow-sm' : 'text-slate-400 hover:bg-white/10 hover:text-slate-100'
              }`}
            >
              {module.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function NavGroupsList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="mb-3">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{group.label}</p>
          {group.items.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className="mb-0.5 flex items-center gap-2 rounded-md border-l-2 border-transparent px-3 py-2 text-[13px] text-slate-300 transition hover:bg-white/5 hover:text-slate-100"
                activeOptions={{ exact: true }}
                activeProps={{ className: 'border-l-blue-400 bg-blue-500/20 font-semibold text-white' }}
              >
                <Icon size={15} />
                <span>{item.title}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </>
  )
}

export function SidebarNavPanel({
  mobileOpen = false,
  onMobileClose,
}: {
  mobileOpen?: boolean
  onMobileClose?: () => void
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const activeModule = useMemo(() => appModuleFromPathname(pathname), [pathname])
  const groups = useMemo(() => groupsForModule(activeModule), [activeModule])
  const brandSubtitle = moduleSubtitle[activeModule]

  useEffect(() => {
    persistAppModule(activeModule)
  }, [activeModule])

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-[224px] min-w-[224px] flex-col border-r border-white/10 bg-[#1e2a3b] text-slate-300 lg:flex">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
          <img src="/favicon.png" alt="" className="h-10 w-10 rounded-lg object-cover" />
          <div>
            <p className="text-[15px] font-semibold leading-tight text-slate-100">Kapil Products</p>
            <p className="text-xs text-slate-400">{brandSubtitle}</p>
          </div>
        </div>
        <ModuleSwitcherRow activeModule={activeModule} />
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <NavGroupsList groups={groups} />
        </nav>
      </aside>
      <div className={`fixed inset-0 z-[70] bg-slate-950/45 transition lg:hidden ${mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`} onClick={onMobileClose} />
      <aside
        className={`fixed inset-y-0 left-0 z-[80] flex h-dvh w-[292px] max-w-[88vw] flex-col border-r border-white/10 bg-[#1e2a3b] text-slate-300 transition-transform duration-200 lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-4">
        <div className="flex items-center gap-2">
          <img src="/favicon.png" alt="" className="h-10 w-10 rounded-lg object-cover" />
          <div>
            <p className="text-[15px] font-semibold leading-tight text-slate-100">Kapil Products</p>
            <p className="text-xs text-slate-400">{brandSubtitle}</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close navigation menu"
          className="grid h-10 w-10 place-items-center rounded-md border border-white/20 text-slate-300 hover:bg-white/10"
          onClick={onMobileClose}
        >
          <X size={17} />
        </button>
      </div>
      <ModuleSwitcherRow activeModule={activeModule} />
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavGroupsList groups={groups} onNavigate={onMobileClose} />
      </nav>
      </aside>
    </>
  )
}

const mobilePrimaryItems = [
  { to: '/', title: 'Home', icon: LayoutDashboard },
  { to: '/new-bill', title: 'Bill', icon: FilePlus2 },
  { to: '/new-payment', title: 'Pay', icon: CreditCard },
  { to: '/ledger', title: 'Ledger', icon: BookOpen },
]

const mobilePrimaryItemsByModule: Record<AppModuleId, typeof mobilePrimaryItems> = {
  selling: mobilePrimaryItems,
  buying: [
    { to: '/buying', title: 'Buy', icon: LayoutDashboard },
    { to: '/buying/new-purchase', title: 'New', icon: FilePlus2 },
    { to: '/buying/supplier-payments', title: 'Pay', icon: CreditCard },
    { to: '/buying/supplier-ledger', title: 'Ledger', icon: BookOpen },
  ],
  casting: [
    { to: '/casting', title: 'Cast', icon: LayoutDashboard },
    { to: '/casting/new-session', title: 'New', icon: Flame },
    { to: '/casting/log', title: 'Log', icon: ClipboardList },
    { to: '/casting/materials', title: 'Items', icon: Boxes },
  ],
}

export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const activeModule = useMemo(() => appModuleFromPathname(pathname), [pathname])
  const items = mobilePrimaryItemsByModule[activeModule]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden" aria-label="Primary navigation">
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => {
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
