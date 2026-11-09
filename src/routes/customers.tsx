import { inputClass as baseInputClass } from '@/components/ui/form-control-classes'
import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { DateInput } from '@/components/ui/date-input'
import {
  PartyManagerShell,
  type PartyManagerColumn,
  type PartyManagerFilterGroup,
  type PartyManagerSort,
} from '@/components/ledger/party-manager-shell'
import { createCustomer, loadCustomersWithLedgerContext, toggleCustomerActive, updateCustomer } from '@/data/customers'
import type { CustomerLedgerSummary } from '@/domain/customers'
import { DASHBOARD_QUERY_KEY } from '@/domain/dashboard'
import { formatCustomerDisplayName, formatCustomerTypeLabel } from '@/lib/customer-display'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/customers')({
  beforeLoad: () => { throw redirect({ to: '/ledger', search: { tab: 'customers' } }) },
})

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
  custType: z.string().optional(),
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
  custType: string
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
  custType: '',
})

const CUSTOMER_QUERY_KEY = ['customers-ledger'] as const

function lastActivityOf(row: CustomerLedgerSummary) {
  return row.lastBillDate > row.lastPaymentDate ? row.lastBillDate : row.lastPaymentDate
}

// Adapter data for PartyManagerShell: sales floats, sorted name-ascending
// first-highlight by overdue money. Adapters only shape display; the shell
// owns no financial logic.
const CUSTOMER_SORTS: Array<PartyManagerSort<CustomerLedgerSummary>> = [
  { key: 'outstanding', label: 'Highest outstanding', compare: (a, b) => b.netBalance - a.netBalance },
  { key: 'name', label: 'Name A-Z', compare: (a, b) => formatCustomerDisplayName(a.customer.companyName, a.customer.name).localeCompare(formatCustomerDisplayName(b.customer.companyName, b.customer.name)) },
  { key: 'billed', label: 'Highest billed', compare: (a, b) => b.billedTotal - a.billedTotal },
  { key: 'activity', label: 'Recent activity', compare: (a, b) => lastActivityOf(b).localeCompare(lastActivityOf(a)) },
]

const CUSTOMER_FILTER_GROUPS: Array<PartyManagerFilterGroup<CustomerLedgerSummary>> = [
  {
    key: 'balance',
    ariaLabel: 'Balance filter',
    options: [
      { key: 'all', label: 'All', matches: () => true },
      { key: 'due', label: 'With due', matches: (row) => row.dueAmount > 0 },
      { key: 'advance', label: 'Advance', matches: (row) => row.advanceAmount > 0 },
    ],
  },
  {
    key: 'type',
    ariaLabel: 'Customer type filter',
    options: [
      { key: 'all', label: 'All types', matches: () => true },
      { key: 'unset', label: 'Type not set', matches: (row) => (row.customer.custType ?? '') === '' },
      { key: 'gas', label: 'Gas parts', matches: (row) => (row.customer.custType ?? '') === 'gas' },
      { key: 'electronic', label: 'Electronic parts', matches: (row) => (row.customer.custType ?? '') === 'electronic' },
      { key: 'both', label: 'Both', matches: (row) => (row.customer.custType ?? '') === 'both' },
    ],
  },
]

