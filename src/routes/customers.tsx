import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Edit3, Phone, Plus, Search, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { DateInput } from '@/components/ui/date-input'
import { createCustomer, loadCustomersWithLedgerContext, toggleCustomerActive, updateCustomer } from '@/data/customers'
import type { CustomerLedgerSummary } from '@/domain/customers'
import { DASHBOARD_QUERY_KEY } from '@/domain/dashboard'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/customers')({
  component: CustomersPage,
})

const CUSTOMER_QUERY_KEY = ['customers-ledger'] as const

const customerSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required'),
  name: z.string().trim().min(1, 'Customer name is required'),
  openingBalance: z.number(),
  openingBalanceDate: z.string().optional(),
  active: z.boolean(),
  phone: z.string().optional(),
  gstin: z.string().optional(),
  address: z.string().optional(),
  creditLimit: z.number().optional(),
  note: z.string().optional(),
})

type CustomerFormState = {
  id: string | null
  companyName: string
  name: string
  openingBalance: number
  openingBalanceDate: string
  active: boolean
  phone: string
  gstin: string
  address: string
  creditLimit: number
  note: string
}

const defaultCustomerFormState = (): CustomerFormState => ({
  id: null,
  companyName: '',
  name: '',
  openingBalance: 0,
  openingBalanceDate: '',
  active: true,
  phone: '',
  gstin: '',
  address: '',
  creditLimit: 0,
  note: '',
})

type BalanceFilter = 'all' | 'due' | 'advance' | 'inactive'
type SortKey = 'name' | 'outstanding' | 'billed' | 'activity'

const FILTER_LABEL: Record<BalanceFilter, string> = {
  all: 'All',
  due: 'With due',
  advance: 'Advance',
  inactive: 'Inactive',
}

