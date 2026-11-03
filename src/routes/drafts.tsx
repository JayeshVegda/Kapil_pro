import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type RefObject } from 'react'
import { Check, Eye, RefreshCw, RotateCcw, Search, Sparkles, X } from 'lucide-react'
import { pb } from '@/data/pocketbase'
import { countPendingDrafts, loadDraftItemMasters, loadDraftPage, type DraftStatusFilter } from '@/data/bill-drafts'
import { countPendingPaymentDrafts, loadPaymentDraftPage, rejectPaymentDraft, savePaymentFromDraft } from '@/data/payment-drafts'
import { loadCustomerAutoBalanceContext } from '@/data/customer-balance'
import { loadPaymentCustomers } from '@/data/payments'
import { buildDraftView, type DraftView } from '@/domain/drafts'
import { composeReceiptNote, PAYMENT_MODES, type PaymentDraftView } from '@/domain/payment-drafts'
import { formatDateTime, formatFullDate } from '@/lib/date'
import { formatInrInteger, formatRate } from '@/lib/inr-format'
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
const LANE_FETCH_LIMIT = 200

type DraftRow =
  | { source: 'bill'; view: DraftView }
  | { source: 'payment'; view: PaymentDraftView }

function DraftsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<DraftStatusFilter>('pending')
  const [typeFilter, setTypeFilter] = useState<'all' | 'bills' | 'payments'>('all')
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [previewDraft, setPreviewDraft] = useState<DraftView | null>(null)
  const [previewStatus, setPreviewStatus] = useState('')
  const [rejectingPayment, setRejectingPayment] = useState<PaymentDraftView | null>(null)
  const [editingPayment, setEditingPayment] = useState<PaymentDraftView | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const itemsQuery = useQuery({
    queryKey: ['draft-page-items'],
    queryFn: loadDraftItemMasters,
    staleTime: 5 * 60_000,
  })

  const billsQuery = useQuery({
    queryKey: ['bill-drafts-page', statusFilter, search],
    queryFn: () => loadDraftPage({ page: 1, perPage: LANE_FETCH_LIMIT, status: statusFilter, search }),
    refetchInterval: pollWhileTabVisible(8000),
    placeholderData: (previous) => previous,
  })

  const paymentsQuery = useQuery({
    queryKey: ['payment-drafts-page', statusFilter, search],
    queryFn: () => loadPaymentDraftPage({ page: 1, perPage: LANE_FETCH_LIMIT, status: statusFilter, search }),
    refetchInterval: pollWhileTabVisible(8000),
    placeholderData: (previous) => previous,
  })

  const pendingCountQuery = useQuery({
    queryKey: ['bill-drafts-pending-count'],
    queryFn: countPendingDrafts,
    refetchInterval: pollWhileTabVisible(8000),
  })

  const paymentPendingCountQuery = useQuery({
    queryKey: ['payment-drafts-pending-count'],
    queryFn: countPendingPaymentDrafts,
    refetchInterval: pollWhileTabVisible(8000),
  })

  const combinedPending = (pendingCountQuery.data ?? 0) + (paymentPendingCountQuery.data ?? 0)

  const billViews = (billsQuery.data?.drafts ?? []).map(({ draft, items, payments }) =>
    buildDraftView(draft, items, payments, itemsQuery.data ?? []),
  )

  const rows: DraftRow[] = [
    ...(typeFilter === 'payments' ? [] : billViews.map((view): DraftRow => ({ source: 'bill', view }))),
    ...(typeFilter === 'bills' ? [] : (paymentsQuery.data?.drafts ?? []).map((view): DraftRow => ({ source: 'payment', view }))),
  ].sort((a, b) => b.view.created.localeCompare(a.view.created))

  const totalItems = rows.length
  const totalPages = Math.max(1, Math.ceil(totalItems / PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const visible = rows.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE)

  const latestBillQuery = useQuery({
    queryKey: ['bill-drafts-latest'],
    queryFn: () => loadDraftPage({ page: 1, perPage: 1, status: 'all', search: '' }),
    refetchInterval: pollWhileTabVisible(8000),
    staleTime: 15_000,
  })
  const latestPaymentQuery = useQuery({
    queryKey: ['payment-drafts-latest'],
    queryFn: () => loadPaymentDraftPage({ page: 1, perPage: 1, status: 'all', search: '' }),
    refetchInterval: pollWhileTabVisible(8000),
    staleTime: 15_000,
  })
  const latestRows: DraftRow[] = []
  const latestBillRaw = latestBillQuery.data?.drafts[0]
  if (latestBillRaw) {
    latestRows.push({ source: 'bill', view: buildDraftView(latestBillRaw.draft, latestBillRaw.items, latestBillRaw.payments, itemsQuery.data ?? []) })
  }
  const latestPaymentRaw = latestPaymentQuery.data?.drafts[0]
  if (latestPaymentRaw) {
    latestRows.push({ source: 'payment', view: latestPaymentRaw })
  }
  const latest = latestRows.sort((a, b) => b.view.created.localeCompare(a.view.created))[0] ?? null

  const latestLabel = latest
    ? `${latest.source === 'bill' ? 'Bill' : 'Payment'} · ${latest.view.customerName || 'Unmatched Party'} · ${
        latest.source === 'bill'
          ? latest.view.itemsSubtotal > 0
            ? formatInrInteger(latest.view.grandTotal)
            : '—'
          : latest.view.amount > 0
            ? formatInrInteger(latest.view.amount)
            : '—'
      } · ${formatDateTime(latest.view.created) || '—'}`
    : ''

  const firstError = billsQuery.error ?? paymentsQuery.error ?? null

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['bill-drafts-page'] })
    void queryClient.invalidateQueries({ queryKey: ['bill-drafts-pending-count'] })
    void queryClient.invalidateQueries({ queryKey: ['bill-drafts-latest'] })
    void queryClient.invalidateQueries({ queryKey: ['payment-drafts-page'] })
    void queryClient.invalidateQueries({ queryKey: ['payment-drafts-pending-count'] })
    void queryClient.invalidateQueries({ queryKey: ['payment-drafts-latest'] })
  }

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await pb.collection('bill_drafts').update(id, { status })
    },
    onSuccess: () => {
      refreshAll()
    },
  })

  const paymentRejectMutation = useMutation({
    mutationFn: (id: string) => rejectPaymentDraft(id),
    onSuccess: () => {
      refreshAll()
      setRejectingPayment(null)
    },
  })

  const loadIntoBill = (view: DraftView, autoOpenPreview = false) => {
    const raw = billsQuery.data?.drafts.find((entry) => entry.draft.id === view.id)
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

  return (
    <div className="w-full space-y-4 px-3 pb-12 pt-3 sm:px-5 lg:px-7">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm"><Sparkles size={15} /></span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">AI Drafts</h2>
          <p className="text-[11px] text-slate-500">Bills and payments staged by Muse</p>
        </div>
        <span className={`ml-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${combinedPending ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
          {combinedPending} pending
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold text-slate-600">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => { setStatusFilter(status); setPage(1) }}
              className={`rounded-md px-3 py-1.5 capitalize transition ${statusFilter === status ? 'bg-white font-bold text-indigo-700 shadow-sm' : 'hover:text-slate-900'}`}
            >
              {status === 'pending' ? `Pending ${combinedPending}` : status}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold text-slate-600">
          {(['all', 'bills', 'payments'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => { setTypeFilter(type); setPage(1) }}
              className={`rounded-md px-3 py-1.5 transition ${typeFilter === type ? 'bg-white font-bold text-indigo-700 shadow-sm' : 'hover:text-slate-900'}`}
            >
              {type === 'bills' ? 'Bills' : type === 'payments' ? 'Payments' : 'All'}
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[220px] flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(event) => changeSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') commitSearch() }}
            onBlur={commitSearch}
            placeholder="Search party, notes, items, dictation…"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {firstError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-800">
          <p className="text-sm font-bold">Failed to load drafts</p>
          <p className="mt-1 text-xs font-mono">{firstError instanceof Error ? firstError.message : String(firstError)}</p>
        </div>
      ) : billsQuery.isLoading || paymentsQuery.isLoading ? (
        <div className="grid place-items-center rounded-xl border border-slate-200 bg-white py-14 text-slate-500">
          <RefreshCw size={22} className="animate-spin text-indigo-600" />
          <p className="mt-2 text-xs font-semibold">Loading drafts…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold text-slate-900">{search ? 'No matching drafts' : 'All caught up'}</p>
          {latest && <p className="mt-0.5 text-[11px] text-slate-500">Latest draft: {latestLabel}</p>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] uppercase font-bold tracking-wider text-slate-500">
                <th className="px-3.5 py-2.5">Type</th>
                <th className="px-2 py-2.5">Party</th>
                <th className="px-2 py-2.5">Date</th>
                <th className="px-2 py-2.5 text-right">Amount</th>
                <th className="px-2 py-2.5">Detail</th>
                <th className="px-3.5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((row) => {
                const isPending = row.view.status !== 'approved' && row.view.status !== 'rejected'
                if (row.source === 'payment') {
                  const view = row.view
                  return (
                    <tr key={`payment-${view.id}`} className={`transition hover:bg-slate-50/70 ${isPending ? '' : 'opacity-70'}`}>
                      <td className="px-3.5 py-2.5">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700">Payment</span>
                      </td>
                      <DraftPartyCell name={view.customerName} isLinked={view.isPartyLinked} avatarClass={view.isPartyLinked ? 'bg-emerald-500' : 'bg-amber-500'} secondaryText={view.rawText} />
                      <td className="whitespace-nowrap px-2 py-2.5 text-slate-600">{view.date ? formatFullDate(view.date) : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono font-bold tabular-nums text-sm text-emerald-800">{formatInrInteger(view.amount)}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700">{view.mode}</span>
                          {view.note && <span className="max-w-[160px] truncate text-[10px] italic text-slate-500">{view.note}</span>}
                          {view.convertedPayment && <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">converted</span>}
                        </div>
                        {view.isPartyLinked && !view.convertedPayment && (
                          <div className="mt-0.5"><PaymentDraftDueCell customerId={view.customerId} date={view.date} /></div>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {isPending ? (
                            <>
                              <button type="button" onClick={() => setRejectingPayment(view)} title="Reject" className="rounded-md border border-slate-200 p-1 text-rose-600 transition hover:bg-rose-50"><X size={13} /></button>
                              <button type="button" onClick={() => setEditingPayment(view)} disabled={!view.isPartyLinked} title={view.isPartyLinked ? 'Accept payment' : 'Party unmatched — accept after linking in the modal'} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"><Check size={12} /> Accept</button>
                            </>
                          ) : (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              {view.status === 'approved' ? 'accepted' : 'rejected'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                }
                const view = row.view
                const firstItem = view.rows[0]
                return (
                  <tr key={`bill-${view.id}`} className={`transition hover:bg-slate-50/70 ${isPending ? '' : 'opacity-70'}`}>
                    <td className="px-3.5 py-2.5">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700">Bill</span>
                    </td>
                    <DraftPartyCell name={view.customerName} isLinked={view.isPartyLinked} avatarClass={view.isPartyLinked ? 'bg-indigo-500' : 'bg-amber-500'} secondaryText={view.notes} />
                    <td className="whitespace-nowrap px-2 py-2.5 text-slate-600">{view.date ? formatFullDate(view.date) : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono font-bold tabular-nums text-sm text-slate-900">
                      {view.itemsSubtotal > 0 ? formatInrInteger(view.grandTotal) : '—'}
                      {view.isEstimate && <span className="ml-1 rounded bg-amber-100 px-1 align-middle text-[9px] font-bold text-amber-800">est.</span>}
                    </td>
                    <td className="max-w-[260px] px-2 py-2.5">
                      {view.rows.length === 0 ? (
                        <p className="text-slate-400">no items</p>
                      ) : (
                        <p className="truncate text-slate-800">
                          {firstItem.itemName}
                          {firstItem.rate > 0 ? ` @ ${formatRate(firstItem.rate)}` : ' @ auto'}
                          {view.rows.length > 1 ? ` +${view.rows.length - 1}` : ''}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-500">
                        <span className="font-mono">
                          {view.convertedBill
                            ? 'converted'
                            : view.bookNo > 0 || view.billNo > 0
                              ? `${view.bookNo > 0 ? `${view.bookNo}/` : ''}${view.billNo || '—'}`
                              : 'auto'}
                        </span>
                        {view.advanceTotal > 0 && ` · Adv ${formatInrInteger(view.advanceTotal)}`}
                      </p>
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
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage(Math.max(1, currentPage - 1))} className="rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">Prev</button>
              <span className="font-mono">page {currentPage} / {totalPages}</span>
              <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(Math.min(totalPages, currentPage + 1))} className="rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">Next</button>
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

      {rejectingPayment && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-slate-900">Reject payment draft?</h3>
            <p className="mt-1 text-xs text-slate-500">
              {rejectingPayment.customerName || 'Unmatched Party'} · {formatInrInteger(rejectingPayment.amount)} · {rejectingPayment.date ? formatFullDate(rejectingPayment.date) : 'no date'}
            </p>
            <p className="mt-2 text-xs text-slate-500">Rejected drafts are dead ends. Muse gets feedback; fixes happen on the payment record once accepted.</p>
            {paymentRejectMutation.isError && <p className="mt-2 text-xs font-semibold text-rose-700">{paymentRejectMutation.error instanceof Error ? paymentRejectMutation.error.message : String(paymentRejectMutation.error)}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => { setRejectingPayment(null); paymentRejectMutation.reset() }} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => paymentRejectMutation.mutate(rejectingPayment.id)} disabled={paymentRejectMutation.isPending} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-60">{paymentRejectMutation.isPending ? 'Rejecting…' : 'Reject'}</button>
            </div>
          </div>
        </div>
      )}

      {editingPayment && (
        <PaymentAcceptModal
          view={editingPayment}
          onClose={() => { setEditingPayment(null); void queryClient.invalidateQueries({ queryKey: ['payment-drafts-page'] }) }}
          refreshAll={queryClient.invalidateQueries}
        />
      )}
    </div>
  )
}

function DraftPartyCell({ name, isLinked, avatarClass, secondaryText }: { name: string; isLinked: boolean; avatarClass: string; secondaryText?: string }) {
  return (
    <td className="px-2 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-black text-white ${avatarClass}`}>
          {(name || 'P').charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{name || 'Unmatched Party'}</p>
          {!isLinked && (
            <span className="mt-0.5 inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Party not matched</span>
          )}
          {secondaryText && <p className="max-w-[220px] truncate text-[10px] italic text-slate-400">“{secondaryText}”</p>}
        </div>
      </div>
    </td>
  )
}

function PaymentDraftDueCell({ customerId, date }: { customerId: string; date: string }) {
  const dueQuery = useQuery({
    queryKey: ['payment-drafts-due', customerId, date],
    queryFn: () => loadCustomerAutoBalanceContext(customerId, date),
    staleTime: 30_000,
  })
  if (!dueQuery.data) return null
  const balance = dueQuery.data
  const due = balance.previousBalanceAmount + balance.credits.reduce((sum, credit) => sum + credit.amount, 0)
  return (
    <span className="text-[11px] text-slate-500">
      Due <span className="font-mono font-semibold text-slate-700">₹{formatInrInteger(due)}</span>
    </span>
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


type AcceptModalProps = {
  view: PaymentDraftView
  onClose: () => void
  refreshAll: (filter: { queryKey: readonly unknown[] }) => void
}

function PaymentAcceptModal({ view, onClose, refreshAll }: AcceptModalProps) {
  const customersQuery = useQuery({
    queryKey: ['payment-drafts-customers'],
    queryFn: loadPaymentCustomers,
    staleTime: 5 * 60_000,
  })
  const customers = customersQuery.data ?? []

  const [customerId, setCustomerId] = useState(view.customerId)
  const [date, setDate] = useState(view.date)
  const [amount, setAmount] = useState(view.amount > 0 ? String(view.amount) : '')
  const [mode, setMode] = useState<'Cash' | 'Bank'>(view.mode)
  const [museNote, setMuseNote] = useState(view.note)

  const amountDueQuery = useQuery({
    queryKey: ['payment-drafts-amount-due', customerId, date],
    queryFn: () => loadCustomerAutoBalanceContext(customerId, date),
    enabled: Boolean(customerId),
    staleTime: 30_000,
  })
  const balance = amountDueQuery.data
  const amountDue = balance ? balance.previousBalanceAmount + balance.credits.reduce((sum, credit) => sum + credit.amount, 0) : null

  const selectedCustomer = customers.find((customer) => customer.id === customerId)
  const parsedAmount = Number(amount)
  const canAccept = Boolean(
    customerId && date && Number.isFinite(parsedAmount) && parsedAmount > 0,
  )

  const acceptMutation = useMutation({
    mutationFn: () =>
      savePaymentFromDraft({
        draftId: view.id,
        customerId,
        customerName: selectedCustomer?.name ?? view.customerName,
        date,
        amount: parsedAmount,
        mode,
        note: composeReceiptNote(date, view.note, museNote),
      }),
    onSuccess: () => {
      void refreshAll({ queryKey: ['payment-drafts-page'] })
      void refreshAll({ queryKey: ['payment-drafts-pending-count'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/60 px-3 py-4 backdrop-blur-sm sm:px-4 sm:py-8">
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">Accept Payment Draft</h3>
            <p className="mt-0.5 text-xs text-slate-500">{view.customerName || 'Unmatched Party'} · ID {view.id.slice(0, 8)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-auto p-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] italic text-slate-600">
            <span className="font-bold not-italic text-slate-500">Dictated: </span>“{view.rawText || '—'}”
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-500">Party</label>
              {view.isPartyLinked ? (
                <select
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-none focus:border-indigo-500"
                >
                  {customers.some((customer) => customer.id === customerId) ? null : <option value={view.customerId}>{view.customerName} (from dictation)</option>}
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
              ) : (
                <select
                  value=""
                  onChange={(event) => setCustomerId(event.target.value)}
                  className="h-9 w-full rounded-lg border border-amber-300 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-none focus:border-indigo-500"
                >
                  <option value="">Link a party to enable Accept</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
              )}
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">
              Date
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-none focus:border-indigo-500" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">
              Amount (₹)
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                className={`h-9 rounded-lg border px-2.5 text-xs text-slate-800 shadow-sm outline-none focus:border-indigo-500 ${parsedAmount > 0 ? 'border-slate-300 bg-white' : 'border-amber-300 bg-white'}`}
              />
            </label>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-500">Mode</label>
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                {PAYMENT_MODES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMode(option)}
                    className={`rounded-md px-4 py-1.5 text-xs font-semibold transition ${mode === option ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500 sm:col-span-2">
              Note (prefix added on accept)
              <input
                value={museNote}
                onChange={(event) => setMuseNote(event.target.value)}
                placeholder="Muse's note, editable"
                className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-none focus:border-indigo-500"
              />
              <span className="text-[10px] font-normal text-slate-400">Saved as “Receipt via Muse {date || 'unknown-date'}{museNote ? ` - ${museNote}` : ''}”. The dictated text stays on the draft untouched.</span>
            </label>
          </div>

          {customerId && (
            <div className="rounded-lg border border-slate-200 bg-blue-50/60 p-3 text-xs">
              {amountDueQuery.isFetching ? (
                <span className="text-blue-700">Loading amount due…</span>
              ) : amountDueQuery.isError || amountDue === null ? (
                <span className="text-amber-800">Could not load the party balance — verify manually before accepting.</span>
              ) : (
                <>
                  <span className="font-semibold text-slate-500">Amount due (as of {date ? formatFullDate(date) : '—'}): </span>
                  <span className="font-mono font-bold text-slate-900">₹{formatInrInteger(amountDue)}</span>
                  <span className="ml-2 text-[10px] text-slate-500">{amountDue < 0 ? 'advance' : 'receivable'} · figure here wins over what Muse said</span>
                </>
              )}
            </div>
          )}

          {acceptMutation.isError && <p className="text-xs font-semibold text-rose-700">{acceptMutation.error instanceof Error ? acceptMutation.error.message : String(acceptMutation.error)}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">Cancel</button>
          <button
            type="button"
            onClick={() => acceptMutation.mutate()}
            disabled={!canAccept || acceptMutation.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {acceptMutation.isPending ? 'Posting…' : `Accept · ${formatInrInteger(parsedAmount) || '₹0'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

