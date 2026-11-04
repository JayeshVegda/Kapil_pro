import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import {
  addPurchaseBardanEntry,
  cancelPurchaseBill,
  cancelSupplierPayment,
  createSupplierPayment,
  loadAllSupplierPayments,
  loadPurchaseBill,
} from '@/data/suppliers'
import { validateManualPins } from '@/domain/supplier-settlement'
import { lineAmountPaise, rupeesToPaise } from '@/domain/supplier-units'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

const MODAL_INPUT =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
const MODAL_LABEL = 'text-xs font-medium text-slate-600'

/** Centered modal shell: Esc closes, Ctrl+Enter submits. */
function ModalShell({
  title,
  onClose,
  onSubmit,
  canSubmit,
  submitting,
  submitLabel,
  children,
  width = 'max-w-md',
}: {
  title: string
  onClose: () => void
  onSubmit: () => void
  canSubmit: boolean
  submitting: boolean
  submitLabel: string
  children: ReactNode
  width?: string
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSubmit && !submitting) {
        event.preventDefault()
        onSubmit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onSubmit, canSubmit, submitting])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${width} rounded-xl border border-slate-200 bg-white shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={15} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-3.5">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-2.5">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
            Close
          </button>
          {submitLabel && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit || submitting}
              className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Saving…' : submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ErrorText({ error }: { error?: string }) {
  if (!error) return null
  return <p className="text-xs text-rose-600">{error}</p>
}

// ---------------------------------------------------------------------------
// Add Bardan
// ---------------------------------------------------------------------------

export function AddBardanModal({ billId, onClose }: { billId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [kgStr, setKgStr] = useState('')
  const [method, setMethod] = useState<'deduct' | 'in_kind' | 'cash_back' | 'advance'>('deduct')
  const [lineId, setLineId] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [cashStr, setCashStr] = useState('')
  const [errorText, setErrorText] = useState('')

  const billQuery = useQuery({ queryKey: ['purchase-bill', billId], queryFn: () => loadPurchaseBill(billId) })
  const bill = billQuery.data
  const lines = bill?.lines ?? []
  const selectedLine = lines.find((l) => l.id === lineId) ?? lines[0]
  const grams = Math.round((parseFloat(kgStr) || 0) * 1000)
  const creditPaise = method === 'deduct' || method === 'advance' ? lineAmountPaise(grams, selectedLine?.rateMilli ?? 0) : 0
  const cashPaise = method === 'cash_back' ? rupeesToPaise(parseFloat(cashStr) || 0) : 0

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!bill) throw new Error('Bill still loading.')
      if (grams <= 0) throw new Error('Enter a valid bardan weight in kg.')
      await addPurchaseBardanEntry({
        billId: bill.bill.id,
        bardanG: grams,
        rateLineId: selectedLine?.id,
        rateMilli: selectedLine?.rateMilli ?? 0,
        method,
        creditPaise,
        cashAmountPaise: cashPaise,
        date: date || bill.bill.date,
        note: note.trim(),
      })
    },
    onSuccess: async () => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, bill?.bill.supplierId)
      await queryClient.invalidateQueries({ queryKey: ['purchase-bill', billId] })
      onClose()
    },
    onError: (err) => setErrorText(toUserMessage(err)),
  })

  return (
    <ModalShell
      title="Add Bardan"
      onClose={onClose}
      onSubmit={() => addMutation.mutate()}
      canSubmit={Boolean(bill) && grams > 0}
      submitting={addMutation.isPending}
      submitLabel="Save Bardan"
    >
      {!bill ? (
        <p className="text-xs text-slate-400">Loading bill…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1">
              <span className={MODAL_LABEL}>Bardan Weight (kg)</span>
              <input className={MODAL_INPUT} type="text" placeholder="e.g. 24.000" value={kgStr} onChange={(e) => setKgStr(e.target.value)} autoFocus />
            </label>
            <label className="flex flex-col gap-1">
              <span className={MODAL_LABEL}>Method</span>
              <select className={MODAL_INPUT} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="deduct">Deduct (credit kg × rate)</option>
                <option value="in_kind">In Kind (settled, nil)</option>
                <option value="cash_back">Cash Back (memo only)</option>
                <option value="advance">Advance (future pool payment)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={MODAL_LABEL}>Rate Line</span>
              <select className={MODAL_INPUT} value={selectedLine?.id ?? ''} onChange={(e) => setLineId(e.target.value)}>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.itemName} (₹{l.rateMilli / 1000}/kg)
                  </option>
                ))}
              </select>
            </label>
            {method === 'cash_back' ? (
              <label className="flex flex-col gap-1">
                <span className={MODAL_LABEL}>Cash Back Amount (₹)</span>
                <input className={MODAL_INPUT} type="text" placeholder="0" value={cashStr} onChange={(e) => setCashStr(e.target.value)} />
              </label>
            ) : (
              <label className="flex flex-col gap-1">
                <span className={MODAL_LABEL}>Date</span>
                <DateInput className={MODAL_INPUT} value={date || bill.bill.date} onChange={setDate} />
              </label>
            )}
          </div>
          <label className="flex flex-col gap-1">
            <span className={MODAL_LABEL}>Note</span>
            <input className={MODAL_INPUT} type="text" placeholder="e.g. 24 plastic bags returned" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="rounded-md border border-blue-100 bg-blue-50/60 px-2.5 py-1.5 text-xs text-slate-700">
            {method === 'deduct' && (
              <>
                Credit preview: <strong className="font-mono">{formatPaiseInr(creditPaise)}</strong> — deducted from the bill payable.
              </>
            )}
            {method === 'in_kind' && 'Settled in kind — no money effect.'}
            {method === 'cash_back' && (
              <>
                Memo cash back: <strong className="font-mono">{formatPaiseInr(cashPaise)}</strong> — no effect on payable.
              </>
            )}
            {method === 'advance' && (
              <>
                Creates an advance payment of <strong className="font-mono">{formatPaiseInr(creditPaise)}</strong> in the {bill.bill.pool} pool.
              </>
            )}
          </p>
          <ErrorText error={errorText} />
        </>
      )}
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Record Payment (single bill or multi-pin)
// ---------------------------------------------------------------------------

