import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { SupplierFormModal, type SupplierFormState } from '@/components/suppliers/supplier-form-modal'
import { PurchasesShell } from '@/components/suppliers/purchases-shell'
import { RowMenu } from '@/components/ui/row-menu'
import {
  deactivateSupplier,
  createSupplier,
  loadSuppliersSummary,
  reactivateSupplier,
  updateSupplier,
  type SupplierSummary,
  type SupplierUpsertInput,
} from '@/data/suppliers'
import { rupeesToPaise } from '@/domain/supplier-units'
import { formatPaiseInr } from '@/lib/inr-format'

const searchSchema = z.object({
  supplier: z.string().optional(),
})

export const Route = createFileRoute('/suppliers')({
  validateSearch: searchSchema,
  component: SuppliersRoute,
})

function SuppliersRoute() {
  return (
    <PurchasesShell>
      <SuppliersPage />
    </PurchasesShell>
  )
}

function SuppliersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { supplier: supplierFilter } = Route.useSearch()
  const [dialogState, setDialogState] = useState<SupplierFormState | null>(null)
  const [errorText, setErrorText] = useState('')
  const [statusText, setStatusText] = useState('')

  const suppliersQuery = useQuery({ queryKey: ['suppliers'], queryFn: loadSuppliersSummary })
  const allRows = suppliersQuery.data ?? []
  const rows = supplierFilter ? allRows.filter((r) => r.supplier.id === supplierFilter) : allRows

  const totals = rows.reduce(
    (acc, r) => ({
      kachaDuePaise: acc.kachaDuePaise + r.kachaDuePaise,
      gstDuePaise: acc.gstDuePaise + r.gstDuePaise,
      advancePaise: acc.advancePaise + r.advancePaise,
      outstandingPaise: acc.outstandingPaise + r.outstandingPaise,
      bardanPending: acc.bardanPending + r.bardanPendingCount,
    }),
    { kachaDuePaise: 0, gstDuePaise: 0, advancePaise: 0, outstandingPaise: 0, bardanPending: 0 },
  )

  const createOrUpdateMutation = useMutation({
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
      if (formState.id) await updateSupplier(formState.id, payload)
      else await createSupplier(payload)
      return formState.id
    },
    onSuccess: async (id) => {
      setDialogState(null)
      setStatusText(id ? 'Supplier saved.' : 'Supplier saved.')
      await invalidateAfterSupplierPurchaseWrite(queryClient, id ?? undefined)
    },
    onError: (error) => setErrorText(toUserMessage(error)),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      if (active) await reactivateSupplier(id)
      else await deactivateSupplier(id)
      return id
    },
    onSuccess: async (id) => {
      setStatusText('Supplier status updated.')
      await invalidateAfterSupplierPurchaseWrite(queryClient, id)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  function openEditDialog(row: SupplierSummary) {
    const s = row.supplier
    setDialogState({
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
    })
  }

  return (
    <div className="min-w-0 px-3 pb-10 pt-2 sm:px-4">
      {/* Slim totals strip (top bar owns the title) */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          <span className="font-semibold text-slate-700">{rows.length}</span> supplier{rows.length === 1 ? '' : 's'}
          {' · '}Total owed <span className="font-semibold text-rose-600">{formatPaiseInr(totals.outstandingPaise)}</span>
          {totals.bardanPending > 0 && (
            <>
              {' · '}Bardan pending <span className="font-semibold text-amber-600">{totals.bardanPending}</span>
            </>
          )}
        </span>
        {statusText && <span className="text-slate-400">{statusText}</span>}
      </div>

      {/* Dense table */}
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[880px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5">Company</th>
              <th className="px-2 py-1.5">City / Contact</th>
              <th className="px-2 py-1.5 text-right">Kacha</th>
              <th className="px-2 py-1.5 text-right">GST</th>
              <th className="px-2 py-1.5 text-right">Advance</th>
              <th className="px-2 py-1.5 text-right">Net Owed</th>
              <th className="px-2 py-1.5 text-right">Last Activity</th>
              <th className="w-8 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const s = row.supplier
              return (
                <tr
                  key={s.id}
                  onClick={() => void navigate({ to: '/supplier-ledger/$supplierId', params: { supplierId: s.id } })}
                  className={`h-[34px] cursor-pointer transition hover:bg-slate-50 ${s.active ? '' : 'opacity-60'}`}
                >
                  <td className="sticky left-0 z-10 bg-white px-2 py-0 shadow-[1px_0_0_0_#e2e8f0]">
                    <span className="flex items-center gap-1.5">
                      {row.bardanPendingCount > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
                      <span className="font-medium text-slate-800">{s.companyName}</span>
                      {!s.active && <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-500">Inactive</span>}
                    </span>
                  </td>
                  <td className="px-2 py-0 text-slate-600">
                    {s.city || '—'}
                    {s.phone ? <span className="text-slate-400"> · {s.phone}</span> : null}
                  </td>
                  <td className="px-2 py-0 text-right font-mono tabular-nums text-amber-700">{row.kachaDuePaise > 0 ? formatPaiseInr(row.kachaDuePaise) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-2 py-0 text-right font-mono tabular-nums text-blue-700">{row.gstDuePaise > 0 ? formatPaiseInr(row.gstDuePaise) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-2 py-0 text-right font-mono tabular-nums text-emerald-700">{row.advancePaise > 0 ? formatPaiseInr(row.advancePaise) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-2 py-0 text-right font-mono font-semibold tabular-nums text-rose-600">{row.outstandingPaise > 0 ? formatPaiseInr(row.outstandingPaise) : <span className="font-normal text-slate-400">Nil</span>}</td>
                  <td className="px-2 py-0 text-right font-mono text-xs tabular-nums text-slate-500">{row.lastActivityDate ? row.lastActivityDate.slice(5) : '—'}</td>
                  <td className="px-2 py-0 text-right" onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      label="Supplier actions"
                      items={[
                        { label: 'Edit', onSelect: () => openEditDialog(row) },
                        {
                          label: s.active ? 'Deactivate' : 'Reactivate',
                          danger: s.active,
                          onSelect: () => toggleActiveMutation.mutate({ id: s.id, active: !s.active }),
                        },
                      ]}
                    />
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-xs italic text-slate-400">
                  {suppliersQuery.isLoading ? 'Loading…' : supplierFilter ? 'This supplier is filtered out — clear it in the rail.' : 'No suppliers yet. Add one from the rail.'}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50/80 font-semibold text-slate-700">
                <td className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-500" colSpan={2}>Totals ({rows.length})</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(totals.kachaDuePaise)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(totals.gstDuePaise)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(totals.advancePaise)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(totals.outstandingPaise)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {dialogState && (
        <SupplierFormModal
          formState={dialogState}
          isSaving={createOrUpdateMutation.isPending}
          errorText={errorText}
          onChange={setDialogState}
          onClose={() => setDialogState(null)}
          onSave={() => {
            setErrorText('')
            createOrUpdateMutation.mutate(dialogState)
          }}
        />
      )}
    </div>
  )
}
