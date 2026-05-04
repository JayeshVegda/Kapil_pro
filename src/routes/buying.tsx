import { createFileRoute } from '@tanstack/react-router'
import type { PurchaseEntry, SupplierMaster, SupplierPayment } from '@/domain/scrap-buying-types'
import { BoMetric, BoSection, EmptyTableHint } from '@/components/modules/boilerplate-ui'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/buying')({
  component: BuyingOverviewPage,
})

const PLACEHOLDER_SUPPLIERS: SupplierMaster[] = []
const PLACEHOLDER_PURCHASES: PurchaseEntry[] = []
const PLACEHOLDER_PAYMENTS: SupplierPayment[] = []

function BuyingOverviewPage() {
  const totalPayable = 0
  const recentPurchases = PLACEHOLDER_PURCHASES.slice(0, 5)
  const recentPayments = PLACEHOLDER_PAYMENTS.slice(0, 5)

  return (
    <div className="w-full space-y-8 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500">
        Buying dashboard shell for scrap procurement. <span className="text-amber-700">No backend logic yet.</span>
      </p>

      <BoSection title="Quick Summary">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <BoMetric label="Total payable" value={formatInrInteger(totalPayable)} emphasized />
          <BoMetric label="Suppliers" value={String(PLACEHOLDER_SUPPLIERS.length)} />
          <BoMetric label="Recent purchases" value={String(recentPurchases.length)} />
          <BoMetric label="Recent payments" value={String(recentPayments.length)} />
        </div>
      </BoSection>

      <BoSection title="Recent Purchases">
        <EmptyTableHint entityLabel="purchase records" />
      </BoSection>

      <BoSection title="Recent Supplier Payments">
        <EmptyTableHint entityLabel="supplier payment records" />
      </BoSection>
    </div>
  )
}
