import { createRootRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/layout/app-shell'
import { toUserMessage } from '@/app/errors'

export const Route = createRootRoute({
  component: AppShell,
  errorComponent: ({ error }) => (
    <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {toUserMessage(error)}
    </div>
  ),
})
