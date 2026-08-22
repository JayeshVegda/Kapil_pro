import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertDialog, Dialog } from 'radix-ui'
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM } from '@/components/billing/bill-print-layout'
import { PaymentAmountInput } from '@/components/ui/payment-amount-input'
import { loadTransactionsContext, updateBillWithItems, updatePayment } from '@/data/transactions'
import { calculateBillTotalFromBase, calculateBillTotals } from '@/domain/billing-calculations'
import { calculateBillingLineBags, getBillingUnit } from '@/domain/billing-modes'
import { buildTransactionRows, type BillItemSnapshot, type BillSnapshot, type PaymentSnapshot } from '@/domain/transactions'
import { formatFullDate, toDateTimeLocalInputValue, toStoredDateTimeValue } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'
import { subscribeTransactionEditor, type TransactionEditorKind } from './transaction-editor-events'

const EDITOR_QUERY_KEY = ['transactions-page'] as const

const paymentSchema = z.object({
  date: z.string().min(1, 'Date and time is required'),
  customerId: z.string().min(1, 'Customer is required'),
  customerName: z.string().min(1),
  amount: z.number().positive('Payment amount must be greater than zero'),
  mode: z.enum(['Cash', 'Bank']),
  note: z.string(),
})

const billSchema = z.object({
  date: z.string().min(1, 'Date and time is required'),
  customerId: z.string().min(1, 'Customer is required'),
  customerName: z.string().min(1),
  bookNo: z.number().int().positive('Book number is required'),
  billNo: z.number().int().positive('Bill number is required'),
  mktRate: z.number().nonnegative(),
  transport: z.number().nonnegative(),
  gstRate: z.number().nonnegative(),
  gstAmount: z.number().nonnegative().optional(),
  lrNo: z.string(),
  items: z.array(z.object({
    itemId: z.string().optional(),
    itemName: z.string().trim().min(1, 'Item is required'),
    qty: z.number().positive('Quantity must be greater than zero'),
    rate: z.number().positive('Final rate must be greater than zero'),
    defaultRate: z.number().nonnegative().optional(),
    type: z.string().optional(),
    unit: z.string().optional(),
    bagWeight: z.number().positive().optional(),
  })).min(1, 'At least one item is required'),
})

type EditorTarget = { kind: TransactionEditorKind; id: string }
type BillDraft = Omit<BillSnapshot, 'id'>
type PaymentDraft = Omit<PaymentSnapshot, 'id'>

