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
import { countPendingCastingSessionDrafts, loadCastingSessionDraftLane, rejectCastingSessionDraft, type CastingSessionDraftView } from '@/data/casting-session-drafts'
import { loadCastingMaterials } from '@/data/casting'
import { matchCastingMaterial } from '@/domain/casting-session-draft'
import { calculateCastingCost } from '@/domain/casting-calculations'
import { pollWhileTabVisible } from '@/lib/poll-while-visible'

export function CastingSessionDraftLane({ selected, onClose }: { selected?: CastingSessionDraftView | null; onClose?: () => void }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [history, setHistory] = useState(false)
  const [preview, setPreview] = useState<CastingSessionDraftView | null>(null)
  const [rejecting, setRejecting] = useState<CastingSessionDraftView | null>(null)
  const [reason, setReason] = useState('')
  const lane = useQuery({ queryKey: ['casting-session-drafts', history], queryFn: () => loadCastingSessionDraftLane(history), enabled: selected === undefined, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const count = useQuery({ queryKey: ['casting-session-drafts-count'], queryFn: countPendingCastingSessionDrafts, enabled: selected === undefined, refetchInterval: pollWhileTabVisible(45_000), refetchOnWindowFocus: true })
  const materials = useQuery({ queryKey: ['casting-materials'], queryFn: loadCastingMaterials, staleTime: 60_000 })
  const activePreview = selected ?? preview
  const closePreview = () => { setPreview(null); onClose?.() }
  const valid = activePreview?.parsed.kind === 'valid' ? activePreview.parsed : null
  const cost = valid ? calculateCastingCost({ batches: valid.batches, coalKg: valid.coalKg, coalRate: valid.coalRate, workerSalary: valid.workerSalary }) : null
  const warnings = valid ? [
    ...valid.batches.flatMap((batch) => batch.inputs.map((input) => !matchCastingMaterial(input.materialName, input.materialId, materials.data ?? []) && `Batch ${batch.batchNumber}: ${input.materialName} is unmatched.`)),
    valid.batches.some((batch) => batch.inputs.length === 0 || batch.inputs.some((input) => input.qty <= 0 || input.rate <= 0)) && 'A batch has missing or non-positive material inputs.',
    valid.batches.some((batch) => batch.wireOut <= 0) && 'A batch has missing or non-positive wire output.',
    activePreview && activePreview.confidence < 0.7 && 'Low confidence: compare carefully with the original message.',
  ].filter((warning): warning is string => Boolean(warning)) : []
  const refresh = () => { void client.invalidateQueries({ queryKey: ['casting-session-drafts'] }); void client.invalidateQueries({ queryKey: ['casting-session-drafts-count'] }) }
  const reject = useMutation({ mutationFn: () => rejectCastingSessionDraft(rejecting!.id, reason), onSuccess: () => { setRejecting(null); setReason(''); refresh() } })
  const columns = useMemo<ColumnDef<CastingSessionDraftView, unknown>[]>(() => [
    { header: 'Module / Status', cell: ({ row }) => <div className="flex flex-wrap gap-1"><StatusChip tone="selection">Casting</StatusChip><StatusChip tone={row.original.parsed.kind === 'invalid' ? 'danger' : row.original.status === 'pending_review' ? 'warning' : 'neutral'}>{row.original.parsed.kind === 'invalid' ? 'Invalid draft' : row.original.status.replace('_', ' ')}</StatusChip></div> },
    { header: 'Date', cell: ({ row }) => row.original.parsed.kind === 'valid' ? row.original.parsed.value.date : '—' },
    { header: 'Batches / Output', cell: ({ row }) => row.original.parsed.kind === 'valid' ? `${row.original.parsed.batches.length} · ${row.original.parsed.batches.reduce((sum, batch) => sum + batch.wireOut, 0).toFixed(3)} kg` : '—' },
    { header: 'Actions', cell: ({ row }) => <div className="flex flex-wrap gap-1.5"><button type="button" className={buttonClass('secondary')} onClick={() => setPreview(row.original)}>Preview</button>{row.original.status === 'pending_review' && row.original.parsed.kind === 'valid' && <button type="button" className={buttonClass()} onClick={() => void navigate({ to: '/casting/new-session', search: { draftId: row.original.id } })}>Review &amp; Edit</button>}{row.original.status === 'pending_review' && <button type="button" className={buttonClass('secondary')} onClick={() => { setRejecting(row.original); setReason('') }}>Reject</button>}</div> },
  ], [navigate])
  return <>
    {selected === undefined && <Panel className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">Casting Session Drafts <StatusChip tone="warning">{count.data ?? 0} pending</StatusChip></h3><p className="text-xs text-slate-600">Review furnace inputs and output before saving.</p></div><button type="button" className={buttonClass('secondary')} onClick={() => setHistory(!history)}>{history ? 'Pending only' : 'Show history'}</button></div>
    <DataTable data={lane.data ?? []} columns={columns} loading={lane.isLoading} error={lane.error instanceof Error ? lane.error.message : undefined} empty="No Casting drafts to review." initialPageSize={25} />
    </Panel>}
    <Dialog open={Boolean(activePreview)} onOpenChange={(open) => { if (!open) closePreview() }}><DialogContent className="max-h-[90vh] w-full max-w-4xl overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>Casting Session Draft</DialogTitle><DialogDescription>Compare Muse’s message with the calculated furnace results.</DialogDescription></DialogHeader>{activePreview && <div className="space-y-3"><div className="grid gap-3 md:grid-cols-2"><Panel className="bg-slate-50"><h4 className="text-xs font-semibold text-slate-700">Original message</h4><p className="mt-2 whitespace-pre-wrap text-sm">{activePreview.raw_text || 'No original text supplied.'}</p></Panel><Panel><h4 className="text-xs font-semibold text-slate-700">Parsed session</h4>{valid ? <div className="mt-2 space-y-1 text-sm"><p>{valid.value.date} · {valid.batches.length} batches</p><p>Coal: {valid.coalKg.toFixed(3)} kg @ ₹{valid.coalRate.toFixed(3)}/kg</p><p>Worker wages: ₹{valid.workerSalary.toFixed(2)}</p><p>Note: {valid.value.note || '—'}</p></div> : <StatusChip tone="danger">Invalid draft</StatusChip>}</Panel></div>{activePreview.parsed.kind === 'invalid' && <Panel className="border-rose-200 bg-rose-50 text-sm text-rose-800">Invalid draft — editor unavailable: {activePreview.parsed.issues.join('; ')}</Panel>}{warnings.length > 0 && <Panel className="border-amber-200 bg-amber-50 text-sm text-amber-800">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</Panel>}{valid && cost && <Panel className="space-y-2"><h4 className="text-xs font-semibold text-slate-700">Cost, yield &amp; wastage</h4><p className="text-sm">Input {cost.totalInputKg.toFixed(3)} kg · Wire out {cost.totalWireOut.toFixed(3)} kg · Mel {cost.totalMel.toFixed(3)} kg</p><p className="text-sm">Yield {cost.totalInputKg > 0 ? (cost.totalWireOut / cost.totalInputKg * 100).toFixed(1) : '0.0'}% · Wastage {cost.totalInputKg > 0 ? (cost.totalMel / cost.totalInputKg * 100).toFixed(1) : '0.0'}% · Casting cost ₹{cost.finalCastingCostPerKg.toFixed(2)}/kg</p>{valid.batches.map((batch) => <div key={batch.batchNumber} className="border-t border-slate-100 pt-1 text-sm"><p className="font-semibold">Batch {batch.batchNumber}: wire {batch.wireOut.toFixed(3)} kg · mel {batch.mel.toFixed(3)} kg</p>{batch.inputs.map((input, index) => <p key={`${input.materialName}-${index}`} className="text-slate-600">{input.materialName} · {input.qty.toFixed(3)} kg @ ₹{input.rate.toFixed(3)}/kg</p>)}</div>)}</Panel>}<div className="flex justify-end gap-2"><button type="button" className={buttonClass('secondary')} onClick={closePreview}>Close</button>{activePreview.status === 'pending_review' && valid && <button type="button" className={buttonClass()} onClick={() => void navigate({ to: '/casting/new-session', search: { draftId: activePreview.id } })}>Review &amp; Edit</button>}</div></div>}</DialogContent></Dialog>
    <ConfirmDialog open={Boolean(rejecting)} onOpenChange={(open) => { if (!open) setRejecting(null) }} title="Reject Casting draft?" tone="danger" confirmLabel="Reject Draft" pending={reject.isPending} onConfirm={() => reject.mutate()} description={<div className="space-y-2"><p>The proposal stays in history and cannot be saved.</p><label className="block">Reason (optional)<input className={`${inputClass} mt-1`} value={reason} onChange={(event) => setReason(event.target.value)} /></label>{reject.isError && <p role="alert" className="text-rose-700">{reject.error instanceof Error ? reject.error.message : 'Could not reject draft.'}</p>}</div>} />
  </>
}
