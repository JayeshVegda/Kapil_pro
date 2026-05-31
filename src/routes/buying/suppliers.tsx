import { createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { SupplierMaster } from '@/domain/scrap-buying-types'
import { BoField, BoMetric, BoSection, BOILERPLATE_INPUT_CLASS, EmptyTableHint } from '@/components/modules/boilerplate-ui'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/buying/suppliers')({
  component: BuyingSuppliersPage,
})

const PLACEHOLDER_SUPPLIERS: SupplierMaster[] = []

function BuyingSuppliersPage() {
  const suppliers = PLACEHOLDER_SUPPLIERS
  const summary = useMemo(
    () => ({
      payable: suppliers.reduce((a, s) => a + s.openingPayable + 0, 0),
      active: suppliers.filter((s) => s.active).length,
    }),
    [suppliers],
  )

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [openingPayable, setOpeningPayable] = useState(0)

  return (
    <div className="w-full space-y-8 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500">
        Procurement — supplier master &amp; payable snapshot. <span className="text-amber-700">Backend not connected yet.</span>
      </p>

      <BoSection
        title="Add Supplier"
        action={
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-medium text-white opacity-50"
            disabled
            title="Save will wire to PocketBase later"
          >
            <Plus size={13} /> Save supplier
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <BoField label="Name *">
            <input className={BOILERPLATE_INPUT_CLASS} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" />
          </BoField>
          <BoField label="Phone">
            <input className={BOILERPLATE_INPUT_CLASS} type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </BoField>
          <BoField label="Opening payable">
            <input
              className={BOILERPLATE_INPUT_CLASS}
              type="number"
              value={openingPayable || ''}
              onChange={(e) => setOpeningPayable(Number(e.target.value || 0))}
              placeholder="0"
            />
          </BoField>
          <BoField label="Notes (later)">
            <input className={BOILERPLATE_INPUT_CLASS} disabled placeholder="GSTIN / address UI after API" />
          </BoField>
        </div>
      </BoSection>

      <BoSection title="Summary (stub)">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <BoMetric label="Active suppliers" value={String(summary.active)} />
          <BoMetric label="Opening-only payable" value={formatInrInteger(summary.payable)} emphasized />
          <BoMetric label="Last purchase" value="—" />
          <BoMetric label="Mode" value="Demo" />
        </div>
      </BoSection>

      <BoSection title="Supplier list">
        {suppliers.length === 0 ? (
          <EmptyTableHint entityLabel="suppliers" />
        ) : (
          <TableShell
            head={['Name', 'Phone', 'Opening payable', 'Status', '']}
            body={suppliers.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-2 py-2 font-medium text-slate-900">{s.name}</td>
                <td className="px-2 py-2 text-slate-600">{s.phone ?? '—'}</td>
                <td className="px-2 py-2 font-mono">{formatInrInteger(s.openingPayable)}</td>
                <td className="px-2 py-2">{s.active ? 'Active' : 'Inactive'}</td>
                <td className="px-2 py-2">
                  <button type="button" className="text-xs text-blue-600" disabled>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          />
        )}
      </BoSection>
    </div>
  )
}

function TableShell({ head, body }: { head: string[]; body: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="bg-slate-50">
            {head.map((h) => (
              <th key={h} className="border-b border-slate-200 px-2 py-2 text-left font-semibold text-slate-700">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  )
}