export function TransactionEditorHost() {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<EditorTarget | null>(null)
  const [billDraft, setBillDraft] = useState<BillDraft | null>(null)
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft | null>(null)
  const [initialDraft, setInitialDraft] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [errorText, setErrorText] = useState('')

  useEffect(() => subscribeTransactionEditor((detail) => {
    setErrorText('')
    setTarget(detail)
  }), [])

  const contextQuery = useQuery({
    queryKey: EDITOR_QUERY_KEY,
    queryFn: loadTransactionsContext,
    enabled: Boolean(target),
  })

  const rows = useMemo(
    () => contextQuery.data ? buildTransactionRows(contextQuery.data) : [],
    [contextQuery.data],
  )
  const editing = useMemo(
    () => target ? rows.find((row) => row.kind === target.kind && row.id === target.id) ?? null : null,
    [rows, target],
  )

  // Seed the draft once per opened record. Background refetches rebuild `rows`
  // with fresh identities — reseeding on identity would silently wipe edits.
  const seededRecordRef = useRef('')
  useEffect(() => {
    if (!editing) {
      seededRecordRef.current = ''
      return
    }
    const recordKey = `${editing.kind}:${editing.id}`
    if (seededRecordRef.current === recordKey) return
    seededRecordRef.current = recordKey
    if (editing.kind === 'bill') {
      const next: BillDraft = {
        date: editing.bill.date,
        businessDate: editing.bill.businessDate,
        createdAt: editing.bill.createdAt,
        customerId: editing.bill.customerId,
        customerName: editing.bill.customerName,
        bookNo: editing.bill.bookNo,
        billNo: editing.bill.billNo,
        mktRate: editing.bill.mktRate,
        transport: editing.bill.transport,
        gstRate: editing.bill.gstRate,
        gstAmount: editing.bill.gstAmount,
        lrNo: editing.bill.lrNo,
        items: editing.bill.items.length > 0 ? editing.bill.items : [emptyBillItem()],
      }
      setBillDraft(next)
      setPaymentDraft(null)
      setInitialDraft(JSON.stringify(next))
    } else {
      const next: PaymentDraft = {
        date: editing.payment.date,
        businessDate: editing.payment.businessDate,
        createdAt: editing.payment.createdAt,
        customerId: editing.payment.customerId,
        customerName: editing.payment.customerName,
        amount: editing.payment.amount,
        mode: editing.payment.mode,
        note: editing.payment.note,
      }
      setPaymentDraft(next)
      setBillDraft(null)
      setInitialDraft(JSON.stringify(next))
    }
  }, [editing])

  const currentDraft = JSON.stringify(billDraft ?? paymentDraft ?? null)
  const isDirty = Boolean(initialDraft && currentDraft !== initialDraft)

  function closeEditor() {
    setTarget(null)
    setBillDraft(null)
    setPaymentDraft(null)
    setInitialDraft('')
    setErrorText('')
  }

  function requestClose() {
    if (isDirty) setDiscardOpen(true)
    else closeEditor()
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return
      if (editing.kind === 'bill' && billDraft) {
        const parsed = billSchema.safeParse(billDraft)
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid bill')
        await updateBillWithItems(editing.id, parsed.data)
      }
      if (editing.kind === 'payment' && paymentDraft) {
        const parsed = paymentSchema.safeParse(paymentDraft)
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid payment')
        await updatePayment(editing.id, parsed.data)
      }
    },
    onSuccess: async () => {
      closeEditor()
      await queryClient.invalidateQueries()
    },
    onError: (error) => setErrorText(toUserMessage(error)),
  })

  function updateBillItem(index: number, patch: Partial<BillItemSnapshot>) {
    setBillDraft((previous) => previous ? {
      ...previous,
      items: previous.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    } : previous)
  }

  const preview = useMemo(() => {
    if (!billDraft || !contextQuery.data || !editing || editing.kind !== 'bill') return null
    const totals = calculateBillTotals({
      items: billDraft.items,
      transport: billDraft.transport,
      gstRate: billDraft.gstRate,
      gstAmountOverride: billDraft.gstAmount,
    })
    const day = billDraft.date.slice(0, 10)
    const priorBills = contextQuery.data.bills
      .filter((bill) => bill.id !== editing.id && bill.customerId === billDraft.customerId && bill.date.slice(0, 10) <= day)
      .sort((left, right) => left.date.localeCompare(right.date) || left.billNo - right.billNo)
    const baseByBill = new Map<string, number>()
    for (const item of contextQuery.data.billItems) {
      baseByBill.set(item.billId, (baseByBill.get(item.billId) ?? 0) + item.amount)
    }
    const openingBalance = contextQuery.data.customers.find((customer) => customer.id === billDraft.customerId)?.openingBalance ?? 0
    const previousBillDate = priorBills.at(-1)?.date ?? 'Opening'
    const cutoffDay = previousBillDate === 'Opening' ? '' : previousBillDate.slice(0, 10)
    const payments = contextQuery.data.payments.filter((payment) => payment.customerId === billDraft.customerId && payment.date.slice(0, 10) <= day)
    const paidBeforeCutoff = cutoffDay
      ? payments.filter((payment) => payment.date.slice(0, 10) <= cutoffDay).reduce((sum, payment) => sum + payment.amount, 0)
      : 0
    const previousBalance = openingBalance + priorBills.reduce((sum, bill) => sum + calculateBillTotalFromBase(
      baseByBill.get(bill.id) ?? 0,
      bill.transport,
      bill.gstRate,
      bill.gstAmount,
    ), 0) - paidBeforeCutoff
    const credits = payments
      .filter((payment) => !cutoffDay || payment.date.slice(0, 10) > cutoffDay)
      .map((payment) => ({ id: payment.id, date: payment.date, amount: payment.amount }))
    const creditsTotal = credits.reduce((sum, payment) => sum + payment.amount, 0)
    const itemRows = billDraft.items.map((item) => ({
      itemName: item.itemName,
      qty: item.qty,
      rate: item.rate,
      amount: item.qty * item.rate,
      bags: calculateBillingLineBags({ qty: item.qty, item }),
      type: item.type,
      unit: item.unit,
      bagWeight: item.bagWeight,
    }))
    return {
      totals,
      props: {
        bookNo: billDraft.bookNo,
        billNo: billDraft.billNo,
        date: billDraft.date,
        customerName: billDraft.customerName,
        mkt: billDraft.mktRate,
        itemRows,
        gstAmount: totals.gstAmount,
        transport: billDraft.transport,
        gstRate: billDraft.gstRate,
        currentBillTotal: totals.grandTotal,
        previousBalance,
        previousBillDate,
        periodCreditEntries: credits,
        subtotal: previousBalance + totals.grandTotal,
        finalTotal: previousBalance + totals.grandTotal - creditsTotal,
        totalQty: totals.totalQty,
        totalBags: itemRows.reduce((sum, item) => sum + item.bags, 0),
        lrList: billDraft.lrNo.split(',').map((value) => value.trim()).filter(Boolean),
      },
    }
  }, [billDraft, contextQuery.data, editing])

  return (
    <>
      <Dialog.Root open={Boolean(target)} onOpenChange={(open) => { if (!open) requestClose() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/55 backdrop-blur-[1px]" />
          <Dialog.Content
            className="fixed left-1/2 top-[4vh] z-[101] flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-[1420px] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl outline-none"
            onEscapeKeyDown={(event) => { event.preventDefault(); requestClose() }}
            onPointerDownOutside={(event) => { event.preventDefault(); requestClose() }}
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-slate-950">
                  {target?.kind === 'bill' ? `Edit Bill${billDraft ? ` ${billDraft.bookNo}/${billDraft.billNo}` : ''}` : 'Edit Payment'}
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-slate-500">
                  Review the complete record and save only after the preview is correct.
                </Dialog.Description>
                {billDraft && preview && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Pill label="Buyer" value={billDraft.customerName} />
                    <Pill label="Date" value={formatFullDate(billDraft.date)} />
                    <Pill label="MKT" value={formatInrInteger(billDraft.mktRate)} />
                    <Pill label="Bill total" value={formatInrInteger(preview.totals.grandTotal)} />
                    <Pill label={preview.props.finalTotal >= 0 ? 'Amount due' : 'Advance'} value={formatInrInteger(Math.abs(preview.props.finalTotal))} tone={preview.props.finalTotal > 0 ? 'amber' : 'green'} />
                  </div>
                )}
              </div>
              <button type="button" className="rounded-md p-2 text-slate-500 hover:bg-slate-100" onClick={requestClose} aria-label="Close editor"><X size={18} /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3 lg:overflow-hidden">
              {contextQuery.isLoading && <div className="grid min-h-80 place-items-center text-sm text-slate-500">Loading complete record…</div>}
              {contextQuery.isError && <div className="grid min-h-80 place-items-center text-sm text-red-600">Unable to load this record.</div>}
              {target && !contextQuery.isLoading && !editing && <div className="grid min-h-80 place-items-center text-sm text-red-600">The selected record no longer exists.</div>}

              {editing?.kind === 'payment' && paymentDraft && (
                <div className="mx-auto grid max-w-4xl grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2">
                  <Field label="Date & time"><input className={inputClass} type="datetime-local" value={toDateTimeLocalInputValue(paymentDraft.date)} onChange={(event) => setPaymentDraft({ ...paymentDraft, date: toStoredDateTimeValue(event.target.value) })} /></Field>
                  <Field label="Customer"><select className={inputClass} value={paymentDraft.customerId} onChange={(event) => { const customer = contextQuery.data?.customers.find((item) => item.id === event.target.value); setPaymentDraft({ ...paymentDraft, customerId: event.target.value, customerName: customer?.name ?? '' }) }}><option value="">Select customer…</option>{contextQuery.data?.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field>
                  <Field label="Mode"><select className={inputClass} value={paymentDraft.mode} onChange={(event) => setPaymentDraft({ ...paymentDraft, mode: event.target.value === 'Bank' ? 'Bank' : 'Cash' })}><option>Cash</option><option>Bank</option></select></Field>
                  <Field label="Amount"><PaymentAmountInput className={inputClass} value={paymentDraft.amount} onChange={(amount) => setPaymentDraft({ ...paymentDraft, amount })} /></Field>
                  <Field label="Note"><input className={inputClass} value={paymentDraft.note} onChange={(event) => setPaymentDraft({ ...paymentDraft, note: event.target.value })} /></Field>
                </div>
              )}

              {editing?.kind === 'bill' && billDraft && preview && (
                <div className="grid min-h-0 gap-3 lg:h-full lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
                  <div className="space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <section>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Bill details</h3>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Field label="Date & time"><input className={inputClass} type="datetime-local" value={toDateTimeLocalInputValue(billDraft.date)} onChange={(event) => setBillDraft({ ...billDraft, date: toStoredDateTimeValue(event.target.value) })} /></Field>
                        <Field label="Customer"><select className={inputClass} value={billDraft.customerId} onChange={(event) => { const customer = contextQuery.data?.customers.find((item) => item.id === event.target.value); setBillDraft({ ...billDraft, customerId: event.target.value, customerName: customer?.name ?? '' }) }}><option value="">Select customer…</option>{contextQuery.data?.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field>
                        <Field label="Book number"><input className={inputClass} type="number" value={billDraft.bookNo || ''} onChange={(event) => setBillDraft({ ...billDraft, bookNo: parseNonNegativeNumber(event.target.value) })} /></Field>
                        <Field label="Bill number"><input className={inputClass} type="number" value={billDraft.billNo || ''} onChange={(event) => setBillDraft({ ...billDraft, billNo: parseNonNegativeNumber(event.target.value) })} /></Field>
                        <Field label="Market rate"><input className={inputClass} type="number" value={billDraft.mktRate || ''} onChange={(event) => setBillDraft({ ...billDraft, mktRate: parseNonNegativeNumber(event.target.value) })} /></Field>
                        <Field label="Transport"><input className={inputClass} type="number" value={billDraft.transport || ''} onChange={(event) => setBillDraft({ ...billDraft, transport: parseNonNegativeNumber(event.target.value) })} /></Field>
                        <Field label="GST"><select className={inputClass} value={billDraft.gstRate === 18 ? '18' : (billDraft.gstAmount ?? 0) > 0 ? 'manual' : '0'} onChange={(event) => { const value = event.target.value; setBillDraft({ ...billDraft, gstRate: value === '18' ? 18 : 0, gstAmount: value === 'manual' ? billDraft.gstAmount || 0 : 0 }) }}><option value="0">No GST</option><option value="18">GST 18%</option><option value="manual">Manual amount</option></select></Field>
                        {(billDraft.gstAmount ?? 0) > 0 && billDraft.gstRate === 0 && <Field label="GST amount"><input className={inputClass} type="number" value={billDraft.gstAmount || ''} onChange={(event) => setBillDraft({ ...billDraft, gstAmount: parseNonNegativeNumber(event.target.value) })} /></Field>}
                        <Field label="LR numbers"><input className={inputClass} value={billDraft.lrNo} onChange={(event) => setBillDraft({ ...billDraft, lrNo: event.target.value })} placeholder="Comma separated" /></Field>
                      </div>
                    </section>

                    <section className="border-t border-slate-100 pt-3">
                      <div className="mb-2 flex items-center justify-between gap-2"><div><h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Bill items</h3><p className="mt-0.5 text-[11px] text-slate-400">Master default is shown for reference; stored final rate is preserved until you edit it.</p></div><button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => setBillDraft({ ...billDraft, items: [...billDraft.items, emptyBillItem()] })}><Plus size={13} /> Add item</button></div>
                      <div className="space-y-2">
                        {billDraft.items.map((item, index) => (
                          <div key={index} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2 sm:grid-cols-2 xl:grid-cols-[minmax(170px,1.4fr)_90px_105px_105px_105px_40px] xl:items-end">
                            <Field label="Item"><select className={inputClass} value={item.itemId || ''} onChange={(event) => { const selected = contextQuery.data?.items.find((entry) => entry.id === event.target.value); updateBillItem(index, selected ? { itemId: selected.id, itemName: selected.name, rate: selected.defaultRate, defaultRate: selected.defaultRate, type: selected.type, unit: selected.unit, bagWeight: selected.bagWeight } : emptyBillItem()) }}><option value="">Select item…</option>{contextQuery.data?.items.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field>
                            <Field label={`Qty (${getBillingUnit(item)})`}><input className={`${inputClass} text-right`} type="number" value={item.qty || ''} onChange={(event) => updateBillItem(index, { qty: parseNonNegativeNumber(event.target.value) })} /></Field>
                            <Field label="Default"><input className={`${inputClass} bg-slate-100 text-right text-slate-500`} readOnly value={item.defaultRate || ''} title="Current item-master default; historical rate mode was not stored" /></Field>
                            <Field label="Final rate"><input className={`${inputClass} text-right`} type="number" value={item.rate || ''} onChange={(event) => updateBillItem(index, { rate: parseNonNegativeNumber(event.target.value) })} /></Field>
                            <Field label="Amount"><div className="flex h-10 items-center justify-end rounded-md border border-slate-200 bg-white px-2.5 font-mono text-sm tabular-nums text-slate-800">{formatInrInteger(item.qty * item.rate)}</div></Field>
                            <button type="button" className="grid h-10 w-10 place-items-center rounded-md border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-40" onClick={() => setBillDraft({ ...billDraft, items: billDraft.items.filter((_, itemIndex) => itemIndex !== index) })} disabled={billDraft.items.length <= 1} aria-label={`Remove item ${index + 1}`}><Trash2 size={14} /></button>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
                      <Metric label="Items" value={preview.totals.itemsTotal} />
                      <Metric label="Transport" value={preview.totals.transport} />
                      <Metric label="GST" value={preview.totals.gstAmount} />
                      <Metric label="Current bill" value={preview.totals.grandTotal} strong />
                    </section>

                    <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      Previous balance and payments are calculated from the ledger and shown in the preview. Edit individual payments from Logs; saving this bill will not change payment records.
                    </div>
                  </div>

                  <aside className="overflow-y-auto rounded-xl border border-slate-200 bg-slate-100 p-3 shadow-sm">
                    <div className="mb-2 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-slate-900">Live bill preview</h3><p className="text-xs text-slate-500">This is the same layout used by Print Bill.</p></div><span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-500">Live</span></div>
                    <div className="flex justify-center overflow-auto rounded-lg border border-slate-200 bg-white p-2">
                      <div style={{ width: `${BILL_PRINT_PAGE_WIDTH_CM}cm`, maxWidth: '100%' }}><BillPrintLayout {...preview.props} /></div>
                    </div>
                  </aside>
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0 text-xs">{errorText ? <span className="inline-flex items-center gap-1.5 text-red-700"><AlertTriangle size={14} />{errorText}</span> : <span className={isDirty ? 'text-amber-700' : 'text-slate-500'}>{isDirty ? 'Unsaved changes' : 'No changes yet'}</span>}</div>
              <div className="flex gap-2"><button type="button" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={requestClose}>Cancel</button><button type="button" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50" onClick={() => { setErrorText(''); void saveMutation.mutateAsync() }} disabled={!editing || !isDirty || saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : 'Save changes'}</button></div>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/60" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[111] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-5 shadow-2xl outline-none">
            <AlertDialog.Title className="text-base font-semibold text-slate-950">Discard unsaved changes?</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-slate-600">Your edits have not been saved. The database record will remain unchanged.</AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2"><AlertDialog.Cancel asChild><button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">Keep editing</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="rounded-md bg-rose-700 px-3 py-2 text-sm font-medium text-white" onClick={closeEditor}>Discard changes</button></AlertDialog.Action></div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  )
}

function emptyBillItem(): BillItemSnapshot {
  return { itemId: '', itemName: '', qty: 0, rate: 0, defaultRate: 0, type: '', unit: '', bagWeight: 50 }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1"><span className="text-[11px] font-medium text-slate-600">{label}</span>{children}</label>
}

function Pill({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'amber' | 'green' }) {
  const colors = tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-800' : tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-700'
  return <span className={`rounded-full border px-2 py-1 text-[11px] ${colors}`}><span className="text-slate-500">{label}</span> <strong>{value || '—'}</strong></span>
}

function Metric({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return <div className={`rounded-lg border px-3 py-2 ${strong ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}><p className="text-[10px] uppercase tracking-[0.08em] text-slate-500">{label}</p><p className={`mt-0.5 font-mono tabular-nums ${strong ? 'text-base font-bold text-blue-900' : 'text-sm font-semibold text-slate-900'}`}>{formatInrInteger(value)}</p></div>
}

const inputClass = 'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
