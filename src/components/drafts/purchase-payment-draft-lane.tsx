import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Panel } from '@/components/ui/panel'
import { DataTable } from '@/components/ui/data-table'
import { StatusChip } from '@/components/ui/status-chip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { buttonClass, inputClass } from '@/components/ui/form-control-classes'
import { countPendingPurchasePaymentDrafts, loadPurchasePaymentDraftLane, rejectPurchasePaymentDraft, type PurchasePaymentDraftView } from '@/data/purchase-payment-drafts'
import { listSuppliers } from '@/data/suppliers'
import { supplierContextQueryOptions } from '@/data/purchase-queries'
import { matchPurchaseMaster } from '@/domain/purchase-bill-draft'
import { buildSupplierPaymentWorkflow } from '@/domain/supplier-payment-workflow'
import { formatPaiseInr } from '@/lib/inr-format'
import { pollWhileTabVisible } from '@/lib/poll-while-visible'

export function PurchasePaymentDraftLane({ selected, onClose }: { selected?: PurchasePaymentDraftView | null; onClose?: () => void }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [history, setHistory] = useState(false)
  const [preview, setPreview] = useState<PurchasePaymentDraftView | null>(null)
  const [rejecting, setRejecting] = useState<PurchasePaymentDraftView | null>(null)
  const [reason, setReason] = useState('')
  const lane = useQuery({ queryKey: ['purchase-payment-drafts', history], queryFn: () => loadPurchasePaymentDraftLane(history), enabled: selected === undefined, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const count = useQuery({ queryKey: ['purchase-payment-drafts-count'], queryFn: countPendingPurchasePaymentDrafts, enabled: selected === undefined, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const suppliers = useQuery({ queryKey: ['purchase-draft-suppliers'], queryFn: () => listSuppliers({ includeInactive: true }), staleTime: 60_000 })
  const activePreview = selected ?? preview
  const closePreview = () => { setPreview(null); onClose?.() }
  const valid = activePreview?.parsed.kind === 'valid' ? activePreview.parsed : null
  const supplier = valid ? matchPurchaseMaster(valid.value.supplier_name, valid.value.supplier_id, (suppliers.data ?? []).map((row) => ({ id: row.id, name: row.companyName, aliases: row.aliases, active: row.active }))) : null
  const contextQuery = useQuery(supplierContextQueryOptions(supplier?.id ?? ''))
  const context = contextQuery.data
  const workflow = valid && context ? buildSupplierPaymentWorkflow(context, { pool: valid.value.pool, date: valid.value.date, kind: valid.value.kind, amountPaise: valid.amountPaise, selectedBillIds: new Set(valid.value.bill_pins ?? []) }) : null
  const wrongPins = valid && context ? (valid.value.bill_pins ?? []).filter((id) => !context.bundle.bills.some((bill) => bill.id === id && bill.pool === valid.value.pool && !bill.cancelled)) : []
  const warnings = valid ? [
    !supplier && 'Supplier not matched; select an existing Purchase supplier.',
    !valid.value.mode && 'Payment mode missing; choose it in the editor.',
    workflow && valid.value.kind !== 'refund_received' && valid.amountPaise > Math.max(0, workflow.outstandingBefore) && 'Amount exceeds this pool’s current due; excess may become an advance.',
    wrongPins && wrongPins.length > 0 && `${wrongPins.length} pin(s) are missing, cancelled or outside this pool; review before saving.`,
  ].filter((warning): warning is string => Boolean(warning)) : []
  const refresh = () => { void client.invalidateQueries({ queryKey: ['purchase-payment-drafts'] }); void client.invalidateQueries({ queryKey: ['purchase-payment-drafts-count'] }) }
  const reject = useMutation({ mutationFn: () => rejectPurchasePaymentDraft(rejecting!.id, reason), onSuccess: () => { setRejecting(null); setReason(''); refresh() } })
  const columns = useMemo<ColumnDef<PurchasePaymentDraftView, unknown>[]>(() => [
    { header: 'Module / Status', cell: ({ row }) => <div className="flex flex-wrap gap-1"><StatusChip tone="selection">Purchase Payment</StatusChip><StatusChip tone={row.original.parsed.kind === 'invalid' ? 'danger' : row.original.status === 'pending_review' ? 'warning' : 'neutral'}>{row.original.parsed.kind === 'invalid' ? 'Invalid draft' : row.original.status.replace('_', ' ')}</StatusChip></div> },
    { header: 'Supplier', cell: ({ row }) => row.original.parsed.kind === 'valid' ? row.original.parsed.value.supplier_name : 'Needs correction' },
    { header: 'Date / Pool', cell: ({ row }) => row.original.parsed.kind === 'valid' ? `${row.original.parsed.value.date} · ${row.original.parsed.value.pool}` : '—' },
    { header: 'Amount', cell: ({ row }) => row.original.parsed.kind === 'valid' ? formatPaiseInr(row.original.parsed.amountPaise) : '—' },
    { header: 'Actions', cell: ({ row }) => <div className="flex flex-wrap gap-1.5"><button type="button" className={buttonClass('secondary')} onClick={() => setPreview(row.original)}>Preview</button>{row.original.status === 'pending_review' && row.original.parsed.kind === 'valid' && <button type="button" className={buttonClass()} onClick={() => void navigate({ to: '/new-supplier-payment', search: { draftId: row.original.id } })}>Review &amp; Edit</button>}{row.original.status === 'pending_review' && <button type="button" className={buttonClass('secondary')} onClick={() => { setRejecting(row.original); setReason('') }}>Reject</button>}</div> },
  ], [navigate])
  return <>
    {selected === undefined && <Panel className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">Purchase Payment Drafts <StatusChip tone="warning">{count.data ?? 0} pending</StatusChip></h3><p className="text-xs text-slate-600">Review the supplier and pool before saving.</p></div><button type="button" className={buttonClass('secondary')} onClick={() => setHistory(!history)}>{history ? 'Pending only' : 'Show history'}</button></div>
    <DataTable data={lane.data ?? []} columns={columns} loading={lane.isLoading} error={lane.error instanceof Error ? lane.error.message : undefined} empty="No purchase payment drafts to review." initialPageSize={25} />
    </Panel>}
    <Dialog open={Boolean(activePreview)} onOpenChange={(open) => { if (!open) closePreview() }}><DialogContent className="max-h-[90vh] w-full max-w-4xl overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>Purchase Payment Draft</DialogTitle><DialogDescription>Compare Muse’s message with its proposed payment and settlement impact.</DialogDescription></DialogHeader>{activePreview && <div className="space-y-3"><div className="grid gap-3 md:grid-cols-2"><Panel className="bg-slate-50"><h4 className="text-xs font-semibold text-slate-700">Original message</h4><p className="mt-2 whitespace-pre-wrap text-sm">{activePreview.raw_text || 'No original text supplied.'}</p></Panel><Panel><h4 className="text-xs font-semibold text-slate-700">Parsed payment</h4>{valid ? <div className="mt-2 space-y-1 text-sm"><p>{valid.value.supplier_name} · {valid.value.date}</p><p>{valid.value.kind} · {valid.value.pool} · {valid.value.mode || 'Mode needed'}</p><p className="font-mono font-semibold">{formatPaiseInr(valid.amountPaise)}</p><p>Payee: {valid.value.payee || '—'} · Reference: {valid.value.reference || '—'}</p><p>Note: {valid.value.note || '—'}</p></div> : <StatusChip tone="danger">Invalid draft</StatusChip>}</Panel></div>{activePreview.parsed.kind === 'invalid' && <Panel className="border-rose-200 bg-rose-50 text-sm text-rose-800">Invalid draft — editor unavailable: {activePreview.parsed.issues.join('; ')}</Panel>}{warnings.length > 0 && <Panel className="border-amber-200 bg-amber-50 text-sm text-amber-800">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</Panel>}{workflow && <Panel className="space-y-2"><h4 className="text-xs font-semibold text-slate-700">{valid?.value.pool.toUpperCase()} pool impact</h4><p className="text-sm">Due before: {formatPaiseInr(workflow.outstandingBefore)} · Applied: {formatPaiseInr(workflow.allocationPreview.appliedToDuesPaise)} · Due after: {formatPaiseInr(workflow.allocationPreview.outstandingAfterPaise)}</p><p className="text-xs text-slate-600">FIFO pays oldest bills first; selected pins take priority within this pool.</p>{workflow.allocationPreview.lines.filter((line) => line.paidNowPaise > 0).map((line) => <p key={line.billId} className="flex justify-between gap-2 border-t border-slate-100 pt-1 text-sm"><span>{line.inNo} {valid?.value.bill_pins?.includes(line.billId) ? '· pinned' : '· FIFO'}</span><span className="font-mono">{formatPaiseInr(line.paidNowPaise)}</span></p>)}</Panel>}<div className="flex justify-end gap-2"><button type="button" className={buttonClass('secondary')} onClick={closePreview}>Close</button>{activePreview.status === 'pending_review' && valid && <button type="button" className={buttonClass()} onClick={() => void navigate({ to: '/new-supplier-payment', search: { draftId: activePreview.id } })}>Review &amp; Edit</button>}</div></div>}</DialogContent></Dialog>
    <ConfirmDialog open={Boolean(rejecting)} onOpenChange={(open) => { if (!open) setRejecting(null) }} title="Reject purchase payment draft?" tone="danger" confirmLabel="Reject Draft" pending={reject.isPending} onConfirm={() => reject.mutate()} description={<div className="space-y-2"><p>The proposal stays in history and cannot be saved.</p><label className="block">Reason (optional)<input className={`${inputClass} mt-1`} value={reason} onChange={(event) => setReason(event.target.value)} /></label>{reject.isError && <p role="alert" className="text-rose-700">{reject.error instanceof Error ? reject.error.message : 'Could not reject draft.'}</p>}</div>} />
  </>
}
