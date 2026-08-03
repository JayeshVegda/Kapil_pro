import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit3, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import {
  deleteBillWithItems,
  deletePayment,
  loadTransactionsContext,
  restoreBillFromSnapshot,
  restorePaymentFromSnapshot,
  updateBillWithItems,
  updatePayment,
} from '@/data/transactions'
import { DASHBOARD_QUERY_KEY } from '@/domain/dashboard'
import { cleanupExpiredTrash, type BillItemSnapshot, type BillSnapshot, type PaymentSnapshot, buildTransactionRows, matchesTransactionSearch, type TransactionRow, type TrashEntry } from '@/domain/transactions'
import { formatDateTime, toDateTimeLocalInputValue, toStoredDateTimeValue } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/transactions')({
  validateSearch: (search: Record<string, unknown>) => ({
    focusKind: search.focusKind === 'bill' || search.focusKind === 'payment' ? search.focusKind : '',
    focusId: typeof search.focusId === 'string' ? search.focusId : '',
  }),
  component: TransactionsPage,
})

const TRANSACTIONS_QUERY_KEY = ['transactions-page'] as const
const TRASH_STORAGE_KEY = 'kapil-transactions-trash-v1'
const pollMs = 60_000

const paymentSchema = z.object({
  date: z.string().min(1, 'Date and time is required'),
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  amount: z.number().positive(),
  mode: z.enum(['Cash', 'Bank']),
  note: z.string(),
})

const billSchema = z.object({
  date: z.string().min(1, 'Date and time is required'),
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  bookNo: z.number().int().positive(),
  billNo: z.number().int().positive(),
  mktRate: z.number().nonnegative(),
  transport: z.number().nonnegative(),
  gstRate: z.number().nonnegative(),
  gstAmount: z.number().nonnegative().optional(),
  lrNo: z.string(),
  items: z.array(
    z.object({
      itemId: z.string().optional(),
      itemName: z.string().trim().min(1),
      qty: z.number().positive(),
      rate: z.number().positive(),
    }),
  ).min(1),
})

function readTrashEntries(): TrashEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRASH_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return cleanupExpiredTrash(parsed as TrashEntry[])
  } catch {
    return []
  }
}

function writeTrashEntries(entries: TrashEntry[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TRASH_STORAGE_KEY, JSON.stringify(cleanupExpiredTrash(entries)))
}

