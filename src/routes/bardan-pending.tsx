import { redirect } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'

/** Retired in the supplier-purchases redesign; the Bardan Pending tab replaces it. */
export const Route = createFileRoute('/bardan-pending')({
  beforeLoad: () => {
    throw redirect({ to: '/purchase-bills', search: { tab: 'bardan' } })
  },
})
