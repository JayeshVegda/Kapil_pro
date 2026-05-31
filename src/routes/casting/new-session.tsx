import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { loadCastingMaterials, loadLatestMaterialRates, loadMarketRateForDate, saveCastingSession } from '@/data/casting'
import { calculateCastingCost, type CastingInputRow } from '@/domain/casting-calculations'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/casting/new-session')({
  component: CastingNewSessionPage,
})

const LATEST_RATES_KEY = ['latest-material-rates'] as const
const CASTING_MATERIALS_KEY = ['casting-materials'] as const

type UiMaterialRow = CastingInputRow & { clientId: string }

const DEFAULT_MATERIALS = ['Brass', 'Chol', 'Plate', 'Zinc', 'Lead']

function newClientId() {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function defaultRows(): UiMaterialRow[] {
  return DEFAULT_MATERIALS.map((name) => ({
    clientId: newClientId(),
    materialName: name,
    qty: 0,
    rate: 0,
  }))
}

const saveSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
    unit: z.number().nonnegative(),
    wireOut: z.number().nonnegative(),
    wastage: z.number().nonnegative(),
    cholIn: z.number().nonnegative(),
    note: z.string(),
    rows: z.array(
      z.object({
        materialName: z.string(),
        qty: z.number(),
        rate: z.number(),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    const valid = data.rows.filter((r) => r.materialName.trim().length > 0 && r.qty > 0 && r.rate > 0)
    if (valid.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Add at least one material row with qty > 0 and rate > 0',
        path: ['rows'],
      })
    }
  })

