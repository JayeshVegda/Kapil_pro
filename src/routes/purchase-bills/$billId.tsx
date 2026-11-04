import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  Edit3,
  Lock,
  Package,
  Printer,
  Trash2,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import {
  BillChitty,
  type BillChittyData,
  type ChittyPaymentRow,
  type ChittyStatus,
} from '@/components/suppliers/bill-chitty'
import {
  AddBardanModal,
  CancelBillModal,
  RecordPaymentModal,
  SettleToNilModal,
} from '@/components/suppliers/bill-modals'
import { pb } from '@/data/pocketbase'
import {
  bundleToSettlementInput,
  loadPurchaseBill,
  loadPurchaseBillIdByInNo,
  loadSupplierBundle,
  loadVilaityHistory,
} from '@/data/suppliers'
import { CREDIT_KINDS, computeSupplierSettlement, type SupplierSettlementBillRow } from '@/domain/supplier-settlement'
import { extractUserNote, parseBagsAtReceiptKg } from '@/domain/supplier-purchases'
import { milliToRateText } from '@/domain/supplier-units'
import { formatFullDate } from '@/lib/date'
import { exportNodeAsJpg } from '@/lib/image-export'

export const Route = createFileRoute('/purchase-bills/$billId')({
  component: PurchaseBillChittyPage,
})

type ChittyModal = null | 'bardan' | 'payment' | 'settleNil' | 'cancelBill'

function findVilaityForDate(history: Array<{ date: string; vilaityMilli: number }>, targetDate: string) {
  if (!history.length) return null
  const exact = history.find((h) => h.date === targetDate)
  if (exact) return exact
  const earlier = history.filter((h) => h.date < targetDate)
  return earlier[earlier.length - 1] ?? history[0]
}

