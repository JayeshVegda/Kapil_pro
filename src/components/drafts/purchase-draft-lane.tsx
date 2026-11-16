import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Panel } from '@/components/ui/panel'
import { DataTable } from '@/components/ui/data-table'
import { StatusChip } from '@/components/ui/status-chip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { buttonClass, inputClass } from '@/components/ui/form-control-classes'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { countPendingPurchaseBillDrafts, loadPurchaseBillDraftLane, rejectPurchaseBillDraft, type PurchaseBillDraftView } from '@/data/purchase-bill-drafts'
import { listPurchaseItems, listSuppliers, type PurchaseItemView, type SupplierView } from '@/data/suppliers'
import { calculateDraftLinePaise, matchPurchaseMaster, type PurchaseBillDraftPayloadV1, type PurchaseMaster } from '@/domain/purchase-bill-draft'
import { computeBillNet } from '@/domain/supplier-purchases'
import { formatPaiseInr } from '@/lib/inr-format'
import { gramsToKgText, milliToRateText } from '@/domain/supplier-units'
import { formatFullDate } from '@/lib/date'
import { pollWhileTabVisible } from '@/lib/poll-while-visible'

export function getPurchaseDraftSummary(payload: PurchaseBillDraftPayloadV1) {
  const lines = payload.lines.map((line) => ({ ...line, computed: calculateDraftLinePaise(line.weight_g, line.rate_milli) }))
  const bardan = (payload.bardan ?? []).map((entry) => ({
    method: entry.method,
    creditPaise: entry.method === 'deduct' ? (entry.credit_paise ?? calculateDraftLinePaise(entry.bardan_g, entry.rate_milli)) : 0,
    cashAmountPaise: entry.cash_amount_paise ?? 0,
  }))
  const net = computeBillNet(lines.map((line) => ({ amountPaise: line.computed })),
    (payload.adjustments ?? []).map((a) => ({ type: a.type, amountPaise: a.amount_paise })), bardan,
    payload.tax_mode, payload.gst_rate_bp ?? (payload.pool === 'gst' ? 1800 : 0))
  return { lines, bardan, net }
}

