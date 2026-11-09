import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import {
  PartyManagerShell,
  type PartyManagerColumn,
  type PartyManagerSort,
} from '@/components/ledger/party-manager-shell'
import {
  SupplierFormModal,
  emptySupplierFormState,
  type SupplierFormState,
} from '@/components/suppliers/supplier-form-modal'
import { suppliersSummaryQueryOptions } from '@/data/purchase-queries'
import {
  createSupplier,
  deactivateSupplier,
  reactivateSupplier,
  updateSupplier,
  type SupplierSummary,
  type SupplierUpsertInput,
} from '@/data/suppliers'
import { rupeesToPaise } from '@/domain/supplier-units'
import { formatFullDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

/**
 * Supplier side of the shared party manager (operational redesign Phase 3).
 * Same shell the customers tab uses, fed with purchase data: integer-paise
 * balances are formatted for display only — all calculations stay in
 * `data/suppliers.ts` and `domain/supplier-settlement`. Opening balances keep
 * the sign-directed form convention (`we_owe` positive, `they_owe` negative).
 */

const SUPPLIER_SORTS: Array<PartyManagerSort<SupplierSummary>> = [
  { key: 'due', label: 'Highest due', compare: (a, b) => b.outstandingPaise - a.outstandingPaise },
  { key: 'name', label: 'Name A-Z', compare: (a, b) => a.supplier.companyName.localeCompare(b.supplier.companyName) },
  { key: 'activity', label: 'Recent activity', compare: (a, b) => b.lastActivityDate.localeCompare(a.lastActivityDate) },
]

const SUPPLIER_COLUMNS: Array<PartyManagerColumn<SupplierSummary>> = [
  {
    key: 'supplier',
    header: 'Supplier',
    render: (row) => (
      <div>
        <p className="font-medium text-slate-900">{row.supplier.companyName}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {row.supplier.contactName || row.supplier.city || '—'}
          {!row.supplier.active && (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-slate-500">Inactive</span>
          )}
        </p>
      </div>
    ),
  },
  {
    key: 'contact',
    header: 'Contact',
    render: (row) =>
      row.supplier.phone ? (
        <span className="text-xs text-slate-600">{row.supplier.phone}</span>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      ),
  },
  {
    key: 'kacha',
    header: 'Kacha due',
    align: 'right',
    render: (row) =>
      row.kachaDuePaise > 0 ? (
        <span className="font-mono tabular-nums text-slate-700">{formatPaiseInr(row.kachaDuePaise)}</span>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      ),
  },
  {
    key: 'gst',
    header: 'GST due',
    align: 'right',
    render: (row) =>
      row.gstDuePaise > 0 ? (
        <span className="font-mono tabular-nums text-slate-700">{formatPaiseInr(row.gstDuePaise)}</span>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      ),
  },
  {
    key: 'advance',
    header: 'Advance',
    align: 'right',
    render: (row) =>
      row.advancePaise > 0 ? (
        <span className="font-mono font-semibold tabular-nums text-emerald-700">{formatPaiseInr(row.advancePaise)}</span>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      ),
  },
  {
    key: 'net',
    header: 'Net payable',
    align: 'right',
    render: (row) =>
      row.outstandingPaise > 0 ? (
        <span className="font-mono font-semibold tabular-nums text-rose-600">{formatPaiseInr(row.outstandingPaise)}</span>
      ) : row.outstandingPaise < 0 ? (
        <span className="font-mono font-semibold tabular-nums text-emerald-600">{formatPaiseInr(row.outstandingPaise)}</span>
      ) : (
        <span className="text-xs font-medium text-slate-400">NIL</span>
      ),
  },
  {
    key: 'activity',
    header: 'Last activity',
    align: 'right',
    render: (row) =>
      row.lastActivityDate ? (
        <span className="text-xs text-slate-500">{formatFullDate(row.lastActivityDate)}</span>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      ),
  },
]

export function SupplierPartiesManager() {
  const queryClient = useQueryClient()
  const [statusText, setStatusText] = useState('')
  const [formError, setFormError] = useState('')
  const [dialogTarget, setDialogTarget] = useState<{ summary: SupplierSummary | null; formState: SupplierFormState } | null>(null)

  const suppliersQuery = useQuery(suppliersSummaryQueryOptions())
  const rows = suppliersQuery.data ?? []

  const kpis = useMemo(() => {
    const active = rows.filter((row) => row.supplier.active).length
    const withDue = rows.filter((row) => row.outstandingPaise > 0)
    return {
      total: rows.length,
      active,
      withDue: withDue.length,
      totalDuePaise: withDue.reduce((sum, row) => sum + row.outstandingPaise, 0),
    }
  }, [rows])

  // Purchase financial invariant: opening balances are sign-directed integer
  // paise — `we_owe` positive, `they_owe` negative. Never touch floats here.
  const formToPayload = (formState: SupplierFormState): SupplierUpsertInput => {
    const kachaSign = formState.openingKachaDirection === 'we_owe' ? 1 : -1
    const gstSign = formState.openingGstDirection === 'we_owe' ? 1 : -1
    return {
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
  }

  const createMutation = useMutation({
    mutationFn: (formState: SupplierFormState) => createSupplier(formToPayload(formState)),
    onSuccess: async (created) => {
      setDialogTarget(null)
      setStatusText(`Supplier ${created.companyName} created.`)
      await invalidateAfterSupplierPurchaseWrite(queryClient)
    },
    onError: (error) => setFormError(toUserMessage(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ supplierId, formState }: { supplierId: string; formState: SupplierFormState }) =>
      updateSupplier(supplierId, formToPayload(formState)),
    onSuccess: async (updated) => {
      setDialogTarget(null)
      setStatusText(`Supplier ${updated.companyName} updated.`)
      await invalidateAfterSupplierPurchaseWrite(queryClient, updated.id)
    },
    onError: (error) => setFormError(toUserMessage(error)),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ supplierId, nextActive }: { supplierId: string; nextActive: boolean }) =>
      nextActive ? reactivateSupplier(supplierId) : deactivateSupplier(supplierId),
    onSuccess: async (updated) => {
      setStatusText('')
      await invalidateAfterSupplierPurchaseWrite(queryClient, updated.id)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const openEditDialog = (summary: SupplierSummary) => {
    const s = summary.supplier
    setDialogTarget({
      summary,
      formState: {
        id: s.id,
        companyName: s.companyName,
        contactName: s.contactName ?? '',
        phone: s.phone ?? '',
        gstNo: s.gstNo ?? '',
        city: s.city ?? '',
        notes: s.notes ?? '',
        openingKachaRupees: Math.abs(s.openingKachaPaise) / 100,
        openingKachaDirection: s.openingKachaPaise >= 0 ? 'we_owe' : 'they_owe',
        openingGstRupees: Math.abs(s.openingGstPaise) / 100,
        openingGstDirection: s.openingGstPaise >= 0 ? 'we_owe' : 'they_owe',
        openingBalanceDate: s.openingBalanceDate ?? '',
        active: s.active,
      },
    })
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <>
      <PartyManagerShell
        objectLabel="supplier"
        pluralLabel="suppliers"
        heading="Suppliers"
        rows={rows}
        isLoading={suppliersQuery.isLoading}
        isError={suppliersQuery.isError}
        getRowId={(row) => row.supplier.id}
        searchText={(row) => `${row.supplier.companyName} ${row.supplier.contactName} ${row.supplier.phone} ${row.supplier.city}`}
        isActive={(row) => row.supplier.active}
        sorts={SUPPLIER_SORTS}
        columns={SUPPLIER_COLUMNS}
        createLabel="Add supplier"
        onCreateClick={() => {
          setFormError('')
          setDialogTarget({ summary: null, formState: emptySupplierFormState() })
        }}
        onEdit={(row) => {
          setFormError('')
          openEditDialog(row)
        }}
        onToggleActive={(row, nextActive) => {
          toggleMutation.mutate({ supplierId: row.supplier.id, nextActive })
        }}
        togglePending={toggleMutation.isPending}
        tableMinWidth="880px"
        headingBadges={
          <>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{kpis.total}</span>
            <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">
              {kpis.withDue} owed {formatPaiseInr(kpis.totalDuePaise)}
            </span>
          </>
        }
        statusLine={statusText ? <p role="status" aria-live="polite" className="text-xs text-slate-500">{statusText}</p> : null}
        emptyHint="No suppliers yet. Use “Add supplier” above to create the first one."
      />
      {dialogTarget && (
        <SupplierFormModal
          formState={dialogTarget.formState}
          isSaving={isSaving}
          errorText={formError}
          onChange={(next) => setDialogTarget({ ...dialogTarget, formState: next })}
          onClose={() => setDialogTarget(null)}
          onSave={() => {
            if (dialogTarget.summary) {
              updateMutation.mutate({ supplierId: dialogTarget.summary.supplier.id, formState: dialogTarget.formState })
            } else {
              createMutation.mutate(dialogTarget.formState)
            }
          }}
        />
      )}
    </>
  )
}
