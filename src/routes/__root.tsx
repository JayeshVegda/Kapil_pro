import { createRootRoute, redirect } from '@tanstack/react-router'
import { toast } from 'sonner'
import { loadModuleSettingsForGuard } from '@/data/module-settings'
import { isPathHiddenByModules, type ModuleSettings } from '@/lib/module-settings'
import { AppShell } from '@/components/layout/app-shell'
import { toUserMessage } from '@/app/errors'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    let settings: ModuleSettings
    try { settings = await loadModuleSettingsForGuard() } catch { return }
    if (isPathHiddenByModules(location.pathname, settings)) {
      toast.info(`${location.pathname.startsWith('/casting') || location.pathname === '/reports/casting' ? 'Casting' : 'Purchase'} is turned off in Settings`)
      throw redirect({ to: '/' })
    }
  },
  component: AppShell,
  errorComponent: ({ error }) => (
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 mb-4">
        <AlertTriangle size={24} />
      </div>
      <h2 className="text-base font-semibold text-slate-800">Connection or Application Issue</h2>
      <p className="mt-1.5 max-w-md text-xs text-slate-600">
        {toUserMessage(error)}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
      >
        <RefreshCw size={13} />
        Retry / Refresh Page
      </button>
    </div>
  ),
})
