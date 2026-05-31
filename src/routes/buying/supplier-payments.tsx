import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { toUserMessage } from '@/app/errors'
import { loadBuyingCollections, saveSupplierPayment } from '@/data/scrap-buying'
import { allocateSupplierPayment } from '@/domain/scrap-buying'
import type { BillMode, SupplierPaymentMode } from '@/domain/scrap-buying-types'
import { BoField, BoMetric, BoSection, BOILERPLATE_INPUT_CLASS } from '@/components/modules/boilerplate-ui'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/buying/supplier-payments')({
  component: SupplierPaymentsPage,
})

const BUYING_KEY = ['buying-collections'] as const

function SupplierPaymentsPage() {
  const queryClient = useQueryClient()
  const today = useMemo(() => getLocalIsoDate(), [])
  const query = useQuery({ queryKey: BUYING_KEY, queryFn: loadBuyingCollections })
  const data = query.data
  const suppliers = data?.suppliers ?? []
  const [date, setDate] = useState(today)
  const [supplierId, setSupplierId] = useState('')
  const supplier = suppliers.find((row) => row.id === supplierId)
  const [amount, setAmount] = useState(0)
  const [mode, setMode] = useState<SupplierPaymentMode>('cash')
  const [billModeScope, setBillModeScope] = useState<BillMode>('kacha')
  const [note, setNote] = useState('')
  const [statusText, setStatusText] = useState('')

  const preview = useMemo(
    () =>
      data && supplierId
        ? allocateSupplierPayment({
            purchases: data.purchases,
            payments: data.payments,
            supplierId,
            billMode: billModeScope,
            amount,
          })
        : { allocations: [], paymentApplied: 0, advanceAfterPayment: amount },
    [data, supplierId, billModeScope, amount],
  )

  const mutation = useMutation({
    mutationFn: () => saveSupplierPayment({ date, supplierId, supplierName: supplier?.name ?? '', amount, mode, billModeScope, note }),
    onSuccess: async () => {
      setStatusText('Supplier payment saved.')
      setAmount(0)
      setNote('')
      await queryClient.invalidateQueries({ queryKey: BUYING_KEY })
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500" role="status" aria-live="polite">
        {statusText || (query.isLoading ? 'Loading buying data...' : '')}
      </p>

      <BoSection
        title="Payment"
        action={<button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="h-9 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{mutation.isPending ? 'Saving...' : 'Save payment'}</button>}
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-6">
          <BoField label="Date">
            <input className={BOILERPLATE_INPUT_CLASS} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </BoField>
          <BoField label="Supplier *">
            <select className={BOILERPLATE_INPUT_CLASS} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select supplier</option>
              {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </BoField>
          <BoField label="Bill scope">
            <select className={BOILERPLATE_INPUT_CLASS} value={billModeScope} onChange={(e) => setBillModeScope(e.target.value as BillMode)}>
              <option value="kacha">Kacha</option>
              <option value="gst">GST</option>
            </select>
          </BoField>
          <BoField label="Amount *">
            <input className={BOILERPLATE_INPUT_CLASS} type="number" min={0} value={amount || ''} onChange={(e) => setAmount(parseNonNegativeNumber(e.target.value))} />
          </BoField>
          <BoField label="Mode">
            <select className={BOILERPLATE_INPUT_CLASS} value={mode} onChange={(e) => setMode(e.target.value as SupplierPaymentMode)}>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="upi">UPI</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </BoField>
          <BoField label="Note">
            <input className={BOILERPLATE_INPUT_CLASS} value={note} onChange={(e) => setNote(e.target.value)} />
          </BoField>
        </div>
      </BoSection>

      <BoSection title="Allocation preview">
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3">
          <BoMetric label="Payment" value={formatInrInteger(amount)} />
          <BoMetric label="Applied" value={formatInrInteger(preview.paymentApplied)} emphasized />
          <BoMetric label="Advance" value={formatInrInteger(preview.advanceAfterPayment)} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <Th>Date</Th>
                <Th>Bill</Th>
                <Th align="right">Applied</Th>
              </tr>
            </thead>
            <tbody>
              {preview.allocations.map((row) => (
                <tr key={row.purchaseBillId} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.billDate}</td>
                  <td className="px-3 py-2 text-slate-800">{row.billLabel}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{formatInrInteger(row.amount)}</td>
                </tr>
              ))}
              {preview.allocations.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-sm text-slate-500">No matching open {billModeScope.toUpperCase()} purchases for this payment.</td>
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
