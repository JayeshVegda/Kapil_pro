import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonPage } from '@/components/layout/coming-soon-page'

export const Route = createFileRoute('/transactions')({
  component: TransactionsPage,
})

function TransactionsPage() {
  return <ComingSoonPage title="Transactions" description="Unified transaction explorer will be implemented in the next phase." />
}
