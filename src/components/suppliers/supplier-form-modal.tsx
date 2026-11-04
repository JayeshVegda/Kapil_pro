import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { parseNonNegativeNumber } from '@/lib/inr-format'

export type SupplierFormState = {
  id: string | null
  companyName: string
  contactName: string
  phone: string
  gstNo: string
  city: string
  notes: string
  openingKachaRupees: number
  openingKachaDirection: 'we_owe' | 'they_owe'
  openingGstRupees: number
  openingGstDirection: 'we_owe' | 'they_owe'
  openingBalanceDate: string
  active: boolean
}

export const emptySupplierFormState = (): SupplierFormState => ({
  id: null,
  companyName: '',
  contactName: '',
  phone: '',
  gstNo: '',
  city: '',
  notes: '',
  openingKachaRupees: 0,
  openingKachaDirection: 'we_owe',
  openingGstRupees: 0,
  openingGstDirection: 'we_owe',
  openingBalanceDate: '',
  active: true,
})

const inputClass =
  'h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100'

/** Centered supplier create/edit modal. Esc closes, Ctrl+Enter saves. */
export function SupplierFormModal({
  formState,
  isSaving,
  errorText,
  onChange,
  onClose,
  onSave,
}: {
  formState: SupplierFormState
  isSaving: boolean
  errorText?: string
  onChange: (next: SupplierFormState) => void
  onClose: () => void
  onSave: () => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && formState.companyName.trim() && !isSaving) {
        event.preventDefault()
        onSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onSave, formState.companyName, isSaving])

  const canSave = formState.companyName.trim().length > 0 && !isSaving

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={formState.id ? 'Edit supplier' : 'Add supplier'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">{formState.id ? 'Edit Supplier' : 'Add Supplier'}</h3>
          <button type="button" aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Company Name *">
                <input
                  className={inputClass}
                  type="text"
                  placeholder="e.g. Maruti Metals Jamnagar"
                  value={formState.companyName}
                  autoFocus
                  onChange={(e) => onChange({ ...formState, companyName: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Contact Person (optional)">
              <input className={inputClass} type="text" placeholder="e.g. Rajeshbhai" value={formState.contactName} onChange={(e) => onChange({ ...formState, contactName: e.target.value })} />
            </Field>
            <Field label="Phone (optional)">
              <input className={inputClass} type="tel" placeholder="10-digit mobile" value={formState.phone} onChange={(e) => onChange({ ...formState, phone: e.target.value })} />
            </Field>
            <Field label="City (optional)">
              <input className={inputClass} type="text" placeholder="Jamnagar" value={formState.city} onChange={(e) => onChange({ ...formState, city: e.target.value })} />
            </Field>
            <Field label="GSTIN (optional)">
              <input className={inputClass} type="text" placeholder="24AAAAA0000A1Z5" value={formState.gstNo} onChange={(e) => onChange({ ...formState, gstNo: e.target.value })} />
            </Field>
            <Field label="Status">
              <select className={inputClass} value={formState.active ? 'yes' : 'no'} onChange={(e) => onChange({ ...formState, active: e.target.value === 'yes' })}>
                <option value="yes">Active</option>
                <option value="no">Inactive</option>
              </select>
            </Field>
            <Field label="Opening Balance Date">
              <DateInput className={inputClass} value={formState.openingBalanceDate} onChange={(nextDate) => onChange({ ...formState, openingBalanceDate: nextDate })} />
            </Field>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Opening Balances</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Field label="Opening Kacha (₹)">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={formState.openingKachaRupees || ''}
                    onChange={(e) => onChange({ ...formState, openingKachaRupees: parseNonNegativeNumber(e.target.value) })}
                  />
                </Field>
                <div className="mt-1.5 flex gap-2">
                  <DirectionRadio
                    name="kachaDir"
                    checked={formState.openingKachaDirection === 'we_owe'}
                    onChange={() => onChange({ ...formState, openingKachaDirection: 'we_owe' })}
                    label="We owe supplier"
                  />
                  <DirectionRadio
                    name="kachaDir"
                    checked={formState.openingKachaDirection === 'they_owe'}
                    onChange={() => onChange({ ...formState, openingKachaDirection: 'they_owe' })}
                    label="They owe us (Adv)"
                  />
                </div>
              </div>

              <div>
                <Field label="Opening GST (₹)">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={formState.openingGstRupees || ''}
                    onChange={(e) => onChange({ ...formState, openingGstRupees: parseNonNegativeNumber(e.target.value) })}
                  />
                </Field>
                <div className="mt-1.5 flex gap-2">
                  <DirectionRadio
                    name="gstDir"
                    checked={formState.openingGstDirection === 'we_owe'}
                    onChange={() => onChange({ ...formState, openingGstDirection: 'we_owe' })}
                    label="We owe supplier"
                  />
                  <DirectionRadio
                    name="gstDir"
                    checked={formState.openingGstDirection === 'they_owe'}
                    onChange={() => onChange({ ...formState, openingGstDirection: 'they_owe' })}
                    label="They owe us (Adv)"
                  />
                </div>
              </div>
            </div>
          </div>

          <Field label="Notes (optional)">
            <textarea
              rows={2}
              className="w-full rounded-md border border-slate-300 bg-white p-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="Terms, payment methods, bank details..."
              value={formState.notes}
              onChange={(e) => onChange({ ...formState, notes: e.target.value })}
            />
          </Field>

          {errorText && <p className="text-xs text-rose-600">{errorText}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onSave}
            disabled={!canSave}
          >
            {isSaving ? 'Saving...' : formState.id ? 'Update Supplier' : 'Save Supplier'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DirectionRadio({ name, checked, onChange, label }: { name: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}
