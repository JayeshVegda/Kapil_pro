import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  Command,
  DatabaseBackup,
  Flame,
  HeartPulse,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { loadItems } from '@/data/items'
import {
  defaultAdminControlSettings,
  getAdminControlSettings,
  saveAdminControlSettings,
  subscribeAdminControlSettings,
  type AdminControlSettings,
} from '@/lib/admin-control'
import { getModuleSettings, saveModuleSettings, subscribeModuleSettings, type ModuleSettings } from '@/lib/module-settings'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const [modules, setModules] = useState<ModuleSettings>(() => getModuleSettings())
  const [admin, setAdmin] = useState<AdminControlSettings>(() => getAdminControlSettings())

  useEffect(() => subscribeModuleSettings(setModules), [])
  useEffect(() => subscribeAdminControlSettings(setAdmin), [])

  function updateModules(next: Partial<ModuleSettings>) {
    saveModuleSettings({ ...getModuleSettings(), ...next })
  }
  function updateAdmin(next: Partial<AdminControlSettings>) {
    saveAdminControlSettings({ ...getAdminControlSettings(), ...next })
  }

  return (
    <div className="w-full space-y-5 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <SlidersHorizontal size={15} className="text-slate-400" />
          Settings
        </h2>
        <p className="mt-1 max-w-prose text-xs text-slate-500">
          Preferences save instantly on this computer. Nothing here deletes data — module switches only hide pages.
        </p>
      </section>

      <SettingsCard icon={Flame} title="Modules" description="Hide or show optional parts of the app.">
        <SettingRow
          icon={Flame}
          title="Casting"
          description="Furnace sessions, casting log, materials, and casting bill. When off, casting pages disappear from the sidebar and casting figures are left out of the dashboard."
          enabled={modules.castingEnabled}
          onChange={(next) => updateModules({ castingEnabled: next })}
        />
      </SettingsCard>

      <BillEntryCard defaultItemName={admin.defaultBillItemName} onChange={(name) => updateAdmin({ defaultBillItemName: name })} />

      <CommandBarCard admin={admin} onChange={updateAdmin} />

      <SettingsCard icon={DatabaseBackup} title="Data & Safety" description="Backups, exports, and health checks for your billing data.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <LinkCard to="/backup" icon={DatabaseBackup} title="Backup" detail="Download a full JSON + CSV snapshot of customers, bills, and payments." />
          <LinkCard to="/data-health" icon={HeartPulse} title="Data Health" detail="Scan for skipped bill numbers, misfiled books, and broken references." />
        </div>
      </SettingsCard>

      <SettingsCard icon={ShieldCheck} title="Advanced" description="Access phrase, palette behaviour details, and settings import/export live in the Control Room.">
        <Link
          to="/control-room"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Open Control Room
          <ChevronRight size={14} />
        </Link>
      </SettingsCard>
    </div>
  )
}

