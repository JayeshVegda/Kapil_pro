import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CastingSessionEditor } from '@/components/casting/casting-session-editor'

export const Route = createFileRoute('/casting/new-session')({
  validateSearch: z.object({ draftId: z.string().regex(/^[a-z0-9]{15}$/).optional() }),
  component: CastingNewSessionPage,
})

function CastingNewSessionPage() {
  const { draftId } = Route.useSearch()
  return <CastingSessionEditor key={draftId ?? 'manual'} draftId={draftId} />
}
