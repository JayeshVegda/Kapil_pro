import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toUserMessage } from '@/app/errors'
import { loadBuyingCollections, savePurchase } from '@/data/scrap-buying'
import { calculatePurchaseTotals } from '@/domain/scrap-buying'
import type { BillMode, PurchaseCalculationMode, PurchaseDeductionKind, PurchaseDeductionLineInput, PurchaseMaterialLineInput } from '@/domain/scrap-buying-types'
import { BoField, BoMetric, BoSection, BOILERPLATE_INPUT_CLASS } from '@/components/modules/boilerplate-ui'
import { getLocalIsoDate } from '@/lib/date'
import { formatInQty, formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/buying/new-purchase')({
  component: BuyingNewPurchasePage,
})

const BUYING_KEY = ['buying-collections'] as const
const MATERIALS = ['Brass Scrap', 'Zinc Scrap', 'Chol', 'Pata', 'Plate']

type MaterialRow = PurchaseMaterialLineInput & { clientId: string }
type DeductionRow = PurchaseDeductionLineInput & { clientId: string }

function newId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function blankMaterial(): MaterialRow {
  return { clientId: newId(), materialName: 'Brass Scrap', grossKg: 0, bagCount: 0, bagKg: 0, rate: 0, calculationMode: 'deduct_before_amount' }
}

function blankDeduction(): DeductionRow {
  return { clientId: newId(), kind: 'faulty_return', materialName: 'Brass Scrap', description: 'Faulty material return', qtyKg: 0, rate: 0, amount: 0, affectsStock: true }
}

