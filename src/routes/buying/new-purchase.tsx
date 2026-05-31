import { createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PurchaseDeductionLine, PurchaseMaterialLine } from '@/domain/scrap-buying-types'
import { BoField, BoMetric, BoSection, BOILERPLATE_INPUT_CLASS, EmptyTableHint } from '@/components/modules/boilerplate-ui'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/buying/new-purchase')({
  component: BuyingNewPurchasePage,
})

/** Demo starter rows — will be editable once mutations exist. */
const DEMO_ITEMS: PurchaseMaterialLine[] = []
const DEMO_DEDUCTIONS: PurchaseDeductionLine[] = []

function BuyingNewPurchasePage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [date, setDate] = useState(today)
  const [supplierLabel, setSupplierLabel] = useState('')

  const gross = DEMO_ITEMS.reduce((a, row) => a + row.lineTotal, 0)
  const deductions = DEMO_DEDUCTIONS.reduce((a, row) => a + row.amount, 0)
  const net = gross - deductions

  return (
    <div className="w-full space-y-8 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500">
        Purchase entry — material rows &amp; deduction rows mirror sale bills structure.{' '}
        <span className="text-amber-700">No save yet.</span>
      </p>

      <BoSection title="Header">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <BoField label="Business date">
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
          <BoField label="Book / inward ref">
            <input className={BOILERPLATE_INPUT_CLASS} disabled placeholder="Optional" />
          </BoField>
          <BoField label="Bill note">
            <input className={BOILERPLATE_INPUT_CLASS} disabled placeholder="After API wiring" />
          </BoField>
        </div>
      </BoSection>

      <BoSection
        title="Material lines"
        action={
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500" disabled title="Adds row when backed">
            <Plus size={12} /> Add line
          </button>
        }
      >
        {DEMO_ITEMS.length === 0 ? (
          <EmptyTableHint entityLabel="material rows" />
        ) : (
          <p className="text-xs text-slate-500">{DEMO_ITEMS.length} lines (stub)</p>
        )}
      </BoSection>

      <BoSection
        title="Deductions (returns, bardan, etc.)"
        action={
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500" disabled>
            <Plus size={12} /> Add deduction
          </button>
        }
      >
        {DEMO_DEDUCTIONS.length === 0 ? (
          <EmptyTableHint entityLabel="deduction rows" />
        ) : (
          <p className="text-xs text-slate-500">{DEMO_DEDUCTIONS.length} rows (stub)</p>
        )}
      </BoSection>

      <BoSection title="Totals (calculated placeholders)">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <BoMetric label="Gross material" value={formatInrInteger(gross)} />
          <BoMetric label="Deductions" value={formatInrInteger(deductions)} />
          <BoMetric label="Net payable" value={formatInrInteger(Math.max(net, 0))} emphasized />
          <BoMetric label="Save" value="Disabled" />
        </div>
      </BoSection>
    </div>
  )
}
