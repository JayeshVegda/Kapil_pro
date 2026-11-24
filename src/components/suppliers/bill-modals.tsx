import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import {
  addPurchaseBardanEntry,
  cancelPurchaseBill,
  cancelSupplierPayment,
  createSupplierPayment,
} from '@/data/suppliers'
import { purchaseBillQueryOptions, supplierContextQueryOptions, supplierPaymentsQueryOptions } from '@/data/purchase-queries'
import { validateManualPins } from '@/domain/supplier-settlement'
import { computeBillNet } from '@/domain/supplier-purchases'
import { buildSupplierPaymentWorkflow, prepareSupplierPaymentInput, type SupplierPaymentDraft } from '@/domain/supplier-payment-workflow'
import { SUPPLIER_PAYMENT_MODES, supplierPaymentNeedsReference, type SupplierPaymentMode } from '@/domain/supplier-payment-modes'
import { lineAmountPaise, rupeesToPaise } from '@/domain/supplier-units'
import { purchaseReceiptBagCount, remainingPurchaseBags } from '@/domain/purchase-receipt-memos'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'
import { PaymentAmountInput } from '@/components/ui/payment-amount-input'
import { PurchaseDialog, PurchaseReadNotice } from './purchase-dialog'
import { getPurchaseReadState, requirePurchaseRecord } from './purchase-read-state'
import type { MusePurchaseAction } from '@/domain/muse-purchase-actions'

const MODAL_INPUT =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
const MODAL_LABEL = 'text-xs font-medium text-slate-600'

function ErrorText({ error }: { error?: string }) {
  if (!error) return null
  return <p className="text-xs text-rose-600">{error}</p>
}

// ---------------------------------------------------------------------------
// Add Bardan
// ---------------------------------------------------------------------------

