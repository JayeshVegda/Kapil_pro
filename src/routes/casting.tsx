import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { loadCastingSessions } from '@/data/casting'

export const Route = createFileRoute('/casting')({
  component: CastingLayout,
})

const CASTING_SESSIONS_KEY = ['casting-sessions'] as const

function CastingLayout() {
  useQuery({
    queryKey: CASTING_SESSIONS_KEY,
    queryFn: () => loadCastingSessions(),
  })
  return <Outlet />
}
