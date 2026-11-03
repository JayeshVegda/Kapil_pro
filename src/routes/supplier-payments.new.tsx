import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CreditCard,
  Image as ImageIcon,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import {
  bundleToSettlementInput,
  createSupplierPayment,
  listSuppliers,
  loadSupplierBundle,
  type SupplierBundle,
  type SupplierPaymentCreateInput,
} from '@/data/suppliers'
import {
  computeSupplierSettlement,
  validateManualPins,
  type SupplierPool,
} from '@/domain/supplier-settlement'
import { computeDaysSince } from '@/domain/supplier-purchases'
import { rupeesToPaise } from '@/domain/supplier-units'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

const searchSchema = z.object({
  supplierId: z.string().optional(),
  pool: z.enum(['kacha', 'gst']).optional(),
  billId: z.string().optional(),
})

export const Route = createFileRoute('/supplier-payments/new')({
  validateSearch: searchSchema,
  component: NewSupplierPaymentPage,
})

type PaymentKind = 'payment' | 'paid_on_behalf' | 'settle_off' | 'refund_received'
type PaymentMode = 'cash' | 'upi' | 'rtgs' | 'neft' | 'cheque' | 'other'

const PAYMENT_KINDS: Array<{ kind: PaymentKind; label: string; desc: string }> = [
  { kind: 'payment', label: 'Payment', desc: 'Direct payment to supplier (reduces balance)' },
  { kind: 'paid_on_behalf', label: 'Paid for them (labour/transport)', desc: 'Paid third-party on supplier behalf' },
  { kind: 'settle_off', label: 'Small settle-off', desc: 'Write off tiny leftover balance' },
  { kind: 'refund_received', label: 'Refund from supplier', desc: 'Supplier returned cash/bank (increases balance)' },
]

function NewSupplierPaymentPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { supplierId: initialSupplierId, pool: initialPool, billId: initialBillId } = Route.useSearch()

  const [supplierId, setSupplierId] = useState(initialSupplierId ?? '')
  const [date, setDate] = useState(() => getLocalIsoDate())
  const [pool, setPool] = useState<SupplierPool>(initialPool ?? 'kacha')
  const [kind, setKind] = useState<PaymentKind>('payment')
  const [amountRupeesStr, setAmountRupeesStr] = useState('')
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [reference, setReference] = useState('')
  const [payeeName, setPayeeName] = useState('')
  const [privateNote, setPrivateNote] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(
    () => new Set(initialBillId ? [initialBillId] : []),
  )
  const [isManualPicking, setIsManualPicking] = useState(Boolean(initialBillId))
  const [manualPins, setManualPins] = useState<Record<string, string>>({})
  const [statusText, setStatusText] = useState('')

  const suppliersQuery = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => listSuppliers({ includeInactive: false }),
  })

  const bundleQuery = useQuery({
    queryKey: ['supplier-bundle', supplierId],
    queryFn: () => loadSupplierBundle(supplierId),
    enabled: Boolean(supplierId),
  })

  const amountPaise = useMemo(() => {
    return rupeesToPaise(parseFloat(amountRupeesStr) || 0)
  }, [amountRupeesStr])

  // Calculate open bills in the selected pool
  const openBills = useMemo(() => {
    if (!bundleQuery.data) return []
    const bundle: SupplierBundle = bundleQuery.data
    const settlement = computeSupplierSettlement(bundleToSettlementInput(bundle))
    const poolBills = settlement.pools[pool].bills

    const billDetailMap = new Map(bundle.bills.map((b) => [b.id, b]))

    return poolBills
      .filter((b) => b.status !== 'cancelled' && b.duePaise > 0)
      .map((b) => {
        const detail = billDetailMap.get(b.billId)
        return {
          billId: b.billId,
          inNo: detail?.inNo ?? '',
          date: detail?.date ?? '',
          netPaise: b.netPaise,
          paidPaise: b.paidPaise,
          duePaise: b.duePaise,
          daysOld: computeDaysSince(detail?.date ?? ''),
        }
      })
  }, [bundleQuery.data, pool])

  // Pre-fill amount when navigated with initialBillId
  useEffect(() => {
    if (initialBillId && openBills.length > 0) {
      const target = openBills.find((b) => b.billId === initialBillId)
      if (target) {
        setAmountRupeesStr((target.duePaise / 100).toString())
        setIsManualPicking(true)
        setManualPins({ [target.billId]: (target.duePaise / 100).toString() })
        setSelectedBillIds(new Set([target.billId]))
      }
    }
  }, [initialBillId, openBills])

  // FIFO Allocation Preview
  const fifoAllocations = useMemo(() => {
    if (amountPaise <= 0 || openBills.length === 0) {
      return { lines: [], advancePaise: amountPaise }
    }
    let remaining = amountPaise
    const lines: Array<{
      billId: string
      inNo: string
      duePaise: number
      allocatedPaise: number
      isFullyCovered: boolean
    }> = []

    for (const bill of openBills) {
      if (remaining <= 0) break
      const allocated = Math.min(bill.duePaise, remaining)
      lines.push({
        billId: bill.billId,
        inNo: bill.inNo,
        duePaise: bill.duePaise,
        allocatedPaise: allocated,
        isFullyCovered: allocated === bill.duePaise,
      })
      remaining -= allocated
    }

    return { lines, advancePaise: Math.max(0, remaining) }
  }, [amountPaise, openBills])

  // Manual allocation summary & validation
  const manualAllocationSummary = useMemo(() => {
    let totalPinnedPaise = 0
    const parsedAllocations: Array<{ billId: string; amountPaise: number }> = []

    for (const bill of openBills) {
      const pinStr = manualPins[bill.billId]
      if (!pinStr) continue
      const pinnedPaise = rupeesToPaise(parseFloat(pinStr) || 0)
      if (pinnedPaise <= 0) continue

      totalPinnedPaise += pinnedPaise
      parsedAllocations.push({ billId: bill.billId, amountPaise: pinnedPaise })
    }

    const pinCandidates = parsedAllocations.map((p) => ({
      billId: p.billId,
      billPool: pool,
      billDuePaise: openBills.find((b) => b.billId === p.billId)?.duePaise ?? 0,
      pinnedPaise: p.amountPaise,
    }))

    const validation = validateManualPins(pool, amountPaise, pinCandidates)
    const unallocatedPaise = Math.max(0, amountPaise - totalPinnedPaise)

    return {
      totalPinnedPaise,
      unallocatedPaise,
      validation,
      parsedAllocations,
    }
  }, [manualPins, openBills, pool, amountPaise])

  const supplierOptions = useMemo(() => {
    return (suppliersQuery.data ?? []).map((s) => ({
      id: s.id,
      name: s.companyName,
      suffix: s.city ? `(${s.city})` : undefined,
    }))
  }, [suppliersQuery.data])

  // Handler for Kind change
  const handleKindSelect = (nextKind: PaymentKind) => {
    setKind(nextKind)
    if (nextKind === 'paid_on_behalf') {
      setPool('kacha')
    }
  }

  // Handler for Pay Full Due
  const handlePayFullDue = () => {
    const totalDuePaise = openBills.reduce((s, b) => s + b.duePaise, 0)
    setAmountRupeesStr((totalDuePaise / 100).toString())
  }

  // Handler for Pay Selected Bills
  const handlePaySelectedBills = () => {
    const selected = openBills.filter((b) => selectedBillIds.has(b.billId))
    const totalSelectedPaise = selected.reduce((s, b) => s + b.duePaise, 0)
    setAmountRupeesStr((totalSelectedPaise / 100).toString())
    setIsManualPicking(true)
    const pins: Record<string, string> = {}
    for (const b of selected) {
      pins[b.billId] = (b.duePaise / 100).toString()
    }
    setManualPins(pins)
  }

  const toggleBillSelect = (billId: string) => {
    setSelectedBillIds((prev) => {
      const next = new Set(prev)
      if (next.has(billId)) next.delete(billId)
      else next.add(billId)
      return next
    })
  }

  const selectAllBills = () => {
    if (selectedBillIds.size === openBills.length) {
      setSelectedBillIds(new Set())
    } else {
      setSelectedBillIds(new Set(openBills.map((b) => b.billId)))
    }
  }

  const isRefRequired = ['upi', 'rtgs', 'neft', 'cheque'].includes(mode)

  const saveMutation = useMutation({
    mutationFn: async () => {
      setStatusText('')
      if (!supplierId) throw new Error('Please select a supplier.')
      if (amountPaise <= 0) throw new Error('Payment amount must be greater than zero.')

      if (kind === 'paid_on_behalf' && !payeeName.trim()) {
        throw new Error('Payee name is required when paying on behalf of supplier.')
      }

      if (isRefRequired && !reference.trim()) {
        throw new Error(`Reference number / transaction ID is required for ${mode.toUpperCase()} payments.`)
      }

      if (isManualPicking && !manualAllocationSummary.validation.valid) {
        throw new Error(manualAllocationSummary.validation.error ?? 'Manual allocations are invalid.')
      }

      const allocationsToSave = isManualPicking ? manualAllocationSummary.parsedAllocations : undefined

      const payload: SupplierPaymentCreateInput = {
        supplierId,
        date,
        pool,
        kind,
        amountPaise,
        mode,
        reference: reference.trim(),
        payeeName: kind === 'paid_on_behalf' ? payeeName.trim() : undefined,
        privateNote: privateNote.trim(),
        photos: photos.length > 0 ? photos : undefined,
        allocations: allocationsToSave,
      }

      return await createSupplierPayment(payload)
    },
    onSuccess: async () => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
      await queryClient.invalidateQueries({ queryKey: ['supplier-payments'] })
      void navigate({
        to: '/supplier-ledger/$supplierId',
        params: { supplierId },
      })
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  return (
    <div className="w-full space-y-4 px-3 pb-16 pt-3 sm:px-4 lg:px-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <h1 className="text-base font-bold text-slate-900">Record Supplier Payment</h1>
        </div>

        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          <CreditCard size={14} />
          {saveMutation.isPending ? 'Recording...' : 'Save Payment'}
        </button>
      </div>

      {statusText && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {statusText}
        </div>
      )}

      {/* Main Payment Details Form */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        {/* Payment Kind Chips */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700">Payment Type</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
            {PAYMENT_KINDS.map((item) => {
              const active = kind === item.kind
              return (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => handleKindSelect(item.kind)}
                  className={`rounded-lg border p-2.5 text-left transition ${
                    active
                      ? 'border-emerald-500 bg-emerald-50/80 ring-2 ring-emerald-200'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${active ? 'text-emerald-950' : 'text-slate-800'}`}>
                      {item.label}
                    </span>
                    {active && <Check size={14} className="text-emerald-600" />}
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-500">{item.desc}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Supplier, Date, Pool */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-semibold text-slate-700">
              Supplier <span className="text-rose-600">*</span>
            </label>
            <SearchableCombobox
              options={supplierOptions}
              value={supplierId}
              onChange={setSupplierId}
              inputClassName="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              placeholder="Select supplier..."
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Payment Date</label>
            <DateInput
              value={date}
              onChange={setDate}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Pool</label>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
              <button
                type="button"
                className={`rounded-md py-1.5 transition ${
                  pool === 'kacha' ? 'bg-amber-100 text-amber-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setPool('kacha')}
              >
                Kacha
              </button>
              <button
                type="button"
                className={`rounded-md py-1.5 transition ${
                  pool === 'gst' ? 'bg-blue-100 text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setPool('gst')}
              >
                GST
              </button>
            </div>
          </div>
        </div>

        {/* If kind is paid_on_behalf, show Payee Name input */}
        {kind === 'paid_on_behalf' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
            <div className="max-w-md space-y-1">
              <label className="text-xs font-semibold text-amber-900">
                Third-Party Payee Name <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Jamnagar Transport Co., Ramu Labour"
                value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
                className="h-9 w-full rounded-md border border-amber-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-amber-500"
              />
              <p className="text-[10px] text-amber-700">
                This payment reduces what we owe the supplier, but was disbursed directly to this party.
              </p>
            </div>
          </div>
        )}

        {/* Open Bills Box (Shown only when supplier is chosen, BEFORE Amount field) */}
        {supplierId && (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-slate-900">
                  Open Bills ({pool.toUpperCase()} Pool)
                </h3>
                <p className="text-[11px] text-slate-500">
                  {openBills.length === 0
                    ? `No open bills with remaining balance in ${pool} pool.`
                    : `${openBills.length} open bill${openBills.length > 1 ? 's' : ''} available for settlement.`}
                </p>
              </div>

              {openBills.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handlePayFullDue}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
                  >
                    Pay Full Due ({formatPaiseInr(openBills.reduce((s, b) => s + b.duePaise, 0))})
                  </button>
                  {selectedBillIds.size > 0 && (
                    <button
                      type="button"
                      onClick={handlePaySelectedBills}
                      className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                    >
                      Pay Selected ({selectedBillIds.size})
                    </button>
                  )}
                </div>
              )}
            </div>

            {openBills.length > 0 && (
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-2.5 py-2 w-8 text-center">
                        <input
                          type="checkbox"
                          checked={selectedBillIds.size === openBills.length}
                          onChange={selectAllBills}
                          className="rounded text-emerald-600"
                        />
                      </th>
                      <th className="px-2.5 py-2 text-left">IN No</th>
                      <th className="px-2.5 py-2 text-left">Bill Date</th>
                      <th className="px-2.5 py-2 text-right">Age</th>
                      <th className="px-2.5 py-2 text-right">Net Bill</th>
                      <th className="px-2.5 py-2 text-right">Already Paid</th>
                      <th className="px-2.5 py-2 text-right">Due Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {openBills.map((b) => {
                      const isSelected = selectedBillIds.has(b.billId)
                      return (
                        <tr
                          key={b.billId}
                          className={`transition ${isSelected ? 'bg-emerald-50/60' : 'hover:bg-slate-50/70'}`}
                        >
                          <td className="px-2.5 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleBillSelect(b.billId)}
                              className="rounded text-emerald-600"
                            />
                          </td>
                          <td className="px-2.5 py-2 font-mono font-semibold text-blue-700">{b.inNo}</td>
                          <td className="px-2.5 py-2 text-slate-600">{formatFullDate(b.date)}</td>
                          <td className="px-2.5 py-2 text-right font-mono text-slate-600">
                            <span
                              className={
                                b.daysOld > 10
                                  ? 'font-bold text-rose-600'
                                  : b.daysOld >= 7
                                    ? 'font-semibold text-amber-600'
                                    : 'text-slate-600'
                              }
                            >
                              {b.daysOld}d
                            </span>
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-700">
                            {formatPaiseInr(b.netPaise)}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-emerald-700">
                            {formatPaiseInr(b.paidPaise)}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono font-bold tabular-nums text-rose-600">
                            {formatPaiseInr(b.duePaise)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Amount, Mode, Reference, Photo Attach */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Amount (₹) <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              placeholder="0.00"
              value={amountRupeesStr}
              onChange={(e) => setAmountRupeesStr(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Payment Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as PaymentMode)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="rtgs">RTGS</option>
              <option value="neft">NEFT</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-semibold text-slate-700">
              Reference / UTR / Cheque No {isRefRequired && <span className="text-rose-600">*</span>}
            </label>
            <input
              type="text"
              placeholder={isRefRequired ? 'Required for Bank/UPI/Cheque' : 'Optional for cash'}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
        </div>

        {/* Private Note & Photo Slip Attach */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Private Note (Never Printed)</label>
            <textarea
              rows={2}
              placeholder="Internal notes, bank account remarks..."
              value={privateNote}
              onChange={(e) => setPrivateNote(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs text-slate-900 outline-none focus:border-emerald-400"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Attach Payment Slip / Proof</label>
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                <Upload size={13} />
                <span>Upload Slips</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    if (files.length > 0) setPhotos((prev) => [...prev, ...files])
                  }}
                />
              </label>
              {photos.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {photos.map((f, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                    >
                      <ImageIcon size={10} /> {f.name}
                      <button
                        type="button"
                        onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Allocations & FIFO Preview (Rendered ONLY when supplier is selected) */}
      {supplierId && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Bill Matching & Allocation Preview
              </h2>
              <p className="text-[11px] text-slate-500">
                Payments match bills in the same pool ({pool}) via FIFO, or you can manually pin amounts.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={isManualPicking}
                  onChange={(e) => setIsManualPicking(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <span>Manual Bill Picking</span>
              </label>
            </div>
          </div>

          {!isManualPicking ? (
            /* Default FIFO Allocation Preview */
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-2">
                <span className="font-semibold text-slate-700">FIFO Distribution Preview:</span>
                {fifoAllocations.lines.length === 0 ? (
                  <p className="text-slate-500 italic">
                    {amountPaise > 0
                      ? `No open bills in ${pool} pool — the full amount of ${formatPaiseInr(amountPaise)} will be held as advance credit.`
                      : 'Enter an amount above to preview FIFO bill matching.'}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {fifoAllocations.lines.map((l) => (
                      <div
                        key={l.billId}
                        className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-slate-800">
                          {l.isFullyCovered ? (
                            <>Covers <strong className="text-blue-700 font-mono">{l.inNo}</strong> fully</>
                          ) : (
                            <>Covers <strong className="text-blue-700 font-mono">{l.inNo}</strong> partially</>
                          )}
                          <span className="text-slate-400 text-[11px] ml-2">
                            (allocated {formatPaiseInr(l.allocatedPaise)} of {formatPaiseInr(l.duePaise)} due)
                          </span>
                        </span>
                        <span className="font-mono font-bold text-emerald-700">
                          {formatPaiseInr(l.allocatedPaise)}
                        </span>
                      </div>
                    ))}
                    <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between font-semibold text-slate-700">
                      <span>Advance remaining:</span>
                      <span className="font-mono text-emerald-700">
                        {formatPaiseInr(fifoAllocations.advancePaise)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Manual Bill Picking Mode */
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Specify exact amounts to pin against each open bill. Pinned amounts cannot exceed the bill due or
                the total payment amount.
              </p>

              {!manualAllocationSummary.validation.valid && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                  <AlertCircle size={15} className="shrink-0 text-rose-600" />
                  <span>{manualAllocationSummary.validation.error}</span>
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">IN No</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Remaining Due</th>
                      <th className="px-3 py-2 text-right w-44">Pinned Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {openBills.map((b) => (
                      <tr key={b.billId}>
                        <td className="px-3 py-2 font-mono font-bold text-blue-700">{b.inNo}</td>
                        <td className="px-3 py-2 text-slate-600">{formatFullDate(b.date)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">
                          {formatPaiseInr(b.duePaise)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="text"
                            placeholder="0.00"
                            value={manualPins[b.billId] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value
                              setManualPins((prev) => ({ ...prev, [b.billId]: val }))
                            }}
                            className="h-8 w-full rounded border border-slate-300 px-2 text-right font-mono text-xs text-slate-900 outline-none focus:border-emerald-400"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between rounded-lg bg-slate-50 p-2.5 text-xs font-semibold text-slate-700">
                <span>Total Pinned: {formatPaiseInr(manualAllocationSummary.totalPinnedPaise)}</span>
                <span>Unpinned Remainder: {formatPaiseInr(manualAllocationSummary.unallocatedPaise)}</span>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
