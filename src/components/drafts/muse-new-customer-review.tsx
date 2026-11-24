import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { pb } from '@/data/pocketbase'
import { invalidateAfterPaymentWrite } from '@/app/query-invalidation'
import { toUserMessage } from '@/app/errors'
import { getNextBillNoForBook, saveBillWithItems } from '@/data/bills'
import { loadPendingBillDraftForReview } from '@/data/bill-drafts'
import { type DraftView } from '@/domain/drafts'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { buttonClass, inputClass } from '@/components/ui/form-control-classes'

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

export function MuseNewCustomerReview({ view, onClose }: { view: DraftView; onClose: () => void }) {
  const client = useQueryClient()
  const [book, setBook] = useState(String(view.bookNo || 69))
  const [number, setNumber] = useState(view.billNo > 0 ? String(view.billNo) : '')
  const bookNo = Number(book)
  const numberQuery = useQuery({
    queryKey: ['muse-first-sales-bill-number', bookNo],
    queryFn: () => getNextBillNoForBook(bookNo),
    enabled: Number.isSafeInteger(bookNo) && bookNo > 0 && view.status === 'pending_review',
    refetchOnMount: 'always',
  })
  const billNo = number.trim() === '' ? numberQuery.data ?? 0 : Number(number)
  const save = useMutation({
    mutationFn: async () => {
      const draft = await loadPendingBillDraftForReview(view.id)
      if (!('muse_new_customer' in draft) || draft.muse_new_customer !== true || !draft.customer_name) throw new Error('Draft no longer matches this review.')
      if (draft.customer_name !== view.customerName || String(draft.date ?? '').slice(0, 10) !== view.date ||
          Number(draft.mkt ?? 0) !== view.mkt || Number(draft.transport ?? 0) !== view.transport ||
          Number(draft.gst_rate ?? 0) !== view.gstRate || Number(draft.gst_amount ?? 0) !== view.gstAmount ||
          JSON.stringify(draft.payments.map((p) => [p.date, p.amount, p.mode, p.note])) !==
            JSON.stringify(view.payments.map((p) => [p.date?.slice(0, 10), p.amount, p.mode, p.note ?? ''])) ||
          draft.items.length !== view.rows.length ||
          draft.items.some((line, i) => line.qty !== view.rows[i].qty || line.rate !== view.rows[i].rate || line.itemName !== view.rows[i].itemName)) {
        throw new Error('Draft changed. Close and review it again.')
      }
      const items = await Promise.all(draft.items.map(async (line) => {
        if (!line.itemId || !(line.qty > 0) || !(line.rate > 0)) throw new Error('Every item needs a saved match, quantity and final rate.')
        const item = await pb.collection('items').getOne(line.itemId)
        if (item.active === false || item.name !== line.itemName) throw new Error('An item was renamed or deactivated. Review a fresh draft.')
        return { itemId: line.itemId, itemName: line.itemName, qty: line.qty, rate: line.rate, type: String(item.type), unit: String(item.unit), bagWeight: Number(item.bag_weight) }
      }))
      return saveBillWithItems({
        draftId: view.id, newCustomer: true, customerId: view.id,
        customerName: draft.customer_name, bookNo, billNo, date: String(draft.date ?? '').slice(0, 10),
        mktRate: Number(draft.mkt ?? 0), transport: Number(draft.transport ?? 0), gstRate: Number(draft.gst_rate ?? 0), gstAmount: Number(draft.gst_amount ?? 0),
        lrList: String(draft.lr_no ?? '').split(',').map((value) => value.trim()).filter(Boolean),
        items, payments: draft.payments,
      })
    },
    onSuccess: async () => {
      toast.success(`Customer and first Sales bill saved · ${bookNo}/${billNo}`)
      await Promise.all([
        invalidateAfterPaymentWrite(client, view.id),
        ...['customers-options', 'customers', 'bill-drafts-page', 'bill-drafts', 'bill-drafts-pending-count', 'muse-first-sales-bill-number'].map((key) => client.invalidateQueries({ queryKey: [key] })),
      ])
      onClose()
    },
  })
  return <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose() }}>
    <DialogContent showCloseButton={!save.isPending} className="max-h-[90vh] overflow-auto sm:max-w-xl">
      <DialogTitle>New customer + first Sales bill</DialogTitle>
      <DialogDescription>Nothing is posted until you confirm. Kapil saves the customer and bill together.</DialogDescription>
      <section className="space-y-2 rounded-lg border p-3 text-sm">
        <p><strong>{view.customerName}</strong> · {view.date}</p>
        {view.mkt > 0 && <p>Market rate {money.format(view.mkt)}</p>}
        {view.rows.map((item, i) => <p key={i}>{item.itemName} · {item.qty} {item.unit} × {money.format(item.rate)}</p>)}
        {view.transport !== 0 && <p>Transport {money.format(view.transport)}</p>}
        {view.gstAmount > 0 && <p>GST{view.gstRate > 0 ? ` ${view.gstRate}%` : ''} {money.format(view.gstAmount)}</p>}
        <strong>Bill total {money.format(view.grandTotal)}</strong>
        {view.advanceTotal > 0 && <><p>Proposed receipt {money.format(view.advanceTotal)}</p><p>Balance after receipt {money.format(view.grandTotal - view.advanceTotal)}</p></>}
      </section>
      {view.status === 'pending_review' && <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1"><span>Book number</span><input className={inputClass} type="number" min="1" value={book} onChange={(e) => { setBook(e.target.value); setNumber('') }} /></label>
        <label className="space-y-1"><span>Bill number</span><input className={inputClass} type="number" min="1" value={number} placeholder={String(numberQuery.data ?? '')} onChange={(e) => setNumber(e.target.value)} /></label>
      </div>}
      {save.isError && <p role="alert" className="text-xs text-rose-700">{toUserMessage(save.error)}</p>}
      <footer className="flex justify-end gap-2">
        <button type="button" className={buttonClass('secondary')} disabled={save.isPending} onClick={onClose}>Close</button>
        {view.status === 'pending_review' && <button type="button" className={buttonClass('primary')} disabled={save.isPending || !Number.isSafeInteger(bookNo) || bookNo <= 0 || !Number.isSafeInteger(billNo) || billNo <= 0} onClick={() => save.mutate()}>Confirm &amp; Save</button>}
      </footer>
    </DialogContent>
  </Dialog>
}
