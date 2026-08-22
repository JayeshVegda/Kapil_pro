import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/calendar')({
  validateSearch: (search: Record<string, unknown>) => ({
    month: typeof search.month === 'string' && /^\d{4}-\d{2}$/.test(search.month) ? search.month : undefined,
  }),
  component: CalendarCompatibilityRedirect,
})

function CalendarCompatibilityRedirect() {
  const search = Route.useSearch()
  return <Navigate to="/monthly-sales-calendar" search={{ month: search.month }} replace />
}