export function AddBardanModal({ billId, onClose, draft }: { billId: string; onClose: () => void; draft?: Extract<MusePurchaseAction, { kind: 'bardan' }> & { id: string } }) {
  const queryClient = useQueryClient()
  const [kgStr, setKgStr] = useState(draft ? String(draft.weightG / 1000) : '')
  const [method, setMethod] = useState<'deduct' | 'in_kind' | 'cash_back' | 'advance'>(draft?.method ?? 'deduct')
  const [lineId, setLineId] = useState(draft?.lineId ?? '')
  const [bagCountText, setBagCountText] = useState<string | null>(draft ? String(draft.bagCount) : null)
  const [date, setDate] = useState(draft?.date ?? '')
  const [note, setNote] = useState('')
  const [cashStr, setCashStr] = useState('')
  const [errorText, setErrorText] = useState('')
  const [confirming, setConfirming] = useState(false)

  const billQuery = useQuery(purchaseBillQueryOptions(billId))
  const billState = getPurchaseReadState(billQuery, billQuery.data?.bill.id === billId ? billQuery.data : null)
  const bill = billState.status === 'ready' ? billState.record : null
  const lines = bill?.lines ?? []
  const expectedLines = lines.filter((line) => purchaseReceiptBagCount(line.receiptMemo) > 0)
  const pendingLines = expectedLines.filter((line) => remainingPurchaseBags(line, bill?.bardan ?? []) > 0)
  const selectedLine = lines.find((l) => l.id === lineId) ?? (pendingLines.length === 1 ? pendingLines[0] : lines.length === 1 ? lines[0] : undefined)
  const expectedCount = purchaseReceiptBagCount(selectedLine?.receiptMemo)
  const remainingBags = selectedLine ? remainingPurchaseBags(selectedLine, bill?.bardan ?? []) : 0
  const bagCount = bagCountText === null ? remainingBags : purchaseReceiptBagCount(bagCountText)
  const grams = /^\d{1,9}(?:\.\d{1,3})?$/.test(kgStr.trim()) ? Math.round(Number(kgStr) * 1000) : 0
  const creditPaise = method === 'deduct' || method === 'advance' ? lineAmountPaise(grams, selectedLine?.rateMilli ?? 0) : 0
  const cashPaise = method === 'cash_back' ? rupeesToPaise(parseFloat(cashStr) || 0) : 0
  const needsRate = method === 'deduct' || method === 'advance'
  const canSave = Boolean(bill && !bill.bill.cancelled && grams > 0 && (!needsRate || (selectedLine && creditPaise > 0))
    && (!expectedCount || (bagCount > 0 && bagCount <= remainingBags)))
  const revisedNet = bill && method === 'deduct' ? computeBillNet(lines, bill.adjustments, [...bill.bardan, { method, creditPaise, cashAmountPaise: 0 }], bill.bill.taxMode, bill.bill.gstRateBp).netPaise : null

  const addMutation = useMutation({
    mutationFn: async () => {
      const currentBill = requirePurchaseRecord(billState, 'Bill')
      if (grams <= 0) throw new Error('Enter a valid bardan weight in kg.')
      if (!canSave) throw new Error('Choose a bill line with a valid bardan rate.')
      await addPurchaseBardanEntry({
        actionDraftId: draft?.id,
        billId: currentBill.bill.id,
        bardanG: grams,
        bagCount: bagCount || undefined,
        rateLineId: selectedLine?.id,
        rateMilli: selectedLine?.rateMilli ?? 0,
        method,
        creditPaise,
        cashAmountPaise: cashPaise,
        date: date || currentBill.bill.date,
        note: note.trim(),
      })
      return currentBill.bill.supplierId
    },
    onSuccess: async (supplierId) => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
      onClose()
    },
    onError: (err) => setErrorText(toUserMessage(err)),
  })

  return (
    <PurchaseDialog
      title="Add Bardan"
      onClose={onClose}
      onSubmit={() => {
        if (!canSave || addMutation.isPending) return
        if (confirming) {
          addMutation.mutate()
        } else {
          setLineId(selectedLine?.id ?? '')
          setBagCountText(bagCount ? String(bagCount) : null)
          setConfirming(true)
        }
      }}
      canSubmit={canSave}
      submitting={addMutation.isPending}
      submitLabel={confirming ? 'Confirm Bardan' : 'Review Bardan'}
    >
      {!bill ? (
        <PurchaseReadNotice state={billState} subject="Bill" />
      ) : (
        <div className="space-y-2">
          {confirming && <button type="button" className="text-xs font-semibold text-blue-700" disabled={addMutation.isPending} onClick={() => setConfirming(false)}>Back to edit</button>}
          <fieldset disabled={confirming} className="space-y-2">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1"><span className={MODAL_LABEL}>Bags{expectedCount > 0 ? ` (${remainingBags} remaining)` : ''}</span>
              <input className={MODAL_INPUT} inputMode="numeric" value={bagCountText ?? (remainingBags || '')} readOnly={!expectedCount && !draft} placeholder="Not recorded" onChange={(event) => setBagCountText(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={MODAL_LABEL}>Bardan Weight (kg)</span>
              <input className={MODAL_INPUT} type="text" placeholder="e.g. 24.000" value={kgStr} onChange={(e) => setKgStr(e.target.value)} autoFocus />
            </label>
            <label className="flex flex-col gap-1">
              <span className={MODAL_LABEL}>Rate</span>
              <select aria-label="Bardan rate line" className={MODAL_INPUT} value={selectedLine?.id ?? ''} onChange={(e) => { setLineId(e.target.value); setBagCountText(null) }}>
                <option value="" disabled>Choose a bill line</option>
                {lines.map((line) => <option key={line.id} value={line.id}>{line.itemName} (₹{line.rateMilli / 1000}/kg)</option>)}
              </select>
            </label>
          </div>
          <details className="text-xs text-slate-600">
          <summary className="cursor-pointer py-1">More options</summary>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1">
              <span className={MODAL_LABEL}>Method</span>
              <select className={MODAL_INPUT} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="deduct">Deduct (credit kg × rate)</option>
                <option value="in_kind">In Kind (settled, nil)</option>
                <option value="cash_back">Cash Back (memo only)</option>
                <option value="advance">Advance (future pool payment)</option>
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
          </details>
          </fieldset>
          <p className="rounded-md border border-blue-100 bg-blue-50/60 px-2.5 py-1.5 text-xs text-slate-700">
            {method === 'deduct' && (
              <>
                {grams / 1000} kg × ₹{(selectedLine?.rateMilli ?? 0) / 1000}/kg = <strong className="font-mono">{formatPaiseInr(creditPaise)}</strong>
                {revisedNet !== null && <span className="block">Revised bill net {formatPaiseInr(revisedNet)}</span>}
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
        </div>
      )}
    </PurchaseDialog>
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
  const [amountRupees, setAmountRupees] = useState<number>(() => pins.reduce((sum, pin) => sum + pin.duePaise, 0) / 100)
  const [mode, setMode] = useState<SupplierPaymentMode>('cash')
  const [reference, setReference] = useState('')
  const [errorText, setErrorText] = useState('')

  const supplierQuery = useQuery(supplierContextQueryOptions(supplierId))
  const supplierState = getPurchaseReadState(supplierQuery, supplierQuery.data?.bundle.supplier.id === supplierId ? supplierQuery.data : null)
  const context = supplierState.status === 'ready' ? supplierState.record : null
  const currentBills = context?.settlement.pools[pool].bills.filter((bill) => bill.status !== 'cancelled') ?? []
  const currentPins = pins.flatMap((pin) => {
    const bill = currentBills.find((candidate) => candidate.billId === pin.billId)
    return bill ? [{ ...pin, duePaise: bill.duePaise }] : []
  })
  const targetsState = getPurchaseReadState(supplierQuery, context && currentPins.length === pins.length ? currentPins : null)
  const totalDuePaise = currentPins.reduce((sum, pin) => sum + pin.duePaise, 0)
  const amountPaise = rupeesToPaise(amountRupees)
  const needsReference = supplierPaymentNeedsReference(mode)

  const draft: SupplierPaymentDraft = {
    supplierId, date: getLocalIsoDate(), pool, kind: 'payment', amountPaise, mode, reference, payeeName: '', privateNote: '',
  }
  const workflow = context && targetsState.status === 'ready' ? buildSupplierPaymentWorkflow(context, {
    ...draft, selectedBillIds: new Set(currentPins.map((pin) => pin.billId)), pinOrder: 'selection',
  }) : null
  const allocationPlan = workflow?.allocations ?? []
  const pinnedTotalPaise = allocationPlan.reduce((sum, a) => sum + a.amountPaise, 0)
  const advancePaise = Math.max(0, amountPaise - (workflow?.allocationPreview.appliedToDuesPaise ?? 0))
  const validation = validateManualPins(
    pool,
    amountPaise,
    allocationPlan.map((a) => ({ billId: a.billId, billPool: pool, billDuePaise: currentPins.find((p) => p.billId === a.billId)?.duePaise ?? 0, pinnedPaise: a.amountPaise })),
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      requirePurchaseRecord(supplierState, 'Supplier')
      requirePurchaseRecord(targetsState, 'Bill')
      if (amountPaise <= 0) throw new Error('Payment amount must be greater than zero.')
      if (!validation.valid) throw new Error(validation.error ?? 'Invalid allocation.')
      if (needsReference && !reference.trim()) throw new Error(`Reference is required for ${mode.toUpperCase()}.`)
      return createSupplierPayment(prepareSupplierPaymentInput(draft, workflow))
    },
    onSuccess: async (saved) => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, saved.supplierId)
      onClose()
    },
    onError: (err) => setErrorText(toUserMessage(err)),
  })

  return (
    <PurchaseDialog
      title={`Record Payment${supplierName ? ` · ${supplierName}` : ''}`}
      onClose={onClose}
      onSubmit={() => saveMutation.mutate()}
      canSubmit={supplierState.status === 'ready' && targetsState.status === 'ready' && amountPaise > 0 && validation.valid && (!needsReference || reference.trim().length > 0)}
      submitting={saveMutation.isPending}
      submitLabel="Save Payment"
    >
      {supplierState.status !== 'ready' ? <PurchaseReadNotice state={supplierState} subject="Supplier" />
        : targetsState.status !== 'ready' ? <PurchaseReadNotice state={targetsState} subject="Bill" /> : <>
      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-2.5 py-2 text-xs text-slate-600">
        {pins.length === 1 ? (
          <>
            Pinned to <span className="font-mono font-semibold text-slate-800">{pins[0].inNo || 'bill'}</span> · due{' '}
            <span className="font-mono">{formatPaiseInr(currentPins[0].duePaise)}</span>
          </>
        ) : (
          <>Pinned to {pins.length} bills · total due <span className="font-mono">{formatPaiseInr(totalDuePaise)}</span></>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className={MODAL_LABEL}>Amount (₹)</span>
          <PaymentAmountInput value={amountRupees} onChange={setAmountRupees} className={MODAL_INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={MODAL_LABEL}>Mode</span>
          <select className={MODAL_INPUT} value={mode} onChange={(e) => setMode(e.target.value as SupplierPaymentMode)}>
                {SUPPLIER_PAYMENT_MODES.map((option) => <option key={option} value={option}>{option === 'cash' ? 'Cash' : option === 'cheque' ? 'Cheque' : option === 'other' ? 'Other' : option.toUpperCase()}</option>)}
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
        {pins.length === 1 && pinnedTotalPaise > 0 ? (
          <>
            {' '}· after saving, this bill's due drops from{' '}
            <span className="font-mono">{formatPaiseInr(currentPins[0].duePaise)}</span> to{' '}
            <span className="font-mono font-semibold text-slate-800">{formatPaiseInr(Math.max(0, currentPins[0].duePaise - pinnedTotalPaise))}</span>
          </>
        ) : pinnedTotalPaise > 0 ? (
          <> · pinned dues drop by {formatPaiseInr(pinnedTotalPaise)} in total</>
        ) : null}
      </p>
      <ErrorText error={errorText} />
      </>}
    </PurchaseDialog>
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

  const supplierQuery = useQuery(supplierContextQueryOptions(supplierId))
  const supplierState = getPurchaseReadState(supplierQuery, supplierQuery.data?.bundle.supplier.id === supplierId ? supplierQuery.data : null)
  const context = supplierState.status === 'ready' ? supplierState.record : null
  const billState = getPurchaseReadState(supplierQuery, context?.settlement.pools[pool].bills.find((bill) => bill.billId === billId && bill.status !== 'cancelled'))
  const bill = billState.status === 'ready' ? billState.record : null
  const duePaise = bill?.duePaise ?? 0
  const needsConfirm = duePaise > 50_000

  const saveMutation = useMutation({
    mutationFn: async () => {
      const currentSupplier = requirePurchaseRecord(supplierState, 'Supplier')
      const currentBill = requirePurchaseRecord(billState, 'Bill')
      if (!reason.trim()) throw new Error('Reason is required.')
      if (currentBill.duePaise <= 0) throw new Error('This bill is already settled.')
      if (needsConfirm && !confirmed) throw new Error('Please confirm this write-off.')
      return createSupplierPayment({
        supplierId: currentSupplier.bundle.supplier.id,
        date: getLocalIsoDate(),
        pool,
        kind: 'settle_off',
        amountPaise: currentBill.duePaise,
        mode: 'other',
        reference: reason.trim(),
        allocations: [{ billId: currentBill.billId, amountPaise: currentBill.duePaise }],
      })
    },
    onSuccess: async (saved) => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, saved.supplierId)
      onClose()
    },
    onError: (err) => setErrorText(toUserMessage(err)),
  })

  return (
    <PurchaseDialog
      title="Settle to NIL"
      onClose={onClose}
      onSubmit={() => saveMutation.mutate()}
      canSubmit={Boolean(bill) && reason.trim().length > 0 && duePaise > 0 && (!needsConfirm || confirmed)}
      submitting={saveMutation.isPending}
      submitLabel="Settle to NIL"
    >
      {supplierState.status !== 'ready' ? <PurchaseReadNotice state={supplierState} subject="Supplier" />
        : !bill ? <PurchaseReadNotice state={billState} subject="Bill" /> : <>
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
      </>}
    </PurchaseDialog>
  )
}

// ---------------------------------------------------------------------------
// Cancel bill
// ---------------------------------------------------------------------------

export function CancelBillModal({ billId, inNo, onClose }: { billId: string; inNo: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [errorText, setErrorText] = useState('')

  const billQuery = useQuery(purchaseBillQueryOptions(billId))
  const billState = getPurchaseReadState(billQuery, billQuery.data?.bill.id === billId ? billQuery.data : null)
  const bill = billState.status === 'ready' ? billState.record : null
  const netPaise = bill ? computeBillNet(bill.lines, bill.adjustments, bill.bardan, bill.bill.taxMode, bill.bill.gstRateBp).netPaise : 0

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const currentBill = requirePurchaseRecord(billState, 'Bill')
      if (!reason.trim()) throw new Error('Cancellation reason is required.')
      return cancelPurchaseBill(currentBill.bill.id, reason.trim())
    },
    onSuccess: async (saved) => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, saved.supplierId)
      onClose()
    },
    onError: (err) => setErrorText(toUserMessage(err)),
  })

  return (
    <PurchaseDialog
      title={`Void Bill ${inNo || ''}`}
      onClose={onClose}
      onSubmit={() => cancelMutation.mutate()}
      canSubmit={Boolean(bill) && reason.trim().length > 0}
      submitting={cancelMutation.isPending}
      submitLabel="Void Bill"
      tone="danger"
    >
      {!bill ? <PurchaseReadNotice state={billState} subject="Bill" /> : <>
        <div className="rounded-md border border-slate-200 bg-slate-50/70 px-2.5 py-2 text-xs text-slate-600">
          <p>
            <span className="font-mono font-semibold text-slate-800">{bill.bill.inNo || inNo}</span> · {formatFullDate(bill.bill.date)} ·{' '}
            {netPaise >= 0
              ? `net ${formatPaiseInr(netPaise)}`
              : 'credit bill'}
          </p>
          <p className="mt-1 text-rose-700">
            Cancelling removes it from dues and the ledger money flow, and frees any payments pinned to it.
          </p>
        </div>
      <p className="text-xs text-slate-600">
        Soft cancellation: the bill stays struck-through in the ledger for the audit trail and loses all money effect.
      </p>
      <label className="flex flex-col gap-1">
        <span className={MODAL_LABEL}>Reason (required)</span>
        <input className={MODAL_INPUT} type="text" placeholder="e.g. duplicate entry" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      <ErrorText error={errorText} />
      </>}
    </PurchaseDialog>
  )
}

