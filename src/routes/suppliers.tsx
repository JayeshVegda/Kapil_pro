import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, BookOpen, Edit3, Phone, Plus, Search, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import {
  createSupplier,
  deactivateSupplier,
  loadSuppliersSummary,
  reactivateSupplier,
  updateSupplier,
  type SupplierSummary,
  type SupplierUpsertInput,
} from '@/data/suppliers'
import { formatFullDate } from '@/lib/date'
import { formatPaiseInr, parseNonNegativeNumber } from '@/lib/inr-format'
import { rupeesToPaise } from '@/domain/supplier-units'

export const Route = createFileRoute('/suppliers')({
  component: SuppliersPage,
})

const supplierSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required'),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  gstNo: z.string().optional(),
  city: z.string().optional(),
  notes: z.string().optional(),
  openingKachaRupees: z.number().nonnegative(),
  openingKachaDirection: z.enum(['we_owe', 'they_owe']),
  openingGstRupees: z.number().nonnegative(),
  openingGstDirection: z.enum(['we_owe', 'they_owe']),
  openingBalanceDate: z.string().optional(),
  active: z.boolean(),
})

type SupplierFormState = {
  id: string | null
  companyName: string
  contactName: string
  phone: string
  gstNo: string
  city: string
  notes: string
  openingKachaRupees: number
  openingKachaDirection: 'we_owe' | 'they_owe'
  openingGstRupees: number
  openingGstDirection: 'we_owe' | 'they_owe'
  openingBalanceDate: string
  active: boolean
}

const defaultSupplierFormState = (): SupplierFormState => ({
  id: null,
  companyName: '',
  contactName: '',
  phone: '',
  gstNo: '',
  city: '',
  notes: '',
  openingKachaRupees: 0,
  openingKachaDirection: 'we_owe',
  openingGstRupees: 0,
  openingGstDirection: 'we_owe',
  openingBalanceDate: '',
  active: true,
})

type FilterType = 'all' | 'due' | 'advance' | 'inactive'
type SortKey = 'name' | 'kacha' | 'gst' | 'advance' | 'outstanding' | 'activity' | 'bardan' | 'oldest'

const FILTER_LABEL: Record<FilterType, string> = {
  all: 'All',
  due: 'With Due',
  advance: 'Advance',
  inactive: 'Inactive',
}

function formatPaiseDisplay(paise: number): string {
  return formatPaiseInr(paise)
}

