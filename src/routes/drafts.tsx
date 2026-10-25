import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo, useRef } from 'react'
import {
  Sparkles,
  Check,
  X,
  Clock,
  ArrowRight,
  RefreshCw,
  Calendar,
  CheckCircle2,
  Search,
  Eye,
  TrendingUp,
  Package,
  Truck,
  CreditCard,
  FileText,
  Printer,
  Download,
  Share2,
} from 'lucide-react'
import { pb } from '@/data/pocketbase'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger, formatRate, formatInQty } from '@/lib/inr-format'
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
import { pollWhileTabVisible } from '@/lib/poll-while-visible'

export const Route = createFileRoute('/drafts')({
  component: DraftsPage,
})

type DraftItem = {
  id?: string
  draft?: string
  itemId?: string
  itemName: string
  qty: number
  bags?: number
  rate: number
  amount?: number
}

type DraftPayment = {
  id?: string
  customer?: string
  date?: string
  amount: number
  mode?: 'Cash' | 'Bank' | string
  note?: string
}

type BillDraft = {
  id: string
  created: string
  customer?: string
  customer_name?: string
  created_by?: string
  converted_bill?: string
  book_no?: number
  bill_no?: number
  date?: string
  mkt?: number
  transport?: number
  gst_mode?: string
  gst_rate?: number
  gst_amount?: number
  lr_no?: string
  confidence?: number
  notes?: string
  status: 'pending_review' | 'approved' | 'rejected' | string
  items: DraftItem[]
  payments?: DraftPayment[]
  bill_total?: number
  expand?: {
    customer?: { id: string; name?: string; company_name?: string }
    created_by?: { id: string; email?: string }
    converted_bill?: { id: string; book_no?: number; bill_no?: number; bill_ref?: string }
  }
}

function DraftsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [searchQuery, setSearchQuery] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)
  const [previewDraft, setPreviewDraft] = useState<BillDraft | null>(null)
  const [previewStatus, setPreviewStatus] = useState('')

  const draftsQuery = useQuery({
    queryKey: ['bill-drafts-list'],
    queryFn: async (): Promise<BillDraft[]> => {
      const [draftsRes, draftItemsRes, draftPaymentsRes] = await Promise.all([
        pb.collection('bill_drafts').getList(1, 50, {
          expand: 'customer,created_by,converted_bill',
        }),
        pb.collection('bill_draft_items').getFullList({
          expand: 'item',
        }).catch(() => []),
        pb.collection('bill_draft_payments').getFullList().catch(() => []),
      ])

      const list = draftsRes.items.map((draft: any) => {
        const rows = draftItemsRes
          .filter((row: any) => row.draft === draft.id)
          .map((row: any) => ({
            id: row.id,
            itemId: row.item || row.expand?.item?.id || '',
            itemName: row.item_name || row.expand?.item?.name || 'Item',
            qty: Number(row.qty || 0),
            bags: Number(row.bags || 0),
            rate: Number(row.rate || 0),
            amount: Number(row.amount || (Number(row.qty || 0) * Number(row.rate || 0))),
          }))

        const payments = draftPaymentsRes
          .filter((p: any) => p.draft === draft.id)
          .map((p: any) => ({
            id: p.id,
            customer: p.customer,
            date: p.date,
            amount: Number(p.amount || 0),
            mode: p.mode,
            note: p.note,
          }))

        return {
          ...draft,
          items: rows,
          payments,
        } as BillDraft
      })

      return list.sort((a, b) => String(b.created || b.id || '').localeCompare(String(a.created || a.id || '')))
    },
    refetchInterval: pollWhileTabVisible(4000),
  })

  const allDrafts = draftsQuery.data ?? []

  // Stats calculation
  const stats = useMemo(() => {
    const pendingList = allDrafts.filter((d) => d.status !== 'approved' && d.status !== 'rejected')
    const totalPendingQty = pendingList.reduce((sum, d) => {
      return sum + (d.items || []).reduce((iSum, it) => iSum + Number(it.qty || 0), 0)
    }, 0)
    const totalPendingBags = pendingList.reduce((sum, d) => {
      return sum + (d.items || []).reduce((iSum, it) => iSum + Number(it.bags || 0), 0)
    }, 0)
    const totalPendingAmount = pendingList.reduce((sum, d) => {
      const itemsAmt = (d.items || []).reduce((iSum, it) => iSum + (Number(it.amount) || (Number(it.qty || 0) * Number(it.rate || 0))), 0)
      const gstAmt = Number(d.gst_amount || (d.gst_rate ? (itemsAmt * d.gst_rate) / 100 : 0))
      return sum + itemsAmt + gstAmt + Number(d.transport || 0)
    }, 0)

    return {
      pendingCount: pendingList.length,
      totalQty: totalPendingQty,
      totalBags: totalPendingBags,
      totalAmount: totalPendingAmount,
    }
  }, [allDrafts])

  // Filtered drafts
  const drafts = useMemo(() => {
    return allDrafts.filter((d) => {
      if (statusFilter === 'pending' && (d.status === 'approved' || d.status === 'rejected')) return false
      if (statusFilter === 'approved' && d.status !== 'approved') return false
      if (statusFilter === 'rejected' && d.status !== 'rejected') return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const party = (d.expand?.customer?.company_name || d.customer_name || '').toLowerCase()
        const billNo = String(d.bill_no || '')
        const notes = (d.notes || '').toLowerCase()
        const hasItem = (d.items || []).some((it) => it.itemName.toLowerCase().includes(q))
        return party.includes(q) || billNo.includes(q) || notes.includes(q) || hasItem
      }

      return true
    })
  }, [allDrafts, statusFilter, searchQuery])

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await pb.collection('bill_drafts').update(id, { status })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bill-drafts-list'] })
      queryClient.invalidateQueries({ queryKey: ['bill-drafts-pending'] })
      setActionMessage(`Draft marked as ${variables.status}.`)
      setTimeout(() => setActionMessage(''), 4000)
    },
  })

  const loadIntoBill = (draft: BillDraft, autoOpenPreview = false) => {
    sessionStorage.setItem('kapil-loaded-draft', JSON.stringify({ ...draft, autoOpenPreview }))
    void navigate({ to: '/new-bill' })
  }

  const previewPrintProps = useMemo((): BillPrintLayoutProps | null => {
    if (!previewDraft) return null
    const partyName =
      previewDraft.customer_name ||
      previewDraft.expand?.customer?.company_name ||
      previewDraft.expand?.customer?.name ||
      'Party'
    const draftItems = previewDraft.items || []
    const previewRows = draftItems.map((r) => {
      const qty = Number(r.qty || 0)
      const rate = Number(r.rate || 0)
      return {
        itemName: r.itemName,
        qty,
        rate,
        amount: Number(r.amount || qty * rate),
        bags: Number(r.bags || Math.round(qty / 50)),
        type: 'gas',
        unit: 'kg',
      }
    })
    const totalQty = previewRows.reduce((s, r) => s + r.qty, 0)
    const totalBags = previewRows.reduce((s, r) => s + r.bags, 0)
    const transport = Number(previewDraft.transport || 0)
    const isGst = previewDraft.gst_mode === 'percent18' || Number(previewDraft.gst_rate) === 18
    const manualGst = Number(previewDraft.gst_amount || 0)
    const calcTotals = calculateBillTotals({
      items: previewRows.map((r) => ({ qty: r.qty, rate: r.rate })),
      transport,
      gstRate: isGst ? 18 : 0,
      gstAmountOverride: manualGst > 0 ? manualGst : null,
    })

    return buildBillPreviewProps({
      bookNo: Number(previewDraft.book_no || 69),
      billNo: Number(previewDraft.bill_no || 0),
      date: previewDraft.date ? String(previewDraft.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
      customerName: partyName,
      mktRate: Number(previewDraft.mkt || 0),
      itemRows: previewRows,
      gstAmount: calcTotals.gstAmount,
      transport,
      gstRate: calcTotals.gstRate,
      currentBillTotal: calcTotals.grandTotal,
      balance: null,
      quickPayments: (previewDraft.payments || []).map((p) => ({
        id: p.id || 'p1',
        date: p.date ? String(p.date).slice(0, 10) : '',
        amount: Number(p.amount || 0),
      })),
      totalQty,
      totalBags,
      lrList: previewDraft.lr_no ? String(previewDraft.lr_no).split(',').map((s) => s.trim()).filter(Boolean) : [],
    })
  }, [previewDraft])

  const printDraftPreview = () => {
    const previewElement = previewRef.current
    if (!previewElement) return
    printBillLayoutFromElement(previewElement, BILL_PRINT_DOCUMENT_TITLE, setPreviewStatus)
  }

  const saveDraftPreviewJpg = async () => {
    const previewElement = previewRef.current
    if (!previewElement || !previewDraft) return
    try {
      await downloadBillLayoutAsJpg(previewElement, `draft-preview-${previewDraft.bill_no || 'bill'}.jpg`)
      setPreviewStatus('')
    } catch {
      setPreviewStatus('Unable to save JPG.')
    }
  }

  const shareDraftWhatsApp = async () => {
    const previewElement = previewRef.current
    if (!previewElement || !previewDraft || !previewPrintProps) return
    const billRef = `${previewPrintProps.bookNo}/${previewPrintProps.billNo || 'Draft'}`
    const message = [
      `Kapil Products`,
      `Bill Ref: ${billRef}`,
      `Party: ${previewPrintProps.customerName}`,
      `Date: ${formatFullDate(previewPrintProps.date)}`,
      `Current Bill: ${formatInrInteger(previewPrintProps.currentBillTotal)}`,
      ...previewPrintProps.periodCreditEntries.map((c) => `Advance Paid: ${formatInrInteger(c.amount)}`),
      `Net Total: ${formatInrInteger(previewPrintProps.finalTotal)}`,
    ].join('\n')

    await shareBillLayoutImageWithWhatsAppFallback({
      element: previewElement,
      imageFilename: `draft-preview-${previewDraft.bill_no || 'bill'}.jpg`,
      message,
      setStatus: setPreviewStatus,
    })
  }

  return (
    <div className="w-full space-y-6 px-3 pb-12 pt-3 sm:px-5 lg:px-7 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-950 via-indigo-900 to-slate-900 p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-indigo-300 backdrop-blur shadow-inner">
              <Sparkles size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">Muse AI Staging Inbox</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-0.5 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Live Listening
                </span>
              </div>
              <p className="mt-1 text-xs text-indigo-200/90 sm:text-sm">
                Bills dictated on WhatsApp or sent via bill photo appear here with full line items and party matching.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => draftsQuery.refetch()}
            disabled={draftsQuery.isFetching}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-white/20 transition disabled:opacity-50 shadow-sm"
          >
            <RefreshCw size={14} className={draftsQuery.isFetching ? 'animate-spin' : ''} />
            Refresh Inbox
          </button>
        </div>

        {/* Realtime Metrics Summary */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-indigo-800/80 pt-5 text-slate-100">
          <div className="rounded-xl bg-white/5 p-3 backdrop-blur">
            <span className="text-[11px] font-medium text-indigo-300 uppercase tracking-wider flex items-center gap-1">
              <Clock size={13} /> Pending Bills
            </span>
            <p className="mt-1 text-xl font-black text-white">{stats.pendingCount}</p>
          </div>
          <div className="rounded-xl bg-white/5 p-3 backdrop-blur">
            <span className="text-[11px] font-medium text-indigo-300 uppercase tracking-wider flex items-center gap-1">
              <Package size={13} /> Staged Qty
            </span>
            <p className="mt-1 text-xl font-black text-white">
              {stats.totalQty > 0 ? formatInQty(stats.totalQty, 'kg') : '0 kg'}
            </p>
          </div>
          <div className="rounded-xl bg-white/5 p-3 backdrop-blur">
            <span className="text-[11px] font-medium text-indigo-300 uppercase tracking-wider flex items-center gap-1">
              <Package size={13} /> Staged Bags
            </span>
            <p className="mt-1 text-xl font-black text-white">{stats.totalBags} katte</p>
          </div>
          <div className="rounded-xl bg-white/5 p-3 backdrop-blur">
            <span className="text-[11px] font-medium text-indigo-300 uppercase tracking-wider flex items-center gap-1">
              <TrendingUp size={13} /> Est. Value
            </span>
            <p className="mt-1 text-xl font-black text-emerald-400">
              {stats.totalAmount > 0 ? formatInrInteger(stats.totalAmount) : '₹0'}
            </p>
          </div>
        </div>
      </div>

      {actionMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 flex items-center gap-2.5 shadow-sm">
          <CheckCircle2 size={18} /> {actionMessage}
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold text-slate-600 shadow-inner">
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`rounded-lg px-3.5 py-2 transition ${
              statusFilter === 'pending'
                ? 'bg-white font-bold text-indigo-700 shadow-sm'
                : 'hover:text-slate-900'
            }`}
          >
            Pending Review ({stats.pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('approved')}
            className={`rounded-lg px-3.5 py-2 transition ${
              statusFilter === 'approved'
                ? 'bg-white font-bold text-indigo-700 shadow-sm'
                : 'hover:text-slate-900'
            }`}
          >
            Approved ({allDrafts.filter(d => d.status === 'approved').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('rejected')}
            className={`rounded-lg px-3.5 py-2 transition ${
              statusFilter === 'rejected'
                ? 'bg-white font-bold text-indigo-700 shadow-sm'
                : 'hover:text-slate-900'
            }`}
          >
            Rejected ({allDrafts.filter(d => d.status === 'rejected').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`rounded-lg px-3.5 py-2 transition ${
              statusFilter === 'all'
                ? 'bg-white font-bold text-indigo-700 shadow-sm'
                : 'hover:text-slate-900'
            }`}
          >
            All History ({allDrafts.length})
          </button>
        </div>

        {/* Quick Search Input */}
        <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search party, item, bill #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Drafts List */}
      {draftsQuery.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-800">
          <p className="font-bold text-base">Failed to fetch drafts from PocketBase</p>
          <p className="mt-1 text-xs text-rose-600 font-mono">
            {draftsQuery.error instanceof Error ? draftsQuery.error.message : String(draftsQuery.error)}
          </p>
          <button
            type="button"
            onClick={() => draftsQuery.refetch()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition"
          >
            <RefreshCw size={13} /> Try Again
          </button>
        </div>
      ) : draftsQuery.isLoading ? (
        <div className="grid place-items-center rounded-2xl border border-slate-200 bg-white py-16 text-slate-500">
          <RefreshCw size={26} className="animate-spin text-indigo-600" />
          <p className="mt-3 text-sm font-semibold">Checking Muse drafts...</p>
        </div>
      ) : drafts.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-sm">
            <Sparkles size={28} />
          </div>
          <h3 className="mt-4 text-base font-bold text-slate-900">
            {searchQuery ? 'No matching drafts found' : `No ${statusFilter} drafts right now`}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-xs text-slate-500 leading-relaxed">
            When Jay dictates items in chat (e.g. <em>&quot;aaj DE ko 6 katte spindle 8.5 wale bheje&quot;</em>) or sends a bill photo, Muse stages the proposal here in <code>bill_drafts</code> &amp; <code>bill_draft_items</code>.
          </p>

          <div className="mt-8 mx-auto max-w-lg rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Muse AI Integration Status</h4>
            <p className="mt-1 font-mono text-[11px] text-indigo-700 break-all select-all">
              POST http://kapil-products:4174/pb/api/collections/bill_drafts/records
            </p>
            <p className="mt-2 text-[11px] text-slate-500">
              Authenticated as <code>muse@kapil.cosearch.me</code>. Line items stage to <code>bill_draft_items</code>.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-1 lg:grid-cols-2">
          {drafts.map((draft) => {
            const items = draft.items || []
            const isPending = draft.status !== 'approved' && draft.status !== 'rejected'
            const partyName = draft.expand?.customer?.company_name || draft.customer_name || 'Unmatched Party'
            const isPartyLinked = Boolean(draft.expand?.customer)

            const totalItemQty = items.reduce((s, it) => s + Number(it.qty || 0), 0)
            const totalItemBags = items.reduce((s, it) => s + Number(it.bags || 0), 0)
            const itemsSubtotal = items.reduce((s, it) => s + (Number(it.amount) || (Number(it.qty || 0) * Number(it.rate || 0))), 0)
            const gstAmount = Number(draft.gst_amount || (draft.gst_rate ? (itemsSubtotal * draft.gst_rate) / 100 : 0))
            const estimatedGrandTotal = itemsSubtotal + gstAmount + Number(draft.transport || 0)

            return (
              <div
                key={draft.id}
                className={`rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md flex flex-col justify-between ${
                  isPending
                    ? 'border-indigo-200 ring-2 ring-indigo-500/10'
                    : draft.status === 'approved'
                      ? 'border-emerald-200'
                      : 'border-slate-200 opacity-70'
                }`}
              >
                <div>
                  {/* Top Bar: Party Name & Estimated Amount */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white font-black text-base shadow-sm">
                        {partyName.charAt(0) || 'P'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-base tracking-tight truncate">
                            {partyName}
                          </span>
                          {isPartyLinked ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
                              <Check size={11} /> Linked Party
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                              Unmatched Name
                            </span>
                          )}
                          {draft.confidence != null && (
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-100">
                              {Math.round(draft.confidence * 100)}% match
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1 font-medium">
                            <Calendar size={13} className="text-slate-400" />
                            {draft.date ? formatFullDate(draft.date) : 'Today'}
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                            <Clock size={13} className="text-slate-400" />
                            {draft.created ? new Date(draft.created).toLocaleTimeString() : ''}
                          </span>
                          {draft.expand?.created_by?.email && (
                            <span className="text-[11px] text-indigo-600 font-medium">
                              · by Muse AI
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-base font-black text-slate-900 font-mono">
                        {estimatedGrandTotal > 0 ? formatInrInteger(estimatedGrandTotal) : 'Auto Total'}
                      </p>
                      <span
                        className={`inline-block mt-0.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          isPending
                            ? 'bg-amber-100 text-amber-800'
                            : draft.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {String(draft.status || 'pending').replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  {/* Metadata Pills Bar */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {draft.expand?.converted_bill ? (
                      <span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-mono text-xs font-bold text-emerald-900 border border-emerald-300 shadow-sm flex items-center gap-1">
                        <FileText size={13} /> Converted: Bill #{draft.expand.converted_bill.book_no}/{draft.expand.converted_bill.bill_no}
                      </span>
                    ) : Number(draft.bill_no) > 0 ? (
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-xs font-bold text-slate-800 border border-slate-200">
                        {Number(draft.book_no) > 0 ? `Book ${draft.book_no} / ` : ''}Bill #{draft.bill_no}
                      </span>
                    ) : null}

                    {Number(draft.mkt) > 0 && (
                      <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 border border-amber-200 shadow-sm flex items-center gap-1">
                        <TrendingUp size={13} /> Mkt: ₹{draft.mkt}
                      </span>
                    )}

                    {Number(draft.transport) > 0 && (
                      <span className="rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 border border-sky-200 flex items-center gap-1">
                        <Truck size={13} /> Transport: ₹{draft.transport}
                      </span>
                    )}

                    {draft.gst_mode === 'percent18' || Number(draft.gst_rate) === 18 ? (
                      <span className="rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-800 border border-purple-200">
                        GST: 18% {gstAmount > 0 ? `(₹${Math.round(gstAmount)})` : ''}
                      </span>
                    ) : (
                      <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        No GST
                      </span>
                    )}

                    {draft.lr_no && (
                      <span className="rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 border border-purple-200">
                        LR: {draft.lr_no}
                      </span>
                    )}

                    {draft.payments && draft.payments.length > 0 && (
                      <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 border border-emerald-200 flex items-center gap-1">
                        <CreditCard size={13} /> Advance: ₹{draft.payments.reduce((s, p) => s + Number(p.amount || 0), 0)} ({draft.payments[0]?.mode || 'Bank'})
                      </span>
                    )}
                  </div>

                  {draft.notes && (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 italic border border-slate-200/80">
                      &ldquo;{draft.notes}&rdquo;
                    </div>
                  )}

                  {/* Items Preview Table */}
                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/50">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/70 text-[10px] uppercase font-bold text-slate-600">
                          <th className="px-3.5 py-2">Item</th>
                          <th className="px-3 py-2 text-right">Bags</th>
                          <th className="px-3 py-2 text-right">Qty (Kg)</th>
                          <th className="px-3 py-2 text-right">Rate</th>
                          <th className="px-3.5 py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {items.map((row, idx) => (
                          <tr key={row.id || idx} className="hover:bg-white transition">
                            <td className="px-3.5 py-2 text-slate-900 font-semibold">{row.itemName}</td>
                            <td className="px-3 py-2 text-right text-slate-600 font-mono">{row.bags || '-'}</td>
                            <td className="px-3 py-2 text-right text-slate-900 font-mono font-bold">{row.qty}</td>
                            <td className="px-3 py-2 text-right text-slate-800 font-mono">
                              {row.rate > 0 ? `₹${formatRate(row.rate)}` : <span className="text-indigo-600 font-semibold">Auto</span>}
                            </td>
                            <td className="px-3.5 py-2 text-right text-slate-900 font-mono font-bold">
                              {Number(row.amount ?? 0) > 0 ? formatInrInteger(Number(row.amount ?? 0)) : (row.rate > 0 ? formatInrInteger(row.qty * row.rate) : '-')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {items.length > 0 && (
                        <tfoot>
                          <tr className="border-t border-slate-200 bg-slate-100/40 text-[11px] font-bold text-slate-700">
                            <td className="px-3.5 py-1.5">Total</td>
                            <td className="px-3 py-1.5 text-right font-mono">{totalItemBags || '-'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{totalItemQty} kg</td>
                            <td className="px-3 py-1.5"></td>
                            <td className="px-3.5 py-1.5 text-right font-mono text-slate-900">
                              {itemsSubtotal > 0 ? formatInrInteger(itemsSubtotal) : '-'}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-3.5 border-t border-slate-100">
                  <div className="text-[11px] text-slate-400 font-mono">
                    ID: {String(draft.id || '').slice(0, 10)}
                  </div>

                  <div className="flex items-center gap-2">
                    {isPending ? (
                      <>
                        <button
                          type="button"
                          onClick={() => updateStatusMutation.mutate({ id: draft.id, status: 'rejected' })}
                          disabled={updateStatusMutation.isPending}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition shadow-sm"
                        >
                          <X size={14} /> Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewDraft(draft)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-sm hover:bg-indigo-100 transition"
                          title="Instant printable bill preview popup"
                        >
                          <Eye size={14} /> Direct Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => loadIntoBill(draft, false)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-md hover:bg-indigo-700 transition"
                        >
                          <Check size={14} /> Review &amp; Load <ArrowRight size={13} />
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewDraft(draft)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
                        >
                          <Eye size={13} /> Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => updateStatusMutation.mutate({ id: draft.id, status: 'pending_review' })}
                          className="text-xs text-indigo-600 font-semibold hover:underline"
                        >
                          Re-open as Pending
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Instant In-Page Preview Modal */}
      {previewDraft && previewPrintProps && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/60 px-3 py-4 sm:px-4 sm:py-8 backdrop-blur-sm">
          <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[840px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-4rem)]">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="truncate text-base font-bold text-slate-900">
                    AI Bill Instant Preview
                  </h3>
                  {Number(previewDraft.mkt) > 0 && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900 border border-amber-300 font-mono">
                      MKT: ₹{previewDraft.mkt}
                    </span>
                  )}
                  {(previewDraft.gst_mode === 'percent18' || Number(previewDraft.gst_rate) === 18) && (
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-bold text-purple-800 border border-purple-200">
                      18% GST
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Direct printable layout preview for <strong className="text-slate-800">{previewPrintProps.customerName}</strong>
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                onClick={() => { setPreviewDraft(null); setPreviewStatus('') }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-100/60 p-4 sm:p-6">
              <div className="mx-auto flex w-full max-w-[14cm] justify-center">
                <div
                  ref={previewRef}
                  className={`${BILL_PREVIEW_CARD_CLASS} w-full shadow-md`}
                  style={{ width: `${BILL_PRINT_PAGE_WIDTH_CM}cm`, maxWidth: '100%' }}
                >
                  <BillPrintLayout {...previewPrintProps} />
                </div>
              </div>
            </div>

            {previewStatus && (
              <div className="bg-amber-50 px-5 py-2 text-xs font-medium text-amber-800 border-t border-amber-200">
                {previewStatus}
              </div>
            )}

            <div className="grid shrink-0 gap-3 border-t border-slate-200 bg-white px-5 py-3.5 md:grid-cols-[1fr_auto] md:items-center">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const d = previewDraft
                    setPreviewDraft(null)
                    loadIntoBill(d, false)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-sm"
                >
                  <ArrowRight size={14} /> Review &amp; Edit in Editor
                </button>
                {previewDraft.status === 'pending_review' && (
                  <button
                    type="button"
                    onClick={() => {
                      updateStatusMutation.mutate({ id: previewDraft.id, status: 'approved' })
                      setPreviewDraft(null)
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-sm"
                  >
                    <Check size={14} /> Approve Draft
                  </button>
                )}
              </div>
              <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm"
                  onClick={printDraftPreview}
                >
                  <Printer size={13} /> Print
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm"
                  onClick={() => void saveDraftPreviewJpg()}
                >
                  <Download size={13} /> JPG
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition shadow-sm"
                  onClick={shareDraftWhatsApp}
                >
                  <Share2 size={13} /> WhatsApp
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
                  onClick={() => { setPreviewDraft(null); setPreviewStatus('') }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