function formatTimeLeft(deletedAt: number) {
  const msLeft = Math.max(0, deletedAt + 3 * 60 * 60 * 1000 - Date.now())
  const totalMinutes = Math.ceil(msLeft / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m left`
  return `${hours}h ${minutes}m left`
}

function TransactionsPage() {
  const routeSearch = Route.useSearch()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'bill' | 'payment'>('all')
  const [viewMode, setViewMode] = useState<'active' | 'deleted'>('active')
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>(() => readTrashEntries())
  const [editing, setEditing] = useState<TransactionRow | null>(null)
  const [billDraft, setBillDraft] = useState<Omit<BillSnapshot, 'id'> | null>(null)
  const [paymentDraft, setPaymentDraft] = useState<Omit<PaymentSnapshot, 'id'> | null>(null)
  const autoOpenedFocusRef = useRef('')

  const transactionsQuery = useQuery({
    queryKey: TRANSACTIONS_QUERY_KEY,
    queryFn: loadTransactionsContext,
  })

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTrashEntries((prev) => {
        const next = cleanupExpiredTrash(prev)
        if (next.length !== prev.length) writeTrashEntries(next)
        return next
      })
    }, pollMs)
    return () => window.clearInterval(timer)
  }, [])

  const rows = useMemo(() => {
    if (!transactionsQuery.data) return []
    return buildTransactionRows(transactionsQuery.data)
  }, [transactionsQuery.data])

  const trashMap = useMemo(() => {
    const map = new Map<string, TrashEntry>()
    for (const entry of trashEntries) map.set(entry.key, entry)
    return map
  }, [trashEntries])

  const visibleRows = useMemo(() => {
    const base = viewMode === 'active' ? rows.filter((row) => !trashMap.has(row.key)) : trashEntries.map((entry) => entry.snapshot)
    if (routeSearch.focusId && routeSearch.focusKind) {
      return base.filter((row) => row.kind === routeSearch.focusKind && row.id === routeSearch.focusId)
    }
    return base.filter((row) => (kindFilter === 'all' ? true : row.kind === kindFilter)).filter((row) => matchesTransactionSearch(row, search))
  }, [rows, trashEntries, viewMode, kindFilter, search, trashMap, routeSearch.focusId, routeSearch.focusKind])

  useEffect(() => {
    if (!routeSearch.focusId || !routeSearch.focusKind) return
    const key = `${routeSearch.focusKind}:${routeSearch.focusId}`
    if (autoOpenedFocusRef.current === key) return
    const row = rows.find((entry) => entry.kind === routeSearch.focusKind && entry.id === routeSearch.focusId)
    if (!row) return
    autoOpenedFocusRef.current = key
    startEdit(row)
  }, [routeSearch.focusId, routeSearch.focusKind, rows])

  const deleteMutation = useMutation({
    mutationFn: async (row: TransactionRow) => {
      if (row.kind === 'bill') await deleteBillWithItems(row.id)
      else await deletePayment(row.id)
      return row
    },
    onSuccess: async (row) => {
      const next = cleanupExpiredTrash([...trashEntries, { key: row.key, deletedAt: Date.now(), snapshot: row }])
      setTrashEntries(next)
      writeTrashEntries(next)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: TRANSACTIONS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
      ])
    },
  })

  const restoreMutation = useMutation({
    mutationFn: async (entry: TrashEntry) => {
      if (entry.snapshot.kind === 'bill') await restoreBillFromSnapshot(entry.snapshot.bill)
      else await restorePaymentFromSnapshot(entry.snapshot.payment)
      return entry
    },
    onSuccess: async (entry) => {
      const next = trashEntries.filter((item) => item.key !== entry.key)
      setTrashEntries(next)
      writeTrashEntries(next)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: TRANSACTIONS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
      ])
    },
  })

  const editMutation = useMutation({
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
      setEditing(null)
      setBillDraft(null)
      setPaymentDraft(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: TRANSACTIONS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
      ])
    },
  })

  function startEdit(row: TransactionRow) {
    setEditing(row)
    if (row.kind === 'bill') {
      setBillDraft({
        date: row.bill.date,
        customerId: row.bill.customerId,
        customerName: row.bill.customerName,
        bookNo: row.bill.bookNo,
        billNo: row.bill.billNo,
        mktRate: row.bill.mktRate,
        transport: row.bill.transport,
        gstRate: row.bill.gstRate,
        gstAmount: row.bill.gstAmount,
        lrNo: row.bill.lrNo,
        items: row.bill.items.length > 0 ? row.bill.items : [{ itemId: '', itemName: '', qty: 0, rate: 0 }],
      })
    } else {
      setPaymentDraft({
        date: row.payment.date,
        customerId: row.payment.customerId,
        customerName: row.payment.customerName,
        amount: row.payment.amount,
        mode: row.payment.mode,
        note: row.payment.note,
      })
    }
  }

  function updateBillItem(index: number, patch: Partial<BillItemSnapshot>) {
    setBillDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        items: prev.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      }
    })
  }

  function addBillItem() {
    setBillDraft((prev) => (prev ? { ...prev, items: [...prev.items, { itemId: '', itemName: '', qty: 0, rate: 0 }] } : prev))
  }

  function removeBillItem(index: number) {
    setBillDraft((prev) => {
      if (!prev) return prev
      if (prev.items.length <= 1) return prev
      return { ...prev, items: prev.items.filter((_, i) => i !== index) }
    })
  }

  const customers = transactionsQuery.data?.customers ?? []
  const items = transactionsQuery.data?.items ?? []

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-[260px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30" placeholder="Search party, type, reference..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <select className={`${inputClass} lg:w-40 lg:flex-none`} value={kindFilter} onChange={(event) => setKindFilter(event.target.value as 'all' | 'bill' | 'payment')}>
            <option value="all">All types</option>
            <option value="bill">Bills</option>
            <option value="payment">Payments</option>
          </select>
          <div className="inline-flex flex-none rounded-md border border-slate-300 bg-slate-50 p-0.5 text-xs">
            <button type="button" className={`rounded px-3 py-1.5 ${viewMode === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`} onClick={() => setViewMode('active')}>
              Active
            </button>
            <button type="button" className={`rounded px-3 py-1.5 ${viewMode === 'deleted' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`} onClick={() => setViewMode('deleted')}>
              Deleted
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {transactionsQuery.isLoading && <p className="text-sm text-slate-500">Loading transactions...</p>}
        {transactionsQuery.isError && <p className="text-sm text-red-600">Unable to load transactions.</p>}
        {!transactionsQuery.isLoading && !transactionsQuery.isError && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[920px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Party</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Reference</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                      No transactions found for selected filters.
                    </td>
                  </tr>
                )}
                {visibleRows.map((row, index) => (
                  <tr key={row.key} className={`border-t border-slate-100 ${routeSearch.focusId === row.id && routeSearch.focusKind === row.kind ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                    <td className="px-3 py-3 text-sm text-slate-700">{formatDateTime(row.date)}</td>
                    <td className="px-3 py-3 text-sm">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.kind === 'bill' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {row.subtitle}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm font-medium text-slate-800">{row.customerName}</td>
                    <td className="px-3 py-3 text-sm text-slate-700">{row.reference}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-900">{formatInrInteger(row.amount)}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex gap-2">
                        {viewMode === 'active' && (
                          <>
                            <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100" onClick={() => startEdit(row)}>
                              <Edit3 size={12} /> Edit
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                              onClick={() => void deleteMutation.mutateAsync(row)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </>
                        )}
                        {viewMode === 'deleted' && (
                          <>
                            <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                              {formatTimeLeft(trashMap.get(row.key)?.deletedAt ?? Date.now())}
                            </span>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                              onClick={() => {
                                const entry = trashMap.get(row.key)
                                if (entry) void restoreMutation.mutateAsync(entry)
                              }}
                              disabled={restoreMutation.isPending}
                            >
                              <RotateCcw size={12} /> Restore
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">{editing.kind === 'bill' ? 'Edit Bill' : 'Edit Payment'}</h3>
              <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100" onClick={() => setEditing(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 p-4">
              {editing.kind === 'payment' && paymentDraft && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Date & Time">
                    <input
                      className={inputClass}
                      type="datetime-local"
                      value={toDateTimeLocalInputValue(paymentDraft.date)}
                      onChange={(event) => setPaymentDraft({ ...paymentDraft, date: toStoredDateTimeValue(event.target.value) })}
                    />
                  </Field>
                  <Field label="Customer">
                    <select
                      className={inputClass}
                      value={paymentDraft.customerId}
                      onChange={(event) => {
                        const nextId = event.target.value
                        const customer = customers.find((item) => item.id === nextId)
                        setPaymentDraft({ ...paymentDraft, customerId: nextId, customerName: customer?.name ?? '' })
                      }}
                    >
                      <option value="">Select customer...</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Mode">
                    <select className={inputClass} value={paymentDraft.mode} onChange={(event) => setPaymentDraft({ ...paymentDraft, mode: event.target.value === 'Bank' ? 'Bank' : 'Cash' })}>
                      <option value="Cash">Cash</option>
                      <option value="Bank">Bank</option>
                    </select>
                  </Field>
                  <Field label="Amount">
                    <input className={inputClass} type="number" value={paymentDraft.amount || ''} onChange={(event) => setPaymentDraft({ ...paymentDraft, amount: parseNonNegativeNumber(event.target.value) })} />
                  </Field>
                  <Field label="Note">
                    <input className={inputClass} value={paymentDraft.note} onChange={(event) => setPaymentDraft({ ...paymentDraft, note: event.target.value })} />
                  </Field>
                </div>
              )}
              {editing.kind === 'bill' && billDraft && (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="Date & Time">
                      <input
                        className={inputClass}
                        type="datetime-local"
                        value={toDateTimeLocalInputValue(billDraft.date)}
                        onChange={(event) => setBillDraft({ ...billDraft, date: toStoredDateTimeValue(event.target.value) })}
                      />
                    </Field>
                    <Field label="Customer">
                      <select
                        className={inputClass}
                        value={billDraft.customerId}
                        onChange={(event) => {
                          const nextId = event.target.value
                          const customer = customers.find((item) => item.id === nextId)
                          setBillDraft({ ...billDraft, customerId: nextId, customerName: customer?.name ?? '' })
                        }}
                      >
                        <option value="">Select customer...</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Book No">
                      <input className={inputClass} type="number" value={billDraft.bookNo} onChange={(event) => setBillDraft({ ...billDraft, bookNo: parseNonNegativeNumber(event.target.value) })} />
                    </Field>
                    <Field label="Bill No">
                      <input className={inputClass} type="number" value={billDraft.billNo} onChange={(event) => setBillDraft({ ...billDraft, billNo: parseNonNegativeNumber(event.target.value) })} />
                    </Field>
                    <Field label="MKT Rate">
                      <input className={inputClass} type="number" value={billDraft.mktRate} onChange={(event) => setBillDraft({ ...billDraft, mktRate: parseNonNegativeNumber(event.target.value) })} />
                    </Field>
                    <Field label="Transport">
                      <input className={inputClass} type="number" value={billDraft.transport} onChange={(event) => setBillDraft({ ...billDraft, transport: parseNonNegativeNumber(event.target.value) })} />
                    </Field>
                    <Field label="GST %">
                      <input className={inputClass} type="number" value={billDraft.gstRate} onChange={(event) => setBillDraft({ ...billDraft, gstRate: parseNonNegativeNumber(event.target.value) })} />
                    </Field>
                    <Field label="LR No">
                      <input className={inputClass} value={billDraft.lrNo} onChange={(event) => setBillDraft({ ...billDraft, lrNo: event.target.value })} />
                    </Field>
                  </div>
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-slate-900">Bill Items</h4>
                      <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={addBillItem}>
                        <Plus size={12} /> Add Row
                      </button>
                    </div>
                    <div className="mb-1 hidden grid-cols-[1fr_110px_110px_110px_76px] gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400 md:grid">
                      <span>Item</span>
                      <span className="text-right">Qty</span>
                      <span className="text-right">Rate</span>
                      <span className="text-right">Amount</span>
                      <span />
                    </div>
                    <div className="space-y-2">
                      {billDraft.items.map((item, index) => (
                        <div key={index} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_110px_110px_110px_76px] md:items-center">
                          <select
                            className={inputClass}
                            value={item.itemId || items.find((entry) => entry.name === item.itemName)?.id || ''}
                            onChange={(event) => {
                              const nextId = event.target.value
                              const selected = items.find((entry) => entry.id === nextId)
                              updateBillItem(index, { itemId: nextId, itemName: selected?.name ?? '' })
                            }}
                          >
                            <option value="">Select item...</option>
                            {items.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.name}
                              </option>
                            ))}
                          </select>
                          <input className={`${inputClass} text-right`} type="number" value={item.qty || ''} onChange={(event) => updateBillItem(index, { qty: parseNonNegativeNumber(event.target.value) })} placeholder="Qty" />
                          <input className={`${inputClass} text-right`} type="number" value={item.rate || ''} onChange={(event) => updateBillItem(index, { rate: parseNonNegativeNumber(event.target.value) })} placeholder="Rate" />
                          <p className="text-right font-mono text-sm tabular-nums text-slate-800 max-md:px-0.5">{formatInrInteger(item.qty * item.rate)}</p>
                          <button type="button" className="rounded-md border border-rose-300 bg-white px-2 py-2 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-60" onClick={() => removeBillItem(index)} disabled={billDraft.items.length <= 1}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const base = billDraft.items.reduce((sum, item) => sum + item.qty * item.rate, 0)
                      const gst = (base * billDraft.gstRate) / 100
                      const total = base + gst + billDraft.transport
                      return (
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-x-5 gap-y-1 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                          <span>Items <strong className="font-mono tabular-nums text-slate-800">{formatInrInteger(base)}</strong></span>
                          {billDraft.transport > 0 && <span>Transport <strong className="font-mono tabular-nums text-slate-800">{formatInrInteger(billDraft.transport)}</strong></span>}
                          {gst > 0 && <span>GST <strong className="font-mono tabular-nums text-slate-800">{formatInrInteger(gst)}</strong></span>}
                          <span className="text-sm text-slate-600">
                            New Total <strong className="font-mono text-base font-bold tabular-nums text-slate-900">{formatInrInteger(total)}</strong>
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                </>
              )}
            </div>
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60" onClick={() => void editMutation.mutateAsync()} disabled={editMutation.isPending}>
                {editMutation.isPending ? 'Saving...' : 'Save Changes'}
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

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
