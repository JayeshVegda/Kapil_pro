import { inputClass as baseInputClass } from '@/components/ui/form-control-classes'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowDownRight,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  Landmark,
  ReceiptText,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import { PaymentAmountInput } from '@/components/ui/payment-amount-input'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { createSupplierPayment, type SupplierPaymentView } from '@/data/suppliers'
import { loadPurchasePaymentDraft } from '@/data/purchase-payment-drafts'
import { supplierContextQueryOptions, supplierListQueryOptions } from '@/data/purchase-queries'
import type { SupplierPool } from '@/domain/supplier-settlement'
import { buildSupplierPaymentWorkflow, prepareSupplierPaymentInput, type SupplierPaymentKind } from '@/domain/supplier-payment-workflow'
import { SUPPLIER_PAYMENT_MODES, supplierPaymentNeedsReference, type SupplierPaymentMode } from '@/domain/supplier-payment-modes'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'
import { matchPurchaseMaster, parsePurchaseDecimal } from '@/domain/purchase-bill-draft'
import { paiseToRupeesText } from '@/domain/supplier-units'
import { Panel } from '@/components/ui/panel'
import { AppError } from '@/app/errors'

const searchSchema = z.object({
  supplierId: z.string().optional(),
  pool: z.enum(['kacha', 'gst']).optional(),
  billId: z.string().optional(),
  draftId: z.string().regex(/^[a-z0-9]{15}$/).optional(),
})

export const Route = createFileRoute('/new-supplier-payment')({
  validateSearch: searchSchema,
  component: NewSupplierPaymentPage,
})

type PaymentKind = SupplierPaymentKind
type PaymentMode = SupplierPaymentMode

const KIND_OPTIONS: Array<{ kind: PaymentKind; label: string; allowPins: boolean }> = [
  { kind: 'payment', label: 'Payment', allowPins: true },
  { kind: 'paid_on_behalf', label: 'Paid for them (Labour/Freight)', allowPins: true },
  { kind: 'settle_off', label: 'Small settle-off difference', allowPins: true },
  { kind: 'refund_received', label: 'Refund from supplier', allowPins: false },
]

