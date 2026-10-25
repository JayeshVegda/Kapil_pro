import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type RefObject } from 'react'
import { Check, Eye, RefreshCw, RotateCcw, Search, Sparkles, X } from 'lucide-react'
import { pb } from '@/data/pocketbase'
import { countPendingDrafts, loadDraftItemMasters, loadDraftPage, type DraftStatusFilter } from '@/data/bill-drafts'
import { loadCustomerAutoBalanceContext } from '@/data/customer-balance'
import { buildDraftView, type DraftView } from '@/domain/drafts'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger, formatRate, formatInQty } from '@/lib/inr-format'
import { pollWhileTabVisible } from '@/lib/poll-while-visible'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM, type BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import {
  BILL_PREVIEW_CARD_CLASS,
  BILL_PRINT_DOCUMENT_TITLE,
  downloadBillLayoutAsJpg,
  printBillLayoutFromElement,
  shareBillLayoutImageWithWhatsAppFallback,
} from '@/lib/bill-print-export'
import { buildBillPreviewProps } from '@/lib/bill-preview-props'
import { calculateBillTotals } from '@/domain/billing-calculations'

export const Route = createFileRoute('/drafts')({
  component: DraftsPage,
})

const PER_PAGE = 25

function DraftsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<DraftStatusFilter>('pending')
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [previewDraft, setPreviewDraft] = useState<DraftView | null>(null)
  const [previewStatus, setPreviewStatus] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)

  const itemsQuery = useQuery({
    queryKey: ['draft-page-items'],
    queryFn: loadDraftItemMasters,
    staleTime: 5 * 60_000,
  })

  const draftsQuery = useQuery({
    queryKey: ['bill-drafts-page', statusFilter, page, search],
    queryFn: () => loadDraftPage({ page, perPage: PER_PAGE, status: statusFilter, search }),
    refetchInterval: pollWhileTabVisible(8000),
    placeholderData: (previous) => previous,
  })

  const pendingCountQuery = useQuery({
    queryKey: ['bill-drafts-pending-count'],
    queryFn: countPendingDrafts,
    refetchInterval: pollWhileTabVisible(8000),
  })

  const views = (draftsQuery.data?.drafts ?? []).map(({ draft, items, payments }) =>
    buildDraftView(draft, items, payments, itemsQuery.data ?? []),
  )

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['bill-drafts-page'] })
    void queryClient.invalidateQueries({ queryKey: ['bill-drafts-pending-count'] })
  }

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await pb.collection('bill_drafts').update(id, { status })
    },
    onSuccess: () => {
      refreshAll()
    },
  })

  const loadIntoBill = (view: DraftView, autoOpenPreview = false) => {
    const raw = draftsQuery.data?.drafts.find((entry) => entry.draft.id === view.id)
    if (!raw) return
    sessionStorage.setItem(
      'kapil-loaded-draft',
      JSON.stringify({ ...raw.draft, items: raw.items.map((row) => ({
        itemId: String(row.item ?? ''),
        itemName: String(row.item_name ?? ''),
        qty: Number(row.qty ?? 0),
        bags: Number(row.bags ?? 0),
        rate: Number(row.rate ?? 0),
      })), payments: raw.payments, autoOpenPreview }),
    )
    void navigate({ to: '/new-bill' })
  }

  const changeSearch = (value: string) => {
    setSearchInput(value)
  }

  const commitSearch = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const totalItems = draftsQuery.data?.totalItems ?? 0
  const totalPages = Math.max(1, draftsQuery.data?.totalPages ?? 1)

  return (
    <div className="w-full space-y-4 px-3 pb-12 pt-3 sm:px-5 lg:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm"><Sparkles size={15} /></span>
          <h2 className="text-sm font-semibold text-slate-900">AI Drafts</h2>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${pendingCountQuery.data ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
            {pendingCountQuery.data ?? 0} pending
          </span>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          disabled={draftsQuery.isFetching}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={13} className={draftsQuery.isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold text-slate-600">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => { setStatusFilter(status); setPage(1) }}
              className={`rounded-md px-3 py-1.5 capitalize transition ${statusFilter === status ? 'bg-white font-bold text-indigo-700 shadow-sm' : 'hover:text-slate-900'}`}
            >
              {status === 'pending' ? `Pending (${pendingCountQuery.data ?? 0})` : status}
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(event) => changeSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') commitSearch() }}
            onBlur={commitSearch}
            placeholder="Search party, notes, bill #…"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {draftsQuery.isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-800">
          <p className="text-sm font-bold">Failed to load drafts</p>
          <p className="mt-1 text-xs font-mono">{draftsQuery.error instanceof Error ? draftsQuery.error.message : String(draftsQuery.error)}</p>
        </div>
      ) : draftsQuery.isLoading ? (
        <div className="grid place-items-center rounded-xl border border-slate-200 bg-white py-14 text-slate-500">
          <RefreshCw size={22} className="animate-spin text-indigo-600" />
          <p className="mt-2 text-xs font-semibold">Loading drafts…</p>
        </div>
      ) : views.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-bold text-slate-900">{search ? 'No matching drafts' : `No ${statusFilter === 'all' ? '' : statusFilter + ' '}drafts`}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">Bills Muse stages (dictated or bill photos) land here for review. Approve, load into the editor, or reject with feedback.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] uppercase font-bold tracking-wider text-slate-500">
                <th className="px-3.5 py-2.5">Party</th>
                <th className="px-2 py-2.5">Bill</th>
                <th className="px-2 py-2.5">Date</th>
                <th className="px-2 py-2.5">Items</th>
                <th className="px-2 py-2.5 text-right">Qty / Bags</th>
                <th className="px-2 py-2.5 text-right">MKT</th>
                <th className="px-2 py-2.5 text-right">Total</th>
                <th className="px-2 py-2.5 text-right">Advance</th>
                <th className="px-2 py-2.5">Match</th>
                <th className="px-3.5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {views.map((view) => {
                const isPending = view.status !== 'approved' && view.status !== 'rejected'
                const firstItem = view.rows[0]
                return (
                  <tr key={view.id} className={`transition hover:bg-slate-50/70 ${isPending ? '' : 'opacity-70'}`}>
                    <td className="max-w-[220px] px-3.5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-black text-white ${view.isPartyLinked ? 'bg-indigo-500' : 'bg-amber-500'}`}>
                          {(view.customerName || 'P').charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{view.customerName || 'Unmatched Party'}</p>
                          {view.notes && <p className="truncate text-[10px] italic text-slate-400">“{view.notes}”</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-[11px] text-slate-700">
                      {view.convertedBill
                        ? 'converted'
                        : view.bookNo > 0 || view.billNo > 0
                          ? `${view.bookNo > 0 ? `${view.bookNo}/` : ''}${view.billNo || '—'}`
                          : 'auto'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-slate-600">{view.date ? formatFullDate(view.date) : '—'}</td>
                    <td className="max-w-[200px] px-2 py-2.5">
                      {view.rows.length === 0 ? (
                        <span className="text-slate-400">no items</span>
                      ) : (
                        <p className="truncate text-slate-800">
                          {firstItem.itemName}
                          {firstItem.rate > 0 ? ` @ ${formatRate(firstItem.rate)}` : ' @ auto'}
                          {view.rows.length > 1 ? ` +${view.rows.length - 1}` : ''}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {formatInQty(view.totalQty, 'kg')} / {view.totalBags}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-amber-800">{view.mkt > 0 ? `₹${view.mkt}` : '—'}</td>
                    <td className="px-2 py-2.5 text-right font-mono font-bold tabular-nums text-slate-900">
                      {view.itemsSubtotal > 0 ? formatInrInteger(view.grandTotal) : '—'}
                      {view.isEstimate && <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800">est.</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-emerald-700">{view.advanceTotal > 0 ? formatInrInteger(view.advanceTotal) : '—'}</td>
                    <td className="px-2 py-2.5">
                      {view.isPartyLinked ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">linked</span>
                      ) : (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">unmatched</span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {isPending ? (
                          <>
                            <button type="button" onClick={() => updateStatusMutation.mutate({ id: view.id, status: 'rejected' })} title="Reject" className="rounded-md border border-slate-200 p-1 text-rose-600 transition hover:bg-rose-50"><X size={13} /></button>
                            <button type="button" onClick={() => setPreviewDraft(view)} title="Preview" className="rounded-md border border-indigo-200 bg-indigo-50 p-1 text-indigo-700 transition hover:bg-indigo-100"><Eye size={13} /></button>
                            <button type="button" onClick={() => loadIntoBill(view)} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-indigo-700"><Check size={12} /> Load</button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => setPreviewDraft(view)} title="Preview" className="rounded-md border border-slate-200 p-1 text-slate-600 transition hover:bg-slate-50"><Eye size={13} /></button>
                            <button type="button" onClick={() => updateStatusMutation.mutate({ id: view.id, status: 'pending_review' })} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"><RotateCcw size={12} /> Re-open</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-200 px-3.5 py-2 text-[11px] text-slate-500">
            <span>{totalItems} draft{totalItems === 1 ? '' : 's'}{search ? ` matching “${search}”` : ''}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current: number) => Math.max(1, current - 1))} className="rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">Prev</button>
              <span className="font-mono">page {page} / {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((current: number) => Math.min(totalPages, current + 1))} className="rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      )}

      {previewDraft && (
        <DraftPreviewModal
          view={previewDraft}
          onClose={() => { setPreviewDraft(null); setPreviewStatus('') }}
          previewRef={previewRef}
          status={previewStatus}
          setStatus={setPreviewStatus}
          onEdit={() => {
            const current = previewDraft
            setPreviewDraft(null)
            loadIntoBill(current, false)
          }}
          onApprove={() => {
            updateStatusMutation.mutate({ id: previewDraft.id, status: 'approved' })
            setPreviewDraft(null)
          }}
        />
      )}
    </div>
  )
}

type PreviewModalProps = {
  view: DraftView
  onClose: () => void
  previewRef: RefObject<HTMLDivElement | null>
  status: string
  setStatus: (value: string) => void
  onEdit: () => void
  onApprove: () => void
}

function DraftPreviewModal({ view, onClose, previewRef, status, setStatus, onEdit, onApprove }: PreviewModalProps) {
  const isPending = view.status !== 'approved' && view.status !== 'rejected'
  const balanceQuery = useQuery({
    queryKey: ['bill-drafts-preview-balance', view.customerId, view.date],
    queryFn: () => loadCustomerAutoBalanceContext(view.customerId, view.date),
    enabled: view.isPartyLinked,
    staleTime: 30_000,
  })
  const balance = balanceQuery.data ?? null

  const previewRows = view.rows.map((row) => ({
    itemName: row.itemName,
    qty: row.qty,
    rate: row.rate,
    amount: row.amount,
    bags: row.bags,
    type: row.isGas ? 'gas' : 'electronic',
    unit: row.unit,
  }))
  const isGst = view.gstMode === 'percent18' || view.gstRate === 18
  const calcTotals = calculateBillTotals({
    items: previewRows.map((row) => ({ qty: row.qty, rate: row.rate })),
    transport: view.transport,
    gstRate: isGst ? 18 : 0,
    gstAmountOverride: view.gstAmount > 0 ? view.gstAmount : null,
  })

  const previewProps: BillPrintLayoutProps | null = buildBillPreviewProps({
    bookNo: view.bookNo || 69,
    billNo: view.billNo || 0,
    date: view.date || new Date().toISOString().slice(0, 10),
    customerName: view.customerName || 'Unmatched Party',
    mktRate: view.mkt,
    itemRows: previewRows,
    gstAmount: calcTotals.gstAmount,
    transport: view.transport,
    gstRate: calcTotals.gstRate,
    currentBillTotal: calcTotals.grandTotal,
    balance: view.isPartyLinked ? balance : null,
    quickPayments: view.payments.map((payment, index) => ({ id: payment.id || `p${index}`, date: (payment.date || view.date || '').slice(0, 10), amount: Number(payment.amount || 0) })),
    totalQty: view.totalQty,
    totalBags: view.totalBags,
    lrList: view.lrNo ? view.lrNo.split(',').map((part) => part.trim()).filter(Boolean) : [],
  })

  const printDraft = () => {
    if (!previewRef.current) return
    printBillLayoutFromElement(previewRef.current, BILL_PRINT_DOCUMENT_TITLE, setStatus)
  }
  const saveJpg = async () => {
    if (!previewRef.current) return
    try {
      await downloadBillLayoutAsJpg(previewRef.current, `draft-preview-${view.billNo || view.customerName || 'bill'}.jpg`)
      setStatus('')
    } catch {
      setStatus('Unable to save JPG.')
    }
  }
  const shareWhatsApp = async () => {
    if (!previewRef.current || !previewProps) return
    const billRef = `${previewProps.bookNo}/${previewProps.billNo || 'Draft'}`
    const message = [
      'Kapil Products',
      `Bill Ref: ${billRef}`,
      `Party: ${previewProps.customerName}`,
      `Date: ${formatFullDate(previewProps.date)}`,
      `Current Bill: ${formatInrInteger(previewProps.currentBillTotal)}`,
      ...previewProps.periodCreditEntries.map((credit) => `Advance Paid: ${formatInrInteger(credit.amount)}`),
      `Net Total: ${formatInrInteger(previewProps.finalTotal)}`,
    ].join('\n')
    await shareBillLayoutImageWithWhatsAppFallback({ element: previewRef.current, imageFilename: `draft-preview-${view.billNo || 'bill'}.jpg`, message, setStatus })
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/60 px-3 py-4 backdrop-blur-sm sm:px-4 sm:py-8">
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[840px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-4rem)]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">Draft Preview</h3>
              {view.mkt > 0 && <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-900">MKT ₹{view.mkt}</span>}
              {isGst && <span className="rounded-full border border-purple-200 bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800">18% GST</span>}
              {view.isEstimate && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">estimate — some rates auto</span>}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {view.customerName || 'Unmatched Party'} · {view.date ? formatFullDate(view.date) : 'no date'} · {view.rows.length} item{view.rows.length === 1 ? '' : 's'}
              {view.isPartyLinked ? '' : ' · party not linked, ledger balance unavailable'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
        </div>

        {view.isPartyLinked && balanceQuery.isFetching && (
          <div className="border-b border-slate-200 bg-blue-50 px-5 py-1.5 text-[11px] font-medium text-blue-700">Loading live ledger balance…</div>
        )}
        {view.isPartyLinked && balanceQuery.isError && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-1.5 text-[11px] font-medium text-amber-800">Could not load the ledger balance ({balanceQuery.error instanceof Error ? balanceQuery.error.message : 'error'}) — totals below are bill-only.</div>
        )}

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100/60 p-4 sm:p-6">
          <div className="mx-auto flex w-full max-w-[14cm] justify-center">
            <div ref={previewRef} className={`${BILL_PREVIEW_CARD_CLASS} w-full shadow-md`} style={{ width: `${BILL_PRINT_PAGE_WIDTH_CM}cm`, maxWidth: '100%' }}>
              {previewProps && <BillPrintLayout {...previewProps} />}
            </div>
          </div>
        </div>

        {status && <div className="border-t border-amber-200 bg-amber-50 px-5 py-2 text-xs font-medium text-amber-800">{status}</div>}

        <div className="grid shrink-0 gap-3 border-t border-slate-200 bg-white px-5 py-3 md:grid-cols-[1fr_auto] md:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100">Review &amp; Edit in Editor</button>
            {isPending && (
              <button type="button" onClick={onApprove} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100">Approve Draft</button>
            )}
          </div>
          <div className="flex flex-wrap justify-start gap-2 md:justify-end">
            <button type="button" onClick={printDraft} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">Print</button>
            <button type="button" onClick={() => void saveJpg()} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">JPG</button>
            <button type="button" onClick={() => void shareWhatsApp()} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100">WhatsApp</button>
          </div>
        </div>
      </div>
    </div>
  )
}
