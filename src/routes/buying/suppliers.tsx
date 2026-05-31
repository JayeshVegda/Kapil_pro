import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { toUserMessage } from '@/app/errors'
import { loadBuyingCollections, saveSupplier } from '@/data/scrap-buying'
import type { BillMode } from '@/domain/scrap-buying-types'
import { BoField, BoMetric, BoSection, BOILERPLATE_INPUT_CLASS } from '@/components/modules/boilerplate-ui'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/buying/suppliers')({
  component: BuyingSuppliersPage,
})

const BUYING_KEY = ['buying-collections'] as const

function BuyingSuppliersPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: BUYING_KEY, queryFn: loadBuyingCollections })
  const suppliers = query.data?.suppliers ?? []
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [gstin, setGstin] = useState('')
  const [address, setAddress] = useState('')
  const [defaultBillMode, setDefaultBillMode] = useState<BillMode>('kacha')
  const [openingPayable, setOpeningPayable] = useState(0)
  const [openingDate, setOpeningDate] = useState(getLocalIsoDate())
  const [notes, setNotes] = useState('')
  const [statusText, setStatusText] = useState('')

  const mutation = useMutation({
    mutationFn: () => saveSupplier({ name, phone, gstin, address, defaultBillMode, openingPayable, openingPayableDate: openingDate, notes }),
    onSuccess: async () => {
      setName('')
      setPhone('')
      setGstin('')
      setAddress('')
      setOpeningPayable(0)
      setNotes('')
      setStatusText('Supplier saved.')
      await queryClient.invalidateQueries({ queryKey: BUYING_KEY })
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  const openingTotal = suppliers.reduce((sum, supplier) => sum + supplier.openingPayable, 0)

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500" role="status" aria-live="polite">
        {statusText || (query.isLoading ? 'Loading suppliers...' : '')}
      </p>

      <BoSection
        title="Add supplier"
        action={
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="inline-flex h-9 items-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus size={13} /> {mutation.isPending ? 'Saving...' : 'Save supplier'}
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <BoField label="Name *">
            <input className={BOILERPLATE_INPUT_CLASS} value={name} onChange={(e) => setName(e.target.value)} placeholder="Bhavesh Metal" />
          </BoField>
          <BoField label="Phone">
            <input className={BOILERPLATE_INPUT_CLASS} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </BoField>
          <BoField label="Default mode">
            <select className={BOILERPLATE_INPUT_CLASS} value={defaultBillMode} onChange={(e) => setDefaultBillMode(e.target.value as BillMode)}>
              <option value="kacha">Kacha</option>
              <option value="gst">GST</option>
            </select>
          </BoField>
          <BoField label="Opening payable">
            <input className={BOILERPLATE_INPUT_CLASS} type="number" min={0} value={openingPayable || ''} onChange={(e) => setOpeningPayable(parseNonNegativeNumber(e.target.value))} />
          </BoField>
          <BoField label="Opening date">
            <input className={BOILERPLATE_INPUT_CLASS} type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </BoField>
          <BoField label="GSTIN / ref">
            <input className={BOILERPLATE_INPUT_CLASS} value={gstin} onChange={(e) => setGstin(e.target.value)} />
          </BoField>
          <BoField label="Address">
            <input className={BOILERPLATE_INPUT_CLASS} value={address} onChange={(e) => setAddress(e.target.value)} />
          </BoField>
          <BoField label="Notes">
            <input className={BOILERPLATE_INPUT_CLASS} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </BoField>
        </div>
      </BoSection>

      <BoSection title="Summary">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <BoMetric label="Active suppliers" value={String(suppliers.filter((s) => s.active).length)} />
          <BoMetric label="Opening payable" value={formatInrInteger(openingTotal)} emphasized />
          <BoMetric label="Kacha default" value={String(suppliers.filter((s) => s.defaultBillMode === 'kacha').length)} />
          <BoMetric label="GST default" value={String(suppliers.filter((s) => s.defaultBillMode === 'gst').length)} />
        </div>
      </BoSection>

      <BoSection title="Supplier list">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Default</Th>
                <Th align="right">Opening payable</Th>
                <Th>GSTIN / ref</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{supplier.name}</td>
                  <td className="px-3 py-2 text-slate-700">{supplier.phone || '-'}</td>
                  <td className="px-3 py-2 uppercase text-slate-700">{supplier.defaultBillMode}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{formatInrInteger(supplier.openingPayable)}</td>
                  <td className="px-3 py-2 text-slate-700">{supplier.gstin || '-'}</td>
                  <td className="px-3 py-2 text-slate-600">{supplier.notes || '-'}</td>
                </tr>
              ))}
              {!query.isLoading && suppliers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">No suppliers yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </BoSection>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className={`border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>
}
