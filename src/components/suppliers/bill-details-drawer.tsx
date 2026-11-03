import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Edit3,
  Lock,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { pb } from '@/data/pocketbase'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { DateInput } from '@/components/ui/date-input'
import {
  addPurchaseBardanEntry,
  cancelPurchaseBill,
  loadPurchaseBill,
  loadVilaityHistory,
} from '@/data/suppliers'
import { parseBagsAtReceiptKg } from '@/domain/supplier-purchases'
import { formatFullDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'
import {
  gramsToKgText,
  kgToGrams,
  lineAmountPaise,
  milliToRateText,
  rupeesToPaise,
} from '@/domain/supplier-units'

function findVilaityForDate(
  history: Array<{ date: string; vilaityMilli: number }>,
  targetDate: string,
): { date: string; vilaityMilli: number } | null {
  if (!history || history.length === 0) return null
  const exact = history.find((h) => h.date === targetDate)
  if (exact) return exact
  const earlier = history.filter((h) => h.date < targetDate)
  if (earlier.length > 0) return earlier[earlier.length - 1]
  return history[0]
}

export function BillDetailsDrawer({
  billId,
  initialShowAddBardan = false,
  onClose,
}: {
  billId: string | null
  initialShowAddBardan?: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const billQuery = useQuery({
    queryKey: ['purchase-bill-drawer', billId],
    queryFn: () => (billId ? loadPurchaseBill(billId) : null),
    enabled: Boolean(billId),
  })

  const vilaityQuery = useQuery({
    queryKey: ['vilaity-history'],
    queryFn: loadVilaityHistory,
  })

  // Add Bardan state
  const [showAddBardan, setShowAddBardan] = useState(initialShowAddBardan)
  const [bardanKgStr, setBardanKgStr] = useState('')
  const [bardanLineId, setBardanLineId] = useState('')
  const [bardanMethod, setBardanMethod] = useState<'deduct' | 'in_kind' | 'cash_back' | 'advance'>('deduct')
  const [bardanDate, setBardanDate] = useState('')
  const [bardanNote, setBardanNote] = useState('')
  const [bardanCashStr, setBardanCashStr] = useState('')
  const [bardanError, setBardanError] = useState('')

  // Cancel Bill state
  const [showCancelPrompt, setShowCancelPrompt] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState('')

  if (!billId) return null

  const detail = billQuery.data
  if (billQuery.isLoading) {
    return (
      <div className="fixed inset-0 z-[75] flex justify-end bg-slate-900/40 backdrop-blur-xs" onClick={onClose}>
        <div className="h-full w-full max-w-xl bg-white p-5 shadow-2xl flex items-center justify-center">
          <p className="text-xs text-slate-400">Loading bill details...</p>
        </div>
      </div>
    )
  }

  if (billQuery.isError || !detail) {
    return (
      <div className="fixed inset-0 z-[75] flex justify-end bg-slate-900/40 backdrop-blur-xs" onClick={onClose}>
        <div className="h-full w-full max-w-xl bg-white p-5 shadow-2xl space-y-3">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="text-sm font-bold text-slate-800">Error</h3>
            <button type="button" onClick={onClose}><X size={16} /></button>
          </div>
          <p className="text-xs text-rose-600">Failed to load purchase bill.</p>
        </div>
      </div>
    )
  }

  const { bill, lines, adjustments, bardan, allocations } = detail
  const hasManualAllocations = allocations.length > 0
  const vilaityMatch = findVilaityForDate(vilaityQuery.data ?? [], bill.date)

  const selectedLine = lines.find((l) => l.id === (bardanLineId || lines[0]?.id)) || lines[0]
  const bardanRateMilli = selectedLine?.rateMilli ?? 0
  const bardanGrams = kgToGrams(parseFloat(bardanKgStr) || 0)
  const bardanCreditPaise =
    bardanMethod === 'deduct' || bardanMethod === 'advance'
      ? lineAmountPaise(bardanGrams, bardanRateMilli)
      : 0
  const bardanCashPaise = bardanMethod === 'cash_back' ? rupeesToPaise(parseFloat(bardanCashStr) || 0) : 0

  const addBardan = async () => {
    if (bardanGrams <= 0) throw new Error('Please enter a valid bardan weight in kg.')
    await addPurchaseBardanEntry({
      billId: bill.id,
      bardanG: bardanGrams,
      rateLineId: selectedLine?.id,
      rateMilli: bardanRateMilli,
      method: bardanMethod,
      creditPaise: bardanCreditPaise,
      cashAmountPaise: bardanCashPaise,
      date: bardanDate || bill.date,
      note: bardanNote.trim(),
    })
    setShowAddBardan(false)
    setBardanKgStr('')
    setBardanNote('')
    setBardanCashStr('')
    await queryClient.invalidateQueries({ queryKey: ['purchase-bill-drawer', billId] })
    await invalidateAfterSupplierPurchaseWrite(queryClient, bill.supplierId)
  }

  const cancelBill = async () => {
    if (!cancelReason.trim()) throw new Error('Cancellation reason is required.')
    await cancelPurchaseBill(bill.id, cancelReason.trim())
    setShowCancelPrompt(false)
    await queryClient.invalidateQueries({ queryKey: ['purchase-bill-drawer', billId] })
    await invalidateAfterSupplierPurchaseWrite(queryClient, bill.supplierId)
    onClose()
  }

  const memoBagsKg = parseBagsAtReceiptKg(bill.privateNote)

  return (
    <div className="fixed inset-0 z-[75] flex justify-end bg-slate-900/40 backdrop-blur-xs" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl p-5 space-y-5"
        role="dialog"
        aria-label="Purchase Bill Details"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Bill {bill.inNo || bill.id}</h2>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                  bill.pool === 'gst' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-800'
                }`}
              >
                {bill.pool}
              </span>
              {bill.cancelled && (
                <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                  Cancelled
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Date: {formatFullDate(bill.date)} {bill.supplierBillNo && `• Supplier Inv: ${bill.supplierBillNo}`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        {hasManualAllocations && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
            <AlertTriangle size={15} className="shrink-0 text-amber-600" />
            <span>
              <strong>Notice:</strong> This bill has manual payment allocations assigned. Editing quantities or totals
              will modify remaining dues.
            </span>
          </div>
        )}

        {/* Quick Actions Bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
          <Link
            to="/purchase-bills/new"
            search={{ supplierId: bill.supplierId, editBillId: bill.id }}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Edit3 size={13} /> Edit Bill
          </Link>

          {!bill.cancelled && (
            <button
              type="button"
              onClick={() => setShowCancelPrompt(true)}
              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
            >
              <Trash2 size={13} /> Cancel Bill
            </button>
          )}

          <Link
            to="/supplier-ledger/$supplierId"
            params={{ supplierId: bill.supplierId }}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 ml-auto"
          >
            Open Ledger
          </Link>
        </div>

        {/* Cancel Prompt Dialog */}
        {showCancelPrompt && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2 text-xs">
            <p className="font-semibold text-rose-900">Confirm Soft Cancellation</p>
            <p className="text-rose-700 text-[11px]">
              This bill will be kept in the audit log but zeroed out for balances. Enter a reason below:
            </p>
            {cancelError && <p className="text-xs text-rose-600 font-bold">{cancelError}</p>}
            <input
              type="text"
              placeholder="Reason for cancelling (required)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="h-8 w-full rounded border border-rose-300 bg-white px-2 text-xs text-slate-900 outline-none"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCancelPrompt(false)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
              >
                Keep Bill
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await cancelBill()
                  } catch (e) {
                    setCancelError(toUserMessage(e))
                  }
                }}
                className="rounded bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        )}

        {/* Bill Meta Card */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <div>
            <span className="text-slate-500">Tax Mode:</span>{' '}
            <span className="font-semibold uppercase text-slate-800">{bill.taxMode}</span>
            {bill.gstRateBp > 0 && <span className="ml-1 text-slate-600">({bill.gstRateBp / 100}%)</span>}
          </div>
          <div>
            <span className="text-slate-500">Vehicle No:</span>{' '}
            <span className="font-semibold text-slate-800">{bill.vehicleNo || '—'}</span>
          </div>
        </div>

        {/* Line Items */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">Line Items (Raw Brass)</h3>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-2.5 py-1.5 text-left">Item</th>
                  <th className="px-2.5 py-1.5 text-right">Weight (kg)</th>
                  <th className="px-2.5 py-1.5 text-right">Rate (₹/kg)</th>
                  <th className="px-2.5 py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-2.5 py-1.5 font-medium text-slate-800">{l.itemName}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono">{gramsToKgText(l.weightG)}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono">₹{milliToRateText(l.rateMilli)}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono font-bold text-slate-800">
                      {formatPaiseInr(l.amountPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Internal Market Premium vs Vilaity (Internal Only) */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-1.5 text-xs text-amber-900">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <Lock size={12} />
            <span>Market Premium vs Vilaity</span>
            <span className="rounded bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
              Internal Only
            </span>
          </div>
          {vilaityMatch ? (
            <div className="space-y-1">
              <p className="text-[11px] text-amber-700">
                Vilaity reference ({formatFullDate(vilaityMatch.date)}): ₹{milliToRateText(vilaityMatch.vilaityMilli)}/kg
              </p>
              {lines.map((l) => {
                const diffMilli = l.rateMilli - vilaityMatch.vilaityMilli
                const isPremium = diffMilli >= 0
                return (
                  <div key={l.id} className="flex justify-between font-mono text-[11px]">
                    <span>{l.itemName}</span>
                    <span>
                      {isPremium ? '+' : '-'}₹{milliToRateText(Math.abs(diffMilli))}/kg {isPremium ? 'premium' : 'discount'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-[11px] text-amber-700">No Vilaity rate recorded for this date period.</p>
          )}
        </div>

        {/* Adjustments */}
        {adjustments.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">Adjustments</h3>
            <div className="rounded border border-slate-200 divide-y divide-slate-100 text-xs">
              {adjustments.map((a) => (
                <div key={a.id} className="flex justify-between px-3 py-2 text-slate-700">
                  <span className="capitalize">{a.type.replace('_', ' ')}</span>
                  <span className="font-mono font-semibold">{formatPaiseInr(a.amountPaise)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bags Weighed at Receipt Memo Reference */}
        {memoBagsKg != null && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/80 p-2.5 text-xs text-blue-900">
            <span className="font-semibold">Receipt Bags Memo:</span>{' '}
            <span className="font-mono font-bold">{memoBagsKg} kg</span>
            <p className="mt-0.5 text-[10px] text-blue-700">Empty-bag weight recorded at receipt as reference for settlement.</p>
          </div>
        )}

        {/* Bardan Entries & Add Bardan Form */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Bardan Entries</h3>
            {!bill.cancelled && !showAddBardan && (
              <button
                type="button"
                onClick={() => setShowAddBardan(true)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                <Plus size={13} /> Add Bardan
              </button>
            )}
          </div>

          {showAddBardan && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-blue-950">New Bardan Settlement Entry</span>
                <button
                  type="button"
                  onClick={() => setShowAddBardan(false)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X size={14} />
                </button>
              </div>

              {bardanError && <p className="text-xs text-rose-600">{bardanError}</p>}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-slate-600">Bardan Weight (kg)</label>
                  <input
                    type="text"
                    placeholder="e.g. 45.000"
                    value={bardanKgStr}
                    onChange={(e) => setBardanKgStr(e.target.value)}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2 font-mono text-xs text-slate-900 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-600">Settlement Method</label>
                  <select
                    value={bardanMethod}
                    onChange={(e) => setBardanMethod(e.target.value as any)}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none"
                  >
                    <option value="deduct">Deduct (Credit kg × rate)</option>
                    <option value="in_kind">In Kind (Settled, nil)</option>
                    <option value="cash_back">Cash Back (Refund memo)</option>
                    <option value="advance">Advance (Future pool payment)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-slate-600">Rate Line</label>
                  <select
                    value={bardanLineId}
                    onChange={(e) => setBardanLineId(e.target.value)}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none"
                  >
                    {lines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.itemName} (₹{milliToRateText(l.rateMilli)}/kg)
                      </option>
                    ))}
                  </select>
                </div>

                {bardanMethod === 'cash_back' ? (
                  <div>
                    <label className="text-[11px] font-medium text-slate-600">Cash Back Amount (₹)</label>
                    <input
                      type="text"
                      placeholder="₹ amount"
                      value={bardanCashStr}
                      onChange={(e) => setBardanCashStr(e.target.value)}
                      className="h-8 w-full rounded border border-slate-300 bg-white px-2 font-mono text-xs text-slate-900 outline-none"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-[11px] font-medium text-slate-600">Date</label>
                    <DateInput
                      value={bardanDate || bill.date}
                      onChange={setBardanDate}
                      className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-600">Note / Bags description</label>
                <input
                  type="text"
                  placeholder="e.g. 50 plastic bags returned"
                  value={bardanNote}
                  onChange={(e) => setBardanNote(e.target.value)}
                  className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none"
                />
              </div>

              {/* Preview banner */}
              <div className="rounded bg-white p-2 border border-blue-200 text-xs">
                {bardanMethod === 'deduct' && (
                  <p className="text-slate-700">
                    Credit Preview: <strong>{formatPaiseInr(bardanCreditPaise)}</strong> (deducted from bill payable)
                  </p>
                )}
                {bardanMethod === 'in_kind' && (
                  <p className="text-slate-600 italic">Money ₹0.00 — settled in kind with note.</p>
                )}
                {bardanMethod === 'cash_back' && (
                  <p className="text-slate-600">
                    Memo cash back: <strong>{formatPaiseInr(bardanCashPaise)}</strong> (no effect on payable).
                  </p>
                )}
                {bardanMethod === 'advance' && (
                  <p className="text-emerald-700 font-medium">
                    Creates an advance payment of <strong>{formatPaiseInr(bardanCreditPaise)}</strong> in the {bill.pool} pool.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddBardan(false)}
                  className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await addBardan()
                    } catch (e) {
                      setBardanError(toUserMessage(e))
                    }
                  }}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Save Bardan
                </button>
              </div>
            </div>
          )}

          {bardan.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No bardan settled yet for this bill.</p>
          ) : (
            <div className="space-y-1.5">
              {bardan.map((b) => (
                <div key={b.id} className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>
                      Method: <span className="uppercase text-blue-700">{b.method}</span>
                    </span>
                    <span className="font-mono">{gramsToKgText(b.bardanG)} kg</span>
                  </div>
                  {b.creditPaise > 0 && (
                    <div className="flex justify-between text-slate-600 font-mono">
                      <span>Credit:</span>
                      <span>{formatPaiseInr(b.creditPaise)}</span>
                    </div>
                  )}
                  {b.cashAmountPaise > 0 && (
                    <div className="flex justify-between text-slate-600 font-mono">
                      <span>Cash Back:</span>
                      <span>{formatPaiseInr(b.cashAmountPaise)}</span>
                    </div>
                  )}
                  {b.note && <p className="text-[11px] text-slate-500 italic">Note: {b.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Private Note (Internal only) */}
        {bill.privateNote && (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs">
            <span className="font-semibold text-slate-700">Private Note (Internal):</span>
            <p className="mt-1 text-slate-600 whitespace-pre-wrap">{bill.privateNote}</p>
          </div>
        )}

        {/* Photos */}
        {bill.photos && bill.photos.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">Attached Photos</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {bill.photos.map((photo) => {
                const photoUrl = pb.files.getURL(
                  { id: bill.id, collectionName: 'purchase_bills' } as unknown as { [key: string]: unknown; id: string; collectionName: string },
                  photo,
                )
                return (
                  <a
                    key={photo}
                    href={photoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-lg border border-slate-200 hover:opacity-90"
                  >
                    <img src={photoUrl} alt="Bill attachment" className="h-28 w-full object-cover" />
                  </a>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