function CustomersPage() {
  const queryClient = useQueryClient()
  const [statusText, setStatusText] = useState('')
  const [query, setQuery] = useState('')
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('outstanding')
  const [sortDesc, setSortDesc] = useState(true)
  const [dialogState, setDialogState] = useState<CustomerFormState | null>(null)

  const customersQuery = useQuery({
    queryKey: CUSTOMER_QUERY_KEY,
    queryFn: loadCustomersWithLedgerContext,
  })
  const allRows = customersQuery.data ?? []

  const kpis = useMemo(() => {
    const active = allRows.filter((row) => row.customer.active).length
    const withDue = allRows.filter((row) => row.dueAmount > 0)
    return {
      total: allRows.length,
      active,
      withDue: withDue.length,
      totalDue: withDue.reduce((sum, row) => sum + row.dueAmount, 0),
    }
  }, [allRows])

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    let rows = allRows
    if (needle) {
      rows = rows.filter((row) =>
        `${row.customer.companyName} ${row.customer.name} ${row.customer.phone}`.toLowerCase().includes(needle),
      )
    }
    if (balanceFilter === 'due') rows = rows.filter((row) => row.dueAmount > 0)
    else if (balanceFilter === 'advance') rows = rows.filter((row) => row.advanceAmount > 0)
    else if (balanceFilter === 'inactive') rows = rows.filter((row) => !row.customer.active)

    const direction = sortDesc ? -1 : 1
    const lastActivity = (row: CustomerLedgerSummary) =>
      row.lastBillDate > row.lastPaymentDate ? row.lastBillDate : row.lastPaymentDate
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') {
        return direction * formatCustomerDisplayName(a.customer.companyName, a.customer.name).localeCompare(formatCustomerDisplayName(b.customer.companyName, b.customer.name))
      }
      if (sortKey === 'billed') return direction * (a.billedTotal - b.billedTotal)
      if (sortKey === 'activity') return direction * lastActivity(a).localeCompare(lastActivity(b))
      return direction * (a.netBalance - b.netBalance)
    })
  }, [allRows, balanceFilter, query, sortDesc, sortKey])

  const createOrUpdateMutation = useMutation({
    mutationFn: async (formState: CustomerFormState) => {
      const parsed = customerSchema.safeParse({
        ...formState,
        companyName: formState.companyName.trim(),
        name: formState.name.trim(),
      })
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Customer validation failed')
      }
      const payload = {
        companyName: parsed.data.companyName,
        name: parsed.data.name,
        openingBalance: parsed.data.openingBalance,
        openingBalanceDate: parsed.data.openingBalanceDate ?? '',
        active: parsed.data.active,
        phone: parsed.data.phone ?? '',
        gstin: parsed.data.gstin ?? '',
        address: parsed.data.address ?? '',
        creditLimit: parsed.data.creditLimit ?? 0,
        note: parsed.data.note ?? '',
      }
      if (formState.id) await updateCustomer(formState.id, payload)
      else await createCustomer(payload)
      return formState.id
    },
    onSuccess: async (updatedId) => {
      setStatusText(updatedId ? 'Customer updated.' : 'Customer created.')
      setDialogState(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
      ])
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, nextActive }: { id: string; nextActive: boolean }) => {
      await toggleCustomerActive(id, nextActive)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
      ])
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  function openEditDialog(row: CustomerLedgerSummary) {
    setDialogState({
      id: row.customer.id,
      companyName: row.customer.companyName || row.customer.name,
      name: row.customer.name,
      openingBalance: row.customer.openingBalance,
      openingBalanceDate: row.customer.openingBalanceDate ?? '',
      active: row.customer.active,
      phone: row.customer.phone ?? '',
      gstin: row.customer.gstin ?? '',
      address: row.customer.address ?? '',
      creditLimit: row.customer.creditLimit ?? 0,
      note: row.customer.note ?? '',
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
      {/* Toolbar: KPIs, search, filters, add */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Customers</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{kpis.total}</span>
            <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">
              {kpis.withDue} owe {formatInrInteger(kpis.totalDue)}
            </span>
          </div>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
            onClick={() => setDialogState(defaultCustomerFormState())}
          >
            <Plus size={14} /> Add Customer
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search name, company, or phone..."
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            {(Object.keys(FILTER_LABEL) as BalanceFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`rounded-md px-3 py-1.5 transition ${balanceFilter === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                onClick={() => setBalanceFilter(key)}
              >
                {FILTER_LABEL[key]}
              </button>
            ))}
          </div>
          {statusText && <p className="text-xs text-slate-500" role="status" aria-live="polite">{statusText}</p>}
        </div>
      </section>

      {/* Customer table */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {customersQuery.isLoading && <p className="p-5 text-sm text-slate-500">Loading customers...</p>}
        {customersQuery.isError && <p className="p-5 text-sm text-red-600">Unable to load customers.</p>}
        {!customersQuery.isLoading && !customersQuery.isError && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                  <SortableTh label="Party" active={sortKey === 'name'} desc={sortDesc} onClick={() => toggleSort('name')} />
                  <th className="px-3 py-2.5">Contact</th>
                  <SortableTh label="Billed" active={sortKey === 'billed'} desc={sortDesc} onClick={() => toggleSort('billed')} align="right" />
                  <th className="px-3 py-2.5 text-right">Paid</th>
                  <SortableTh label="Outstanding" active={sortKey === 'outstanding'} desc={sortDesc} onClick={() => toggleSort('outstanding')} align="right" />
                  <SortableTh label="Last activity" active={sortKey === 'activity'} desc={sortDesc} onClick={() => toggleSort('activity')} align="right" />
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.length === 0 && (
                  <tr>
                    <td className="px-3 py-10 text-center text-sm text-slate-500" colSpan={7}>
                      {allRows.length === 0 ? (
                        <>
                          <p className="font-medium text-slate-700">No customers yet.</p>
                          <button
                            type="button"
                            className="mt-3 inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                            onClick={() => setDialogState(defaultCustomerFormState())}
                          >
                            <Plus size={14} /> Add your first customer
                          </button>
                        </>
                      ) : (
                        <>No customer matches this search or filter.</>
                      )}
                    </td>
                  </tr>
                )}
                {visibleRows.map((row) => {
                  const lastActivity = row.lastBillDate > row.lastPaymentDate ? row.lastBillDate : row.lastPaymentDate
                  return (
                    <tr key={row.customer.id} className={`transition hover:bg-slate-50/60 ${row.customer.active ? '' : 'opacity-60'}`}>
                      <td className="px-3 py-2.5">
                        <Link
                          to="/ledger"
                          search={{ customerId: row.customer.id, focus: '' }}
                          className="font-medium text-blue-700 hover:text-blue-800 hover:underline"
                        >
                          {formatCustomerDisplayName(row.customer.companyName, row.customer.name)}
                        </Link>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {row.customer.name}
                          {!row.customer.active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Inactive</span>}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        {row.customer.phone ? (
                          <a href={`tel:${row.customer.phone}`} className="inline-flex items-center gap-1 hover:text-blue-700">
                            <Phone size={11} /> {row.customer.phone}
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">{formatInrInteger(row.billedTotal)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">{formatInrInteger(row.paidTotal)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {row.dueAmount > 0 ? (
                          <span className="font-mono font-semibold tabular-nums text-rose-600">{formatInrInteger(row.dueAmount)}</span>
                        ) : row.advanceAmount > 0 ? (
                          <span className="font-mono font-semibold tabular-nums text-emerald-600">-{formatInrInteger(row.advanceAmount)}</span>
                        ) : (
                          <span className="text-xs font-medium text-slate-400">Clear</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-500">{lastActivity ? formatFullDate(lastActivity) : '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() => openEditDialog(row)}
                          >
                            <Edit3 size={12} /> Edit
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            onClick={() => void toggleMutation.mutateAsync({ id: row.customer.id, nextActive: !row.customer.active })}
                          >
                            {row.customer.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          Showing {visibleRows.length} of {allRows.length} customers
        </p>
      </section>

      {dialogState && (
        <CustomerDialog
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
    <th className={`px-3 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'}`} aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 uppercase tracking-[0.06em] transition hover:text-slate-800 ${active ? 'text-slate-900' : ''}`}
        onClick={onClick}
      >
        {label}
        {active && (desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  )
}

function CustomerDialog({
  formState,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  formState: CustomerFormState
  isSaving: boolean
  onChange: (next: CustomerFormState) => void
  onClose: () => void
  onSave: () => void
}) {
  const canSave = formState.companyName.trim().length > 0 && formState.name.trim().length > 0 && !isSaving

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={formState.id ? 'Edit customer' : 'Add customer'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-base font-semibold text-slate-900">{formState.id ? 'Edit Customer' : 'Add Customer'}</h3>
          <button type="button" aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Company Name *">
              <input className={inputClass} type="text" value={formState.companyName} onChange={(event) => onChange({ ...formState, companyName: event.target.value })} />
            </Field>
            <Field label="Customer Name *">
              <input className={inputClass} type="text" value={formState.name} onChange={(event) => onChange({ ...formState, name: event.target.value })} />
            </Field>
            <Field label="Opening Balance">
              <input className={inputClass} type="number" value={formState.openingBalance || ''} onChange={(event) => onChange({ ...formState, openingBalance: Number(event.target.value || 0) })} />
            </Field>
            <Field label="Opening Balance Date">
              <DateInput className={inputClass} value={formState.openingBalanceDate} onChange={(nextDate) => onChange({ ...formState, openingBalanceDate: nextDate })} />
            </Field>
            <Field label="Phone">
              <input className={inputClass} type="tel" value={formState.phone} onChange={(event) => onChange({ ...formState, phone: event.target.value })} />
            </Field>
            <Field label="Status">
              <select className={inputClass} value={formState.active ? 'yes' : 'no'} onChange={(event) => onChange({ ...formState, active: event.target.value === 'yes' })}>
                <option value="yes">Active</option>
                <option value="no">Inactive</option>
              </select>
            </Field>
            <Field label="GSTIN (optional)">
              <input className={inputClass} type="text" value={formState.gstin} onChange={(event) => onChange({ ...formState, gstin: event.target.value })} />
            </Field>
            <Field label="Credit Limit (optional)">
              <input className={inputClass} type="number" value={formState.creditLimit || ''} onChange={(event) => onChange({ ...formState, creditLimit: parseNonNegativeNumber(event.target.value) })} />
            </Field>
            <Field label="Address (optional)">
              <input className={inputClass} type="text" value={formState.address} onChange={(event) => onChange({ ...formState, address: event.target.value })} />
            </Field>
            <Field label="Note (optional)">
              <input className={inputClass} type="text" value={formState.note} onChange={(event) => onChange({ ...formState, note: event.target.value })} />
            </Field>
          </div>
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
            {isSaving ? 'Saving...' : formState.id ? 'Update Customer' : 'Save Customer'}
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
