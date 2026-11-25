import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toUserMessage } from '@/app/errors'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { prepareMuseDraftReview, rejectReviewedDraft, type ReviewSource } from '@/data/muse-draft-review'
import { BillChitty } from '@/components/suppliers/bill-chitty'
import { BillPrintLayout } from '@/components/billing/bill-print-layout'
import { CastingTicket } from '@/components/casting/casting-ticket'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { buttonClass, inputClass } from '@/components/ui/form-control-classes'
import { DateInput } from '@/components/ui/date-input'
import { openingBalanceFromRupees } from '@/domain/muse-purchase-actions'

export type DraftReviewIntent = 'confirm' | 'load' | 'reject'
export function MuseDraftReview({ source, id, intent, party, date, amount, canLoad, isOpeningBalance, onClose, onLoad, onDone }: {
  source: ReviewSource; id: string; intent: DraftReviewIntent
  party: string; date: string; amount: string; canLoad: boolean; isOpeningBalance?: boolean
  onClose: () => void; onLoad: () => void | Promise<void>; onDone: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState('')
  const [openingEdit, setOpeningEdit] = useState<{ date: string; kacha: string; gst: string } | null>(null)
  const query = useQuery({
    queryKey: ['muse-direct-review', source, id],
    queryFn: () => prepareMuseDraftReview(source, id),
    retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, refetchOnMount: 'always',
  })
  const review = query.data
  const action = useMutation({
    mutationFn: async () => {
      if (intent === 'reject') return rejectReviewedDraft(source, id, reason)
      if (!review || query.isFetching) throw new Error('Review has not loaded.')
      const current = await prepareMuseDraftReview(source, id)
      if (current.fingerprint !== review.fingerprint) {
        throw new Error('The draft, bill number or balance changed. Refresh the preview and check it before saving.')
      }
      return current.commit(openingEdit
        ? openingBalanceFromRupees(openingEdit.date, openingEdit.kacha.trim() || '0', openingEdit.gst.trim() || '0')
        : undefined)
    },
    onSuccess: async () => {
      toast.success(intent === 'reject' ? 'Draft rejected; reason saved.' : 'Draft confirmed and saved.')
      const keys = ['customers-options', 'payment-customers', 'customer-auto-balance', 'transactions-page', 'customers-ledger',
        'company-report', 'dashboard', 'casting-sessions', 'casting-log', 'latest-casting-defaults', 'casting-session-drafts',
        'purchase-draft-suppliers', 'muse_purchase_action_drafts']
      await Promise.all([invalidateAfterSupplierPurchaseWrite(client), ...keys.map((key) => client.invalidateQueries({ queryKey: [key] }))])
      onDone()
    },
  })
  const load = useMutation({ mutationFn: async () => onLoad() })
  const title = intent === 'confirm' ? 'Preview and confirm' : intent === 'load' ? 'Preview and load' : 'Preview and reject'
  return <Dialog open onOpenChange={(open) => { if (!open && !action.isPending) onClose() }}>
    <DialogContent showCloseButton={!action.isPending} className="max-h-[92vh] gap-0 overflow-auto border p-0 sm:max-w-4xl">
      <header className="sticky top-0 z-10 border-b bg-white px-5 py-3">
        <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{intent === 'confirm' ? 'Review the details before saving. Opening this preview posts nothing.'
          : intent === 'load' ? 'Loading the draft into an editor does not save anything.'
          : 'The draft stays in history with your reason. No bill or payment will be posted.'}</DialogDescription>
      </header>
      <div className="space-y-3 bg-slate-50/80 p-4">
        {!openingEdit && (query.isPending || !review || review.view === 'summary') && <section className="mx-auto max-w-xl space-y-2 rounded-lg border bg-white p-4 text-sm">
          <p><strong>{review?.info.party || party}</strong> · {review?.info.date || date || 'No date'}</p>
          <p className="text-lg font-semibold">{review?.info.amount || amount}</p>
          {review?.info.details?.map((detail, i) => <p key={i} className="text-sm text-slate-700">{detail}</p>)}
          {query.isPending && <p role="status">Loading preview…</p>}
        </section>}
        {review?.view === 'sales-bill' && <div className="overflow-x-auto"><BillPrintLayout {...review.preview} /></div>}
        {review?.view === 'purchase-bill' && <BillChitty data={review.preview} mode="preview" density="dialog" />}
        {review?.view === 'casting' && <div className="mx-auto max-w-3xl"><CastingTicket session={review.preview} /></div>}
        {openingEdit && <fieldset disabled={action.isPending} className="mx-auto max-w-xl space-y-2 rounded-lg border bg-white p-4">
          <legend className="px-1 text-sm font-semibold">Edit opening balance · {review?.info.party}</legend>
          <p className="text-xs text-slate-600">Positive means payable. Negative means advance. Leave an unused pool at zero.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs">Effective date<DateInput className={inputClass} value={openingEdit.date} onChange={(date) => setOpeningEdit({ ...openingEdit, date })} /></label>
            <label className="text-xs">Kacha (₹)<input className={inputClass} value={openingEdit.kacha} onChange={(event) => setOpeningEdit({ ...openingEdit, kacha: event.target.value })} /></label>
            <label className="text-xs">GST (₹)<input className={inputClass} value={openingEdit.gst} onChange={(event) => setOpeningEdit({ ...openingEdit, gst: event.target.value })} /></label>
          </div>
        </fieldset>}
        {query.isError && <p className="rounded border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900" role="alert">{toUserMessage(query.error)}</p>}
        {review?.raw && <details className="mx-auto max-w-3xl rounded border bg-white p-2.5 text-xs"><summary className="cursor-pointer font-semibold">Original Muse message</summary><p className="mt-1 whitespace-pre-wrap break-words">{review.raw}</p></details>}
      </div>
      <footer className="sticky bottom-0 space-y-2 border-t bg-white px-5 py-3">
        {intent === 'reject' && <label className="block space-y-1 text-sm"><span>Rejection reason (required)</span>
          <textarea value={reason} disabled={action.isPending} onChange={(event) => setReason(event.target.value)} maxLength={1000}
            className={`${inputClass} block min-h-20 w-full py-2`} placeholder="What was wrong, or was this a test?" />
        </label>}
        {(action.isError || load.isError) && <p role="alert" className="text-sm text-rose-700">{toUserMessage(action.error ?? load.error)}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClass('secondary')} disabled={action.isPending} onClick={onClose}>Close</button>
          {intent === 'load' && !openingEdit ? <button type="button" className={buttonClass('primary')}
              disabled={!canLoad || query.isPending || load.isPending || (isOpeningBalance && !review?.opening)}
              onClick={() => review?.opening
                ? setOpeningEdit({ date: review.opening.date, kacha: (review.opening.kachaPaise / 100).toFixed(2), gst: (review.opening.gstPaise / 100).toFixed(2) })
                : load.mutate()}>{load.isPending ? 'Opening…' : 'Load into editor'}</button>
            : <button type="button" className={buttonClass(intent === 'reject' ? 'danger' : 'primary')}
                disabled={action.isPending || (intent === 'reject' ? !reason.trim() : !review || query.isFetching || query.isError)}
                onClick={() => action.mutate()}>{action.isPending ? 'Working…' : intent === 'reject' ? 'Reject draft' : 'Confirm & Save'}</button>}
          {intent === 'confirm' && action.isError && <button type="button" className={buttonClass('secondary')} onClick={() => { action.reset(); void query.refetch() }}>Refresh preview</button>}
        </div>
        {!canLoad && intent === 'load' && <p className="text-right text-xs text-slate-600">This draft cannot be loaded yet. See the preview message above for details.</p>}
      </footer>
    </DialogContent>
  </Dialog>
}
