import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { invalidateAfterSupplierPurchaseWrite } from '@/app/query-invalidation'
import { toUserMessage } from '@/app/errors'
import { pb } from '@/data/pocketbase'
import type { SupplierView } from '@/data/suppliers'
import { openingBalanceFromRupees } from '@/domain/muse-purchase-actions'
import { formatPaiseInr } from '@/lib/inr-format'
import { DateInput } from '@/components/ui/date-input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { buttonClass, inputClass } from '@/components/ui/form-control-classes'

export function CorrectOpeningBalanceDialog({ supplier, onClose }: { supplier: SupplierView; onClose: () => void }) {
  const client = useQueryClient()
  const [expected] = useState(() => ({ date: supplier.openingBalanceDate, kachaPaise: supplier.openingKachaPaise, gstPaise: supplier.openingGstPaise }))
  const [date, setDate] = useState(expected.date)
  const [kacha, setKacha] = useState((expected.kachaPaise / 100).toFixed(2))
  const [gst, setGst] = useState((expected.gstPaise / 100).toFixed(2))
  const [reason, setReason] = useState('')
  const [clearing, setClearing] = useState(false)
  const correction = useMutation({
    mutationFn: () => pb.send('/api/kapil/purchase/correct-opening-balance', {
      method: 'POST',
      body: { supplierId: supplier.id, reason, expected,
        values: clearing ? { date: '', kachaPaise: 0, gstPaise: 0 } : openingBalanceFromRupees(date, kacha.trim() || '0', gst.trim() || '0') },
    }),
    onSuccess: async () => {
      await invalidateAfterSupplierPurchaseWrite(client, supplier.id)
      toast.success('Opening balance corrected. Reason saved to the audit log.')
      onClose()
    },
  })
  return <Dialog open onOpenChange={(open) => { if (!open && !correction.isPending) onClose() }}>
    <DialogContent className="sm:max-w-lg" showCloseButton={!correction.isPending}>
      <DialogTitle>Correct opening balance</DialogTitle>
      <DialogDescription>{supplier.companyName} · This changes starting dues, not any saved bill or payment.</DialogDescription>
      <p className="rounded border bg-slate-50 p-2 text-xs">
        Current: Kacha {formatPaiseInr(expected.kachaPaise)} · GST {formatPaiseInr(expected.gstPaise)} · {expected.date || 'No effective date'}
      </p>
      <fieldset disabled={correction.isPending} className="space-y-3">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={clearing} onChange={(e) => setClearing(e.target.checked)} /> Clear both opening balances</label>
        {!clearing && <div className="grid grid-cols-3 gap-2">
          <label className="text-xs">New Kacha (₹)<input className={inputClass} value={kacha} onChange={(e) => setKacha(e.target.value)} /></label>
          <label className="text-xs">New GST (₹)<input className={inputClass} value={gst} onChange={(e) => setGst(e.target.value)} /></label>
          <label className="text-xs">Effective date<DateInput className={inputClass} value={date} onChange={setDate} /></label>
        </div>}
        <p className="text-xs text-slate-600">Positive = payable · Negative = advance</p>
        <label className="block space-y-1 text-xs">Correction reason (required)<textarea className={`${inputClass} block min-h-20 py-2`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></label>
      </fieldset>
      {correction.isError && <p role="alert" className="text-xs text-rose-700">{toUserMessage(correction.error)}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass('secondary')} onClick={onClose} disabled={correction.isPending}>Cancel</button>
        <button type="button" className={buttonClass('primary')} disabled={!reason.trim() || correction.isPending} onClick={() => correction.mutate()}>{correction.isPending ? 'Saving…' : 'Confirm correction'}</button>
      </div>
    </DialogContent>
  </Dialog>
}
