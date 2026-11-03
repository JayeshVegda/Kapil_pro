import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  CreditCard,
  Lock,
} from 'lucide-react'
import { useMemo, useState } from 'react'
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
import { rupeesToPaise } from '@/domain/supplier-units'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

const searchSchema = z.object({
  supplierId: z.string().optional(),
})

export const Route = createFileRoute('/supplier-payments/new')({
  validateSearch: searchSchema,
  component: NewSupplierPaymentPage,
})

type PaymentKind = 'payment' | 'paid_on_behalf' | 'settle_off' | 'refund_received'
type PaymentMode = 'cash' | 'upi' | 'rtgs' | 'neft' | 'cheque' | 'other'

function NewSupplierPaymentPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { supplierId: initialSupplierId } = Route.useSearch()

  const [supplierId, setSupplierId] = useState(initialSupplierId ?? '')
  const [date, setDate] = useState(() => getLocalIsoDate())
  const [pool, setPool] = useState<SupplierPool>('kacha')
  const [kind, setKind] = useState<PaymentKind>('payment')
  const [amountRupeesStr, setAmountRupeesStr] = useState('')
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [reference, setReference] = useState('')
  const [payeeName, setPayeeName] = useState('')
  const [privateNote, setPrivateNote] = useState('')
  const [isManualPicking, setIsManualPicking] = useState(false)
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
          duePaise: b.duePaise,
        }
      })
  }, [bundleQuery.data, pool])

  // FIFO Allocation Preview
  const fifoAllocations = useMemo(() => {
    if (amountPaise <= 0 || openBills.length === 0) {
      return { lines: [], advancePaise: amountPaise }
    }
    let remaining = amountPaise
    const lines: Array<{ billId: string; inNo: string; duePaise: number; allocatedPaise: number }> = []

    for (const bill of openBills) {
      if (remaining <= 0) break
      const allocated = Math.min(bill.duePaise, remaining)
      lines.push({
        billId: bill.billId,
        inNo: bill.inNo,
        duePaise: bill.duePaise,
        allocatedPaise: allocated,
      })
      remaining -= allocated
    }

    return { lines, advancePaise: Math.max(0, remaining) }
  }, [amountPaise, openBills])

  // Manual allocation summary & validation
  const manualAllocationSummary = useMemo(() => {
    let totalPinnedPaise = 0
    const errors: string[] = []
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
    if (!validation.valid && validation.error) {
      errors.push(validation.error)
    }

    const advancePaise = Math.max(0, amountPaise - totalPinnedPaise)
    return {
      totalPinnedPaise,
      advancePaise,
      parsedAllocations,
      errors,
    }
  }, [manualPins, openBills, amountPaise, pool])

  const supplierOptions = useMemo(() => {
    return (suppliersQuery.data ?? []).map((s) => ({
      id: s.id,
      name: s.companyName,
      suffix: s.city ? `(${s.city})` : undefined,
    }))
  }, [suppliersQuery.data])

  // Switch kind rules
  const handleKindChange = (nextKind: PaymentKind) => {
    setKind(nextKind)
    if (nextKind === 'paid_on_behalf') {
      setPool('kacha')
    }
  }

  // Mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error('Please select a supplier.')
      if (amountPaise <= 0) throw new Error('Please enter a valid payment amount.')

      if (isManualPicking && manualAllocationSummary.errors.length > 0) {
        throw new Error(manualAllocationSummary.errors[0])
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
        allocations: allocationsToSave,
      }

      return await createSupplierPayment(payload)
    },
    onSuccess: async () => {
      await invalidateAfterSupplierPurchaseWrite(queryClient, supplierId)
      void navigate({
        to: '/supplier-ledger/$supplierId',
        params: { supplierId },
      })
    },
    onError: (error) => setStatusText(toUserMessage(error)),
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
          <h1 className="text-base font-bold text-slate-900">New Supplier Payment</h1>
        </div>

        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          <CreditCard size={14} />
          {saveMutation.isPending ? 'Recording...' : 'Record Payment'}
        </button>
      </div>

      {statusText && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {statusText}
        </div>
      )}

      {/* Payment Details Form */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-semibold text-slate-700">
              Supplier <span className="text-rose-600">*</span>
            </label>
            <SearchableCombobox
              options={supplierOptions}
              value={supplierId}
              onChange={setSupplierId}
              inputClassName="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="Search supplier..."
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Payment Date</label>
            <DateInput
              value={date}
              onChange={setDate}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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
                disabled={kind === 'paid_on_behalf'}
                className={`rounded-md py-1.5 transition ${
                  pool === 'gst' ? 'bg-blue-100 text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                } ${kind === 'paid_on_behalf' ? 'opacity-40 cursor-not-allowed' : ''}`}
                onClick={() => setPool('gst')}
              >
                GST
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Payment Type / Kind</label>
            <select
              value={kind}
              onChange={(e) => handleKindChange(e.target.value as PaymentKind)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="payment">Direct Payment</option>
              <option value="paid_on_behalf">Paid On Behalf (Labour/Transporter)</option>
              <option value="settle_off">Settle Off (Write-off small diff)</option>
              <option value="refund_received">Refund Received (Increases Due)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Amount (₹) <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 50000 or 50k"
              value={amountRupeesStr}
              onChange={(e) => setAmountRupeesStr(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-xs font-bold text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as PaymentMode)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="rtgs">RTGS</option>
              <option value="neft">NEFT</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Reference / UTR / Cheque</label>
            <input
              type="text"
              placeholder="Optional reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        {kind === 'paid_on_behalf' && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Payee Name (Transporter, Driver, Labour Contractor) <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              placeholder="Who received this money on behalf of the supplier?"
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        )}
      </section>

      {/* Bill Allocation & Matching Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Bill Allocation ({pool.toUpperCase()} Pool)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isManualPicking
                ? 'Manual Pinning: Select exact open bills and assign payment amounts.'
                : 'FIFO Allocation (Default): Automatically covers oldest open bills in this pool first.'}
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 transition ${
                !isManualPicking ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setIsManualPicking(false)}
            >
              Automatic FIFO
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 transition ${
                isManualPicking ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setIsManualPicking(true)}
            >
              Pick Bills Manually
            </button>
          </div>
        </div>

        {openBills.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 text-xs text-emerald-800">
            <p className="font-semibold">No open bills in the {pool} pool.</p>
            <p className="mt-1 text-slate-600">
              The entire payment of <strong>{formatPaiseInr(amountPaise)}</strong> will be recorded as a pre-bill advance in
              the {pool} pool.
            </p>
          </div>
        ) : !isManualPicking ? (
          /* FIFO Preview Table */
          <div className="space-y-3">
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left">IN No</th>
                    <th className="px-3 py-2 text-left">Bill Date</th>
                    <th className="px-3 py-2 text-right">Current Due</th>
                    <th className="px-3 py-2 text-right">FIFO Covered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {openBills.map((bill) => {
                    const match = fifoAllocations.lines.find((l) => l.billId === bill.billId)
                    const coveredPaise = match?.allocatedPaise ?? 0
                    return (
                      <tr key={bill.billId}>
                        <td className="px-3 py-2 font-mono font-medium text-blue-700">{bill.inNo}</td>
                        <td className="px-3 py-2 text-slate-500">{formatFullDate(bill.date)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatPaiseInr(bill.duePaise)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">
                          {coveredPaise > 0 ? formatPaiseInr(coveredPaise) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <span className="text-slate-600">Unapplied Leftover (Advance):</span>
              <span className="font-mono font-bold text-emerald-700">
                {formatPaiseInr(fifoAllocations.advancePaise)}
              </span>
            </div>
          </div>
        ) : (
          /* Manual Pinning Table */
          <div className="space-y-3">
            {manualAllocationSummary.errors.length > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-1">
                {manualAllocationSummary.errors.map((err, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <AlertCircle size={14} className="shrink-0 text-rose-600" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left">IN No</th>
                    <th className="px-3 py-2 text-left">Bill Date</th>
                    <th className="px-3 py-2 text-right">Bill Total</th>
                    <th className="px-3 py-2 text-right">Current Due</th>
                    <th className="px-3 py-2 text-right w-44">Pinned Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {openBills.map((bill) => (
                    <tr key={bill.billId}>
                      <td className="px-3 py-2 font-mono font-medium text-blue-700">{bill.inNo}</td>
                      <td className="px-3 py-2 text-slate-500">{formatFullDate(bill.date)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600">{formatPaiseInr(bill.netPaise)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-rose-700">
                        {formatPaiseInr(bill.duePaise)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="text"
                          placeholder="₹ pin"
                          value={manualPins[bill.billId] ?? ''}
                          onChange={(e) =>
                            setManualPins((prev) => ({
                              ...prev,
                              [bill.billId]: e.target.value,
                            }))
                          }
                          className="h-8 w-full rounded border border-slate-300 px-2 text-right font-mono text-xs text-slate-900 outline-none focus:border-blue-400"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div>
                <span className="text-slate-500">Total Pinned to Bills:</span>{' '}
                <span className="font-mono font-bold text-slate-900">
                  {formatPaiseInr(manualAllocationSummary.totalPinnedPaise)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-500">Leftover Advance:</span>{' '}
                <span className="font-mono font-bold text-emerald-700">
                  {formatPaiseInr(manualAllocationSummary.advancePaise)}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Private Notes Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <Lock size={12} className="text-slate-400" />
          <span>Private Notes (Internal Only)</span>
        </label>
        <textarea
          rows={2}
          placeholder="Private remark for internal record..."
          value={privateNote}
          onChange={(e) => setPrivateNote(e.target.value)}
          className="w-full rounded-md border border-slate-300 p-2 text-xs text-slate-900 outline-none focus:border-blue-400"
        />
      </section>
    </div>
  )
}
