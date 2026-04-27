import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonPage } from '@/components/layout/coming-soon-page'

export const Route = createFileRoute('/monthly-report')({
  component: ReportPage,
})

function ReportPage() {
  return <ComingSoonPage title="Report" description="Business summary and trends will be implemented in the next phase." />
}
