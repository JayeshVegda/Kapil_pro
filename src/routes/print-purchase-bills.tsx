import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  Coins,
  Package,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Printer,
  Search,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import {
  BillChitty,
} from '@/components/suppliers/bill-chitty'
import { buildPurchaseBillPresentation } from '@/components/suppliers/purchase-bill-presentation'
import { AddBardanModal, CancelBillModal, RecordPaymentModal, SettleToNilModal } from '@/components/suppliers/bill-modals'
import { purchaseBillQueryOptions, purchaseBillsQueryOptions, supplierContextQueryOptions } from '@/data/purchase-queries'
import { formatFullDate } from '@/lib/date'
import { exportNodeAsJpg } from '@/lib/image-export'
import { formatPaiseInr } from '@/lib/inr-format'
import { itemsSummary } from '@/components/suppliers/purchase-bills-table'

const searchSchema = z.object({
  billId: z.string().optional(),
})

export const Route = createFileRoute('/print-purchase-bills')({
  validateSearch: searchSchema,
  component: PrintPurchaseBillsPage,
})

type ModalKind = null | 'bardan' | 'payment' | 'settleNil' | 'cancelBill'

function PrintPurchaseBillsPage() {
  const { billId: initialBillId } = Route.useSearch()
  const navigate = useNavigate()
  const exportRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>(initialBillId ?? '')
  const [modal, setModal] = useState<ModalKind>(null)
  const [isExporting, setIsExporting] = useState(false)

  // List data (enriched, newest first)
  const billsQuery = useQuery(purchaseBillsQueryOptions())
  const bills = useMemo(
    () => [...(billsQuery.data ?? [])].sort((a, b) => `${b.date}|${b.created}|${b.id}`.localeCompare(`${a.date}|${a.created}|${a.id}`)),
    [billsQuery.data],
  )

  useEffect(() => {
    if (!selectedId && bills.length > 0) setSelectedId(bills[0].id)
  }, [bills, selectedId])
  useEffect(() => {
    if (initialBillId && initialBillId !== selectedId) setSelectedId(initialBillId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBillId])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return bills
    return bills.filter((bill) =>
      `${bill.inNo} ${bill.supplierName} ${bill.supplierBillNo} ${itemsSummary(bill.lines)}`.toLowerCase().includes(needle),
    )
  }, [bills, query])

  const selectedIndex = filtered.findIndex((bill) => bill.id === selectedId)
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : null

  // Detail refs for the preview
  const detailQuery = useQuery(purchaseBillQueryOptions(selectedId))
  const detail = detailQuery.data
  const supplierId = detail?.bill.supplierId ?? selected?.supplierId ?? ''

  const bundleQuery = useQuery(supplierContextQueryOptions(supplierId))
  const presentation = useMemo(
    () => buildPurchaseBillPresentation(detail, bundleQuery.data),
    [detail, bundleQuery.data],
  )
  const settlementBillRow = presentation?.settlementBillRow
  const chittyData = presentation?.chitty

  const duePaise = settlementBillRow?.duePaise ?? 0

  const goto = (delta: number) => {
    const next = filtered[selectedIndex + delta]
    if (next) setSelectedId(next.id)
  }

  const handleExportJpg = async () => {
    if (!exportRef.current || !detail) return
    try {
      setIsExporting(true)
      await exportNodeAsJpg(exportRef.current, {
        filename: `chitty-${detail.bill.inNo}.jpg`,
        backgroundColor: '#ffffff',
        preferredWidthPx: 1100,
      })
    } catch (error) {
      console.error('Chitty export failed', error)
    } finally {
      setIsExporting(false)
    }
  }

  const cancelBillAction = modal === 'cancelBill' && detail

  return (
    <div className="w-full px-3 pb-10 pt-2 sm:px-4">
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* -------- Left: descending bill list -------- */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              All Purchase Bills
              <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{filtered.length}</span>
            </h2>
            <label className="relative w-48 max-w-full">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter bills…"
                className="h-8 w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-xs outline-none placeholder:text-slate-400 focus:border-slate-500"
                aria-label="Filter bills"
              />
            </label>
          </div>
          <div className="max-h-[74vh] overflow-y-auto rounded-md border border-slate-100 no-scrollbar">
            {billsQuery.isLoading && <p className="px-3 py-6 text-center text-xs text-slate-400">Loading bills…</p>}
            {!billsQuery.isLoading && filtered.length === 0 && <p className="px-3 py-6 text-center text-xs italic text-slate-400">No bills match.</p>}
            <ul className="divide-y divide-slate-100">
              {filtered.map((bill, index) => {
                const active = bill.id === selectedId
                return (
                  <li key={bill.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(bill.id)}
                      className={`flex w-full items-center justify-between gap-2 border-l-4 px-3 py-2 text-left transition ${
                        active ? 'border-l-red-500 bg-rose-50/50' : index % 2 === 0 ? 'border-l-transparent bg-white hover:bg-slate-50' : 'border-l-transparent bg-slate-50/40 hover:bg-slate-50'
                      }`}
                      aria-current={active}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-[12px] font-bold text-blue-700">{bill.inNo}</span>
                          <span className={`text-[11px] font-bold uppercase ${bill.cancelled ? 'text-slate-400 line-through' : bill.status === 'nil' ? 'text-emerald-600' : bill.status === 'partial' ? 'text-amber-700' : 'text-rose-600'}`}>{bill.cancelled ? 'CANCELLED' : bill.status}</span>
                        </span>
                        <span className="block truncate text-[11px] text-slate-600" title={itemsSummary(bill.lines)}>{itemsSummary(bill.lines) || '—'}</span>
                        <span className="text-[11px] text-slate-400">{formatFullDate(bill.date)} · {bill.supplierName}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-[11px] font-semibold tabular-nums text-slate-800">{formatPaiseInr(bill.netPaise)}</span>
                        {bill.duePaise > 0 && <span className="block font-mono text-[11px] tabular-nums text-rose-600">{formatPaiseInr(bill.duePaise)}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* -------- Right: chitty preview + actions -------- */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-8">
          {!selected || !chittyData ? (
            <div className="grid min-h-[70vh] place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center">
              <div>
                <ArrowDown size={20} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm font-semibold text-slate-700">{billsQuery.isLoading ? 'Loading bills…' : 'Select a bill from the list'}</p>
                <p className="mt-1 text-xs text-slate-500">Preview shows the same chitty you can print or export.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Preview · {chittyData.inNo}</h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ActionButton label="Print" icon={<Printer size={13} />} onClick={() => window.print()} />
                  <ActionButton label="JPG" icon={<Download size={13} />} onClick={() => void handleExportJpg()} disabled={isExporting} />
                  <ActionButton label="Edit" icon={<Edit3 size={13} />} tone="blue" onClick={() => void navigate({ to: '/new-purchase-bill', search: { editBillId: selected.id } })} />
                  {!selected.cancelled && (
                    <>
                      <ActionButton label="Bardan" icon={<Package size={13} />} onClick={() => setModal('bardan')} />
                      <ActionButton label="Pay" icon={<Coins size={13} />} onClick={() => setModal('payment')} />
                      <ActionButton label="Settle NIL" onClick={() => setModal('settleNil')} disabled={duePaise <= 0} />
                      <ActionButton label="Cancel" icon={<Trash2 size={13} />} tone="danger" onClick={() => setModal('cancelBill')} />
                    </>
                  )}
                  <div className="inline-flex items-center rounded-md border border-slate-200">
                    <button type="button" aria-label="Previous bill" disabled={selectedIndex <= 0} onClick={() => goto(-1)} className="inline-flex h-8 w-8 items-center justify-center text-slate-500 transition hover:bg-slate-50 disabled:opacity-30">
                      <ChevronLeft size={14} />
                    </button>
                    <button type="button" aria-label="Next bill" disabled={selectedIndex >= filtered.length - 1} onClick={() => goto(1)} className="inline-flex h-8 w-8 items-center justify-center border-l border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-30">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="max-h-[72vh] overflow-auto rounded-lg border border-slate-100 p-1">
                <div ref={exportRef}>
                  <BillChitty data={chittyData} mode="view" />
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Modals */}
      {modal === 'bardan' && selected && <AddBardanModal billId={selected.id} onClose={() => setModal(null)} />}
      {modal === 'payment' && selected && (
        <RecordPaymentModal
          supplierId={selected.supplierId}
          supplierName={selected.supplierName}
          pool={selected.pool}
          pins={[{ billId: selected.id, inNo: selected.inNo, duePaise }]}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'settleNil' && selected && (
        <SettleToNilModal
          supplierId={selected.supplierId}
          pool={selected.pool}
          billId={selected.id}
          inNo={selected.inNo}
          duePaise={duePaise}
          onClose={() => setModal(null)}
        />
      )}
      {cancelBillAction && selected && (
        <CancelBillModal
          billId={selected.id}
          inNo={selected.inNo}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon?: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'blue' | 'danger'
}) {
  const styles =
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
      : tone === 'blue'
        ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}>
      {icon}
      {label}
    </button>
  )
}