function PurchaseBillChittyPage() {
  const { billId: inNo } = Route.useParams()
  const navigate = useNavigate()
  const exportRef = useRef<HTMLDivElement>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [modal, setModal] = useState<ChittyModal>(null)

  const idQuery = useQuery({
    queryKey: ['purchase-bill-id', inNo],
    queryFn: () => loadPurchaseBillIdByInNo(inNo),
    retry: false,
  })
  const billId = idQuery.data

  const billQuery = useQuery({
    queryKey: ['purchase-bill', billId],
    queryFn: () => loadPurchaseBill(billId!),
    enabled: Boolean(billId),
  })
  const billDetail = billQuery.data
  const bill = billDetail?.bill
  const supplierId = bill?.supplierId ?? ''

  const bundleQuery = useQuery({
    queryKey: ['supplier-bundle', supplierId],
    queryFn: () => loadSupplierBundle(supplierId),
    enabled: Boolean(supplierId),
  })
  const vilaityQuery = useQuery({ queryKey: ['vilaity-history'], queryFn: loadVilaityHistory })

  const bundle = bundleQuery.data

  const settlementBillRow = useMemo<SupplierSettlementBillRow | null>(() => {
    if (!bundle) return null
    const settlement = computeSupplierSettlement(bundleToSettlementInput(bundle))
    return [...settlement.pools.kacha.bills, ...settlement.pools.gst.bills].find((row) => row.billId === billId) ?? null
  }, [bundle, billId])

  const orderedBills = useMemo(() => {
    if (!bundle) return []
    return [...bundle.bills].sort((a, b) => `${a.date}|${a.created}|${a.id}`.localeCompare(`${b.date}|${b.created}|${b.id}`))
  }, [bundle])

  const { prevBill, nextBill } = useMemo(() => {
    const index = orderedBills.findIndex((b) => b.id === billId)
    return {
      prevBill: index > 0 ? orderedBills[index - 1] : null,
      nextBill: index >= 0 && index < orderedBills.length - 1 ? orderedBills[index + 1] : null,
    }
  }, [orderedBills, billId])

  const paidRows = useMemo<ChittyPaymentRow[]>(() => {
    if (!bundle || !billDetail) return []
    const paidPaise = settlementBillRow?.paidPaise ?? 0
    const paymentsById = new Map(bundle.payments.map((p) => [p.id, p]))
    const rows: ChittyPaymentRow[] = []
    let pinSum = 0
    for (const pin of billDetail.allocations) {
      if (pin.amountPaise <= 0) continue
      const payment = paymentsById.get(pin.paymentId)
      if (payment?.cancelled) continue
      rows.push({ date: payment?.date ?? '', mode: payment?.mode ?? '', reference: payment?.reference ?? '', amountPaise: pin.amountPaise, pinned: true })
      pinSum += pin.amountPaise
    }
    let remaining = Math.max(0, paidPaise - pinSum)
    const credits = bundle.payments
      .filter((p) => CREDIT_KINDS.has(p.kind) && !p.cancelled)
      .sort((a, b) => `${a.date}|${a.created}|${a.id}`.localeCompare(`${b.date}|${b.created}|${b.id}`))
    for (const payment of credits) {
      if (remaining <= 0) break
      const applied = Math.min(payment.amountPaise, remaining)
      if (applied <= 0) continue
      rows.push({ date: payment.date, mode: payment.mode, reference: payment.reference, amountPaise: applied, pinned: false })
      remaining -= applied
    }
    return rows
  }, [bundle, billDetail, settlementBillRow])

  const chittyData = useMemo<BillChittyData | null>(() => {
    if (!billDetail || !bundle) return null
    return {
      inNo: billDetail.bill.inNo,
      date: billDetail.bill.date,
      supplierName: bundle.supplier.companyName,
      pool: billDetail.bill.pool,
      taxMode: billDetail.bill.taxMode,
      gstRateBp: billDetail.bill.gstRateBp,
      supplierBillNo: billDetail.bill.supplierBillNo,
      vehicleNo: billDetail.bill.vehicleNo,
      lines: billDetail.lines.map((l) => ({ itemName: l.itemName, weightG: l.weightG, rateMilli: l.rateMilli, amountPaise: l.amountPaise })),
      adjustments: billDetail.adjustments.map((a) => ({ type: a.type, amountPaise: a.amountPaise, note: a.note })),
      bardan: billDetail.bardan.map((b) => ({ bardanG: b.bardanG, rateMilli: b.rateMilli, method: b.method, creditPaise: b.creditPaise, cashAmountPaise: b.cashAmountPaise, date: b.date, note: b.note })),
      paidRows,
      cancelled: billDetail.bill.cancelled,
      cancelReason: billDetail.bill.cancelReason,
      statusOverride: (settlementBillRow?.status as ChittyStatus | undefined) ?? undefined,
    }
  }, [billDetail, bundle, paidRows, settlementBillRow])

  const vilaityMatch = bill ? findVilaityForDate(vilaityQuery.data ?? [], bill.date) : null
  const duePaise = settlementBillRow?.duePaise ?? 0

  const handleExportJpg = async () => {
    if (!exportRef.current) return
    try {
      setIsExporting(true)
      await exportNodeAsJpg(exportRef.current, {
        filename: `chitty-${inNo}.jpg`,
        backgroundColor: '#ffffff',
        preferredWidthPx: 1100,
      })
    } catch (err) {
      console.error('Chitty export failed', err)
    } finally {
      setIsExporting(false)
    }
  }

  if (idQuery.isError || (idQuery.data === null && !idQuery.isLoading)) {
    return (
      <div className="p-6">
        <p className="text-sm text-rose-600">No purchase bill found for IN no “{inNo}”.</p>
        <Link to="/purchase-bills" className="mt-2 inline-flex items-center gap-1 text-sm text-blue-700 underline">
          <ArrowLeft size={14} /> Back to purchase bills
        </Link>
      </div>
    )
  }
  if (!billDetail || !chittyData || !bill) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">Loading chitty…</div>
    )
  }

  const bagNote = parseBagsAtReceiptKg(bill.privateNote)
  const userNote = extractUserNote(bill.privateNote)

  return (
    <div className="min-h-full pb-10">
      {/* Sticky action bar — never exported or printed */}
      <div className="sticky top-0 z-30 flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <button type="button" onClick={() => void navigate({ to: '/purchase-bills' })} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <ArrowLeft size={13} /> Back
        </button>
        <div className="inline-flex items-center rounded-md border border-slate-200">
          <button
            type="button"
            aria-label="Previous bill"
            disabled={!prevBill}
            onClick={() => prevBill && void navigate({ to: '/purchase-bills/$billId', params: { billId: prevBill.inNo } })}
            className="inline-flex h-8 w-8 items-center justify-center text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            aria-label="Next bill"
            disabled={!nextBill}
            onClick={() => nextBill && void navigate({ to: '/purchase-bills/$billId', params: { billId: nextBill.inNo } })}
            className="inline-flex h-8 w-8 items-center justify-center border-l border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:inline" />

        <ActionButton icon={<Edit3 size={13} />} label="Edit" onClick={() => void navigate({ to: '/new-purchase-bill', search: { editBillId: bill.id } })} />
        {!bill.cancelled && (
          <>
            <ActionButton icon={<Package size={13} />} label="Add Bardan" onClick={() => setModal('bardan')} />
            <ActionButton icon={<Coins size={13} />} label="Record Payment" onClick={() => setModal('payment')} />
            <ActionButton icon={<Coins size={13} />} label="Settle to NIL" disabled={duePaise <= 0} onClick={() => setModal('settleNil')} />
            <ActionButton icon={<Trash2 size={13} />} label="Cancel" danger onClick={() => setModal('cancelBill')} />
          </>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <ActionButton icon={<Download size={13} />} label={isExporting ? 'Exporting…' : 'JPG'} onClick={() => void handleExportJpg()} />
          <ActionButton icon={<Printer size={13} />} label="Print" onClick={() => window.print()} />
        </span>
      </div>

      <div className="px-3 pt-3">
        {/* Chitty — the only exported/printed region */}
        <div ref={exportRef} className="rounded-xl bg-slate-100/60 p-2 sm:p-4">
          <BillChitty data={chittyData} mode="view" />
        </div>

        {/* Internal-only strip — never printed or exported */}
        <div className="mx-auto mt-3 w-full max-w-[840px] rounded-lg border border-amber-200/70 bg-amber-50/50 px-4 py-2.5 text-xs text-amber-900">
          <p className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-amber-800">
            <Lock size={12} /> Internal only (not printed)
          </p>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold uppercase text-amber-700/80">Premium vs Vilaity</p>
              {vilaityMatch ? (
                <div className="mt-0.5 space-y-0.5 font-mono">
                  {chittyData.lines.map((line, index) => {
                    const diff = line.rateMilli - vilaityMatch.vilaityMilli
                    return (
                      <p key={index} className="flex justify-between gap-2">
                        <span className="truncate">{line.itemName}</span>
                        <span className={diff >= 0 ? 'text-amber-800' : 'text-blue-800'}>
                          {diff >= 0 ? '+' : '-'}₹{milliToRateText(Math.abs(diff))}
                        </span>
                      </p>
                    )
                  })}
                  <p className="text-[10px] text-amber-600">vilaity ₹{milliToRateText(vilaityMatch.vilaityMilli)}/kg · {formatFullDate(vilaityMatch.date)}</p>
                </div>
              ) : (
                <p className="mt-0.5 text-amber-700">No vilaity rate on record.</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-amber-700/80">Private Note</p>
              <p className="mt-0.5 whitespace-pre-wrap text-amber-900">{userNote || <span className="italic text-amber-700/70">None</span>}</p>
              {bagNote != null && (
                <p className="mt-1 text-[10px] text-blue-800">Receipt bags memo: <span className="font-mono font-bold">{bagNote} kg</span></p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-amber-700/80">Photos</p>
              {bill.photos.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {bill.photos.slice(0, 6).map((photo) => {
                    const url = pb.files.getURL(
                      { id: bill.id, collectionName: 'purchase_bills' } as unknown as { [key: string]: unknown; id: string; collectionName: string },
                      photo,
                    )
                    return (
                      <a key={photo} href={url} target="_blank" rel="noopener noreferrer" className="block h-14 w-14 overflow-hidden rounded border border-amber-200 bg-white">
                        <img src={url} alt="Bill attachment" className="h-full w-full object-cover" />
                      </a>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-0.5 text-amber-700">None</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {modal === 'bardan' && <AddBardanModal billId={bill.id} onClose={() => setModal(null)} />}
      {modal === 'payment' && (
        <RecordPaymentModal
          supplierId={bill.supplierId}
          supplierName={bundle?.supplier.companyName}
          pool={bill.pool}
          pins={[{ billId: bill.id, inNo: bill.inNo, duePaise }]}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'settleNil' && (
        <SettleToNilModal
          supplierId={bill.supplierId}
          pool={bill.pool}
          billId={bill.id}
          inNo={bill.inNo}
          duePaise={duePaise}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'cancelBill' && <CancelBillModal billId={bill.id} inNo={bill.inNo} onClose={() => setModal(null)} />}
    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