const CUSTOMER_COLUMNS: Array<PartyManagerColumn<CustomerLedgerSummary>> = [
  {
    key: 'party',
    header: 'Party',
    render: (row) => (
      <div>
        <div className="flex items-center gap-2">
          <Link
            to="/ledger"
            search={{ customerId: row.customer.id, focus: '' }}
            className="font-medium text-blue-700 hover:text-blue-800 hover:underline"
          >
            {formatCustomerDisplayName(row.customer.companyName, row.customer.name)}
          </Link>
          {row.customer.custType && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-slate-500">
              {formatCustomerTypeLabel(row.customer.custType)}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {row.customer.name}
          {!row.customer.active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-slate-500">Inactive</span>}
        </p>
      </div>
    ),
  },
  {
    key: 'contact',
    header: 'Contact',
    render: (row) =>
      row.customer.phone ? (
        <a href={`tel:${row.customer.phone}`} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-blue-700">
          <Phone size={11} /> {row.customer.phone}
        </a>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      ),
  },
  {
    key: 'billed',
    header: 'Billed',
    align: 'right',
    render: (row) => <span className="font-mono tabular-nums text-slate-700">{formatInrInteger(row.billedTotal)}</span>,
  },
  {
    key: 'paid',
    header: 'Paid',
    align: 'right',
    render: (row) => <span className="font-mono tabular-nums text-slate-700">{formatInrInteger(row.paidTotal)}</span>,
  },
  {
    key: 'outstanding',
    header: 'Outstanding',
    align: 'right',
    render: (row) =>
      row.dueAmount > 0 ? (
        <span className="font-mono font-semibold tabular-nums text-rose-600">{formatInrInteger(row.dueAmount)}</span>
      ) : row.advanceAmount > 0 ? (
        <span className="font-mono font-semibold tabular-nums text-emerald-600">-{formatInrInteger(row.advanceAmount)}</span>
      ) : (
        <span className="text-xs font-medium text-slate-400">Clear</span>
      ),
  },
  {
    key: 'activity',
    header: 'Last activity',
    align: 'right',
    render: (row) => {
      const lastActivity = lastActivityOf(row)
      return <span className="text-xs text-slate-500">{lastActivity ? formatFullDate(lastActivity) : '—'}</span>
    },
  },
]

export function CustomersPage() {
  const queryClient = useQueryClient()
  const [statusText, setStatusText] = useState('')
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
        custType: parsed.data.custType ?? '',
      }
      if (formState.id) await updateCustomer(formState.id, payload)
      else await createCustomer(payload)
      return formState.id
    },
    onSuccess: async (updatedId) => {
      setDialogState(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
      ])
      setStatusText(updatedId ? 'Customer updated.' : 'Customer created.')
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, nextActive }: { id: string; nextActive: boolean }) => {
      await toggleCustomerActive(id, nextActive)
    },
    onSuccess: async () => {
      setStatusText('')
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
      custType: row.customer.custType ?? '',
    })
  }

  return (
    <>
      <PartyManagerShell
        objectLabel="customer"
      pluralLabel="customers"
      heading="Customers"
      rows={allRows}
      isLoading={customersQuery.isLoading}
      isError={customersQuery.isError}
      getRowId={(row) => row.customer.id}
      searchText={(row) => `${row.customer.companyName} ${row.customer.name} ${row.customer.phone}`}
      isActive={(row) => row.customer.active}
      sorts={CUSTOMER_SORTS}
      filterGroups={CUSTOMER_FILTER_GROUPS}
      columns={CUSTOMER_COLUMNS}
      createLabel="Add customer"
      onCreateClick={() => setDialogState(defaultCustomerFormState())}
      onEdit={openEditDialog}
      onToggleActive={(row, nextActive) => {
        toggleMutation.mutate({ id: row.customer.id, nextActive })
      }}
      togglePending={toggleMutation.isPending}
      tableMinWidth="880px"
      headingBadges={
        <>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{kpis.total}</span>
          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">
            {kpis.withDue} owe {formatInrInteger(kpis.totalDue)}
          </span>
        </>
      }
      statusLine={statusText ? <p role="status" aria-live="polite" className="text-xs text-slate-500">{statusText}</p> : null}
      emptyHint="No customers yet. Use “Add customer” above to create the first one."
      />
      {dialogState && (
        <CustomerDialog
          formState={dialogState}
          isSaving={createOrUpdateMutation.isPending}
          onChange={setDialogState}
          onClose={() => setDialogState(null)}
          onSave={() => void createOrUpdateMutation.mutateAsync(dialogState)}
        />
      )}
    </>
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
            ✕
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
            <Field label="Type">
              <select className={inputClass} value={formState.custType} onChange={(event) => onChange({ ...formState, custType: event.target.value })}>
                <option value="">Not set</option>
                <option value="gas">Gas Parts</option>
                <option value="electronic">Electronic Parts</option>
                <option value="both">Both</option>
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

const inputClass = `${baseInputClass} h-10`
