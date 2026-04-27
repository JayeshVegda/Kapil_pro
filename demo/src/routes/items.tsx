import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonPage } from '@/components/layout/coming-soon-page'

export const Route = createFileRoute('/items')({
  component: ItemsPage,
})

function ItemsPage() {
  return <ComingSoonPage title="Items" description="Item master management will be implemented in the next phase." />
}
