import { createFileRoute, Link } from '@tanstack/react-router'
import { Flame, SlidersHorizontal } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { getModuleSettings, saveModuleSettings, type ModuleSettings } from '@/lib/module-settings'
import { useModuleSettings } from '@/lib/use-module-settings'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const settings = useModuleSettings()

  function setModule<K extends keyof ModuleSettings>(key: K, value: ModuleSettings[K]) {
    saveModuleSettings({ ...getModuleSettings(), [key]: value })
  }

  return (
    <div className="w-full space-y-5 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <SlidersHorizontal size={15} className="text-slate-400" />
          Settings
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Switch optional modules on or off. Turning a module off only hides it — no records are deleted, and everything
          comes back when you switch it on again.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Modules</h3>
        </div>
        <div className="divide-y divide-slate-100">
          <ModuleToggle
            icon={Flame}
            title="Casting"
            description="Furnace sessions, casting log, materials, and casting bill. When off, casting pages are hidden from the sidebar, the command bar, and quick search, and casting figures are left out of the dashboard."
            enabled={settings.castingEnabled}
            onChange={(next) => setModule('castingEnabled', next)}
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Advanced</h3>
        <p className="mt-1 text-xs text-slate-500">
          Command aliases, pinned routes, and the Control-K palette live in the Control Room, behind an access phrase.
        </p>
        <Link
          to="/control-room"
          className="mt-3 inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Open Control Room
        </Link>
      </section>
    </div>
  )
}

function ModuleToggle({
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
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="flex gap-3">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${enabled ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
          <Icon size={16} />
        </span>
        <div>
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <p className="mt-0.5 max-w-prose text-xs text-slate-500">{description}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${title} module`}
        onClick={() => onChange(!enabled)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
          enabled ? 'bg-blue-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  )
}
