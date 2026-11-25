import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { toUserMessage } from '@/app/errors'
import { approveMusePurchaseAction, musePurchaseActionsKey, type MusePurchaseActionRecord } from '@/data/muse-purchase-action-drafts'
import { purchaseBillQueryOptions } from '@/data/purchase-queries'
import { loadLatestPendingPurchaseBillDrafts } from '@/data/purchase-bill-drafts'
import { prepareMusePurchaseAction } from '@/domain/muse-purchase-actions'
import { computeBillNet } from '@/domain/supplier-purchases'
import { formatPaiseInr } from '@/lib/inr-format'
import { Panel } from '@/components/ui/panel'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { buttonClass } from '@/components/ui/form-control-classes'

function parse(record: MusePurchaseActionRecord) {
  try { return prepareMusePurchaseAction(record.payload) } catch { return null }
}

export function NewPurchaseMuseStrip() {
  const query = useQuery({ queryKey: ['purchase-bill-drafts', 'quick-review'], queryFn: loadLatestPendingPurchaseBillDrafts, refetchOnWindowFocus: 'always' })
  if (!query.data?.length) return null
  return <Panel className="mx-3 mt-3 space-y-2 sm:mx-4 lg:mx-6">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Muse purchase drafts</h2>
      <Link to="/drafts" className="text-xs underline">All drafts</Link>
    </div>
    {query.data.map((draft) => <div key={draft.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
      {draft.parsed.kind === 'valid' ? <>
        <span><strong>{draft.parsed.value.supplier_name}</strong> · {draft.parsed.value.lines.length} items · {draft.parsed.value.date}</span>
        {draft.supplier_draft
          ? <Link to="/drafts" className={buttonClass('primary')}>Review in AI Drafts</Link>
          : <Link to="/new-purchase-bill" search={{ draftId: draft.id }} className={buttonClass('primary')}>Review</Link>}
      </> : <>
        <span>Purchase proposal needs correction</span><Link to="/drafts" className={buttonClass('secondary')}>Open inbox</Link>
      </>}
    </div>)}
  </Panel>
}

export function MusePurchaseActionReview({ selected, onClose }: { selected: MusePurchaseActionRecord; onClose: () => void }) {
  const client = useQueryClient()
  const action = parse(selected)
  const detail = useQuery(purchaseBillQueryOptions(action?.kind === 'bardan' ? action.billId : ''))
  const review = useMutation({
    mutationFn: async () => approveMusePurchaseAction(selected),
    onSuccess: async (result) => {
      toast.success(result.type === 'bill' ? `Supplier and first bill saved · ${result.inNo}` : 'Bardan saved.')
      await Promise.all([
        client.invalidateQueries({ queryKey: musePurchaseActionsKey }),
        client.invalidateQueries({ queryKey: ['purchase-draft-suppliers'] }),
        client.invalidateQueries({ queryKey: ['purchase-bill-drafts'] }),
        client.invalidateQueries({ queryKey: ['purchase-payment-drafts'] }),
        invalidateAfterSupplierPurchaseWrite(client),
      ])
      onClose()
    },
  })
  const target = detail.data
  const line = action?.kind === 'bardan' && target ? target.lines.find((entry) => entry.id === action.lineId) : null
  const billPreview = action?.kind === 'new_supplier_bill'
    ? computeBillNet(action.bill.lines.map((entry) => ({ amountPaise: entry.amount_paise })), [], [], action.bill.tax_mode, action.bill.gst_rate_bp ?? 0)
    : null
  return <Dialog open onOpenChange={(open) => { if (!open && !review.isPending) onClose() }}>
      <DialogContent showCloseButton={!review.isPending} className="max-h-[90vh] overflow-auto sm:max-w-xl">
        <DialogTitle>Review Purchase action</DialogTitle>
        <DialogDescription>Nothing is posted until you confirm.</DialogDescription>
        {action?.kind === 'bardan' && <div className="space-y-2 rounded-lg border p-3 text-sm">
          {detail.isPending ? <p>Loading slip…</p> : target && line ? <>
            <p>{target.bill.inNo} · {line.itemName} · {target.bill.pool.toUpperCase()}</p>
            <p>{action.bagCount} bags · {(action.weightG / 1000).toFixed(3)} kg total · ₹{(action.rateMilli / 1000).toFixed(2)}/kg</p>
            <p>{action.method === 'deduct' ? `Bardan deduction ${formatPaiseInr(action.creditPaise)}` : 'In-kind settlement · no deduction'}</p>
            {line.rateMilli !== action.rateMilli && <p role="alert">The slip rate changed. Reject and ask Muse for a fresh proposal.</p>}
          </> : <p role="alert">Slip or material line is unavailable.</p>}
        </div>}
        {action?.kind === 'new_supplier_bill' && billPreview && <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p><strong>{action.bill.supplier_name}</strong> · new supplier · {action.bill.date} · {action.bill.pool.toUpperCase()}</p>
          {action.bill.lines.map((entry, i) => <p key={i}>{entry.item_name} · {entry.weight_g / 1000} kg × ₹{entry.rate_milli / 1000} · {formatPaiseInr(entry.amount_paise)}</p>)}
          <p className="font-semibold">Bill net {formatPaiseInr(billPreview.netPaise)}</p>
        </div>}
        {action?.kind === 'opening_balance' && <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p><strong>{action.supplierName}</strong> · opening balance proposal · {action.date}</p>
          <p>Kacha: {formatPaiseInr(action.kachaPaise)} · GST: {formatPaiseInr(action.gstPaise)}</p>
          {selected.status === 'approved' && <Link className="underline" to="/supplier-ledger/$supplierId" params={{ supplierId: action.supplierId }}>View saved balance in supplier ledger</Link>}
        </div>}
        {!action && <p role="alert" className="text-xs text-rose-700">Invalid proposal. Reject it and ask Muse to resubmit.</p>}
        {selected.raw_text && <details className="text-xs"><summary>Original message</summary><p className="mt-1 whitespace-pre-wrap break-words">{selected.raw_text}</p></details>}
        {review.isError && <p role="alert" className="text-xs text-rose-700">{toUserMessage(review.error)}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClass('secondary')} disabled={review.isPending} onClick={onClose}>Close</button>
          {selected.status === 'pending_review' && action?.kind !== 'opening_balance' && <button type="button" className={buttonClass('primary')} disabled={review.isPending || !action || (action.kind === 'bardan' && (!line || target?.bill.cancelled || line.rateMilli !== action.rateMilli))} onClick={() => review.mutate()}>Confirm &amp; Save</button>}
        </div>
      </DialogContent>
    </Dialog>
}
