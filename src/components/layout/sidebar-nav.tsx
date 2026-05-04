import { Link, useRouterState } from '@tanstack/react-router'
import type { ComponentType } from 'react'
import { useEffect, useMemo } from 'react'
import {
  BookOpen,
  Boxes,
  Calendar,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Database,
  FilePlus2,
  Flame,
  LayoutDashboard,
  Printer,
  ScrollText,
  Truck,
  Users,
  X,
} from 'lucide-react'
import type { AppModuleId } from '@/domain/app-modules'
import { appModuleFromPathname, persistAppModule } from '@/domain/app-modules'

type NavIcon = ComponentType<{ size?: number; className?: string }>

type NavItem = { to: string; title: string; icon: NavIcon }

type NavGroup = {
  label: string
  items: NavItem[]
}

const sellingGroups: NavGroup[] = [
  { label: 'Dashboard', items: [{ to: '/', title: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Transactions',
    items: [
      { to: '/new-bill', title: 'Bills', icon: FilePlus2 },
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
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/items', title: 'Items', icon: Boxes },
      { to: '/backup', title: 'Backup', icon: Database },
    ],
  },
]

const buyingGroups: NavGroup[] = [
  {
    label: 'Dashboard',
    items: [{ to: '/buying', title: 'Buying Overview', icon: LayoutDashboard }],
  },
  {
    label: 'Suppliers',
    items: [{ to: '/buying/suppliers', title: 'Suppliers', icon: Truck }],
  },
  {
    label: 'Purchases',
    items: [
      { to: '/buying/new-purchase', title: 'New Purchase', icon: FilePlus2 },
      { to: '/buying/supplier-payments', title: 'Supplier Payments', icon: CreditCard },
      { to: '/buying/purchase-logs', title: 'Purchase Logs', icon: ScrollText },
    ],
  },
  {
    label: 'Ledger',
    items: [{ to: '/buying/supplier-ledger', title: 'Supplier Ledger', icon: BookOpen }],
  },
]

const castingGroups: NavGroup[] = [
  {
    label: 'Dashboard',
    items: [{ to: '/casting', title: 'Casting Overview', icon: LayoutDashboard }],
  },
  {
    label: 'Session',
    items: [{ to: '/casting/new-session', title: 'New Session', icon: Flame }],
  },
  {
    label: 'Records',
    items: [{ to: '/casting/log', title: 'Casting Log', icon: ClipboardList }],
  },
]

const modules: Array<{ id: AppModuleId; label: string; defaultTo: string }> = [
  { id: 'selling', label: 'Selling', defaultTo: '/' },
  { id: 'buying', label: 'Buying', defaultTo: '/buying' },
  { id: 'casting', label: 'Casting', defaultTo: '/casting' },
]

function groupsForModule(m: AppModuleId): NavGroup[] {
  if (m === 'buying') return buyingGroups
  if (m === 'casting') return castingGroups
  return sellingGroups
}

const moduleSubtitle: Record<AppModuleId, string> = {
  selling: 'Sales & Billing',
  buying: 'Scrap procurement',
  casting: 'Furnace & output',
}

export function SidebarNav() {
  return <SidebarNavPanel />
}

function ModuleSwitcherRow({ activeModule }: { activeModule: AppModuleId }) {
  return (
    <div className="border-b border-white/10 px-2 py-2">
      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Module</p>
      <div className="grid grid-cols-3 gap-1">
        {modules.map((m) => {
          const isActive = activeModule === m.id
          return (
            <Link
              key={m.id}
              to={m.defaultTo}
              title={m.label}
              className={`rounded-md px-1.5 py-1.5 text-center text-[11px] font-semibold leading-tight transition ${
                isActive ? 'bg-white text-slate-900 ring-1 ring-white/80 shadow-sm' : 'text-slate-400 hover:bg-white/10 hover:text-slate-100'
              }`}
            >
              {m.label}
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
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeModule = useMemo(() => appModuleFromPathname(pathname), [pathname])
  const groups = useMemo(() => groupsForModule(activeModule), [activeModule])

  useEffect(() => {
    persistAppModule(activeModule)
  }, [activeModule])

  const brandSubtitle = moduleSubtitle[activeModule]

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-[224px] min-w-[224px] flex-col border-r border-white/10 bg-[#1e2a3b] text-slate-300 lg:flex">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-blue-500 text-sm font-bold text-white">K</div>
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
      <div
        className={`fixed inset-0 z-[70] bg-slate-950/45 transition lg:hidden ${mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onMobileClose}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-[80] flex h-dvh w-[264px] max-w-[82vw] flex-col border-r border-white/10 bg-[#1e2a3b] text-slate-300 transition-transform duration-200 lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-blue-500 text-sm font-bold text-white">K</div>
            <div>
              <p className="text-[15px] font-semibold leading-tight text-slate-100">Kapil Products</p>
              <p className="text-xs text-slate-400">{brandSubtitle}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close navigation menu"
            className="grid h-8 w-8 place-items-center rounded-md border border-white/20 text-slate-300 hover:bg-white/10"
            onClick={onMobileClose}
          >
            <X size={15} />
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
