import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import type { PurchaseReadState } from './purchase-read-state'

export function PurchaseDialog({
  title, onClose, onSubmit, canSubmit, submitting, submitLabel, children, width = 'max-w-md', tone = 'primary',
}: {
  title: string
  onClose: () => void
  onSubmit: () => void
  canSubmit: boolean
  submitting: boolean
  submitLabel: string
  children: ReactNode
  width?: 'max-w-md' | 'max-w-lg'
  tone?: 'primary' | 'danger'
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        overlayClassName="z-[80] bg-slate-900/60 supports-backdrop-filter:backdrop-blur-none"
        className={`z-[80] block w-[calc(100%-2rem)] gap-0 border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl ring-0 ${width === 'max-w-lg' ? 'max-w-lg sm:max-w-lg' : 'max-w-md sm:max-w-md'}`}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && submitLabel && canSubmit && !submitting) {
            event.preventDefault()
            onSubmit()
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <DialogTitle asChild><h3 className="font-sans text-sm font-semibold leading-normal text-slate-900">{title}</h3></DialogTitle>
          <DialogClose asChild>
            <button type="button" aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={15} />
            </button>
          </DialogClose>
        </div>
        <div className="space-y-3 px-4 py-3.5">{children}</div>
        <DialogFooter className="mx-0 mb-0 flex-row items-center justify-end border-slate-200 bg-white px-4 py-2.5">
          <DialogClose asChild>
            <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Close</button>
          </DialogClose>
          {submitLabel && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit || submitting}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${tone === 'danger' ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'}`}
            >
              {submitting ? 'Saving…' : submitLabel}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PurchaseReadNotice({ state, subject }: { state: PurchaseReadState<unknown>; subject: 'Bill' | 'Supplier' | 'Payment' }) {
  if (state.status === 'ready') return null
  const label = subject === 'Supplier' ? 'supplier ledger' : subject.toLowerCase()
  return (
    <p role={state.status === 'error' ? 'alert' : 'status'} aria-busy={state.status === 'loading'} className={`text-xs ${state.status === 'error' ? 'text-rose-600' : 'text-slate-500'}`}>
      {state.status === 'loading' ? `Loading ${label}…` : state.status === 'error' ? `Unable to load ${label}. Please close and try again.` : `${subject} not found.`}
    </p>
  )
}