function BuyingNewPurchasePage() {
  const queryClient = useQueryClient()
  const today = useMemo(() => getLocalIsoDate(), [])
  const query = useQuery({ queryKey: BUYING_KEY, queryFn: loadBuyingCollections })
  const suppliers = query.data?.suppliers ?? []
  const [date, setDate] = useState(today)
  const [supplierId, setSupplierId] = useState('')
  const supplier = suppliers.find((row) => row.id === supplierId)
  const [billMode, setBillMode] = useState<BillMode>('kacha')
  const [supplierBillNo, setSupplierBillNo] = useState('')
  const [internalRef, setInternalRef] = useState('')
  const [gstRate, setGstRate] = useState(18)
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [note, setNote] = useState('')
  const [materials, setMaterials] = useState<MaterialRow[]>(() => [blankMaterial()])
  const [deductions, setDeductions] = useState<DeductionRow[]>([])
  const [statusText, setStatusText] = useState('')

  const totals = useMemo(
    () => calculatePurchaseTotals({ billMode, gstRate, materialLines: materials, deductionLines: deductions }),
    [billMode, gstRate, materials, deductions],
  )

  const mutation = useMutation({
    mutationFn: () =>
      savePurchase({
        date,
        supplierId,
        supplierName: supplier?.name ?? '',
        billMode,
        supplierBillNo,
        internalRef,
        gstRate,
        supplierGstin: supplier?.gstin ?? '',
        invoiceNo,
        invoiceDate,
        note,
        materialLines: materials,
        deductionLines: deductions,
      }),
    onSuccess: async () => {
      setStatusText('Purchase saved.')
      setSupplierBillNo('')
      setInternalRef('')
      setNote('')
      setMaterials([blankMaterial()])
      setDeductions([])
      await queryClient.invalidateQueries({ queryKey: BUYING_KEY })
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  function updateMaterial(clientId: string, patch: Partial<PurchaseMaterialLineInput>) {
    setMaterials((prev) => prev.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row)))
  }

  function updateDeduction(clientId: string, patch: Partial<PurchaseDeductionLineInput>) {
    setDeductions((prev) => prev.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row)))
  }

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500" role="status" aria-live="polite">
        {statusText || (query.isLoading ? 'Loading suppliers...' : '')}
      </p>

      <BoSection title="Purchase header">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
          <BoField label="Date *">
            <input className={BOILERPLATE_INPUT_CLASS} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </BoField>
          <BoField label="Supplier *">
            <select
              className={BOILERPLATE_INPUT_CLASS}
              value={supplierId}
              onChange={(e) => {
                const next = suppliers.find((row) => row.id === e.target.value)
                setSupplierId(e.target.value)
                if (next) setBillMode(next.defaultBillMode)
              }}
            >
              <option value="">Select supplier</option>
              {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </BoField>
          <BoField label="Bill mode">
            <select className={BOILERPLATE_INPUT_CLASS} value={billMode} onChange={(e) => setBillMode(e.target.value as BillMode)}>
              <option value="kacha">Kacha</option>
              <option value="gst">GST</option>
            </select>
          </BoField>
          <BoField label="Supplier bill no.">
            <input className={BOILERPLATE_INPUT_CLASS} value={supplierBillNo} onChange={(e) => setSupplierBillNo(e.target.value)} />
          </BoField>
          <BoField label="Internal ref">
            <input className={BOILERPLATE_INPUT_CLASS} value={internalRef} onChange={(e) => setInternalRef(e.target.value)} />
          </BoField>
          {billMode === 'gst' && (
            <>
              <BoField label="GST rate">
                <input className={BOILERPLATE_INPUT_CLASS} type="number" min={0} value={gstRate || ''} onChange={(e) => setGstRate(parseNonNegativeNumber(e.target.value))} />
              </BoField>
              <BoField label="Invoice no.">
                <input className={BOILERPLATE_INPUT_CLASS} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
              </BoField>
              <BoField label="Invoice date">
                <input className={BOILERPLATE_INPUT_CLASS} type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </BoField>
            </>
          )}
          <BoField label="Note">
            <input className={BOILERPLATE_INPUT_CLASS} value={note} onChange={(e) => setNote(e.target.value)} />
          </BoField>
        </div>
      </BoSection>

      <BoSection
        title="Material rows"
        action={<button type="button" onClick={() => setMaterials((prev) => [...prev, blankMaterial()])} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><Plus size={13} /> Add material</button>}
      >
        <div className="space-y-2">
          {materials.map((row) => {
            const netKg = Math.max(0, row.grossKg - row.bagKg)
            const amount = netKg * row.rate
            return (
              <div key={row.clientId} className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 md:grid-cols-7">
                <FieldSelect label="Material" value={row.materialName} onChange={(value) => updateMaterial(row.clientId, { materialName: value })} options={MATERIALS} />
                <NumField label="Gross kg" value={row.grossKg} onChange={(value) => updateMaterial(row.clientId, { grossKg: value })} />
                <NumField label="Bags" value={row.bagCount} onChange={(value) => updateMaterial(row.clientId, { bagCount: value })} />
                <NumField label="Bag kg" value={row.bagKg} onChange={(value) => updateMaterial(row.clientId, { bagKg: value })} />
                <NumField label="Rate" value={row.rate} onChange={(value) => updateMaterial(row.clientId, { rate: value })} />
                <BoField label="Method">
                  <select className={BOILERPLATE_INPUT_CLASS} value={row.calculationMode} onChange={(e) => updateMaterial(row.clientId, { calculationMode: e.target.value as PurchaseCalculationMode })}>
                    <option value="deduct_before_amount">Deduct kg first</option>
                    <option value="deduct_after_amount">Deduct value after</option>
                  </select>
                </BoField>
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5">
                    <p className="text-[11px] text-slate-500">Net / Amount</p>
                    <p className="truncate font-mono text-xs font-semibold text-slate-900">{formatInQty(netKg)} · {formatInrInteger(amount)}</p>
                  </div>
                  <button type="button" className="grid h-10 w-10 place-items-center rounded-md border border-slate-300 bg-white text-slate-500 hover:bg-slate-50" onClick={() => setMaterials((prev) => prev.length <= 1 ? prev : prev.filter((item) => item.clientId !== row.clientId))}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </BoSection>

      <BoSection
        title="Deductions / faulty return"
        action={<button type="button" onClick={() => setDeductions((prev) => [...prev, blankDeduction()])} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><Plus size={13} /> Add deduction</button>}
      >
        {deductions.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No deductions. Add faulty material when returned to reduce stock and payable.</p>
        ) : (
          <div className="space-y-2">
            {deductions.map((row) => (
              <div key={row.clientId} className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 md:grid-cols-7">
                <BoField label="Kind">
                  <select className={BOILERPLATE_INPUT_CLASS} value={row.kind} onChange={(e) => updateDeduction(row.clientId, { kind: e.target.value as PurchaseDeductionKind, affectsStock: e.target.value === 'faulty_return' })}>
                    <option value="faulty_return">Faulty return</option>
                    <option value="rate_cut">Rate cut</option>
                    <option value="bardan">Bardan</option>
                    <option value="other">Other</option>
                  </select>
                </BoField>
                <FieldSelect label="Material" value={row.materialName} onChange={(value) => updateDeduction(row.clientId, { materialName: value })} options={MATERIALS} />
                <NumField label="Qty kg" value={row.qtyKg} onChange={(value) => updateDeduction(row.clientId, { qtyKg: value, amount: value * row.rate })} />
                <NumField label="Rate" value={row.rate} onChange={(value) => updateDeduction(row.clientId, { rate: value, amount: row.qtyKg * value })} />
                <NumField label="Amount" value={row.amount} onChange={(value) => updateDeduction(row.clientId, { amount: value })} />
                <BoField label="Note">
                  <input className={BOILERPLATE_INPUT_CLASS} value={row.description} onChange={(e) => updateDeduction(row.clientId, { description: e.target.value })} />
                </BoField>
                <div className="flex items-end gap-2">
                  <label className="flex h-10 flex-1 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700">
                    <input type="checkbox" checked={row.affectsStock} onChange={(e) => updateDeduction(row.clientId, { affectsStock: e.target.checked })} />
                    Stock
                  </label>
                  <button type="button" className="grid h-10 w-10 place-items-center rounded-md border border-slate-300 bg-white text-slate-500 hover:bg-slate-50" onClick={() => setDeductions((prev) => prev.filter((item) => item.clientId !== row.clientId))}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </BoSection>

      <BoSection
        title="Totals"
        action={<button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="h-9 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{mutation.isPending ? 'Saving...' : 'Save purchase'}</button>}
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <BoMetric label="Material" value={formatInrInteger(totals.materialTotal)} />
          <BoMetric label="Deductions" value={formatInrInteger(totals.deductionTotal)} />
          <BoMetric label="Taxable" value={formatInrInteger(totals.taxableValue)} />
          <BoMetric label="GST" value={formatInrInteger(totals.gstAmount)} />
          <BoMetric label="Payable" value={formatInrInteger(totals.grandTotal)} emphasized />
        </div>
      </BoSection>
    </div>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <BoField label={label}>
      <input className={BOILERPLATE_INPUT_CLASS} type="number" min={0} step="0.001" value={value || ''} onChange={(e) => onChange(parseNonNegativeNumber(e.target.value))} />
    </BoField>
  )
}

function FieldSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <BoField label={label}>
      <input className={BOILERPLATE_INPUT_CLASS} list={`${label}-materials`} value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id={`${label}-materials`}>
        {options.map((option) => <option key={option} value={option} />)}
      </datalist>
    </BoField>
  )
}
