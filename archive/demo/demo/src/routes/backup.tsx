import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonPage } from '@/components/layout/coming-soon-page'

export const Route = createFileRoute('/backup')({
  component: BackupPage,
})

function BackupPage() {
  return <ComingSoonPage title="Backup" description="Backup validation/export tooling will be implemented in the next phase." />
}
