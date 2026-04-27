import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit3, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { createCustomer, loadCustomersWithLedgerContext, toggleCustomerActive, updateCustomer } from '@/data/customers'
import { DASHBOARD_QUERY_KEY } from '@/domain/dashboard'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/customers')({
  component: CustomersPage,
})

const CUSTOMER_QUERY_KEY = ['customers-ledger'] as const

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required'),
  openingBalance: z.number(),
  active: z.boolean(),
  phone: z.string().optional(),
  gstin: z.string().optional(),
  address: z.string().optional(),
  creditLimit: z.number().optional(),
  note: z.string().optional(),
})

type CustomerFormState = {
  id: string | null
  name: string
  openingBalance: number
  active: boolean
  phone: string
  gstin: string
  address: string
  creditLimit: number
  note: string
}

const defaultCustomerFormState = (): CustomerFormState => ({
  id: null,
  name: '',
  openingBalance: 0,
  active: true,
  phone: '',
  gstin: '',
  address: '',
  creditLimit: 0,
  note: '',
})

function CustomersPage() {
  const queryClient = useQueryClient()
  const [statusText, setStatusText] = useState('')
  const [showMoreDetails, setShowMoreDetails] = useState(false)
  const [formState, setFormState] = useState<CustomerFormState>(defaultCustomerFormState())

  const customersQuery = useQuery({
    queryKey: CUSTOMER_QUERY_KEY,
    queryFn: loadCustomersWithLedgerContext,
  })

  const filteredRows = customersQuery.data ?? []
  const summary = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.opening += row.openingBalance
        acc.billed += row.billedTotal
        acc.paid += row.paidTotal
        acc.net += row.netBalance
        if (row.lastBillDate > acc.lastBillDate) acc.lastBillDate = row.lastBillDate
        if (row.lastPaymentDate > acc.lastPaymentDate) acc.lastPaymentDate = row.lastPaymentDate
        return acc
      },
      { opening: 0, billed: 0, paid: 0, net: 0, lastBillDate: '', lastPaymentDate: '' },
    )
  }, [filteredRows])

  const createOrUpdateMutation = useMutation({
    mutationFn: async () => {
      const parsed = customerSchema.safeParse({
        ...formState,
        name: formState.name.trim(),
      })
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Customer validation failed')
      }

      const payload = {
        name: parsed.data.name,
        openingBalance: parsed.data.openingBalance,
        active: parsed.data.active,
        phone: parsed.data.phone ?? '',
        gstin: parsed.data.gstin ?? '',
        address: parsed.data.address ?? '',
        creditLimit: parsed.data.creditLimit ?? 0,
        note: parsed.data.note ?? '',
      }

      if (formState.id) {
        await updateCustomer(formState.id, payload)
      } else {
        await createCustomer(payload)
      }
    },
    onSuccess: async () => {
      setStatusText(formState.id ? 'Customer updated successfully' : 'Customer created successfully')
      resetForm()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
      ])
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : 'Failed to save customer')
    },
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
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : 'Failed to update customer status')
    },
  })

  function resetForm() {
    setFormState(defaultCustomerFormState())
    setShowMoreDetails(false)
  }

  function openEditForm(row: (typeof filteredRows)[number]) {
    setFormState({
      id: row.customer.id,
      name: row.customer.name,
      openingBalance: row.customer.openingBalance,
      active: row.customer.active,
      phone: row.customer.phone ?? '',
      gstin: row.customer.gstin ?? '',
      address: row.customer.address ?? '',
      creditLimit: row.customer.creditLimit ?? 0,
      note: row.customer.note ?? '',
    })
  }

  const canSubmitForm = formState.name.trim().length > 0 && !createOrUpdateMutation.isPending

  return (
    <div className="w-full space-y-8 px-4 pb-10 pt-4 md:px-6">
      {statusText && <p className="text-xs text-slate-500" role="status" aria-live="polite">{statusText}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">{formState.id ? 'Edit Customer' : 'Add Customer'}</h3>
            <div className="flex items-center gap-2">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={() => setShowMoreDetails((prev) => !prev)}>
                {showMoreDetails ? 'Less details' : 'More details'}
              </button>
              {formState.id && (
                <button type="button" className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={resetForm}>
                  Switch to New
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
            <Field label="Name *">
              <input className={inputClass} type="text" value={formState.name} onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))} />
            </Field>
            <Field label="Phone">
              <input className={inputClass} type="text" value={formState.phone} onChange={(event) => setFormState((prev) => ({ ...prev, phone: event.target.value }))} />
            </Field>
            <Field label="Opening Balance">
              <input className={inputClass} type="number" value={formState.openingBalance || ''} onChange={(event) => setFormState((prev) => ({ ...prev, openingBalance: Number(event.target.value || 0) }))} />
            </Field>
            <Field label="Status">
              <select className={inputClass} value={formState.active ? 'yes' : 'no'} onChange={(event) => setFormState((prev) => ({ ...prev, active: event.target.value === 'yes' }))}>
                <option value="yes">Active</option>
                <option value="no">Inactive</option>
              </select>
            </Field>
            <div className="flex items-end gap-2 xl:col-span-1">
              <button type="button" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50" onClick={resetForm}>
                Clear
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-1 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void createOrUpdateMutation.mutateAsync()}
                disabled={!canSubmitForm}
              >
                <Plus size={14} />
                {createOrUpdateMutation.isPending ? 'Saving...' : formState.id ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
          {showMoreDetails && (
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
              <Field label="GSTIN (optional)">
                <input className={inputClass} type="text" value={formState.gstin} onChange={(event) => setFormState((prev) => ({ ...prev, gstin: event.target.value }))} />
              </Field>
              <Field label="Credit Limit (optional)">
                <input className={inputClass} type="number" value={formState.creditLimit || ''} onChange={(event) => setFormState((prev) => ({ ...prev, creditLimit: parseNonNegativeNumber(event.target.value) }))} />
              </Field>
              <Field label="Address (optional)">
                <input className={inputClass} type="text" value={formState.address} onChange={(event) => setFormState((prev) => ({ ...prev, address: event.target.value }))} />
              </Field>
              <Field label="Note (optional)">
                <input className={inputClass} type="text" value={formState.note} onChange={(event) => setFormState((prev) => ({ ...prev, note: event.target.value }))} />
              </Field>
            </div>
          )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Metric label="Opening" value={formatInrInteger(summary.opening)} />
          <Metric label="Billed" value={formatInrInteger(summary.billed)} />
          <Metric label="Paid" value={formatInrInteger(summary.paid)} />
          <Metric label={summary.net >= 0 ? 'Due' : 'Advance'} value={formatInrInteger(Math.abs(summary.net))} emphasized />
          <Metric label="Last" value={formatFullDate(latestDate(summary.lastBillDate, summary.lastPaymentDate) || '')} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Customer List</h3>
        {customersQuery.isLoading && <p className="text-sm text-slate-500">Loading customers...</p>}
        {customersQuery.isError && <p className="text-sm text-red-600">Unable to load customers.</p>}
        {!customersQuery.isLoading && !customersQuery.isError && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Phone</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">GSTIN</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Opening Balance</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Active</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td className="px-3 py-8 text-center text-sm text-slate-500" colSpan={6}>
                      <p className="font-medium text-slate-700">No customers yet.</p>
                      <p className="mt-1">Create your first customer to start billing and ledger tracking.</p>
                      <button
                        type="button"
                        className="mt-3 inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                        onClick={() => {
                          resetForm()
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                      >
                        <Plus size={14} />
                        Add Customer
                      </button>
                    </td>
                  </tr>
                )}
                {filteredRows.map((row, index) => (
                  <tr key={row.customer.id} className={`border-t border-slate-100 transition hover:bg-slate-50 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                    <td className="px-3 py-3">
                      <Link to="/ledger" search={{ customerId: row.customer.id, focus: '' }} className="text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline">
                        {row.customer.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-700">{row.customer.phone || '-'}</td>
                    <td className="px-3 py-3 text-sm text-slate-700">{row.customer.gstin || '-'}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-800">{formatInrInteger(row.openingBalance)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${row.customer.active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                        {row.customer.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          onClick={() => openEditForm(row)}
                        >
                          <Edit3 size={12} />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          onClick={() => void toggleMutation.mutateAsync({ id: row.customer.id, nextActive: !row.customer.active })}
                        >
                          {row.customer.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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

function Metric({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-md border p-2.5 ${emphasized ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono tabular-nums ${emphasized ? 'text-lg font-bold text-amber-800' : 'text-base font-semibold text-slate-900'}`}>{value}</p>
    </div>
  )
}

function latestDate(a: string, b: string) {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
