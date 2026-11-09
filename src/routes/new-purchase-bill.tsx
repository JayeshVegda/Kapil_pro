import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PurchaseBillEditor } from '@/components/suppliers/purchase-bill-editor'

const searchSchema = z.object({
  supplierId: z.string().optional(),
  editBillId: z.string().optional(),
})

export const Route = createFileRoute('/new-purchase-bill')({
  validateSearch: searchSchema,
  component: NewPurchaseBillPage,
})

/** Full-page entry: the page wrapper and URL state live here; the editor is shared
 * with the centered modal form on Purchase Bills and Purchase Logs. */
function NewPurchaseBillPage() {
  const { supplierId, editBillId } = Route.useSearch()
  return (
    <PurchaseBillEditor
      variant="page"
      initialSupplierId={supplierId}
      editBillId={editBillId}
    />
  )
}
