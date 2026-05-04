import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { BoField, BoSection, BOILERPLATE_INPUT_CLASS, EmptyTableHint } from '@/components/modules/boilerplate-ui'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/buying/supplier-ledger')({
  component: SupplierLedgerPage,
})

function SupplierLedgerPage() {
  const [asOf, setAsOf] = useState(() => getLocalIsoDate())

  return (
    <div className="w-full space-y-8 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500">
        Single-supplier payable ledger — same mental model as party ledger for customers.{' '}
        <span className="text-amber-700">Read-only shell.</span>
      </p>

      <BoSection title="Supplier">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <BoField label="Supplier *">
            <SearchableCombobox
              options={[]}
              value=""
              onChange={() => {}}
              inputClassName={BOILERPLATE_INPUT_CLASS}
              placeholder="Search supplier..."
              disabled
            />
          </BoField>
          <BoField label="As of date">
            <input className={BOILERPLATE_INPUT_CLASS} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </BoField>
          <BoField label="Outstanding payable">
            <input className={BOILERPLATE_INPUT_CLASS} readOnly value={formatInrInteger(0)} />
          </BoField>
        </div>
      </BoSection>

      <BoSection title="Movements">
        <EmptyTableHint entityLabel="ledger lines" />
      </BoSection>
    </div>
  )
}