function SuppliersPage() {
  const queryClient = useQueryClient()
  const [statusText, setStatusText] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [sortKey, setSortKey] = useState<SortKey>('outstanding')
  const [sortDesc, setSortDesc] = useState(true)
  const [dialogState, setDialogState] = useState<SupplierFormState | null>(null)

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: loadSuppliersSummary,
  })
  const allRows = suppliersQuery.data ?? []

  const kpis = useMemo(() => {
    const active = allRows.filter((r) => r.supplier.active).length
    const withDue = allRows.filter((r) => r.outstandingPaise > 0)
    const totalDuePaise = withDue.reduce((sum, r) => sum + r.outstandingPaise, 0)
    const totalAdvancePaise = allRows.reduce((sum, r) => sum + r.advancePaise, 0)
    return {
      total: allRows.length,
      active,
      withDueCount: withDue.length,
      totalDuePaise,
      totalAdvancePaise,
    }
  }, [allRows])

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    let rows = allRows
    if (needle) {
      rows = rows.filter((r) =>
        `${r.supplier.companyName} ${r.supplier.contactName} ${r.supplier.city} ${r.supplier.phone}`
          .toLowerCase()
          .includes(needle),
      )
    }
    if (filter === 'due') rows = rows.filter((r) => r.outstandingPaise > 0)
    else if (filter === 'advance') rows = rows.filter((r) => r.advancePaise > 0)
    else if (filter === 'inactive') rows = rows.filter((r) => !r.supplier.active)

    const direction = sortDesc ? -1 : 1
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') {
        return direction * a.supplier.companyName.localeCompare(b.supplier.companyName)
      }
      if (sortKey === 'kacha') return direction * (a.kachaDuePaise - b.kachaDuePaise)
      if (sortKey === 'gst') return direction * (a.gstDuePaise - b.gstDuePaise)
      if (sortKey === 'advance') return direction * (a.advancePaise - b.advancePaise)
      if (sortKey === 'bardan') return direction * (a.bardanPendingCount - b.bardanPendingCount)
      if (sortKey === 'oldest') return direction * ((a.oldestDueDays ?? -1) - (b.oldestDueDays ?? -1))
      if (sortKey === 'activity') return direction * (a.lastActivityDate || '').localeCompare(b.lastActivityDate || '')
      return direction * (a.outstandingPaise - b.outstandingPaise)
    })
  }, [allRows, filter, query, sortDesc, sortKey])

  const totals = useMemo(() => {
    return visibleRows.reduce(
      (acc, r) => ({
        kachaDuePaise: acc.kachaDuePaise + r.kachaDuePaise,
        gstDuePaise: acc.gstDuePaise + r.gstDuePaise,
        advancePaise: acc.advancePaise + r.advancePaise,
        outstandingPaise: acc.outstandingPaise + r.outstandingPaise,
      }),
      { kachaDuePaise: 0, gstDuePaise: 0, advancePaise: 0, outstandingPaise: 0 },
    )
  }, [visibleRows])

  const createOrUpdateMutation = useMutation({
    mutationFn: async (formState: SupplierFormState) => {
      const parsed = supplierSchema.safeParse({
        ...formState,
        companyName: formState.companyName.trim(),
      })
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Supplier validation failed')
      }

      const kachaSign = parsed.data.openingKachaDirection === 'we_owe' ? 1 : -1
      const gstSign = parsed.data.openingGstDirection === 'we_owe' ? 1 : -1
      const openingKachaPaise = kachaSign * rupeesToPaise(parsed.data.openingKachaRupees)
      const openingGstPaise = gstSign * rupeesToPaise(parsed.data.openingGstRupees)

      const payload: SupplierUpsertInput = {
        companyName: parsed.data.companyName,
        contactName: parsed.data.contactName ?? '',
        phone: parsed.data.phone ?? '',
        gstNo: parsed.data.gstNo ?? '',
        city: parsed.data.city ?? '',
        notes: parsed.data.notes ?? '',
        openingKachaPaise,
        openingGstPaise,
        openingBalanceDate: parsed.data.openingBalanceDate ?? '',
        active: parsed.data.active,
      }

      if (formState.id) {
        await updateSupplier(formState.id, payload)
      } else {
        await createSupplier(payload)
      }
      return formState.id
    },
    onSuccess: async (updatedId) => {
      setStatusText(updatedId ? 'Supplier updated.' : 'Supplier created.')
      setDialogState(null)
      await invalidateAfterSupplierPurchaseWrite(queryClient, updatedId ?? undefined)
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      if (active) {
        await reactivateSupplier(id)
      } else {
        await deactivateSupplier(id)
      }
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
    const kachaVal = Math.abs(s.openingKachaPaise) / 100
    const gstVal = Math.abs(s.openingGstPaise) / 100
    setDialogState({
      id: s.id,
      companyName: s.companyName,
      contactName: s.contactName ?? '',
      phone: s.phone ?? '',
      gstNo: s.gstNo ?? '',
      city: s.city ?? '',
      notes: s.notes ?? '',
      openingKachaRupees: kachaVal,
      openingKachaDirection: s.openingKachaPaise >= 0 ? 'we_owe' : 'they_owe',
      openingGstRupees: gstVal,
      openingGstDirection: s.openingGstPaise >= 0 ? 'we_owe' : 'they_owe',
      openingBalanceDate: s.openingBalanceDate ?? '',
      active: s.active,
    })
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc((current) => !current)
    } else {
      setSortKey(key)
      setSortDesc(key !== 'name')
    }
  }

  return (
    <div className="w-full space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {/* Header & KPI Toolbar */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Suppliers</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              {kpis.total} Total ({kpis.active} active)
            </span>
            <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">
              {kpis.withDueCount} Owe {formatPaiseInr(kpis.totalDuePaise)}
            </span>
            {kpis.totalAdvancePaise > 0 && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                Advance {formatPaiseInr(kpis.totalAdvancePaise)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/purchase-bills/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Plus size={14} /> New Bill
            </Link>
            <Link
              to="/supplier-payments/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Plus size={14} /> New Payment
            </Link>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
              onClick={() => setDialogState(defaultSupplierFormState())}
            >
              <Plus size={14} /> Add Supplier
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search company, contact, city, phone..."
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            {(Object.keys(FILTER_LABEL) as FilterType[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`rounded-md px-3 py-1.5 transition ${
                  filter === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setFilter(key)}
              >
                {FILTER_LABEL[key]}
              </button>
            ))}
          </div>
          {statusText && (
            <p className="text-xs text-slate-500" role="status" aria-live="polite">
              {statusText}
            </p>
          )}
        </div>
      </section>

      {/* Suppliers Table */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {suppliersQuery.isLoading && <p className="p-5 text-sm text-slate-500">Loading suppliers...</p>}
        {suppliersQuery.isError && <p className="p-5 text-sm text-red-600">Unable to load suppliers.</p>}
        {!suppliersQuery.isLoading && !suppliersQuery.isError && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                  <SortableTh label="Company" active={sortKey === 'name'} desc={sortDesc} onClick={() => toggleSort('name')} />
                  <th className="px-3 py-2.5">City / Contact</th>
                  <SortableTh label="Kacha Due" active={sortKey === 'kacha'} desc={sortDesc} onClick={() => toggleSort('kacha')} align="right" />
                  <SortableTh label="GST Due" active={sortKey === 'gst'} desc={sortDesc} onClick={() => toggleSort('gst')} align="right" />
                  <SortableTh label="Advance" active={sortKey === 'advance'} desc={sortDesc} onClick={() => toggleSort('advance')} align="right" />
                  <SortableTh label="Net Owed" active={sortKey === 'outstanding'} desc={sortDesc} onClick={() => toggleSort('outstanding')} align="right" />
                  <SortableTh label="Bardan" active={sortKey === 'bardan'} desc={sortDesc} onClick={() => toggleSort('bardan')} align="right" />
                  <SortableTh label="Oldest Due" active={sortKey === 'oldest'} desc={sortDesc} onClick={() => toggleSort('oldest')} align="right" />
                  <SortableTh label="Last Activity" active={sortKey === 'activity'} desc={sortDesc} onClick={() => toggleSort('activity')} align="right" />
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.length === 0 && (
                  <tr>
                    <td className="px-3 py-10 text-center text-sm text-slate-500" colSpan={10}>
                      {allRows.length === 0 ? (
                        <>
                          <p className="font-medium text-slate-700">No suppliers registered yet.</p>
                          <button
                            type="button"
                            className="mt-3 inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                            onClick={() => setDialogState(defaultSupplierFormState())}
                          >
                            <Plus size={14} /> Add your first supplier
                          </button>
                        </>
                      ) : (
                        <>No supplier matches this search or filter.</>
                      )}
                    </td>
                  </tr>
                )}
                {visibleRows.map((row) => {
                  const s = row.supplier
                  return (
                    <tr key={s.id} className={`transition hover:bg-slate-50/60 ${s.active ? '' : 'opacity-60'}`}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Link
                            to="/supplier-ledger/$supplierId"
                            params={{ supplierId: s.id }}
                            className="font-medium text-blue-700 hover:text-blue-800 hover:underline"
                          >
                            {s.companyName}
                          </Link>
                          {!s.active && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                              Inactive
                            </span>
                          )}
                        </div>
                        {s.contactName && <p className="mt-0.5 text-xs text-slate-500">{s.contactName}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        <div>{s.city || '—'}</div>
                        {s.phone && (
                          <a href={`tel:${s.phone}`} className="mt-0.5 inline-flex items-center gap-1 text-slate-500 hover:text-blue-700">
                            <Phone size={10} /> {s.phone}
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                        {row.kachaDuePaise > 0 ? (
                          <span className="font-medium text-amber-700">{formatPaiseDisplay(row.kachaDuePaise)}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                        {row.gstDuePaise > 0 ? (
                          <span className="font-medium text-blue-700">{formatPaiseDisplay(row.gstDuePaise)}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {row.advancePaise > 0 ? (
                          <span className="font-medium text-emerald-600">{formatPaiseDisplay(row.advancePaise)}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {row.outstandingPaise > 0 ? (
                          <span className="font-semibold text-rose-600">{formatPaiseDisplay(row.outstandingPaise)}</span>
                        ) : (
                          <span className="text-xs font-medium text-slate-400">Nil</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {row.bardanPendingCount > 0 ? (
                          <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                            {row.bardanPendingCount} pending
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {row.oldestDueDays != null ? (
                          <span
                            className={
                              row.oldestDueDays > 10
                                ? 'font-bold text-rose-600'
                                : row.oldestDueDays >= 7
                                  ? 'font-semibold text-amber-600'
                                  : 'text-slate-700'
                            }
                          >
                            {row.oldestDueDays}d
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-500">
                        {row.lastActivityDate ? formatFullDate(row.lastActivityDate) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex gap-1.5">
                          <Link
                            to="/purchase-bills/new"
                            search={{ supplierId: s.id }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                          >
                            + Bill
                          </Link>
                          <Link
                            to="/supplier-payments/new"
                            search={{ supplierId: s.id }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          >
                            + Pay
                          </Link>
                          <Link
                            to="/supplier-ledger/$supplierId"
                            params={{ supplierId: s.id }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <BookOpen size={12} /> Ledger
                          </Link>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() => openEditDialog(row)}
                          >
                            <Edit3 size={12} /> Edit
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() => void toggleActiveMutation.mutateAsync({ id: s.id, active: !s.active })}
                          >
                            {s.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {visibleRows.length > 0 && (
                <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                  <tr>
                    <td className="px-3 py-3" colSpan={2}>
                      Total ({visibleRows.length} suppliers)
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-amber-800">
                      {formatPaiseDisplay(totals.kachaDuePaise)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-blue-800">
                      {formatPaiseDisplay(totals.gstDuePaise)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-700">
                      {formatPaiseDisplay(totals.advancePaise)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-rose-700">
                      {formatPaiseDisplay(totals.outstandingPaise)}
                    </td>
                    <td className="px-3 py-3" colSpan={4} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          Showing {visibleRows.length} of {allRows.length} suppliers
        </p>
      </section>

      {/* Add / Edit Dialog */}
      {dialogState && (
        <SupplierDialog
          formState={dialogState}
          isSaving={createOrUpdateMutation.isPending}
          onChange={setDialogState}
          onClose={() => setDialogState(null)}
          onSave={() => void createOrUpdateMutation.mutateAsync(dialogState)}
        />
      )}
    </div>
  )
}

function SortableTh({
  label,
  active,
  desc,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  desc: boolean
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`px-3 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'}`}
      aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        className={`inline-flex items-center gap-1 uppercase tracking-[0.06em] transition hover:text-slate-800 ${
          active ? 'text-slate-900' : ''
        }`}
        onClick={onClick}
      >
        {label}
        {active && (desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  )
}

function SupplierDialog({
  formState,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  formState: SupplierFormState
  isSaving: boolean
  onChange: (next: SupplierFormState) => void
  onClose: () => void
  onSave: () => void
}) {
  const canSave = formState.companyName.trim().length > 0 && !isSaving

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={formState.id ? 'Edit supplier' : 'Add supplier'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-base font-semibold text-slate-900">{formState.id ? 'Edit Supplier' : 'Add Supplier'}</h3>
          <button type="button" aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Company Name *">
                <input
                  className={inputClass}
                  type="text"
                  placeholder="e.g. Maruti Metals Jamnagar"
                  value={formState.companyName}
                  onChange={(e) => onChange({ ...formState, companyName: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Contact Person (optional)">
              <input
                className={inputClass}
                type="text"
                placeholder="e.g. Rajeshbhai"
                value={formState.contactName}
                onChange={(e) => onChange({ ...formState, contactName: e.target.value })}
              />
            </Field>
            <Field label="Phone (optional)">
              <input
                className={inputClass}
                type="tel"
                placeholder="10-digit mobile"
                value={formState.phone}
                onChange={(e) => onChange({ ...formState, phone: e.target.value })}
              />
            </Field>
            <Field label="City (optional)">
              <input
                className={inputClass}
                type="text"
                placeholder="Jamnagar"
                value={formState.city}
                onChange={(e) => onChange({ ...formState, city: e.target.value })}
              />
            </Field>
            <Field label="GSTIN (optional)">
              <input
                className={inputClass}
                type="text"
                placeholder="24AAAAA0000A1Z5"
                value={formState.gstNo}
                onChange={(e) => onChange({ ...formState, gstNo: e.target.value })}
              />
            </Field>
            <Field label="Status">
              <select
                className={inputClass}
                value={formState.active ? 'yes' : 'no'}
                onChange={(e) => onChange({ ...formState, active: e.target.value === 'yes' })}
              >
                <option value="yes">Active</option>
                <option value="no">Inactive</option>
              </select>
            </Field>
            <Field label="Opening Balance Date">
              <DateInput
                className={inputClass}
                value={formState.openingBalanceDate}
                onChange={(nextDate) => onChange({ ...formState, openingBalanceDate: nextDate })}
              />
            </Field>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Opening Balances</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Field label="Opening Kacha (₹)">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={formState.openingKachaRupees || ''}
                    onChange={(e) => onChange({ ...formState, openingKachaRupees: parseNonNegativeNumber(e.target.value) })}
                  />
                </Field>
                <div className="mt-1.5 flex gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="kachaDir"
                      checked={formState.openingKachaDirection === 'we_owe'}
                      onChange={() => onChange({ ...formState, openingKachaDirection: 'we_owe' })}
                    />
                    <span>We owe supplier</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="kachaDir"
                      checked={formState.openingKachaDirection === 'they_owe'}
                      onChange={() => onChange({ ...formState, openingKachaDirection: 'they_owe' })}
                    />
                    <span>They owe us (Adv)</span>
                  </label>
                </div>
              </div>

              <div>
                <Field label="Opening GST (₹)">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={formState.openingGstRupees || ''}
                    onChange={(e) => onChange({ ...formState, openingGstRupees: parseNonNegativeNumber(e.target.value) })}
                  />
                </Field>
                <div className="mt-1.5 flex gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="gstDir"
                      checked={formState.openingGstDirection === 'we_owe'}
                      onChange={() => onChange({ ...formState, openingGstDirection: 'we_owe' })}
                    />
                    <span>We owe supplier</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="gstDir"
                      checked={formState.openingGstDirection === 'they_owe'}
                      onChange={() => onChange({ ...formState, openingGstDirection: 'they_owe' })}
                    />
                    <span>They owe us (Adv)</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <Field label="Notes (optional)">
            <textarea
              rows={2}
              className="w-full rounded-md border border-slate-300 bg-white p-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="Terms, payment methods, bank details..."
              value={formState.notes}
              onChange={(e) => onChange({ ...formState, notes: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3.5">
          <button type="button" className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onSave}
            disabled={!canSave}
          >
            {isSaving ? 'Saving...' : formState.id ? 'Update Supplier' : 'Save Supplier'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