export type PaymentPinTarget = { billId: string; inNo: string; duePaise: number }

export function RecordPaymentModal({
  supplierId,
  supplierName,
  pool,
  pins,
  onClose,
}: {
  supplierId: string
  supplierName?: string
  pool: 'kacha' | 'gst'
  pins: PaymentPinTarget[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const totalDuePaise = pins.reduce((sum, pin) => sum + pin.duePaise, 0)
  const [amountStr, setAmountStr] = useState(() => (totalDuePaise > 0 ? String(totalDuePaise / 100) : ''))
  const [mode, setMode] = useState('cash')
  const [reference, setReference] = useState('')
  const [errorText, setErrorText] = useState('')

  const amountPaise = rupeesToPaise(parseFloat(amountStr) || 0)
  const needsReference = ['upi', 'rtgs', 'neft', 'cheque'].includes(mode)

  const allocationPlan = (() => {
    let remaining = amountPaise
    const plan: Array<{ billId: string; amountPaise: number }> = []
    for (const pin of pins) {
      if (remaining <= 0) break
      const applied = Math.min(pin.duePaise, remaining)
      plan.push({ billId: pin.billId, amountPaise: applied })
      remaining -= applied
    }
    return plan
  })()
  const pinnedTotalPaise = allocationPlan.reduce((sum, a) => sum + a.amountPaise, 0)
  const advancePaise = Math.max(0, amountPaise - pinnedTotalPaise)
  const validation = validateManualPins(
    pool,
    amountPaise,
    allocationPlan.map((a) => ({ billId: a.billId, billPool: pool, billDuePaise: pins.find((p) => p.billId === a.billId)?.duePaise ?? 0, pinnedPaise: a.amountPaise })),
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (amountPaise <= 0) throw new Error('Payment amount must be greater than zero.')
      if (!validation.valid) throw new Error(validation.error ?? 'Invalid allocation.')
      if (needsReference && !reference.trim()) throw new Error(`Reference is required for ${mode.toUpperCase()}.`)
      await createSupplierPayment({
        supplierId,
        date: getLocalIsoDate(),
        pool,
        kind: 'payment',
        amountPaise,
        mode,
        reference: reference.trim(),
        allocations: allocationPlan.filter((a) => a.amountPaise > 0),
      })
    },
    onSuccess: async () => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
      onClose()
    },
    onError: (err) => setErrorText(toUserMessage(err)),
  })

  return (
    <ModalShell
      title={`Record Payment${supplierName ? ` · ${supplierName}` : ''}`}
      onClose={onClose}
      onSubmit={() => saveMutation.mutate()}
      canSubmit={amountPaise > 0 && validation.valid && (!needsReference || reference.trim().length > 0)}
      submitting={saveMutation.isPending}
      submitLabel="Save Payment"
    >
      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-2.5 py-2 text-xs text-slate-600">
        {pins.length === 1 ? (
          <>
            Pinned to <span className="font-mono font-semibold text-slate-800">{pins[0].inNo || 'bill'}</span> · due{' '}
            <span className="font-mono">{formatPaiseInr(pins[0].duePaise)}</span>
          </>
        ) : (
          <>Pinned to {pins.length} bills · total due <span className="font-mono">{formatPaiseInr(totalDuePaise)}</span></>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className={MODAL_LABEL}>Amount (₹)</span>
          <input className={MODAL_INPUT} type="text" inputMode="decimal" placeholder="0" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} autoFocus />
        </label>
        <label className="flex flex-col gap-1">
          <span className={MODAL_LABEL}>Mode</span>
          <select className={MODAL_INPUT} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="rtgs">RTGS</option>
            <option value="neft">NEFT</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      {needsReference && (
        <label className="flex flex-col gap-1">
          <span className={MODAL_LABEL}>Reference / UTR (required)</span>
          <input className={MODAL_INPUT} type="text" value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      )}
      <p className="rounded-md border border-emerald-100 bg-emerald-50/60 px-2.5 py-1.5 text-xs text-slate-700">
        Pinned <strong className="font-mono">{formatPaiseInr(pinnedTotalPaise)}</strong>
        {advancePaise > 0 && (
          <>
            {' '}· advance <strong className="font-mono">{formatPaiseInr(advancePaise)}</strong>
          </>
        )}
      </p>
      <ErrorText error={errorText} />
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Settle to NIL
// ---------------------------------------------------------------------------

export function SettleToNilModal({
  supplierId,
  pool,
  billId,
  inNo,
  duePaise,
  onClose,
}: {
  supplierId: string
  pool: 'kacha' | 'gst'
  billId: string
  inNo: string
  duePaise: number
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [errorText, setErrorText] = useState('')

  const needsConfirm = duePaise > 50_000

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error('Reason is required.')
      if (duePaise <= 0) throw new Error('This bill is already settled.')
      await createSupplierPayment({
        supplierId,
        date: getLocalIsoDate(),
        pool,
        kind: 'settle_off',
        amountPaise: duePaise,
        mode: 'other',
        reference: reason.trim(),
        allocations: [{ billId, amountPaise: duePaise }],
      })
    },
    onSuccess: async () => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
      await queryClient.invalidateQueries({ queryKey: ['purchase-bill', billId] })
      onClose()
    },
    onError: (err) => setErrorText(toUserMessage(err)),
  })

  return (
    <ModalShell
      title="Settle to NIL"
      onClose={onClose}
      onSubmit={() => saveMutation.mutate()}
      canSubmit={reason.trim().length > 0 && duePaise > 0 && (!needsConfirm || confirmed)}
      submitting={saveMutation.isPending}
      submitLabel="Settle to NIL"
    >
      <p className="text-xs text-slate-600">
        Remaining due on <span className="font-mono font-semibold text-slate-800">{inNo || 'bill'}</span>:{' '}
        <span className="font-mono text-base font-bold text-rose-600">{formatPaiseInr(duePaise)}</span>
      </p>
      <p className="text-xs text-slate-500">
        Creates a settle-off payment of exactly this amount in the {pool} pool, pinned to the bill. The bill becomes NIL and the settle-off stays visible on the chitty and ledger.
      </p>
      {needsConfirm && (
        <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-2 text-xs text-amber-800">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          <span>This due is larger than ₹500 — confirm you want to write it off.</span>
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className={MODAL_LABEL}>Reason (required)</span>
        <input className={MODAL_INPUT} type="text" placeholder="e.g. rounding off small leftover" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      <ErrorText error={errorText} />
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Cancel bill
// ---------------------------------------------------------------------------

export function CancelBillModal({ billId, inNo, onClose }: { billId: string; inNo: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [errorText, setErrorText] = useState('')

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error('Cancellation reason is required.')
      await cancelPurchaseBill(billId, reason.trim())
    },
    onSuccess: async () => {
      await invalidateAfterSupplierPurchaseWrite(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['purchase-bill', billId] })
      onClose()
    },
    onError: (err) => setErrorText(toUserMessage(err)),
  })

  return (
    <ModalShell
      title={`Cancel Bill ${inNo || ''}`}
      onClose={onClose}
      onSubmit={() => cancelMutation.mutate()}
      canSubmit={reason.trim().length > 0}
      submitting={cancelMutation.isPending}
      submitLabel="Cancel Bill"
    >
      <p className="text-xs text-slate-600">
        Soft cancellation: the bill stays struck-through in the ledger for the audit trail and loses all money effect.
      </p>
      <label className="flex flex-col gap-1">
        <span className={MODAL_LABEL}>Reason (required)</span>
        <input className={MODAL_INPUT} type="text" placeholder="e.g. duplicate entry" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      <ErrorText error={errorText} />
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Payment details (view + cancel)
// ---------------------------------------------------------------------------

export function PaymentDetailsModal({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [cancelReason, setCancelReason] = useState('')
  const [showCancel, setShowCancel] = useState(false)
  const [errorText, setErrorText] = useState('')

  const paymentsQuery = useQuery({ queryKey: ['supplier-payments'], queryFn: loadAllSupplierPayments })
  const payment = (paymentsQuery.data ?? []).find((p) => p.id === paymentId)

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!cancelReason.trim()) throw new Error('Cancellation reason is required.')
      await cancelSupplierPayment(paymentId, cancelReason.trim())
    },
    onSuccess: async () => {
      await invalidateAfterSupplierPurchaseWrite(queryClient)
      onClose()
    },
    onError: (err) => setErrorText(toUserMessage(err)),
  })

  return (
    <ModalShell
      title="Payment Details"
      onClose={onClose}
      onSubmit={() => {}}
      canSubmit={false}
      submitting={false}
      submitLabel=""
      width="max-w-lg"
    >
      {!payment ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-2.5 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <Detail label="Date" value={payment.date ? formatFullDate(payment.date) : '—'} />
            <Detail label="Supplier" value={payment.supplierName} />
            <Detail label="Pool" value={payment.pool.toUpperCase()} />
            <Detail label="Kind" value={payment.kind.replace(/_/g, ' ')} />
            <Detail label="Mode" value={payment.mode.toUpperCase() || '—'} />
            <Detail label="Reference" value={payment.reference || '—'} />
            {payment.payeeName && <Detail label="Payee" value={payment.payeeName} />}
            <Detail label="Amount" value={formatPaiseInr(payment.amountPaise)} mono />
            <Detail label="Allocated" value={formatPaiseInr(payment.appliedPaise)} mono />
            <Detail label="Advance left" value={formatPaiseInr(payment.advancePaise)} mono />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Allocations</p>
            {payment.allocations.length === 0 ? (
              <p className="text-slate-400 italic">None pinned — applied by FIFO across bills.</p>
            ) : (
              <div className="space-y-0.5">
                {payment.allocations.map((alloc, index) => (
                  <p key={index} className="flex justify-between text-slate-600">
                    <span>
                      <span className="font-mono text-slate-800">{alloc.inNo || alloc.billId.slice(0, 8)}</span> · pinned
                    </span>
                    <span className="font-mono tabular-nums">{formatPaiseInr(alloc.amountPaise)}</span>
                  </p>
                ))}
              </div>
            )}
          </div>

          {payment.privateNote && <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">{payment.privateNote}</p>}

          {payment.cancelled ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-500">
              CANCELLED — {payment.cancelReason || 'no reason recorded'}
            </p>
          ) : showCancel ? (
            <div className="space-y-1.5 rounded-md border border-rose-200 bg-rose-50/60 p-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-700">Cancellation reason (required)</span>
                <input className={MODAL_INPUT} type="text" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCancel(false)} className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700">
                  Keep Payment
                </button>
                <button
                  type="button"
                  disabled={!cancelReason.trim() || cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate()}
                  className="rounded bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {cancelMutation.isPending ? 'Cancelling…' : 'Confirm Cancel'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <button type="button" onClick={() => setShowCancel(true)} className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100">
                Cancel Payment
              </button>
            </div>
          )}
          <ErrorText error={errorText} />
        </div>
      )}
    </ModalShell>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <span className="w-24 shrink-0 text-slate-400">{label}</span>
      <span className={`min-w-0 truncate text-slate-800 ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</span>
    </div>
  )
}
