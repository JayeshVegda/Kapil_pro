import { Link } from '@tanstack/react-router'
import type { ComponentType } from 'react'
import { BookOpen, Boxes, CalendarDays, CreditCard, Database, FilePlus2, LayoutDashboard, Printer, ScrollText, Users, X } from 'lucide-react'

type NavGroup = {
  label: string
  items: Array<{ to: string; title: string; icon: ComponentType<{ size?: number; className?: string }> }>
}

const groups: NavGroup[] = [
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

export function SidebarNav() {
  return <SidebarNavPanel />
}

export function SidebarNavPanel({
  mobileOpen = false,
  onMobileClose,
}: {
  mobileOpen?: boolean
  onMobileClose?: () => void
}) {
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-[224px] min-w-[224px] flex-col border-r border-white/10 bg-[#1e2a3b] text-slate-300 lg:flex">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-blue-500 text-sm font-bold text-white">K</div>
          <div>
            <p className="text-[15px] font-semibold leading-tight text-slate-100">Kapil Products</p>
            <p className="text-xs text-slate-400">Billing &amp; Ledger</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.to}
                    to={item.to}
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
        </nav>
      </aside>
      <div className={`fixed inset-0 z-[70] bg-slate-950/45 transition lg:hidden ${mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`} onClick={onMobileClose} />
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
            <p className="text-xs text-slate-400">Billing &amp; Ledger</p>
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
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{group.label}</p>
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onMobileClose}
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
      </nav>
      </aside>
    </>
  )
}