function BillEntryCard({ defaultItemName, onChange }: { defaultItemName: string; onChange: (name: string) => void }) {
  // Same key AND queryFn as control-room: ['items-options'] caches full item
  // records, so consumers must map to names (mixing shapes here once rendered
  // an object as a React child — the infamous "object with keys" crash).
  const itemsQuery = useQuery({ queryKey: ['items-options'], queryFn: loadItems })
  const known = (itemsQuery.data ?? []).map((item) => item.name).filter(Boolean)
  const options = known.includes(defaultItemName) || !defaultItemName ? known : [defaultItemName, ...known]

  return (
    <SettingsCard icon={Settings2} title="Bill Entry" description="Defaults used while creating bills.">
      <label className="flex flex-col gap-1.5 sm:max-w-md">
        <span className="text-xs font-medium text-slate-600">Default bill item</span>
        <select
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
          value={defaultItemName}
          onChange={(event) => onChange(event.target.value)}
        >
          {!defaultItemName && <option value="">Not set</option>}
          {options.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <span className="text-[11px] text-slate-400">Pre-selected when you open New Bill or use the quick command without an item name.</span>
      </label>
    </SettingsCard>
  )
}

function CommandBarCard({ admin, onChange }: { admin: AdminControlSettings; onChange: (next: Partial<AdminControlSettings>) => void }) {
  return (
    <SettingsCard icon={Command} title="Command Bar" description="Quick commands typed at the top of the app.">
      <div className="space-y-4">
        <SettingRow
          icon={Command}
          title="Ctrl+K command palette"
          description="Opens the quick-command bar from anywhere. Turn off if it gets in your way."
          enabled={admin.controlKEnabled}
          onChange={(next) => onChange({ controlKEnabled: next })}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AliasField
            label="Bill aliases"
            value={admin.commandAliases.bill.join(', ')}
            onChange={(value) => onChange({ commandAliases: { ...admin.commandAliases, bill: splitAliases(value, 'bill') } })}
          />
          <AliasField
            label="Payment aliases"
            value={admin.commandAliases.payment.join(', ')}
            onChange={(value) => onChange({ commandAliases: { ...admin.commandAliases, payment: splitAliases(value, 'payment') } })}
          />
          <AliasField
            label="Print aliases"
            value={admin.commandAliases.print.join(', ')}
            onChange={(value) => onChange({ commandAliases: { ...admin.commandAliases, print: splitAliases(value, 'print') } })}
          />
        </div>
        <PinnedRoutes routes={admin.pinnedRoutes} onChange={(routes) => onChange({ pinnedRoutes: routes })} />
      </div>
    </SettingsCard>
  )
}

function PinnedRoutes({ routes, onChange }: { routes: Array<{ label: string; path: string }>; onChange: (routes: Array<{ label: string; path: string }>) => void }) {
  function update(index: number, patch: Partial<{ label: string; path: string }>) {
    onChange(routes.map((route, i) => (i === index ? { ...route, ...patch } : route)))
  }
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-600">Pinned quick commands</p>
      <div className="space-y-1.5">
        {routes.map((route, index) => (
          <div key={`${route.label}-${index}`} className="flex items-center gap-1.5">
            <input
              className="h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
              value={route.label}
              placeholder="Label"
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <input
              className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-600 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
              value={route.path}
              placeholder="/new-bill"
              onChange={(event) => update(index, { path: event.target.value })}
            />
            <button
              type="button"
              aria-label={`Remove ${route.label}`}
              className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              onClick={() => onChange(routes.filter((_, i) => i !== index))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-slate-300 px-2.5 text-xs font-medium text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
        onClick={() => onChange([...routes, { label: '', path: '' }])}
      >
        <Plus size={12} />
        Add pinned route
      </button>
    </div>
  )
}

function AliasField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="b, bill, sale"
      />
    </label>
  )
}

function splitAliases(raw: string, kind: 'bill' | 'payment' | 'print') {
  const aliases = raw.split(/[,\s]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  return aliases.length ? Array.from(new Set(aliases)) : defaultAdminControlSettings.commandAliases[kind]
}

function LinkCard({ to, icon: Icon, title, detail }: { to: string; icon: LucideIconType; title: string; detail: string }) {
  return (
    <Link to={to} className="group flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition hover:border-blue-200 hover:bg-blue-50/40">
      <span className="flex min-w-0 items-start gap-2.5">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-700">
          <Icon size={14} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-800">{title}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{detail}</span>
        </span>
      </span>
      <ChevronRight size={15} className="mt-1 shrink-0 text-slate-300 group-hover:text-blue-600" />
    </Link>
  )
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Icon size={15} className="text-slate-400" />
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
      <div className="divide-y divide-slate-100 px-5 py-2">{children}</div>
    </section>
  )
}

function SettingRow({
  icon: Icon,
  title,
  description,
  enabled,
  onChange,
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  title: string
  description: ReactNode
  enabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-1 last:pb-1">
      <div className="flex gap-3">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${enabled ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
          <Icon size={16} />
        </span>
        <div>
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <p className="mt-0.5 max-w-prose text-xs leading-snug text-slate-500">{description}</p>
        </div>
      </div>
      <Switch checked={enabled} onChange={onChange} label={title} />
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
        checked ? 'bg-blue-600' : 'bg-slate-300'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

type LucideIconType = ComponentType<{ size?: number; className?: string }>
