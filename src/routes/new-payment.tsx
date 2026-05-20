import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterPaymentWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { ensurePaymentPersisted, loadCustomerPaymentLedger, loadPaymentCustomers, savePayment, type SavedPaymentReceipt } from '@/data/payments'
import type { TransactionsContext } from '@/data/transactions'
import { isOnOrBeforeDay } from '@/domain/financial-math'
import { compareBusinessDateThenCreatedDesc } from '@/domain/records'
import { PENDING_COMMAND_STORAGE_KEY, parseContextCommand } from '@/lib/commands'
import { formatFullDate } from '@/lib/date'
import { buildPaymentPreview } from '@/domain/payment-ledger'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/new-payment')({
  component: NewPaymentPage,
})

const submitPaymentSchema = z.object({
  customerId: z.string().trim().min(1, 'Please select a customer'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid payment date'),
  amount: z.number().positive('Payment amount must be greater than zero'),
  mode: z.enum(['Cash', 'Bank']),
  note: z.string().optional(),
})

function NewPaymentPage() {
  const queryClient = useQueryClient()
  const today = useMemo(() => getLocalIsoDate(), [])
  const [date, setDate] = useState(today)
  const [customerId, setCustomerId] = useState('')
  const [mode, setMode] = useState<'Cash' | 'Bank'>('Cash')
  const [amount, setAmount] = useState<number>(0)
  const [note, setNote] = useState('')
  const [statusText, setStatusText] = useState('')
  const [lastSavedPayment, setLastSavedPayment] = useState<SavedPaymentReceipt | null>(null)
  const [isQuickPaymentOpen, setIsQuickPaymentOpen] = useState(false)
  const [quickPaymentCommand, setQuickPaymentCommand] = useState('')
  const [isCommandConfirmOpen, setIsCommandConfirmOpen] = useState(false)

  const customersQuery = useQuery({
    queryKey: ['payment-customers'],
    queryFn: loadPaymentCustomers,
  })

  const selectedCustomer = (customersQuery.data ?? []).find((customer) => customer.id === customerId) ?? null

  const ledgerQuery = useQuery({
    queryKey: ['payment-ledger-context', customerId, date],
    enabled: Boolean(customerId && date),
    queryFn: () => loadCustomerPaymentLedger(customerId, date),
  })

  const paymentPreview = useMemo(() => {
    if (!ledgerQuery.data) return null
    return buildPaymentPreview({
      openingBalance: ledgerQuery.data.openingBalance,
      openingBalanceDate: ledgerQuery.data.openingBalanceDate,
      bills: ledgerQuery.data.bills,
      payments: ledgerQuery.data.payments,
      paymentAmount: amount,
      asOfDate: date,
    })
  }, [ledgerQuery.data, amount, date])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = submitPaymentSchema.safeParse({
        customerId,
        date,
        amount,
        mode,
        note,
      })
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Payment validation failed')
      }
      if (!selectedCustomer) {
        throw new Error('Please select a customer')
      }
      return savePayment({
        customerId: parsed.data.customerId,
        customerName: selectedCustomer.name,
        date: parsed.data.date,
        amount: parsed.data.amount,
        mode: parsed.data.mode,
        note: parsed.data.note,
      })
    },
    onSuccess: async (savedPayment) => {
      const persisted = await ensurePaymentPersisted(savedPayment.id)
      setLastSavedPayment(savedPayment)
      queryClient.setQueryData(['payment-ledger-context', customerId, date], (prev: unknown) => {
        if (!prev || typeof prev !== 'object') return prev
        const existing = prev as {
          customerId: string
          openingBalance: number
          openingBalanceDate: string
          customerName: string
          bills: Array<{
            id: string
            businessDate: string
            createdAt: string
            customerId: string
            customerName: string
            billNo: number
            bookNo: number
            total: number
            transport: number
            gstRate: number
            mktRate: number
            lrNo: string
            compactDetails: string
          }>
          payments: Array<{
            id: string
            businessDate: string
            createdAt: string
            customerId: string
            customerName: string
            amount: number
            mode: string
            note: string
          }>
        }
        if (savedPayment.customerId !== existing.customerId || savedPayment.date > date) return prev
        const alreadyPresent = existing.payments.some((payment) => payment.id === savedPayment.id)
        if (alreadyPresent) return prev
        return {
          ...existing,
          payments: [
            ...existing.payments,
            {
              id: savedPayment.id,
              businessDate: savedPayment.date,
              createdAt: new Date().toISOString(),
              customerId: savedPayment.customerId,
              customerName: savedPayment.customerName,
              amount: savedPayment.amount,
              mode: savedPayment.mode,
              note: savedPayment.note,
            },
          ],
        }
      })
      queryClient.setQueryData(['transactions-page'], (prev: TransactionsContext | undefined) => {
        if (!prev) return prev
        const alreadyPresent = prev.payments.some((payment) => payment.id === savedPayment.id)
        if (alreadyPresent) return prev
        return {
          ...prev,
          payments: [
            {
              id: savedPayment.id,
              businessDate: savedPayment.date,
              createdAt: new Date().toISOString(),
              customerId: savedPayment.customerId,
              customerName: savedPayment.customerName,
              amount: savedPayment.amount,
              mode: savedPayment.mode,
              note: savedPayment.note,
              date: savedPayment.date,
            },
            ...prev.payments,
          ],
        }
      })
      setAmount(0)
      setNote('')
      await invalidateAfterPaymentWrite(queryClient, customerId)
      const refreshed = await ledgerQuery.refetch()
      const visibleAfterRefresh = refreshed.data?.payments?.some((payment) => payment.id === savedPayment.id) ?? false
      if (!isOnOrBeforeDay(savedPayment.date, date)) {
        setStatusText(
          `Payment saved: ${formatInrInteger(savedPayment.amount)} for ${savedPayment.customerName}. It is after current as-of date filter, so totals exclude it.`,
        )
      } else if (!visibleAfterRefresh || !persisted) {
        setStatusText(
          `Payment saved: ${formatInrInteger(savedPayment.amount)} for ${savedPayment.customerName}. Syncing latest ledger...`,
        )
      } else {
        setStatusText(`Payment saved: ${formatInrInteger(savedPayment.amount)} for ${savedPayment.customerName}`)
      }
    },
    onError: (error) => {
      setStatusText(toUserMessage(error))
    },
  })

  const helperText = useMemo(() => {
    if (statusText) return statusText
    if (!customerId) return 'Select customer to load outstanding and payment adjustment preview'
    if (!amount || amount <= 0) return 'Enter payment amount to simulate oldest-first settlement'
    return 'Ready to save payment'
  }, [statusText, customerId, amount])

  const recentPayments = useMemo(() => {
    const base = ledgerQuery.data?.payments ?? []
    const merged = [...base]
    if (
      lastSavedPayment &&
      lastSavedPayment.customerId === customerId &&
      isOnOrBeforeDay(lastSavedPayment.date, date) &&
      !merged.some((payment) => payment.id === lastSavedPayment.id)
    ) {
      merged.push({
        id: lastSavedPayment.id,
        businessDate: lastSavedPayment.date,
        createdAt: new Date().toISOString(),
        customerId: lastSavedPayment.customerId,
        customerName: lastSavedPayment.customerName,
        amount: lastSavedPayment.amount,
        mode: lastSavedPayment.mode,
        note: lastSavedPayment.note,
      })
    }
    return merged.sort(compareBusinessDateThenCreatedDesc).slice(0, 6)
  }, [ledgerQuery.data?.payments, lastSavedPayment, customerId, date])

  const currentOutstanding = useMemo(() => {
    if (!ledgerQuery.data) return null
    const preview = buildPaymentPreview({
      openingBalance: ledgerQuery.data.openingBalance,
      openingBalanceDate: ledgerQuery.data.openingBalanceDate,
      bills: ledgerQuery.data.bills,
      payments: ledgerQuery.data.payments,
      paymentAmount: 0,
      asOfDate: date,
    })
    return preview.outstandingBeforePayment
  }, [ledgerQuery.data, date])

  function resetForm() {
    setDate(today)
    setCustomerId('')
    setMode('Cash')
    setAmount(0)
    setNote('')
    setStatusText('')
    setIsQuickPaymentOpen(false)
    setQuickPaymentCommand('')
    setIsCommandConfirmOpen(false)
  }

  function applyPaymentCommand(input: string) {
    const parsed = parseContextCommand(input, 'payment', {
      customers: customersQuery.data ?? [],
      today,
    })
    if (!parsed.ok) {
      setStatusText(parsed.error)
      return
    }
    if (parsed.command.kind !== 'payment') {
      setStatusText('This command is not a payment command.')
      return
    }
    setCustomerId(parsed.command.customer.id)
    setAmount(parsed.command.amount)
    setMode(parsed.command.mode)
    setDate(parsed.command.date)
    setNote(parsed.command.note)
    setStatusText(`Command ready: ${parsed.command.customer.name} | ${formatInrInteger(parsed.command.amount)} | ${parsed.command.mode}`)
    setIsQuickPaymentOpen(false)
    setQuickPaymentCommand('')
    setIsCommandConfirmOpen(true)
  }

  function applyQuickPaymentCommand() {
    applyPaymentCommand(quickPaymentCommand)
  }

  async function confirmCommandPayment() {
    try {
      await saveMutation.mutateAsync()
      setIsCommandConfirmOpen(false)
    } catch {
      // saveMutation sets visible status text.
    }
  }

  useEffect(() => {
    if (customersQuery.isLoading) return
    const raw = window.sessionStorage.getItem(PENDING_COMMAND_STORAGE_KEY)
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { kind?: string; body?: string; createdAt?: number }
      if (pending.kind !== 'payment' || !pending.body || Date.now() - Number(pending.createdAt ?? 0) > 60_000) return
      window.sessionStorage.removeItem(PENDING_COMMAND_STORAGE_KEY)
      applyPaymentCommand(pending.body)
    } catch {
      window.sessionStorage.removeItem(PENDING_COMMAND_STORAGE_KEY)
    }
  }, [customersQuery.isLoading, customersQuery.data])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setIsQuickPaymentOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!isCommandConfirmOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault()
        void confirmCommandPayment()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isCommandConfirmOpen, customerId, amount, mode, date, note, saveMutation.isPending])

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Payment Details</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Date">
            <DateInput className={inputClass} value={date} onChange={setDate} />
          </Field>
          <Field label="Customer">
            <SearchableCombobox
              options={customersQuery.data ?? []}
              value={customerId}
              onChange={(nextId) => {
                setCustomerId(nextId)
                setStatusText('')
              }}
              inputClassName={inputClass}
              placeholder="Search customer..."
              disabled={customersQuery.isLoading || customersQuery.isError}
              emptyText="No matching customer found."
              maxResults={50}
            />
          </Field>
          <Field label="Mode">
            <select className={inputClass} value={mode} onChange={(e) => setMode((e.target.value === 'Bank' ? 'Bank' : 'Cash'))}>
              <option value="Cash">Cash</option>
              <option value="Bank">Bank</option>
            </select>
          </Field>
          <Field label="Amount (INR)">
            <input className={inputClass} type="number" min={0} value={amount || ''} onChange={(e) => setAmount(parseNonNegativeNumber(e.target.value))} placeholder="0" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Note (optional)">
            <input className={inputClass} type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reference, cheque no., remark..." />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Live Summary</h2>
        {ledgerQuery.isLoading && <p className="text-sm text-slate-500">Loading customer ledger...</p>}
        {ledgerQuery.isError && <p className="text-sm text-red-600">Unable to load customer ledger.</p>}
        {!ledgerQuery.isLoading && !ledgerQuery.isError && !paymentPreview && (
          <p className="text-sm text-slate-500">Select a customer and payment date to view balances.</p>
        )}
        {paymentPreview && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Metric
              label={`Opening Balance (${paymentPreview.openingBalanceDate ? paymentPreview.openingBalanceDate : 'Opening'})`}
              value={formatInrInteger(paymentPreview.openingBalance)}
            />
            <Metric label={paymentPreview.outstandingBeforePayment >= 0 ? 'Outstanding Before' : 'Advance Before'} value={formatInrInteger(Math.abs(paymentPreview.outstandingBeforePayment))} />
            <Metric label="Payment Applied" value={`- ${formatInrInteger(paymentPreview.paymentApplied)}`} />
            <Metric label={paymentPreview.outstandingAfterPayment >= 0 ? 'Outstanding After' : 'Advance After'} value={formatInrInteger(Math.abs(paymentPreview.outstandingAfterPayment))} />
          </div>
        )}
      </section>

      {lastSavedPayment && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-emerald-800">Latest saved payment confirmed</p>
          <p className="mt-1 text-xs text-emerald-700">
            {formatFullDate(lastSavedPayment.date)} - {lastSavedPayment.customerName} - {formatInrInteger(lastSavedPayment.amount)} ({lastSavedPayment.mode})
          </p>
          {currentOutstanding !== null && (
            <p className="mt-1 text-xs text-emerald-700">
              Updated balance now: {formatInrInteger(Math.abs(currentOutstanding))} {currentOutstanding >= 0 ? 'Outstanding' : 'Advance'}
            </p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Auto Adjustment Preview (Oldest First)</h2>
          {selectedCustomer && <span className="text-xs text-slate-500">Party: {selectedCustomer.name}</span>}
        </div>
        {!paymentPreview && <p className="text-sm text-slate-500">No allocation preview yet.</p>}
        {paymentPreview && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[920px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Due Ref</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Due Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Details</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Outstanding</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Paid Now</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {paymentPreview.lines.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-sm text-slate-500" colSpan={6}>
                      No outstanding dues for this customer up to selected date. Extra payment will be treated as advance.
                    </td>
                  </tr>
                )}
                {paymentPreview.lines.map((line) => (
                  <tr key={`${line.dueRef}-${line.dueDate}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-sm font-medium text-slate-800">{line.dueRef}</td>
                    <td className="px-3 py-2 text-sm text-slate-600">{line.dueDate}</td>
                    <td className="max-w-[420px] px-3 py-2 text-xs text-slate-700">{line.compactDetails}</td>
                    <td className="px-3 py-2 text-right text-sm font-mono text-slate-800">{formatInrInteger(line.dueAmount)}</td>
                    <td className="px-3 py-2 text-right text-sm font-mono text-emerald-700">{formatInrInteger(line.paidAmount)}</td>
                    <td className="px-3 py-2 text-right text-sm font-mono text-slate-800">{formatInrInteger(line.remainingAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent Payments (Selected Party)</h2>
        {!customerId && <p className="text-sm text-slate-500">Select customer to view recent payments.</p>}
        {customerId && recentPayments.length === 0 && <p className="text-sm text-slate-500">No payment history for selected date range.</p>}
        {recentPayments.length > 0 && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Ref</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Mode</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((payment) => (
                  <tr key={`${payment.id ?? 'na'}-${payment.businessDate}-${payment.amount}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-sm text-slate-700">{formatFullDate(payment.businessDate ?? payment.date ?? '')}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{(payment.id ?? '-').slice(0, 8)}</td>
                    <td className="px-3 py-2 text-sm text-slate-700">{payment.mode || '-'}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm text-slate-900">{formatInrInteger(payment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-500">{helperText}</span>
          <div className="flex-1" />
          <button type="button" className="px-1 py-1 text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline" onClick={resetForm}>
            Clear
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void saveMutation.mutateAsync()}
            disabled={saveMutation.isPending || !customerId || amount <= 0}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Payment'}
          </button>
        </div>
      </section>
      {isQuickPaymentOpen && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Payment Command (Alt + B)</h3>
              <button type="button" className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={() => setIsQuickPaymentOpen(false)}>
                Close
              </button>
            </div>
            <div className="space-y-2 px-4 py-4">
              <input
                autoFocus
                className={inputClass}
                value={quickPaymentCommand}
                onChange={(e) => setQuickPaymentCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    applyQuickPaymentCommand()
                  }
                }}
                placeholder='party amount [mode=Cash] [date=today|-1|DD-MM-YYYY] ["note"]'
              />
              <p className="text-xs text-slate-500">Default mode is Cash. Example: `sambhu 50000` or `sambhu 1.5l bank -1`</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setIsQuickPaymentOpen(false)}>
                Cancel
              </button>
              <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800" onClick={applyQuickPaymentCommand}>
                Review Payment
              </button>
            </div>
          </div>
        </div>
      )}
      {isCommandConfirmOpen && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Confirm Payment</h3>
              <p className="mt-1 text-xs text-slate-500">Ctrl+Enter confirms save</p>
            </div>
            <div className="space-y-2 px-4 py-4 text-sm text-slate-700">
              <ConfirmRow label="Party" value={selectedCustomer?.name ?? 'Unknown'} />
              <ConfirmRow label="Amount" value={formatInrInteger(amount)} />
              <ConfirmRow label="Mode" value={mode} />
              <ConfirmRow label="Date" value={formatFullDate(date)} />
              {paymentPreview && (
                <ConfirmRow
                  label={paymentPreview.outstandingAfterPayment >= 0 ? 'After Payment' : 'Advance After'}
                  value={formatInrInteger(Math.abs(paymentPreview.outstandingAfterPayment))}
                />
              )}
              {note && <ConfirmRow label="Note" value={note} />}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setIsCommandConfirmOpen(false)}>
                Back to Edit
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void confirmCommandPayment()}
                disabled={saveMutation.isPending || !customerId || amount <= 0}
              >
                {saveMutation.isPending ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  )
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md bg-slate-50 px-3 py-2">
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  )
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
