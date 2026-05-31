import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { BoField, BoMetric, BoSection, BOILERPLATE_INPUT_CLASS, EmptyTableHint } from '@/components/modules/boilerplate-ui'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/buying/supplier-payments')({
  component: SupplierPaymentsPage,
})

function SupplierPaymentsPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [date, setDate] = useState(today)
  const [supplierLabel, setSupplierLabel] = useState('')
  const [amount, setAmount] = useState(0)
  const [mode, setMode] = useState<'Cash' | 'Bank'>('Cash')

  return (
    <div className="w-full space-y-8 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500">
        Pay suppliers — parallels customer payments ledger flow.{' '}
        <span className="text-amber-700">Save disabled pending API.</span>
      </p>

      <BoSection title="Payment">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <BoField label="Payment date">
            <input className={BOILERPLATE_INPUT_CLASS} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </BoField>
          <BoField label="Supplier *">
            <SearchableCombobox
              options={[]}
              value={supplierLabel}
              onChange={setSupplierLabel}
              inputClassName={BOILERPLATE_INPUT_CLASS}
              placeholder="Search supplier..."
              disabled
            />
          </BoField>
          <BoField label="Amount *">
            <input className={BOILERPLATE_INPUT_CLASS} type="number" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value || 0))} />
          </BoField>
          <BoField label="Mode">
            <select className={BOILERPLATE_INPUT_CLASS} value={mode} onChange={(e) => setMode(e.target.value as 'Cash' | 'Bank')}>
              <option value="Cash">Cash</option>
              <option value="Bank">Bank</option>
            </select>
          </BoField>
          <div className="flex items-end">
            <button type="button" className="h-10 w-full rounded-md bg-slate-900 text-sm font-medium text-white opacity-50" disabled>
              Save payment
            </button>
          </div>
        </div>
      </BoSection>

      <BoSection title="Payable preview (empty)">
        <EmptyTableHint entityLabel="outstanding vouchers" />
      </BoSection>

      <BoSection title="Balances (stub)">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <BoMetric label="Suggested opening" value="—" />
          <BoMetric label="Estimated payable" value="—" />
          <BoMetric label="This draft" value={amount > 0 ? formatInrInteger(amount) : '—'} />
          <BoMetric label="Posting" value="N/A" />
        </div>
      </BoSection>
    </div>
  )
}
