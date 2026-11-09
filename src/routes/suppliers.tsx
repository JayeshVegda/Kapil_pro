import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Truck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { SupplierLedgerDetail } from '@/routes/supplier-ledger.$supplierId'
import {
  SupplierFormModal,
  emptySupplierFormState,
  type SupplierFormState,
} from '@/components/suppliers/supplier-form-modal'
import { SupplierListPanel } from '@/components/suppliers/supplier-list-panel'
import { SupplierPartiesManager } from '@/components/suppliers/supplier-parties-manager'
import { EmptyState } from '@/components/ui/empty-state'
import { createSupplier, type SupplierUpsertInput } from '@/data/suppliers'
import { suppliersSummaryQueryOptions } from '@/data/purchase-queries'
import { rupeesToPaise } from '@/domain/supplier-units'

const searchSchema = z.object({
  supplierId: z.string().optional(),
  // Legacy param written by other purchase pages' rail; treated as an alias.
  supplier: z.string().optional(),
  tab: z.enum(['ledger', 'bills', 'payments']).optional(),
  focus: z.string().optional(),
})

export const Route = createFileRoute('/suppliers')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => { throw redirect({ to: '/ledger', search: { tab: 'suppliers', supplierId: search.supplierId || search.supplier, focus: search.focus, supplierSection: search.tab } }) },
})

/**
 * Supplier hub in the Party Ledger pattern: master list on the left
 * (scannable dues), full supplier account on the right, selection driven by
 * the `?supplierId=` URL param so deep links keep working.
 */
export function SuppliersPage({ search, manageOpen }: { search: { supplierId?: string; supplier?: string; supplierSection?: 'ledger' | 'bills' | 'payments'; highlightBill?: string; focus?: string }; manageOpen?: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [newSupplierOpen, setNewSupplierOpen] = useState(false)
  const [newSupplierFormState, setNewSupplierFormState] = useState<SupplierFormState>(emptySupplierFormState)
  const [newSupplierError, setNewSupplierError] = useState('')

  const suppliersQuery = useQuery(suppliersSummaryQueryOptions())
  const rows = suppliersQuery.data ?? []

  const createSupplierMutation = useMutation({
    mutationFn: async (formState: SupplierFormState) => {
      const kachaSign = formState.openingKachaDirection === 'we_owe' ? 1 : -1
      const gstSign = formState.openingGstDirection === 'we_owe' ? 1 : -1
      const payload: SupplierUpsertInput = {
        companyName: formState.companyName.trim(),
        contactName: formState.contactName,
        phone: formState.phone,
        gstNo: formState.gstNo,
        city: formState.city,
        notes: formState.notes,
        openingKachaPaise: kachaSign * rupeesToPaise(formState.openingKachaRupees),
        openingGstPaise: gstSign * rupeesToPaise(formState.openingGstRupees),
        openingBalanceDate: formState.openingBalanceDate,
        active: formState.active,
      }
      return (await createSupplier(payload)).id
    },
    onSuccess: async (createdId) => {
      setNewSupplierOpen(false)
      await invalidateAfterSupplierPurchaseWrite(queryClient)
      if (createdId) selectSupplier(createdId)
    },
    onError: (error) => setNewSupplierError(toUserMessage(error)),
  })

  // `supplierId` is canonical; historic links may still carry `?supplier=` (and
  // the ledger master list honors `focus=overdue` by picking the largest due).
  const requestedId = search.supplierId || search.supplier || ''
  const selectedId = useMemo(() => {
    if (requestedId && rows.some((row) => row.supplier.id === requestedId)) return requestedId
    if (!requestedId && search.focus === 'overdue') {
      const mostOverdue = [...rows]
        .filter((row) => row.supplier.active && row.outstandingPaise > 0)
        .sort((a, b) => b.outstandingPaise - a.outstandingPaise)[0]
      return mostOverdue?.supplier.id ?? ''
    }
    return requestedId
  }, [requestedId, rows, search.focus])

  useEffect(() => {
    if (!requestedId) return
    if (rows.length > 0 && !rows.some((row) => row.supplier.id === requestedId)) {
      // Stale id after a delete/merge — drop it instead of rendering a blank detail.
      void navigate({ to: '/ledger', search: { tab: 'suppliers' } })
    }
  }, [requestedId, rows, navigate])

  const selectSupplier = (supplierId: string) => {
    void navigate({
      to: '/ledger',
      search: { tab: 'suppliers', supplierId },
    })
  }

  const changeTab = (tab: 'ledger' | 'bills' | 'payments') => {
    void navigate({
      to: '/ledger',
      search: { tab: 'suppliers', supplierId: selectedId || undefined, supplierSection: tab === 'ledger' ? undefined : tab },
    })
  }

  // Shared party manager mode: the LedgerPage toolbar toggles supplier
  // management just like the customers tab, replacing the rail/workspace view.
  if (manageOpen) return <SupplierPartiesManager />

  return (
    <div className="grid grid-cols-1 gap-3 px-3 pb-6 pt-3 sm:px-4 lg:px-6 xl:grid-cols-[290px_minmax(0,1fr)] xl:gap-4">
      <SupplierListPanel rows={rows} selectedId={selectedId} onSelect={selectSupplier} onCreateClick={() => {
        setNewSupplierError('')
        setNewSupplierFormState(emptySupplierFormState)
        setNewSupplierOpen(true)
      }} />

      {selectedId ? (
        <div className="min-w-0">
          <SupplierLedgerDetail
            supplierId={selectedId}
            tab={search.supplierSection}
            highlightBill={search.highlightBill}
            showBack={false}
            onTabChange={changeTab}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6">
          <EmptyState
            icon={Truck}
            title="Select a supplier"
            hint="Pick a supplier from the list to see its ledger, bills, payments, and bardan. The list sorts by highest due first."
          />
        </div>
      )}

      {newSupplierOpen && (
        <SupplierFormModal
          formState={newSupplierFormState}
          isSaving={createSupplierMutation.isPending}
          errorText={newSupplierError}
          onChange={setNewSupplierFormState}
          onClose={() => setNewSupplierOpen(false)}
          onSave={() => {
            setNewSupplierError('')
            createSupplierMutation.mutate(newSupplierFormState)
          }}
        />
      )}
    </div>
  )
}