function NewSupplierPaymentPage() {
  const queryClient = useQueryClient()
  const { supplierId: initialSupplierId, pool: initialPool, billId: initialBillId, draftId } = Route.useSearch()

  const [date, setDate] = useState(() => getLocalIsoDate())
  const [supplierId, setSupplierId] = useState(initialSupplierId ?? '')
  const [pool, setPool] = useState<SupplierPool>(initialPool ?? 'kacha')
  const [kind, setKind] = useState<PaymentKind>('payment')
  const [mode, setMode] = useState<PaymentMode | ''>('cash')
  const [amountRupees, setAmountRupees] = useState<number>(0)
  const [draftAmountStr, setDraftAmountStr] = useState('')
  const [draftSaved, setDraftSaved] = useState(false)
  const [convertedPaymentId, setConvertedPaymentId] = useState('')
  const [reference, setReference] = useState('')
  const [payeeName, setPayeeName] = useState('')
  const [privateNote, setPrivateNote] = useState('')
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(() => new Set(initialBillId ? [initialBillId] : []))
  const [statusText, setStatusText] = useState('')
  const [lastSavedPayment, setLastSavedPayment] = useState<SupplierPaymentView | null>(null)

  const amountInputRef = useRef<HTMLInputElement | null>(null)
  const noteInputRef = useRef<HTMLInputElement | null>(null)
  const appliedDraftRef = useRef('')

  const allowPins = KIND_OPTIONS.find((option) => option.kind === kind)?.allowPins ?? true

  const suppliersQuery = useQuery(supplierListQueryOptions())
  const draftQuery = useQuery({ queryKey: ['purchase-payment-draft', draftId], queryFn: () => loadPurchasePaymentDraft(draftId!), enabled: Boolean(draftId), refetchOnWindowFocus: true })
  const contextQuery = useQuery(supplierContextQueryOptions(supplierId))

  useEffect(() => {
    if (!draftId || !draftQuery.data || !suppliersQuery.data || appliedDraftRef.current === draftId) return
    const draft = draftQuery.data
    if (draft.status !== 'pending_review' || draft.parsed.kind !== 'valid') return
    const p = draft.parsed.value
    const supplier = matchPurchaseMaster(p.supplier_name, p.supplier_id, suppliersQuery.data.map((s) => ({ id: s.id, name: s.companyName, aliases: s.aliases, active: s.active })))
    setSupplierId(supplier?.id ?? '')
    setDate(p.date)
    setPool(p.pool)
    setKind(p.kind)
    setMode(p.mode ?? '')
    setDraftAmountStr(paiseToRupeesText(draft.parsed.amountPaise))
    setReference(p.reference ?? '')
    setPayeeName(p.payee ?? '')
    setPrivateNote(p.note ?? '')
    setSelectedBillIds(new Set(p.bill_pins ?? []))
    appliedDraftRef.current = draftId
  }, [draftId, draftQuery.data, suppliersQuery.data])

  const selectedSupplier = useMemo(
    () => (suppliersQuery.data ?? []).find((s) => s.id === supplierId) ?? null,
    [suppliersQuery.data, supplierId],
  )

  const amountPaise = draftId ? (() => { try { return parsePurchaseDecimal(draftAmountStr || '0', 2, 'Amount') } catch { return 0 } })() : Math.round(amountRupees * 100)

  const workflow = useMemo(() => {
    const context = contextQuery.data
    if (!context || contextQuery.isError || context.bundle.supplier.id !== supplierId) return null
    return buildSupplierPaymentWorkflow(context, { pool, date, kind, amountPaise, selectedBillIds })
  }, [contextQuery.data, contextQuery.isError, supplierId, pool, date, kind, amountPaise, selectedBillIds])
  const openBills = workflow?.openBills ?? []
  const totalDuePaise = workflow?.totalDuePaise ?? 0
  const totalSelectedPaise = workflow?.totalSelectedPaise ?? 0
  const allocationPreview = workflow?.allocationPreview ?? { lines: [], appliedToDuesPaise: 0, advancePaise: 0, outstandingAfterPaise: 0 }
  const outstandingBefore = workflow?.outstandingBefore ?? 0
  const outstandingAfter = allocationPreview.outstandingAfterPaise
  const advanceAfter = allocationPreview.advancePaise
  const coveragePercent = workflow?.coveragePercent ?? 0
  const recentPayments = workflow?.recentPayments ?? []
  const contextMessage = contextQuery.isError ? 'Unable to load supplier ledger.'
    : contextQuery.isLoading ? 'Loading supplier ledger…' : 'Supplier not found.'

  // Prefill from ?billId= deep-link
  useEffect(() => {
    if (!initialBillId || openBills.length === 0) return
    if (!selectedBillIds.has(initialBillId)) {
      setSelectedBillIds(new Set([initialBillId]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBillId, openBills.length])

  const isRefRequired = supplierPaymentNeedsReference(mode)

  const toggleBill = (billId: string) => {
    setSelectedBillIds((prev) => {
      const next = new Set(prev)
      if (next.has(billId)) next.delete(billId)
      else next.add(billId)
      return next
    })
  }

  const resetForm = () => {
    setAmountRupees(0)
    setDraftAmountStr('')
    setReference('')
    setPrivateNote('')
    setPayeeName('')
    setSelectedBillIds(new Set())
    setStatusText('')
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      setStatusText('')
      if (draftId && (draftSaved || draftQuery.data?.status !== 'pending_review' || draftQuery.data.parsed.kind !== 'valid')) throw new Error('This draft is invalid or was already processed.')
      if (!mode) throw new Error('Choose a payment mode before saving.')
      const payload = prepareSupplierPaymentInput({ supplierId, date, pool, kind, amountPaise, mode, reference, payeeName, privateNote }, workflow)
      return createSupplierPayment({ ...payload, draftId })
    },
    onSuccess: async (savedPayment) => {
      setLastSavedPayment(savedPayment)
      await invalidateAfterSupplierPurchaseWrite(queryClient, savedPayment.supplierId)
      if (draftId) {
        setDraftSaved(true)
        void queryClient.invalidateQueries({ queryKey: ['purchase-payment-draft', draftId] })
        void queryClient.invalidateQueries({ queryKey: ['purchase-payment-drafts'] })
        void queryClient.invalidateQueries({ queryKey: ['purchase-payment-drafts-count'] })
      }
      resetForm()
    },
    onError: (err) => {
      if (err instanceof AppError && err.code === 'CONFLICT' && err.details && typeof err.details === 'object' && 'paymentId' in err.details) setConvertedPaymentId(String(err.details.paymentId))
      setStatusText(toUserMessage(err))
    },
  })

  // Keyboard shortcut Ctrl+Enter to save
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!saveMutation.isPending && !draftSaved && mode && workflow && amountPaise > 0) {
          saveMutation.mutate()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveMutation, workflow, amountPaise, mode, draftSaved])

  return (
    <div className="w-full space-y-5 px-3 pb-12 pt-3 sm:px-4 lg:px-6">
      {draftId && <Panel className="border-blue-200 bg-blue-50 text-sm text-slate-900">{draftQuery.isLoading ? 'Loading Purchase payment draft…' : draftQuery.data?.parsed.kind === 'invalid' ? `Invalid draft — editor unavailable: ${draftQuery.data.parsed.issues.join('; ')}` : draftQuery.data?.status !== 'pending_review' || draftSaved ? 'This draft has already been processed.' : 'Muse Purchase payment draft · Review supplier, pool, mode and pins before saving.'}{convertedPaymentId && <a className="ml-2 font-semibold underline" href={`/supplier-ledger/${supplierId}`}>View saved payment in supplier ledger</a>}</Panel>}
      {/* Error alert */}
      {statusText && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 shadow-xs">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-500" />
          <span>{statusText}</span>
        </div>
      )}

      {/* Top 2-Column Split: Payment Entry + Payment Impact */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* ================= LEFT CARD: PAYMENT ENTRY ================= */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Supplier Payment Entry</h2>
              <p className="mt-1 text-xs text-slate-500">Record outgoing payment and preview auto-settlement before saving.</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                {pool}
              </span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                {mode}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Date */}
            <Field label="Payment Date">
              <DateInput className={inputClass} value={date} onChange={setDate} />
            </Field>

            {/* Supplier */}
            <Field label="Supplier *">
              <SearchableCombobox
                options={(suppliersQuery.data ?? []).map((s) => ({
                  id: s.id,
                  name: s.companyName,
                  suffix: s.city ? `(${s.city})` : undefined,
                }))}
                value={supplierId}
                onChange={(nextId) => {
                  setSupplierId(nextId)
                  setSelectedBillIds(new Set())
                  setStatusText('')
                }}
                inputClassName={inputClass}
                placeholder="Search supplier…"
                disabled={suppliersQuery.isLoading || suppliersQuery.isError}
                emptyText="No matching supplier found."
                autoFocus
                onSelectionComplete={() => amountInputRef.current?.focus()}
              />
            </Field>

            {/* Pool Toggle */}
            <Field label="Pool">
              <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-300 bg-slate-50 p-1">
                {(['kacha', 'gst'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`h-8 rounded px-2 text-xs font-semibold uppercase transition ${
                      pool === p
                        ? (p === 'kacha' ? 'bg-amber-100 text-amber-950 shadow-xs ring-1 ring-amber-300' : 'bg-blue-100 text-blue-950 shadow-xs ring-1 ring-blue-300')
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => {
                      setPool(p)
                      setSelectedBillIds(new Set())
                                      }}
                  >
                    {p === 'kacha' ? 'Kacha' : 'GST'}
                  </button>
                ))}
              </div>
            </Field>

            {/* Kind / Type */}
            <Field label="Payment Type">
              <select
                value={kind}
                onChange={(e) => {
                  const nextKind = e.target.value as PaymentKind
                  setKind(nextKind)
                  if (!KIND_OPTIONS.find((o) => o.kind === nextKind)?.allowPins) {
                    setSelectedBillIds(new Set())
                  }
                }}
                className={inputClass}
              >
                {KIND_OPTIONS.map((opt) => (
                  <option key={opt.kind} value={opt.kind}>{opt.label}</option>
                ))}
              </select>
            </Field>

            {/* Mode Selector */}
            <div className="md:col-span-2">
              <Field label="Payment Mode">
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 rounded-md border border-slate-300 bg-slate-50 p-1">
                  {SUPPLIER_PAYMENT_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`h-8 rounded px-1 text-xs font-semibold uppercase transition ${
                        mode === m
                          ? 'bg-white text-slate-950 shadow-xs ring-1 ring-slate-200'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      onClick={() => setMode(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {/* Amount */}
            <div className="md:col-span-2">
              <Field label="Payment Amount (₹) *">
                <div className="space-y-1.5">
                  {draftId ? <input type="text" inputMode="decimal" value={draftAmountStr} onChange={(event) => { setDraftAmountStr(event.target.value); setStatusText('') }} className={inputClass} aria-label="Draft payment amount in rupees" /> : <PaymentAmountInput
                    value={amountRupees}
                    onChange={(val) => {
                      setAmountRupees(val)
                      setStatusText('')
                    }}
                    onInputChange={() => setStatusText('')}
                    className={inputClass}
                    inputRef={amountInputRef}
                    onEnter={() => noteInputRef.current?.focus()}
                  />}
                  {totalDuePaise > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <span className="text-[11px] text-slate-500">Quick fill:</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (draftId) setDraftAmountStr(paiseToRupeesText(totalDuePaise))
                          else setAmountRupees(totalDuePaise / 100)
                        }}
                        className="rounded bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition"
                      >
                        Full Due ({formatPaiseInr(totalDuePaise)})
                      </button>
                      {selectedBillIds.size > 0 && totalSelectedPaise > 0 && totalSelectedPaise !== totalDuePaise && (
                        <button
                          type="button"
                          onClick={() => {
                            if (draftId) setDraftAmountStr(paiseToRupeesText(totalSelectedPaise))
                            else setAmountRupees(totalSelectedPaise / 100)
                            }}
                          className="rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold transition"
                        >
                          Selected ({formatPaiseInr(totalSelectedPaise)})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </Field>
            </div>

            {/* Reference */}
            <Field label={isRefRequired ? 'Reference / UTR / Cheque No *' : 'Reference (optional)'}>
              <input
                type="text"
                className={inputClass}
                placeholder={isRefRequired ? 'Required for electronic transfer' : 'Reference, cheque no...'}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>

            {/* Payee name (if paying on behalf) */}
            {kind === 'paid_on_behalf' ? (
              <Field label="Payee Name *">
                <input
                  type="text"
                  className={inputClass}
                  placeholder="Transporter / Labour name..."
                  value={payeeName}
                  onChange={(e) => setPayeeName(e.target.value)}
                />
              </Field>
            ) : (
              <Field label="Private Note (optional)">
                <input
                  ref={noteInputRef}
                  type="text"
                  className={inputClass}
                  placeholder="Internal remark..."
                  value={privateNote}
                  onChange={(e) => setPrivateNote(e.target.value)}
                />
              </Field>
            )}
          </div>

          {/* Form Actions */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <span className="text-xs text-slate-500">
              {amountPaise > 0 ? (
                <>
                  {kind === 'refund_received' ? 'Recording refund' : 'Applying payment'} <strong className="font-mono text-slate-800">{formatPaiseInr(amountPaise)}</strong> in the {pool.toUpperCase()} pool
                </>
              ) : (
                'Enter payment amount to simulate settlement'
              )}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              className="px-2 py-1 text-sm font-medium text-slate-600 hover:text-slate-900 transition"
              onClick={resetForm}
            >
              Clear
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 transition"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !workflow || amountPaise <= 0 || (Boolean(draftId) && (!mode || draftSaved || draftQuery.data?.status !== 'pending_review' || draftQuery.data.parsed.kind !== 'valid'))}
            >
              <CreditCard size={14} />
              {saveMutation.isPending ? 'Saving Payment…' : 'Save Payment (Ctrl+↵)'}
            </button>
          </div>
        </section>

        {/* ================= RIGHT CARD: PAYMENT IMPACT ================= */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Payment Impact</h2>
              <p className="mt-1 text-xs text-slate-500">
                {selectedSupplier ? selectedSupplier.companyName : 'Select supplier to see ledger impact'}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {mode.toUpperCase()}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {pool.toUpperCase()}
              </span>
            </div>
          </div>

          {supplierId && !workflow && <p role={contextQuery.isError ? 'alert' : 'status'} className={`text-sm ${contextQuery.isError ? 'text-rose-600' : 'text-slate-500'}`}>{contextMessage}</p>}

          {!supplierId && (
            <p className="text-sm text-slate-500">Select a supplier above to preview impact on dues.</p>
          )}

          {workflow && (
            <div className="space-y-4">
              {/* 4 Metric Cards */}
              <div className="grid grid-cols-2 gap-3">
                <ImpactMetric
                  icon={<ReceiptText className="h-4 w-4" />}
                  label="Before Payment"
                  value={formatPaiseInr(outstandingBefore)}
                />
                <ImpactMetric
                  icon={<IndianRupee className="h-4 w-4" />}
                  label={kind === 'refund_received' ? 'Receiving Now' : kind === 'settle_off' ? 'Credit Now' : 'Paying Now'}
                  value={formatPaiseInr(amountPaise)}
                />
                <ImpactMetric
                  icon={<ArrowDownRight className="h-4 w-4" />}
                  label="Applied to dues"
                  value={formatPaiseInr(allocationPreview.appliedToDuesPaise)}
                  tone="green"
                />
                <ImpactMetric
                  icon={<Landmark className="h-4 w-4" />}
                  label={advanceAfter > 0 ? 'Advance After' : 'Balance After'}
                  value={advanceAfter > 0 ? formatPaiseInr(advanceAfter) : formatPaiseInr(outstandingAfter)}
                  tone={outstandingAfter === 0 ? 'green' : 'slate'}
                />
              </div>

              {/* Settlement Coverage Progress Bar */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-slate-700">Settlement Coverage ({pool.toUpperCase()})</span>
                  <span className="font-mono font-bold tabular-nums text-slate-900">{Math.round(coveragePercent)}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-white ring-1 ring-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                    style={{ width: `${coveragePercent}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {advanceAfter > 0 ? (
                    <>
                      <strong className="font-mono text-slate-800">{formatPaiseInr(advanceAfter)}</strong> will remain as unallocated advance in the {pool.toUpperCase()} pool.
                    </>
                  ) : outstandingAfter > 0 ? (
                    <>
                      <strong className="font-mono text-rose-600">{formatPaiseInr(outstandingAfter)}</strong> will remain outstanding after this payment.
                    </>
                  ) : (
                    <span className="font-semibold text-emerald-700">
                      All outstanding dues in {pool.toUpperCase()} pool will be fully settled (NIL).
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Confirmed Save Banner */}
      {lastSavedPayment && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-emerald-900">Latest payment confirmed &amp; recorded</p>
              <p className="mt-1 text-xs text-emerald-800">
                {formatFullDate(lastSavedPayment.date)} · {formatPaiseInr(lastSavedPayment.amountPaise)} ({lastSavedPayment.mode.toUpperCase()}{lastSavedPayment.reference ? ` · ${lastSavedPayment.reference}` : ''}) recorded in {lastSavedPayment.pool.toUpperCase()} pool.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLastSavedPayment(null)}
              className="text-xs text-emerald-700 hover:text-emerald-900 underline"
            >
              Dismiss
            </button>
          </div>
        </section>
      )}

      {/* ================= MIDDLE CARD: BILLS AUTO ADJUSTMENT PREVIEW ================= */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Where this payment goes</h2>
            <p className="mt-1 text-xs text-slate-500">
              The amount and date above drive this preview. Bills are paid oldest first; pin a bill to pay it first.
            </p>
          </div>
          {openBills.length > 0 && allowPins && (
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setSelectedBillIds(new Set(openBills.map((b) => b.billId)))
                }}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                Select all ({openBills.length})
              </button>
              {selectedBillIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBillIds(new Set())
                  }}
                  className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 transition"
                >
                  Clear pins
                </button>
              )}
            </div>
          )}
        </div>

        {!supplierId ? (
          <p className="text-sm text-slate-500">Select a supplier to preview open bills and allocations.</p>
        ) : !workflow ? (
          <p className="text-sm text-slate-500">{contextMessage}</p>
        ) : openBills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
            No open bills in this pool. The payment may settle an opening balance or refund; any unused amount becomes an advance.
          </div>
        ) : (
          <div className="overflow-x-auto no-scrollbar rounded-md border border-slate-100">
            <table className="w-full min-w-[850px]">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-100">
                  <th className="w-10 px-3 py-2 text-center">Priority</th>
                  <th className="px-3 py-2 text-left">Bill Ref</th>
                  <th className="px-3 py-2 text-left">Bill Date</th>
                  <th className="px-3 py-2 text-left">Details</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2 text-right">Paid Now</th>
                  <th className="px-3 py-2 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {allocationPreview.lines.map((line) => {
                  const isPinned = allowPins && selectedBillIds.has(line.billId)
                  return (
                    <tr
                      key={line.billId}
                      className={`align-top transition ${
                        isPinned ? 'bg-blue-50/50' : line.paidNowPaise > 0 ? 'bg-emerald-50/30' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={isPinned}
                          disabled={!allowPins}
                          onChange={() => toggleBill(line.billId)}
                          className="h-4 w-4 accent-blue-600 cursor-pointer"
                          aria-label={`Pin payment to ${line.inNo}`}
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono font-bold text-blue-700 whitespace-nowrap">
                        {line.inNo}
                        {isPinned && <span className="ml-1.5 text-[11px] text-blue-600 font-medium font-sans">Pinned</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                        {formatFullDate(line.date)}
                        <span className="ml-1 text-[11px] text-slate-400">({line.daysOld}d)</span>
                      </td>
                      <td className="max-w-[360px] px-3 py-2.5">
                        <p className="truncate text-slate-700" title={line.itemsLabel}>
                          {line.itemsLabel}
                        </p>
                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${line.paidPercent}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-800">
                        {formatPaiseInr(line.duePaise)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">
                        {line.paidNowPaise > 0 ? `− ${formatPaiseInr(line.paidNowPaise)}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-800">
                        {line.remainingDuePaise === 0 ? (
                          <span className="text-emerald-700 font-bold">NIL</span>
                        ) : (
                          formatPaiseInr(line.remainingDuePaise)
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ================= BOTTOM CARD: RECENT PAYMENTS ================= */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Recent Payments</h2>
            <p className="mt-1 text-xs text-slate-500">Past payment records for this supplier.</p>
          </div>
          {workflow && (
            <span className="text-xs text-slate-400">
              {recentPayments.length} recent {recentPayments.length === 1 ? 'record' : 'records'}
            </span>
          )}
        </div>

        {!supplierId && <p className="text-sm text-slate-500">Select a supplier to view recent payments.</p>}
        {supplierId && !workflow && <p className="text-sm text-slate-500">{contextMessage}</p>}
        {workflow && recentPayments.length === 0 && (
          <p className="text-sm text-slate-500">No payment history recorded for this supplier.</p>
        )}
        {recentPayments.length > 0 && (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {recentPayments.map((p) => (
              <div
                key={p.id}
                className={`rounded-lg border p-3.5 transition ${
                  p.cancelled ? 'border-slate-200 bg-slate-50/60 opacity-60' : 'border-slate-200 bg-slate-50/80 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-900">{formatFullDate(p.date)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {p.mode.toUpperCase()} · <span className="font-semibold">{p.pool.toUpperCase()}</span>
                      {p.reference ? ` · ${p.reference}` : ''}
                    </p>
                  </div>
                  <p className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                    {formatPaiseInr(p.amountPaise)}
                  </p>
                </div>
                {p.cancelled && (
                  <span className="mt-2 inline-block rounded bg-rose-50 px-1.5 py-0.2 text-[11px] font-bold text-rose-700 uppercase">
                    Cancelled
                  </span>
                )}
                {p.payeeName && (
                  <p className="mt-1 text-[11px] text-slate-500 italic">Paid to: {p.payeeName}</p>
                )}
              </div>
            ))}
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

function ImpactMetric({
  icon,
  label,
  value,
  tone = 'slate',
}: {
  icon: ReactNode
  label: string
  value: string
  tone?: 'slate' | 'green'
}) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-slate-200 bg-slate-50 text-slate-600'
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  )
}

const inputClass = `${baseInputClass} h-10 text-xs`