function CastingNewSessionPage() {
  const queryClient = useQueryClient()
  const today = useMemo(() => getLocalIsoDate(), [])
  const [date, setDate] = useState(today)
  const [unit, setUnit] = useState(0)
  const [wireOut, setWireOut] = useState(0)
  const [wastage, setWastage] = useState(0)
  const [cholIn, setCholIn] = useState(0)
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<UiMaterialRow[]>(() => defaultRows())
  const [statusText, setStatusText] = useState('')
  const [ratesHint, setRatesHint] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const ratesAppliedRef = useRef(false)
  const previewRef = useRef<HTMLDivElement>(null)

  const ratesQuery = useQuery({
    queryKey: LATEST_RATES_KEY,
    queryFn: loadLatestMaterialRates,
    staleTime: 60_000,
  })
  const materialsQuery = useQuery({
    queryKey: CASTING_MATERIALS_KEY,
    queryFn: loadCastingMaterials,
    staleTime: 60_000,
  })
  const marketRateQuery = useQuery({
    queryKey: ['casting-market-rate', date],
    queryFn: () => loadMarketRateForDate(date),
    staleTime: 60_000,
  })
  const materialOptions = useMemo(
    () => {
      const set = new Set<string>(DEFAULT_MATERIALS)
      for (const m of materialsQuery.data ?? []) {
        if (m.isActive && m.name.trim()) set.add(m.name.trim())
      }
      return [...set].map((name) => ({ id: name, name }))
    },
    [materialsQuery.data],
  )

  useEffect(() => {
    if (!ratesQuery.isSuccess || ratesAppliedRef.current) return
    const map = ratesQuery.data ?? {}
    const anyRate = Object.values(map).some((v) => v > 0)
    ratesAppliedRef.current = true
    setRatesHint(anyRate ? 'Rates auto-filled from latest casting session' : 'No previous casting rates found — enter rates manually')
    if (!anyRate) return
    setRows((prev) =>
      prev.map((r) => {
        const key = r.materialName.trim().toLowerCase()
        const nextRate = map[key]
        if (nextRate != null && nextRate > 0) return { ...r, rate: nextRate }
        return r
      }),
    )
  }, [ratesQuery.isSuccess, ratesQuery.data])

  const cost = useMemo(() => calculateCastingCost(rows), [rows])
  const validRows = useMemo(
    () => rows.filter((r) => r.materialName.trim().length > 0 && r.qty > 0 && r.rate > 0),
    [rows],
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = saveSchema.safeParse({
        date,
        unit,
        wireOut,
        wastage,
        cholIn,
        note,
        rows: rows.map(({ materialName, qty, rate }) => ({ materialName, qty, rate })),
      })
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Validation failed')
      }
      return saveCastingSession({
        date: parsed.data.date,
        unit: parsed.data.unit,
        wireOut: parsed.data.wireOut,
        wastage: parsed.data.wastage,
        cholIn: parsed.data.cholIn,
        note: parsed.data.note,
        inputs: parsed.data.rows,
      })
    },
    onSuccess: async () => {
      setStatusText('Casting session saved.')
      resetForm()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['casting-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['casting-log'] }),
      ])
    },
    onError: (err) => {
      setStatusText(toUserMessage(err))
    },
  })

  function resetForm() {
    setDate(getLocalIsoDate())
    setUnit(0)
    setWireOut(0)
    setWastage(0)
    setCholIn(0)
    setNote('')
    setRows(defaultRows())
    ratesAppliedRef.current = false
    setRatesHint(null)
    void ratesQuery.refetch()
  }

  function updateRow(clientId: string, patch: Partial<CastingInputRow>) {
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, { clientId: newClientId(), materialName: '', qty: 0, rate: 0 }])
  }

  function removeRow(clientId: string) {
    setRows((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((r) => r.clientId !== clientId)
    })
  }

  const helperStatus = statusText || (saveMutation.isPending ? 'Saving...' : '')

  function validateBeforePreview() {
    const parsed = saveSchema.safeParse({
      date,
      unit,
      wireOut,
      wastage,
      cholIn,
      note,
      rows: validRows.map(({ materialName, qty, rate }) => ({ materialName, qty, rate })),
    })
    if (!parsed.success) {
      setStatusText(parsed.error.issues[0]?.message ?? 'Validation failed')
      return false
    }
    return true
  }

  function openPreview() {
    if (!validateBeforePreview()) return
    setStatusText('')
    setIsPreviewOpen(true)
  }

  async function confirmAndSave() {
    try {
      await saveMutation.mutateAsync()
      setIsPreviewOpen(false)
    } catch {
      // saveMutation already sets user-friendly status text.
    }
  }

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500" role="status" aria-live="polite">
        {helperStatus}
      </p>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Session details</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Date *">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <p className="mt-1 text-[11px] text-slate-500">Format: dd-mm-yyyy</p>
          </Field>
          <Field label="Unit (batches)">
            <input className={inputClass} type="number" min={0} step={1} value={unit || ''} onChange={(e) => setUnit(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="Wire out (kg)">
            <input className={inputClass} type="number" min={0} step={0.001} value={wireOut || ''} onChange={(e) => setWireOut(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="Wastage (kg)">
            <input className={inputClass} type="number" min={0} step={0.001} value={wastage || ''} onChange={(e) => setWastage(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="Chol IN (kg recovered)">
            <input className={inputClass} type="number" min={0} step={0.001} value={cholIn || ''} onChange={(e) => setCholIn(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="Note (optional)">
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shift / furnace notes" />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Input materials</h3>
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={addRow}>
            <Plus size={12} /> Add row
          </button>
        </div>
        {ratesHint && <p className="mb-2 text-xs text-slate-600">{ratesHint}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Material</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Qty (kg)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Rate (₹/kg)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, index) => {
                const lineAmount = r.qty * r.rate
                return (
                  <tr key={r.clientId} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                    <td className="px-3 py-2">
                      <input
                        className={inputClass}
                        list={`casting-material-options-${r.clientId}`}
                        value={r.materialName}
                        onChange={(e) => updateRow(r.clientId, { materialName: e.target.value })}
                        placeholder="Material (free text allowed)"
                      />
                      <datalist id={`casting-material-options-${r.clientId}`}>
                        {materialOptions.map((opt) => (
                          <option key={opt.id} value={opt.name} />
                        ))}
                      </datalist>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={`${inputClass} text-right tabular-nums`}
                        type="number"
                        min={0}
                        step={0.001}
                        value={r.qty || ''}
                        onChange={(e) => updateRow(r.clientId, { qty: parseNonNegativeNumber(e.target.value) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={`${inputClass} text-right tabular-nums`}
                        type="number"
                        min={0}
                        step={0.01}
                        value={r.rate || ''}
                        onChange={(e) => updateRow(r.clientId, { rate: parseNonNegativeNumber(e.target.value) })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-800">{formatInrInteger(lineAmount)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-md border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        onClick={() => removeRow(r.clientId)}
                        disabled={rows.length <= 1}
                      >
                        <Trash2 size={12} className="inline" /> Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Rates auto-fill from latest casting log session when available.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Cost summary</h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label="Total input kg" value={cost.totalInputKg.toFixed(3)} />
          <Metric label="Total input cost" value={formatInrInteger(cost.totalInputCost)} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="text-left sm:text-right">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-700">Primary KPI · Cost/kg (input weighted)</p>
              <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-amber-900">{cost.costPerKg > 0 ? `₹${cost.costPerKg.toFixed(2)}` : '—'}</p>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
            <div className="text-left sm:text-right">
              <p className="text-xs text-slate-500">Effective ₹/kg on wire output</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">{wireOut > 0 ? `₹${(cost.totalInputCost / wireOut).toFixed(2)}` : '—'}</p>
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <Metric
            label={`Day market rate${marketRateQuery.data?.rateDate ? ` (${marketRateQuery.data.rateDate})` : ''}`}
            value={marketRateQuery.data?.rate ? `₹${marketRateQuery.data.rate.toFixed(2)}` : '—'}
          />
          <Metric
            label="Cost/kg vs market"
            value={
              marketRateQuery.data?.rate && cost.costPerKg > 0
                ? `${cost.costPerKg >= marketRateQuery.data.rate ? '+' : ''}${(cost.costPerKg - marketRateQuery.data.rate).toFixed(2)}`
                : '—'
            }
            emphasized
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={resetForm}>
            Clear
          </button>
          <div className="flex-1" />
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={openPreview}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save session'}
          </button>
        </div>
      </section>

      {isPreviewOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Casting Session Preview & Confirmation</h3>
              <button type="button" className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={() => setIsPreviewOpen(false)}>
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto bg-slate-50 p-4">
              <div className="mx-auto w-full max-w-3xl rounded-lg border border-slate-300 bg-white p-5 shadow-sm" ref={previewRef}>
                <div className="mb-4 border-b border-slate-200 pb-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Kapil Products</p>
                  <h4 className="text-lg font-semibold text-slate-900">Casting Session Slip</h4>
                  <p className="text-sm text-slate-600">{formatFullDate(date)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Metric label="Unit (batches)" value={String(unit)} />
                  <Metric label="Wire out (kg)" value={wireOut.toFixed(3)} />
                  <Metric label="Wastage (kg)" value={wastage.toFixed(3)} />
                  <Metric label="Chol IN (kg)" value={cholIn.toFixed(3)} />
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Material</th>
                        <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Qty (kg)</th>
                        <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Rate (₹/kg)</th>
                        <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validRows.map((r, idx) => (
                        <tr key={`${r.clientId}-${idx}`} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 font-medium text-slate-800">{r.materialName}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{r.qty.toFixed(3)}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">₹{r.rate.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatInrInteger(r.qty * r.rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Metric label="Total input kg" value={cost.totalInputKg.toFixed(3)} />
                  <Metric label="Total input cost" value={formatInrInteger(cost.totalInputCost)} />
                  <Metric label="Primary KPI · Cost/kg" value={cost.costPerKg > 0 ? `₹${cost.costPerKg.toFixed(2)}` : '—'} emphasized />
                  <Metric label="Note" value={note.trim() || '—'} />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setIsPreviewOpen(false)}>
                Back to Edit
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void confirmAndSave()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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

function Metric({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-md border p-2.5 ${emphasized ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono tabular-nums ${emphasized ? 'text-lg font-bold text-amber-800' : 'text-base font-semibold text-slate-900'}`}>{value}</p>
    </div>
  )
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