export function PurchaseDraftLane({ selected, onClose }: { selected?: PurchaseBillDraftView | null; onClose?: () => void }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [showHistory, setShowHistory] = useState(false)
  const [preview, setPreview] = useState<PurchaseBillDraftView | null>(null)
  const [rejecting, setRejecting] = useState<PurchaseBillDraftView | null>(null)
  const [reason, setReason] = useState('')
  const lane = useQuery({ queryKey: ['purchase-bill-drafts', showHistory], queryFn: () => loadPurchaseBillDraftLane(showHistory), enabled: selected === undefined, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const count = useQuery({ queryKey: ['purchase-bill-drafts-count'], queryFn: countPendingPurchaseBillDrafts, enabled: selected === undefined, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const suppliers = useQuery({ queryKey: ['purchase-draft-suppliers'], queryFn: () => listSuppliers({ includeInactive: true }), staleTime: 60_000 })
  const items = useQuery({ queryKey: ['purchase-draft-items'], queryFn: listPurchaseItems, staleTime: 60_000 })
  const refresh = () => { void client.invalidateQueries({ queryKey: ['purchase-bill-drafts'] }); void client.invalidateQueries({ queryKey: ['purchase-bill-drafts-count'] }) }
  const reject = useMutation({ mutationFn: () => rejectPurchaseBillDraft(rejecting!.id, reason), onSuccess: () => { setRejecting(null); setReason(''); refresh() } })

  const columns = useMemo<ColumnDef<PurchaseBillDraftView, unknown>[]>(() => [
    { header: 'Module / Status', cell: ({ row }) => <div className="flex flex-wrap gap-1"><StatusChip tone="selection">Purchase</StatusChip><StatusChip tone={row.original.parsed.kind === 'invalid' ? 'danger' : row.original.status === 'pending_review' ? 'warning' : 'neutral'}>{row.original.parsed.kind === 'invalid' ? 'Invalid draft' : row.original.status.replace('_', ' ')}</StatusChip></div> },
    { header: 'Supplier', cell: ({ row }) => <span className="font-medium">{row.original.parsed.kind === 'valid' ? row.original.parsed.value.supplier_name : 'Needs correction'}</span> },
    { header: 'Date', cell: ({ row }) => row.original.parsed.kind === 'valid' ? formatFullDate(row.original.parsed.value.date) : '—' },
    { header: 'Pool / Amount', cell: ({ row }) => {
      if (row.original.parsed.kind === 'invalid') return '—'
      const summary = getPurchaseDraftSummary(row.original.parsed.value)
      return <span className="font-mono tabular-nums">{row.original.parsed.value.pool} · {formatPaiseInr(summary.net.netPaise)}</span>
    } },
    { header: 'Actions', cell: ({ row }) => <div className="flex flex-wrap gap-1.5">
      <button type="button" className={buttonClass('secondary')} onClick={() => setPreview(row.original)}>Preview</button>
      {row.original.status === 'pending_review' && row.original.parsed.kind === 'valid' && <button type="button" className={buttonClass()} onClick={() => void navigate({ to: '/new-purchase-bill', search: { draftId: row.original.id } })}>Review &amp; Edit</button>}
      {row.original.status === 'pending_review' && <button type="button" className={buttonClass('secondary')} onClick={() => { setRejecting(row.original); setReason('') }}>Reject</button>}
    </div> },
  ], [navigate])

  const activePreview = selected ?? preview
  const closePreview = () => { setPreview(null); onClose?.() }
  const parsed = activePreview?.parsed.kind === 'valid' ? activePreview.parsed.value : null
  const summary = parsed ? getPurchaseDraftSummary(parsed) : null
  const supplierMasters: PurchaseMaster[] = (suppliers.data ?? []).map((s: SupplierView) => ({ id: s.id, name: s.companyName, active: s.active, aliases: (s as SupplierView & { aliases?: string }).aliases }))
  const itemMasters: PurchaseMaster[] = (items.data ?? []).map((item: PurchaseItemView) => ({ id: item.id, name: item.name, active: item.active, aliases: (item as PurchaseItemView & { aliases?: string }).aliases }))
  const warnings = parsed && summary ? [
    !matchPurchaseMaster(parsed.supplier_name, parsed.supplier_id, supplierMasters) && 'Supplier not matched; choose one in the editor.',
    ...parsed.lines.map((line, i) => !matchPurchaseMaster(line.item_name, line.item_id, itemMasters) && `Line ${i + 1}: item not matched; choose one in the editor.`),
    ...summary.lines.map((line, i) => line.amount_paise !== line.computed && `Line ${i + 1}: Muse amount ${formatPaiseInr(line.amount_paise)} differs from calculated ${formatPaiseInr(line.computed)}.`),
    activePreview && activePreview.confidence < 0.7 && 'Low confidence: check the original message carefully.',
    parsed.stated_total_paise != null && parsed.stated_total_paise !== summary.net.netPaise && `Stated total ${formatPaiseInr(parsed.stated_total_paise)} differs from net payable ${formatPaiseInr(summary.net.netPaise)}.`,
  ].filter((warning): warning is string => Boolean(warning)) : []

  return <>
    {selected === undefined && <Panel className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-slate-900">Purchase Bill Drafts <StatusChip tone="warning">{count.data ?? 0} pending</StatusChip></h3><p className="text-xs text-slate-600">Review Muse proposals before creating an inward bill.</p></div>
      <button type="button" className={buttonClass('secondary')} onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Pending only' : 'Show history'}</button>
    </div>
    <DataTable data={lane.data ?? []} columns={columns} loading={lane.isLoading} error={lane.error instanceof Error ? lane.error.message : undefined} empty="No purchase bill drafts to review." initialPageSize={25} />
    </Panel>}

    <Dialog open={Boolean(activePreview)} onOpenChange={(open) => { if (!open) closePreview() }}>
      <DialogContent className="max-h-[90vh] w-full max-w-5xl overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>Purchase Bill Draft</DialogTitle><DialogDescription>Compare the original message with Muse's proposed fields.</DialogDescription></DialogHeader>
        {activePreview && <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Panel className="bg-slate-50"><h4 className="text-xs font-semibold text-slate-700">Original message</h4><p className="mt-2 whitespace-pre-wrap text-sm text-slate-900">{activePreview.raw_text || 'No original text supplied.'}</p></Panel>
            <Panel><h4 className="text-xs font-semibold text-slate-700">Parsed fields</h4>{parsed ? <div className="mt-2 space-y-1 text-sm"><p>{parsed.supplier_name} · {formatFullDate(parsed.date)}</p><p>Pool: {parsed.pool} · Tax: {parsed.tax_mode}</p><p>Supplier bill: {parsed.supplier_bill_no || '—'} · Vehicle: {parsed.vehicle_no || '—'}</p><p>Notes: {parsed.private_note || '—'}</p></div> : <StatusChip tone="danger">Invalid draft</StatusChip>}</Panel>
          </div>
          {activePreview.parsed.kind === 'invalid' && <Panel className="border-rose-200 bg-rose-50"><p className="font-semibold text-rose-800">Invalid draft — editor unavailable</p><ul className="mt-1 list-inside list-disc text-xs text-rose-700">{activePreview.parsed.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></Panel>}
          {warnings.length > 0 && <Panel className="border-amber-200 bg-amber-50"><h4 className="text-xs font-semibold text-amber-800">Review warnings</h4><ul className="mt-1 list-inside list-disc text-xs text-amber-800">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></Panel>}
          {parsed && summary && <>
            <Panel className="space-y-2"><h4 className="text-xs font-semibold text-slate-700">Material lines</h4>{summary.lines.map((line, i) => <div key={i} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 py-1 text-sm"><span>{line.item_name} · {gramsToKgText(line.weight_g)} kg @ ₹{milliToRateText(line.rate_milli)}/kg</span><span className="font-mono tabular-nums">{formatPaiseInr(line.computed)}</span></div>)}</Panel>
            <div className="grid gap-3 md:grid-cols-2"><Panel><h4 className="text-xs font-semibold text-slate-700">Adjustments &amp; bardan</h4>{(parsed.adjustments ?? []).map((a, i) => <p key={i} className="text-sm">{a.type}: {formatPaiseInr(a.amount_paise)} {a.note}</p>)}{(parsed.bardan ?? []).map((b, i) => <p key={i} className="text-sm">{b.method} · {gramsToKgText(b.bardan_g)} kg · credit {formatPaiseInr(summary.bardan[i].creditPaise)}</p>)}{!parsed.adjustments?.length && !parsed.bardan?.length && <p className="text-xs text-slate-500">None proposed</p>}</Panel><Panel><h4 className="text-xs font-semibold text-slate-700">Settlement</h4><p className="mt-1 text-sm">Tax: {formatPaiseInr(summary.net.taxPaise)}{parsed.tax_mode === 'rcm' ? ' (RCM liability; not supplier payable)' : ''}</p><p className="text-sm">On-bill payment: {formatPaiseInr(parsed.payment?.amount_paise ?? 0)}</p><p className="mt-2 font-mono text-base font-semibold tabular-nums">Net payable: {formatPaiseInr(summary.net.netPaise)}</p></Panel></div>
          </>}
          <div className="flex justify-end gap-2"><button type="button" className={buttonClass('secondary')} onClick={closePreview}>Close</button>{activePreview.status === 'pending_review' && parsed && <button type="button" className={buttonClass()} onClick={() => void navigate({ to: '/new-purchase-bill', search: { draftId: activePreview.id } })}>Review &amp; Edit</button>}</div>
        </div>}
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={Boolean(rejecting)} onOpenChange={(open) => { if (!open) setRejecting(null) }} title="Reject purchase bill draft?" tone="danger" confirmLabel="Reject Draft" pending={reject.isPending} onConfirm={() => reject.mutate()} description={<div className="space-y-2"><p>This proposal will stay in history and cannot be saved as a bill.</p><label className="block">Reason (optional)<input className={`${inputClass} mt-1`} value={reason} onChange={(event) => setReason(event.target.value)} /></label>{reject.isError && <p role="alert" className="text-rose-700">{reject.error instanceof Error ? reject.error.message : 'Could not reject draft.'}</p>}</div>} />
  </>
}
