import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonPage } from '@/components/layout/coming-soon-page'

export const Route = createFileRoute('/print-bill')({
  component: PrintBillPage,
})

function PrintBillPage() {
  return <ComingSoonPage title="Print Bill" description="Printable invoice rendering will be implemented in the next phase." />
}
