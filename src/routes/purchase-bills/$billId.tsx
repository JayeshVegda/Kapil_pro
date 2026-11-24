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
  MoreHorizontal,
  Package,
  Printer,
  Trash2,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { BillChitty } from '@/components/suppliers/bill-chitty'
import { isBrassBenchmarkItem } from '@/domain/purchase-market-benchmark'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { buttonClass } from '@/components/ui/form-control-classes'
import { buildPurchaseBillPresentation } from '@/components/suppliers/purchase-bill-presentation'
import {
  AddBardanModal,
  CancelBillModal,
  RecordPaymentModal,
  SettleToNilModal,
} from '@/components/suppliers/bill-modals'
import { pb } from '@/data/pocketbase'
import {
  loadPurchaseBillIdByInNo,
  loadVilaityHistory,
} from '@/data/suppliers'
import { purchaseBillQueryOptions, supplierContextQueryOptions } from '@/data/purchase-queries'
import { milliToRateText } from '@/domain/supplier-units'
import { formatFullDate } from '@/lib/date'
import { toUserMessage } from '@/app/errors'
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
  return earlier[earlier.length - 1] ?? null
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

  const billQuery = useQuery(purchaseBillQueryOptions(billId ?? ''))
  const billDetail = billQuery.data
  const bill = billDetail?.bill
  const supplierId = bill?.supplierId ?? ''

  const bundleQuery = useQuery(supplierContextQueryOptions(supplierId))
  const vilaityQuery = useQuery({ queryKey: ['vilaity-history'], queryFn: loadVilaityHistory })

  const bundle = bundleQuery.data?.bundle

  const presentation = useMemo(
    () => buildPurchaseBillPresentation(billDetail, bundleQuery.data),
    [billDetail, bundleQuery.data],
  )
  const settlementBillRow = presentation?.settlementBillRow
  const chittyData = presentation?.chitty

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
        <p className="text-sm text-rose-600">{idQuery.isError ? toUserMessage(idQuery.error) : `No purchase bill found for IN no “${inNo}”.`}</p>
        <Link to="/purchase-bills" className="mt-2 inline-flex items-center gap-1 text-sm text-blue-700 underline">
          <ArrowLeft size={14} /> Back to purchase bills
        </Link>
      </div>
    )
  }
  if (billQuery.isError || bundleQuery.isError) {
    return <div className="p-6 text-sm text-rose-600" role="alert">{toUserMessage(billQuery.error ?? bundleQuery.error)}<button type="button" className="ml-3 underline" onClick={() => { void billQuery.refetch(); void bundleQuery.refetch() }}>Retry</button></div>
  }
  if (!billDetail || !chittyData || !bill) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">Loading chitty…</div>
    )
  }

  const bagNote = presentation?.bagsAtReceiptKg
  const userNote = presentation?.userNote

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

        {!bill.cancelled && (
          <>
            <ActionButton icon={<Coins size={13} />} label="Record Payment" onClick={() => setModal('payment')} />
            <ActionButton icon={<Package size={13} />} label="Add Bardan" onClick={() => setModal('bardan')} />
          </>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <ActionButton icon={<Printer size={13} />} label="Print" disabled={!chittyData.supplierName.trim()} onClick={() => window.print()} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More bill actions" className={`${buttonClass('secondary')} h-8 px-2.5 text-xs`}>
                <MoreHorizontal size={14} /> More
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onSelect={() => void navigate({ to: '/new-purchase-bill', search: { editBillId: bill.id } })}><Edit3 size={14} /> Edit</DropdownMenuItem>
              {!bill.cancelled && <DropdownMenuItem disabled={duePaise <= 0} onSelect={() => setModal('settleNil')}><Coins size={14} /> Settle to NIL</DropdownMenuItem>}
              <DropdownMenuItem disabled={isExporting} onSelect={() => void handleExportJpg()}><Download size={14} /> JPG</DropdownMenuItem>
              {!bill.cancelled && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setModal('cancelBill')}><Trash2 size={14} /> Cancel bill</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      <div className="px-3 pt-3 space-y-3 max-w-4xl mx-auto">
        {/* Chitty — the only exported/printed region */}
        <div ref={exportRef} className="rounded-xl bg-slate-100/60 p-2 sm:p-4">
          <BillChitty data={chittyData} mode="view" />
        </div>

        {/* Internal-only strip — never printed or exported */}
        <div className="mx-auto mt-3 w-full max-w-4xl rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-700 print:hidden">
          <p className="flex items-center gap-1.5 font-semibold text-slate-900">
            <Lock size={14} /> Internal only · Not printed
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-600">Brass premium vs Vilaity</p>
              {vilaityMatch && chittyData.lines.some((line) => isBrassBenchmarkItem(line.itemName)) ? (
                <div className="mt-0.5 space-y-0.5 font-mono">
                  {chittyData.lines.filter((line) => isBrassBenchmarkItem(line.itemName)).map((line, index) => {
                    const diff = line.rateMilli - vilaityMatch.vilaityMilli
                    return (
                      <p key={index} className="flex min-w-0 justify-between gap-2">
                        <span className="min-w-0 break-words">{line.itemName}</span>
                        <span className="shrink-0 text-slate-800">
                          {diff >= 0 ? '+' : '-'}₹{milliToRateText(Math.abs(diff))}
                        </span>
                      </p>
                    )
                  })}
                  <p className="break-words text-xs text-slate-500">Vilaity ₹{milliToRateText(vilaityMatch.vilaityMilli)}/kg · {formatFullDate(vilaityMatch.date)}</p>
                </div>
              ) : (
                <p className="mt-0.5 text-slate-500">No matching market comparison.</p>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-600">Private Note</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-slate-800">{userNote || <span className="italic text-slate-500">None</span>}</p>
              {bagNote != null && (
                <p className="mt-1 break-words text-xs text-slate-600">Receipt bags memo: <span className="font-mono font-bold">{bagNote.toFixed(3)} kg</span></p>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-600">Photos</p>
              {bill.photos.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {bill.photos.slice(0, 6).map((photo) => {
                    const url = pb.files.getURL(
                      { id: bill.id, collectionName: 'purchase_bills' } as unknown as { [key: string]: unknown; id: string; collectionName: string },
                      photo,
                    )
                    return (
                      <a key={photo} href={url} target="_blank" rel="noopener noreferrer" className="block h-14 w-14 overflow-hidden rounded-md border border-slate-200 bg-white">
                        <img src={url} alt="Bill attachment" width={56} height={56} className="h-full w-full object-cover" />
                      </a>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-0.5 text-slate-500">None</p>
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
      aria-label={label}
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
