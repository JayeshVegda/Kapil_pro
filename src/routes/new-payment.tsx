import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { loadCustomerPaymentLedger, loadPaymentCustomers, savePayment } from '@/data/payments'
import { DASHBOARD_QUERY_KEY } from '@/domain/dashboard'
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
  const [isQuickPaymentOpen, setIsQuickPaymentOpen] = useState(false)
  const [quickPaymentCommand, setQuickPaymentCommand] = useState('')

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
      await savePayment({
        customerId: parsed.data.customerId,
        customerName: selectedCustomer.name,
        date: parsed.data.date,
        amount: parsed.data.amount,
        mode: parsed.data.mode,
        note: parsed.data.note,
      })
    },
    onSuccess: async () => {
      setStatusText('Payment saved successfully')
      setAmount(0)
      setNote('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['payment-ledger-context', customerId, date] }),
      ])
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : 'Failed to save payment')
    },
  })

  const helperText = useMemo(() => {
    if (statusText) return statusText
    if (!customerId) return 'Select customer to load outstanding and payment adjustment preview'
    if (!amount || amount <= 0) return 'Enter payment amount to simulate oldest-first settlement'
    return 'Ready to save payment'
  }, [statusText, customerId, amount])

  function resetForm() {
    setDate(today)
    setCustomerId('')
    setMode('Cash')
    setAmount(0)
    setNote('')
    setStatusText('')
    setIsQuickPaymentOpen(false)
    setQuickPaymentCommand('')
  }

  function applyQuickPaymentCommand() {
    const parsed = parsePaymentCommand(quickPaymentCommand, customersQuery.data ?? [], today)
    if (!parsed.ok) {
      setStatusText(parsed.error)
      return
    }
    setCustomerId(parsed.customer.id)
    setAmount(parsed.amount)
    setMode(parsed.mode)
    setDate(parsed.date)
    setNote(parsed.note)
    setStatusText('Command applied. Review and save.')
    setIsQuickPaymentOpen(false)
    setQuickPaymentCommand('')
  }

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

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Payment Details</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Customer">
            <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={customersQuery.isLoading || customersQuery.isError}>
              <option value="">Select customer...</option>
              {(customersQuery.data ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
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
            <Metric label="Opening Balance" value={formatInrInteger(paymentPreview.openingBalance)} />
            <Metric label={paymentPreview.outstandingBeforePayment >= 0 ? 'Outstanding Before' : 'Advance Before'} value={formatInrInteger(Math.abs(paymentPreview.outstandingBeforePayment))} />
            <Metric label="Payment Applied" value={`- ${formatInrInteger(paymentPreview.paymentApplied)}`} />
            <Metric label={paymentPreview.outstandingAfterPayment >= 0 ? 'Outstanding After' : 'Advance After'} value={formatInrInteger(Math.abs(paymentPreview.outstandingAfterPayment))} />
          </div>
        )}
      </section>

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
                Apply to Payment Form
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

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'

function parsePaymentCommand(
  input: string,
  customers: Array<{ id: string; name: string }>,
  today: string,
):
  | { ok: true; customer: { id: string; name: string }; amount: number; mode: 'Cash' | 'Bank'; date: string; note: string }
  | { ok: false; error: string } {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'Type payment command first.' }
  const noteMatch = raw.match(/"([^"]*)"/)
  const note = noteMatch?.[1]?.trim() ?? ''
  const withoutNote = noteMatch ? raw.replace(noteMatch[0], '').trim() : raw
  const tokens = withoutNote.split(/\s+/).filter(Boolean)
  const offset = tokens[0]?.toLowerCase() === 'p' ? 1 : 0
  if (tokens.length < 2 + offset) return { ok: false, error: 'Use: party amount [mode] [date]' }
  const partyToken = tokens[0 + offset]
  const customer = resolveCustomer(partyToken, customers)
  if (!customer) return { ok: false, error: `Party not found: ${partyToken}` }
  const amount = parseAmountToken(tokens[1 + offset])
  if (!(amount > 0)) return { ok: false, error: 'Invalid payment amount' }

  let mode: 'Cash' | 'Bank' = 'Cash'
  let date = today
  for (const token of tokens.slice(2 + offset)) {
    const lower = token.toLowerCase()
    if (lower === 'cash') mode = 'Cash'
    else if (lower === 'bank' || lower === 'cheque') mode = 'Bank'
    else date = parseDateToken(lower, today)
  }

  return { ok: true, customer, amount, mode, date, note }
}

function resolveCustomer(token: string, customers: Array<{ id: string; name: string }>) {
  const exact = customers.find((c) => c.name.toLowerCase() === token.toLowerCase())
  if (exact) return exact
  const fuzzy = customers.find((c) => c.name.toLowerCase().includes(token.toLowerCase()))
  return fuzzy ?? null
}

function parseAmountToken(token: string) {
  const normalized = token.toLowerCase().replaceAll(',', '')
  if (normalized.endsWith('l')) return Number(normalized.slice(0, -1)) * 100000
  if (normalized.endsWith('c')) return Number(normalized.slice(0, -1)) * 10000000
  return Number(normalized)
}

function parseDateToken(token: string, today: string) {
  if (token === 'today' || token === '0') return today
  if (token === '-1' || token === 'yday' || token === 'yesterday') {
    const d = new Date(`${today}T00:00:00`)
    d.setDate(d.getDate() - 1)
    return getLocalIsoDate(d)
  }
  const m = token.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return token
}
