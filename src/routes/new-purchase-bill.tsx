import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PurchaseBillEditor } from '@/components/suppliers/purchase-bill-editor'
import { NewPurchaseMuseStrip } from '@/components/drafts/muse-purchase-inbox'

const searchSchema = z.object({
  supplierId: z.string().optional(),
  editBillId: z.string().optional(),
  draftId: z.string().regex(/^[a-z0-9]{15}$/).optional(),
}).refine((value) => !(value.editBillId && value.draftId), 'Open a bill or a draft, not both')

export const Route = createFileRoute('/new-purchase-bill')({
  validateSearch: searchSchema,
  component: NewPurchaseBillPage,
})

/** Full-page entry: the page wrapper and URL state live here; the editor is shared
 * with the centered modal form on Purchase Bills and Purchase Logs. */
function NewPurchaseBillPage() {
  const { supplierId, editBillId, draftId } = Route.useSearch()
  return (
    <>
    {!draftId && !editBillId && <NewPurchaseMuseStrip />}
    <PurchaseBillEditor
      variant="page"
      initialSupplierId={supplierId}
      editBillId={editBillId}
      draftId={draftId}
    />
    </>
  )
}