// ---------------------------------------------------------------------------
// Payment details (view + cancel)
// ---------------------------------------------------------------------------

export function PaymentDetailsModal({ paymentId, onClose, startInVoidMode = false }: { paymentId: string; onClose: () => void; startInVoidMode?: boolean }) {
  const queryClient = useQueryClient()
  const [cancelReason, setCancelReason] = useState('')
  const [showCancel, setShowCancel] = useState(startInVoidMode)
  const [errorText, setErrorText] = useState('')

  const paymentsQuery = useQuery(supplierPaymentsQueryOptions())
  const paymentState = getPurchaseReadState(paymentsQuery, paymentsQuery.data?.find((p) => p.id === paymentId))
  const payment = paymentState.status === 'ready' ? paymentState.record : null

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const currentPayment = requirePurchaseRecord(paymentState, 'Payment')
      if (!cancelReason.trim()) throw new Error('Cancellation reason is required.')
      return cancelSupplierPayment(currentPayment.id, cancelReason.trim())
    },
    onSuccess: async (saved) => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, saved.supplierId)
      onClose()
    },
    onError: (err) => setErrorText(toUserMessage(err)),
  })

  return (
    <PurchaseDialog
      title={showCancel ? 'Void Payment' : 'Payment Details'}
      onClose={onClose}
      onSubmit={() => {}}
      canSubmit={false}
      submitting={false}
      submitLabel=""
      width="max-w-lg"
    >
      {!payment ? (
        <PurchaseReadNotice state={paymentState} subject="Payment" />
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
              <p className="text-[11px] leading-4 text-rose-800">
                Cancelling frees <strong className="font-mono">{formatPaiseInr(payment.appliedPaise)}</strong> of applied credit back into bills to be paid
                {payment.advancePaise > 0 && (
                  <> and removes <strong className="font-mono">{formatPaiseInr(payment.advancePaise)}</strong> of standing advance</>
                )}
                .
              </p>
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
                  {cancelMutation.isPending ? 'Cancelling…' : 'Confirm Void'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <button type="button" onClick={() => setShowCancel(true)} className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100">
                Void Payment
              </button>
            </div>
          )}
          <ErrorText error={errorText} />
        </div>
      )}
    </PurchaseDialog>
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
