import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type RefObject } from 'react'
import { X } from 'lucide-react'
import { pb } from '@/data/pocketbase'
import { countPendingDrafts, loadDraftItemMasters, loadDraftPage } from '@/data/bill-drafts'
import { countPendingPaymentDrafts, loadPaymentDraftPage, rejectPaymentDraft, savePaymentFromDraft } from '@/data/payment-drafts'
import { countPendingPurchaseBillDrafts, loadPurchaseBillDraftLane, rejectPurchaseBillDraft, type PurchaseBillDraftView } from '@/data/purchase-bill-drafts'
import { countPendingPurchasePaymentDrafts, loadPurchasePaymentDraftLane, rejectPurchasePaymentDraft, type PurchasePaymentDraftView } from '@/data/purchase-payment-drafts'
import { countPendingCastingSessionDrafts, loadCastingSessionDraftLane, rejectCastingSessionDraft, type CastingSessionDraftView } from '@/data/casting-session-drafts'
import { loadCustomerAutoBalanceContext } from '@/data/customer-balance'
import { loadPaymentCustomers } from '@/data/payments'
import { buildDraftView, type DraftView } from '@/domain/drafts'
import { composeReceiptNote, PAYMENT_MODES, type PaymentDraftView } from '@/domain/payment-drafts'
import { draftAge, filterDraftInbox, type InboxEntry, type InboxKind, type InboxModule, type InboxStatus } from '@/domain/draft-inbox'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { formatPaiseInr } from '@/lib/inr-format'
import { pollWhileTabVisible } from '@/lib/poll-while-visible'
import { BillPrintLayout, BILL_PRINT_PAGE_WIDTH_CM, type BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { BILL_PREVIEW_CARD_CLASS, BILL_PRINT_DOCUMENT_TITLE, downloadBillLayoutAsJpg, printBillLayoutFromElement, shareBillLayoutImageWithWhatsAppFallback } from '@/lib/bill-print-export'
import { buildBillPreviewProps } from '@/lib/bill-preview-props'
import { calculateBillTotals } from '@/domain/billing-calculations'
import { PurchaseDraftLane, getPurchaseDraftSummary } from '@/components/drafts/purchase-draft-lane'
import { PurchasePaymentDraftLane } from '@/components/drafts/purchase-payment-draft-lane'
import { CastingSessionDraftLane } from '@/components/drafts/casting-session-draft-lane'
import { useModuleSettings } from '@/lib/use-module-settings'
import { listPurchaseItems, listSuppliers } from '@/data/suppliers'
import { loadCastingMaterials } from '@/data/casting'
import { matchPurchaseMaster } from '@/domain/purchase-bill-draft'
import { matchCastingMaterial } from '@/domain/casting-session-draft'
import { StatusChip } from '@/components/ui/status-chip'
import { Panel } from '@/components/ui/panel'
import { DataTable } from '@/components/ui/data-table'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { buttonClass, inputClass, selectClass } from '@/components/ui/form-control-classes'
import type { ColumnDef } from '@tanstack/react-table'

export const Route = createFileRoute('/drafts')({ component: DraftsPage })

type InboxRow = InboxEntry & {
  source: 'sales-bill' | 'sales-payment' | 'purchase-bill' | 'purchase-payment' | 'casting-session'
  view: DraftView | PaymentDraftView | PurchaseBillDraftView | PurchasePaymentDraftView | CastingSessionDraftView
  party: string
  date: string
  amount: string
  confidence: number
  warning: string
  invalid: boolean
}

function DraftsPage() {
  const { purchaseEnabled, castingEnabled } = useModuleSettings()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [showHistory, setShowHistory] = useState(false)
  const [module, setModule] = useState<InboxModule | 'all'>('all')
  const [kind, setKind] = useState<InboxKind | 'all'>('all')
  const [status, setStatus] = useState<InboxStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<InboxRow | null>(null)
  const [rejecting, setRejecting] = useState<InboxRow | null>(null)
  const [reason, setReason] = useState('')
  const [previewStatus, setPreviewStatus] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)
  const items = useQuery({ queryKey: ['draft-page-items'], queryFn: loadDraftItemMasters, staleTime: 300_000 })
  const fetchStatus = showHistory ? 'all' : 'pending'
  const salesBills = useQuery({ queryKey: ['bill-drafts-page', fetchStatus, ''], queryFn: () => loadDraftPage({ page: 1, perPage: 50, status: fetchStatus, search: '' }), refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const salesPayments = useQuery({ queryKey: ['payment-drafts-page', fetchStatus, ''], queryFn: () => loadPaymentDraftPage({ page: 1, perPage: 50, status: fetchStatus, search: '' }), refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const purchaseBills = useQuery({ queryKey: ['purchase-bill-drafts', showHistory], queryFn: () => loadPurchaseBillDraftLane(showHistory), enabled: purchaseEnabled, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const purchasePayments = useQuery({ queryKey: ['purchase-payment-drafts', showHistory], queryFn: () => loadPurchasePaymentDraftLane(showHistory), enabled: purchaseEnabled, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const castingSessions = useQuery({ queryKey: ['casting-session-drafts', showHistory], queryFn: () => loadCastingSessionDraftLane(showHistory), enabled: castingEnabled, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const salesBillCount = useQuery({ queryKey: ['bill-drafts-pending-count'], queryFn: countPendingDrafts, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const salesPaymentCount = useQuery({ queryKey: ['payment-drafts-pending-count'], queryFn: countPendingPaymentDrafts, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const purchaseBillCount = useQuery({ queryKey: ['purchase-bill-drafts-count'], queryFn: countPendingPurchaseBillDrafts, enabled: purchaseEnabled, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const purchasePaymentCount = useQuery({ queryKey: ['purchase-payment-drafts-count'], queryFn: countPendingPurchasePaymentDrafts, enabled: purchaseEnabled, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const castingCount = useQuery({ queryKey: ['casting-session-drafts-count'], queryFn: countPendingCastingSessionDrafts, enabled: castingEnabled, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const suppliers = useQuery({ queryKey: ['purchase-draft-suppliers'], queryFn: () => listSuppliers({ includeInactive: true }), enabled: purchaseEnabled, staleTime: 60_000 })
  const purchaseItems = useQuery({ queryKey: ['purchase-draft-items'], queryFn: listPurchaseItems, enabled: purchaseEnabled, staleTime: 60_000 })
  const castingMaterials = useQuery({ queryKey: ['casting-materials'], queryFn: loadCastingMaterials, enabled: castingEnabled, staleTime: 60_000 })
  const supplierMasters = (suppliers.data ?? []).map((item) => ({ id: item.id, name: item.companyName, aliases: item.aliases, active: item.active }))
  const purchaseItemMasters = (purchaseItems.data ?? []).map((item) => ({ id: item.id, name: item.name, aliases: item.aliases, active: item.active }))

  const allRows: InboxRow[] = [
    ...(salesBills.data?.drafts ?? []).map(({ draft, items: lines, payments }): InboxRow => {
      const view = buildDraftView(draft, lines, payments, items.data ?? [])
      return { id: view.id, module: 'sales', kind: 'bill', source: 'sales-bill', status: view.status, created: view.created, view, party: view.customerName || 'Unmatched party', date: view.date, amount: view.itemsSubtotal > 0 ? `₹${formatInrInteger(view.grandTotal)}` : '—', confidence: view.confidence, warning: !view.isPartyLinked || view.rows.some((line) => !line.matched) ? 'Unmatched' : view.confidence < 0.7 ? 'Low confidence' : '', invalid: false, searchText: [view.customerName, view.notes, draft.raw_text, ...view.rows.map((line) => line.itemName)].join(' ') }
    }),
    ...(salesPayments.data?.drafts ?? []).map((view): InboxRow => ({ id: view.id, module: 'sales', kind: 'payment', source: 'sales-payment', status: view.status, created: view.created, view, party: view.customerName || 'Unmatched party', date: view.date, amount: `₹${formatInrInteger(view.amount)}`, confidence: view.confidence, warning: !view.isPartyLinked ? 'Unmatched' : view.confidence < 0.7 ? 'Low confidence' : '', invalid: false, searchText: [view.customerName, view.note, view.rawText].join(' ') })),
    ...(purchaseBills.data ?? []).map((view): InboxRow => ({ id: view.id, module: 'purchase', kind: 'bill', source: 'purchase-bill', status: view.status, created: view.created, view, party: view.parsed.kind === 'valid' ? view.parsed.value.supplier_name : 'Invalid draft', date: view.parsed.kind === 'valid' ? view.parsed.value.date : '', amount: view.parsed.kind === 'valid' ? formatPaiseInr(getPurchaseDraftSummary(view.parsed.value).net.netPaise) : '—', confidence: view.confidence, warning: view.parsed.kind === 'invalid' ? 'Invalid draft' : !matchPurchaseMaster(view.parsed.value.supplier_name, view.parsed.value.supplier_id, supplierMasters) || view.parsed.value.lines.some((line) => !matchPurchaseMaster(line.item_name, line.item_id, purchaseItemMasters)) ? 'Unmatched' : view.confidence < 0.7 ? 'Low confidence' : '', invalid: view.parsed.kind === 'invalid', searchText: [view.raw_text, view.notes, view.parsed.kind === 'valid' ? [view.parsed.value.supplier_name, ...view.parsed.value.lines.map((line) => line.item_name)].join(' ') : ''].join(' ') })),
    ...(purchasePayments.data ?? []).map((view): InboxRow => ({ id: view.id, module: 'purchase', kind: 'payment', source: 'purchase-payment', status: view.status, created: view.created, view, party: view.parsed.kind === 'valid' ? view.parsed.value.supplier_name : 'Invalid draft', date: view.parsed.kind === 'valid' ? view.parsed.value.date : '', amount: view.parsed.kind === 'valid' ? formatPaiseInr(view.parsed.amountPaise) : '—', confidence: view.confidence, warning: view.parsed.kind === 'invalid' ? 'Invalid draft' : !matchPurchaseMaster(view.parsed.value.supplier_name, view.parsed.value.supplier_id, supplierMasters) ? 'Unmatched' : view.confidence < 0.7 ? 'Low confidence' : '', invalid: view.parsed.kind === 'invalid', searchText: [view.raw_text, view.notes, view.parsed.kind === 'valid' ? view.parsed.value.supplier_name : ''].join(' ') })),
    ...(castingSessions.data ?? []).map((view): InboxRow => ({ id: view.id, module: 'casting', kind: 'session', source: 'casting-session', status: view.status, created: view.created, view, party: view.parsed.kind === 'valid' ? view.parsed.value.batches.flatMap((batch) => batch.inputs.map((input) => input.material_name)).slice(0, 2).join(', ') || 'Casting session' : 'Invalid draft', date: view.parsed.kind === 'valid' ? view.parsed.value.date : '', amount: view.parsed.kind === 'valid' ? `${view.parsed.batches.reduce((sum, batch) => sum + batch.wireOut, 0).toFixed(3)} kg` : '—', confidence: view.confidence, warning: view.parsed.kind === 'invalid' ? 'Invalid draft' : view.parsed.value.batches.some((batch) => batch.inputs.some((input) => !matchCastingMaterial(input.material_name, input.material_id, castingMaterials.data ?? []))) ? 'Unmatched' : view.confidence < 0.7 ? 'Low confidence' : '', invalid: view.parsed.kind === 'invalid', searchText: [view.raw_text, view.notes, view.parsed.kind === 'valid' ? view.parsed.value.batches.flatMap((batch) => batch.inputs.map((input) => input.material_name)).join(' ') : ''].join(' ') })),
  ]
  const rows = filterDraftInbox(allRows, { purchaseEnabled, castingEnabled, showHistory, module, kind, status, search })
  const counts = { sales: (salesBillCount.data ?? 0) + (salesPaymentCount.data ?? 0), purchase: purchaseEnabled ? (purchaseBillCount.data ?? 0) + (purchasePaymentCount.data ?? 0) : 0, casting: castingEnabled ? castingCount.data ?? 0 : 0 }
  const firstError = [salesBills, salesPayments, purchaseBills, purchasePayments, castingSessions].find((query) => query.isError)?.error
  const refresh = () => { for (const key of ['bill-drafts-page', 'payment-drafts-page', 'purchase-bill-drafts', 'purchase-payment-drafts', 'casting-session-drafts', 'bill-drafts-pending-count', 'payment-drafts-pending-count', 'purchase-bill-drafts-count', 'purchase-payment-drafts-count', 'casting-session-drafts-count']) void client.invalidateQueries({ queryKey: [key] }) }
  const reject = useMutation({ mutationFn: async () => {
    if (!rejecting) return
    if (rejecting.source === 'sales-bill') await pb.collection('bill_drafts').update(rejecting.id, { status: 'rejected' })
    else if (rejecting.source === 'sales-payment') await rejectPaymentDraft(rejecting.id)
    else if (rejecting.source === 'purchase-bill') await rejectPurchaseBillDraft(rejecting.id, reason)
    else if (rejecting.source === 'purchase-payment') await rejectPurchasePaymentDraft(rejecting.id, reason)
    else await rejectCastingSessionDraft(rejecting.id, reason)
  }, onSuccess: () => { setRejecting(null); setReason(''); refresh() } })
  const loadSalesBill = (view: DraftView) => {
    void navigate({ to: '/new-bill', search: { draftId: view.id } })
  }
  const review = (row: InboxRow) => {
    if (row.invalid || row.status !== 'pending_review') return
    if (row.source === 'sales-bill') loadSalesBill(row.view as DraftView)
    else if (row.source === 'sales-payment') setSelected(row)
    else if (row.source === 'purchase-bill') void navigate({ to: '/new-purchase-bill', search: { draftId: row.id } })
    else if (row.source === 'purchase-payment') void navigate({ to: '/new-supplier-payment', search: { draftId: row.id } })
    else void navigate({ to: '/casting/new-session', search: { draftId: row.id } })
  }
  const columns: ColumnDef<InboxRow, unknown>[] = [
    { header: 'Module / Type', cell: ({ row }) => <div className="flex flex-wrap gap-1"><StatusChip tone="selection">{row.original.module}</StatusChip><StatusChip>{row.original.kind}</StatusChip></div> },
    { header: 'Party / Material', cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.party}</span> },
    { header: 'Date', cell: ({ row }) => row.original.date ? formatFullDate(row.original.date) : '—' },
    { header: 'Amount / Weight', cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.amount}</span> },
    { header: 'Age', cell: ({ row }) => draftAge(row.original.created) },
    { header: 'Confidence', cell: ({ row }) => `${Math.round(row.original.confidence <= 1 ? row.original.confidence * 100 : row.original.confidence)}%` },
    { header: 'Status', cell: ({ row }) => <div className="flex flex-wrap gap-1"><StatusChip tone={row.original.status === 'pending_review' ? 'warning' : 'neutral'}>{row.original.status.replace('_', ' ')}</StatusChip>{row.original.warning && <StatusChip tone="danger">{row.original.warning}</StatusChip>}</div> },
    { header: 'Actions', cell: ({ row }) => <div className="flex items-center gap-1.5">{!row.original.invalid && row.original.source !== 'sales-payment' && <button type="button" className={buttonClass('secondary')} onClick={() => setSelected(row.original)}>Preview</button>}{row.original.status === 'pending_review' && !row.original.invalid && <button type="button" className={buttonClass()} onClick={() => review(row.original)}>Review &amp; Edit</button>}{row.original.status === 'pending_review' && <button type="button" className={buttonClass('secondary')} onClick={() => { setRejecting(row.original); setReason('') }}>Reject</button>}</div> },
  ]
  return <div className="w-full space-y-3 px-3 pb-12 pt-3 sm:px-5 lg:px-7">
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-600">Muse proposals awaiting review</p><button type="button" className={buttonClass('secondary')} onClick={() => { setShowHistory(!showHistory); setStatus('all') }}>{showHistory ? 'Pending only' : 'Show history'}</button></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap gap-1" aria-label="Module filter">{(['all', 'sales', 'purchase', 'casting'] as const).filter((item) => item === 'all' || item === 'sales' || item === 'purchase' && purchaseEnabled || item === 'casting' && castingEnabled).map((item) => <button key={item} type="button" onClick={() => setModule(item)} className={item === module ? buttonClass() : buttonClass('secondary')}>{item === 'all' ? `All ${counts.sales + counts.purchase + counts.casting}` : `${item[0].toUpperCase()}${item.slice(1)} ${counts[item]}`}</button>)}</div>
        <select aria-label="Draft type" className={`${selectClass} w-auto`} value={kind} onChange={(event) => setKind(event.target.value as InboxKind | 'all')}><option value="all">All types</option><option value="bill">Bills</option><option value="payment">Payments</option>{castingEnabled && <option value="session">Sessions</option>}</select>
        <select aria-label="Draft status" className={`${selectClass} w-auto`} value={showHistory ? status : 'pending_review'} disabled={!showHistory} onChange={(event) => setStatus(event.target.value as InboxStatus | 'all')}><option value="all">All statuses</option><option value="pending_review">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
        <input aria-label="Search drafts" className={`${inputClass} min-w-36 flex-1`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search party, material, message…" />
      </div>
    </Panel>
    <DataTable data={rows} columns={columns} loading={salesBills.isLoading || salesPayments.isLoading || purchaseEnabled && (purchaseBills.isLoading || purchasePayments.isLoading) || castingEnabled && castingSessions.isLoading} error={firstError instanceof Error ? firstError.message : undefined} empty={search || module !== 'all' || kind !== 'all' || status !== 'all' ? 'No drafts match these filters.' : showHistory ? 'No draft history yet.' : 'No pending drafts. You are all caught up.'} initialPageSize={25} />
    {selected?.source === 'sales-bill' && <DraftPreviewModal view={selected.view as DraftView} onClose={() => { setSelected(null); setPreviewStatus('') }} previewRef={previewRef} status={previewStatus} setStatus={setPreviewStatus} onEdit={() => { const view = selected.view as DraftView; setSelected(null); loadSalesBill(view) }} />}
    {selected?.source === 'sales-payment' && <PaymentAcceptModal view={selected.view as PaymentDraftView} onClose={() => { setSelected(null); refresh() }} refreshAll={client.invalidateQueries} />}
    {purchaseEnabled && <PurchaseDraftLane selected={selected?.source === 'purchase-bill' ? selected.view as PurchaseBillDraftView : null} onClose={() => setSelected(null)} />}
    {purchaseEnabled && <PurchasePaymentDraftLane selected={selected?.source === 'purchase-payment' ? selected.view as PurchasePaymentDraftView : null} onClose={() => setSelected(null)} />}
    {castingEnabled && <CastingSessionDraftLane selected={selected?.source === 'casting-session' ? selected.view as CastingSessionDraftView : null} onClose={() => setSelected(null)} />}
    <ConfirmDialog open={Boolean(rejecting)} onOpenChange={(open) => { if (!open) setRejecting(null) }} title="Reject this draft?" tone="danger" confirmLabel="Reject draft" pending={reject.isPending} onConfirm={() => reject.mutate()} description={<div className="space-y-2"><p>The draft will stay in history and cannot be saved.</p><label className="block">Reason (optional)<input className={`${inputClass} mt-1`} value={reason} onChange={(event) => setReason(event.target.value)} /></label>{reject.error && <p role="alert" className="text-rose-700">{reject.error instanceof Error ? reject.error.message : 'Could not reject draft.'}</p>}</div>} />
  </div>
}

type PreviewModalProps = {
  view: DraftView
  onClose: () => void
  previewRef: RefObject<HTMLDivElement | null>
  status: string
  setStatus: (value: string) => void
  onEdit: () => void
}

function DraftPreviewModal({ view, onClose, previewRef, status, setStatus, onEdit }: PreviewModalProps) {
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
              {isGst && <span className="rounded-full border border-purple-200 bg-purple-100 px-2 py-0.5 text-[11px] font-bold text-purple-800">18% GST</span>}
              {view.isEstimate && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">estimate — some rates auto</span>}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {view.customerName || 'Unmatched Party'} · {view.date ? formatFullDate(view.date) : 'no date'} · {view.rows.length} item{view.rows.length === 1 ? '' : 's'}
              {view.isPartyLinked ? '' : ' · party not linked, ledger balance unavailable'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close draft preview" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
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
            {view.status !== 'approved' && view.status !== 'rejected' && <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-100">Review &amp; Edit in Editor</button>}
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
          <button type="button" onClick={onClose} aria-label="Close payment draft" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
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
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-none focus:border-slate-500"
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
                  className="h-9 w-full rounded-lg border border-amber-300 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-none focus:border-slate-500"
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
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-none focus:border-slate-500" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">
              Amount (₹)
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                className={`h-9 rounded-lg border px-2.5 text-xs text-slate-800 shadow-sm outline-none focus:border-slate-500 ${parsedAmount > 0 ? 'border-slate-300 bg-white' : 'border-amber-300 bg-white'}`}
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
                    className={`rounded-md px-4 py-1.5 text-xs font-semibold transition ${mode === option ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
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
                className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-none focus:border-slate-500"
              />
              <span className="text-[11px] font-normal text-slate-400">Saved as “Receipt via Muse {date || 'unknown-date'}{museNote ? ` - ${museNote}` : ''}”. The dictated text stays on the draft untouched.</span>
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
                  <span className="ml-2 text-[11px] text-slate-500">{amountDue < 0 ? 'advance' : 'receivable'} · figure here wins over what Muse said</span>
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

