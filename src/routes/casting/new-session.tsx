import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toUserMessage } from '@/app/errors'
import { loadLatestCastingDefaults, loadMarketRateForDate, saveCastingSession } from '@/data/casting'
import { calculateCastingCost, type CastingBatchCostInput } from '@/domain/casting-calculations'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/casting/new-session')({
  component: CastingNewSessionPage,
})

const DEFAULT_MATERIALS = ['Brass', 'Pata', 'Aux Chol', 'Merobol', 'Lead']
const DEFAULT_BATCH_COUNT = 4

type MaterialRow = {
  id: string
  name: string
  rate: number
  qtyByBatch: number[]
}

function emptyRows(): MaterialRow[] {
  return DEFAULT_MATERIALS.map((name) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    rate: 0,
    qtyByBatch: Array(DEFAULT_BATCH_COUNT).fill(0),
  }))
}

function CastingNewSessionPage() {
  const queryClient = useQueryClient()
  const today = useMemo(() => getLocalIsoDate(), [])
  const [date, setDate] = useState(today)
  const [coalKg, setCoalKg] = useState(0)
  const [coalRate, setCoalRate] = useState(0)
  const [workerSalary, setWorkerSalary] = useState(0)
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<MaterialRow[]>(() => emptyRows())
  const [wireOutByBatch, setWireOutByBatch] = useState<number[]>(() => Array(DEFAULT_BATCH_COUNT).fill(0))
  const [melByBatch, setMelByBatch] = useState<number[]>(() => Array(DEFAULT_BATCH_COUNT).fill(0))
  const [statusText, setStatusText] = useState('')
  const defaultsAppliedRef = useRef(false)

  const defaultsQuery = useQuery({
    queryKey: ['latest-casting-defaults'],
    queryFn: loadLatestCastingDefaults,
    staleTime: 60_000,
  })

  const marketRateQuery = useQuery({
    queryKey: ['casting-market-rate', date],
    queryFn: () => loadMarketRateForDate(date),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!defaultsQuery.isSuccess || defaultsAppliedRef.current) return
    defaultsAppliedRef.current = true
    const defaults = defaultsQuery.data
    if (defaults.coalRate > 0) setCoalRate(defaults.coalRate)
    setRows((prev) =>
      prev.map((row) => {
        const rate = defaults.materialRates[row.name.trim().toLowerCase()]
        return rate > 0 ? { ...row, rate } : row
      }),
    )
    setStatusText(defaults.coalRate > 0 || Object.keys(defaults.materialRates).length > 0 ? 'Rates auto-filled from latest casting session.' : 'No previous casting rates found.')
  }, [defaultsQuery.data, defaultsQuery.isSuccess])

  const batchCount = wireOutByBatch.length
  const batches = useMemo<CastingBatchCostInput[]>(() => {
    return Array.from({ length: batchCount }, (_, batchIndex) => ({
      batchNumber: batchIndex + 1,
      wireOut: wireOutByBatch[batchIndex] ?? 0,
      mel: melByBatch[batchIndex] ?? 0,
      inputs: rows
        .map((row) => ({
          materialName: row.name.trim(),
          qty: row.qtyByBatch[batchIndex] ?? 0,
          rate: row.rate,
        }))
        .filter((row) => row.materialName && row.qty > 0 && row.rate > 0),
    }))
  }, [batchCount, melByBatch, rows, wireOutByBatch])

  const cost = useMemo(
    () =>
      calculateCastingCost({
        batches,
        coalKg,
        coalRate,
        workerSalary,
      }),
    [batches, coalKg, coalRate, workerSalary],
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      const hasMaterial = batches.some((batch) => batch.inputs.length > 0)
      if (!date) throw new Error('Date is required')
      if (!hasMaterial) throw new Error('Enter at least one material quantity and rate')
      if (!(cost.totalWireOut > 0)) throw new Error('Enter wire out for at least one batch')
      return saveCastingSession({
        date,
        coalKg,
        coalRate,
        workerSalary,
        note,
        batches,
      })
    },
    onSuccess: async () => {
      setStatusText('Casting session saved.')
      resetForm()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['casting-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['casting-log'] }),
        queryClient.invalidateQueries({ queryKey: ['latest-casting-defaults'] }),
      ])
    },
    onError: (err) => setStatusText(toUserMessage(err)),
  })

  function resetForm() {
    setDate(getLocalIsoDate())
    setCoalKg(0)
    setWorkerSalary(0)
    setNote('')
    setRows(emptyRows())
    setWireOutByBatch(Array(DEFAULT_BATCH_COUNT).fill(0))
    setMelByBatch(Array(DEFAULT_BATCH_COUNT).fill(0))
    defaultsAppliedRef.current = false
    void defaultsQuery.refetch()
  }

  function addBatch() {
    setRows((prev) => prev.map((row) => ({ ...row, qtyByBatch: [...row.qtyByBatch, 0] })))
    setWireOutByBatch((prev) => [...prev, 0])
    setMelByBatch((prev) => [...prev, 0])
  }

  function removeBatch(batchIndex: number) {
    if (batchCount <= 1) return
    setRows((prev) => prev.map((row) => ({ ...row, qtyByBatch: row.qtyByBatch.filter((_, idx) => idx !== batchIndex) })))
    setWireOutByBatch((prev) => prev.filter((_, idx) => idx !== batchIndex))
    setMelByBatch((prev) => prev.filter((_, idx) => idx !== batchIndex))
  }

  function updateQty(rowId: string, batchIndex: number, value: number) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row
        const qtyByBatch = [...row.qtyByBatch]
        qtyByBatch[batchIndex] = value
        return { ...row, qtyByBatch }
      }),
    )
  }

  function updateRate(rowId: string, value: number) {
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, rate: value } : row)))
  }

  function updateVector(setter: (fn: (prev: number[]) => number[]) => void, index: number, value: number) {
    setter((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  const helperStatus = statusText || (saveMutation.isPending ? 'Saving...' : '')

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500" role="status" aria-live="polite">
        {helperStatus}
      </p>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Session details</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Coal kg">
            <input className={inputClass} placeholder="0 or 40+40" type="number" min={0} step={0.001} value={coalKg || ''} onChange={(e) => setCoalKg(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="Coal rate (₹/kg)">
            <input className={inputClass} type="number" min={0} step={0.01} value={coalRate || ''} onChange={(e) => setCoalRate(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="Worker Salary (₹)">
            <input className={inputClass} type="number" min={0} step={1} value={workerSalary || ''} onChange={(e) => setWorkerSalary(parseNonNegativeNumber(e.target.value))} />
          </Field>
          <Field label="Note">
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Batches</h3>
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={addBatch}>
            <Plus size={15} /> Add Batch
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[840px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="w-40 px-2 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Material</th>
                {Array.from({ length: batchCount }, (_, idx) => (
                  <th key={idx} className="w-20 px-2 py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      Batch {idx + 1}
                      <button type="button" className="rounded p-0.5 text-rose-500 hover:bg-rose-50 disabled:opacity-30" onClick={() => removeBatch(idx)} disabled={batchCount <= 1} aria-label={`Remove batch ${idx + 1}`}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </th>
                ))}
                <th className="w-24 px-2 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Total kg</th>
                <th className="w-28 px-2 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Per kg price</th>
                <th className="w-32 px-2 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Total amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const totalKg = row.qtyByBatch.reduce((sum, qty) => sum + qty, 0)
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-medium text-slate-900">{row.name}</td>
                    {row.qtyByBatch.map((qty, idx) => (
                      <td key={`${row.id}-${idx}`} className="px-2 py-2">
                        <input className={`${inputClass} h-8 text-right tabular-nums`} type="number" min={0} step={0.001} value={qty || ''} onChange={(e) => updateQty(row.id, idx, parseNonNegativeNumber(e.target.value))} placeholder="0 or 40+" />
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums text-slate-950">{totalKg.toFixed(3)}</td>
                    <td className="px-2 py-2">
                      <input className={`${inputClass} h-8 text-right tabular-nums`} type="number" min={0} step={0.01} value={row.rate || ''} onChange={(e) => updateRate(row.id, parseNonNegativeNumber(e.target.value))} />
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-900">{formatInrInteger(totalKg * row.rate)}</td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-2 py-2 font-medium text-slate-900">Mel / wastage</td>
                {melByBatch.map((qty, idx) => (
                  <td key={`mel-${idx}`} className="px-2 py-2">
                    <input className={`${inputClass} h-8 text-right tabular-nums`} type="number" min={0} step={0.001} value={qty || ''} onChange={(e) => updateVector(setMelByBatch, idx, parseNonNegativeNumber(e.target.value))} />
                  </td>
                ))}
                <td className="px-2 py-2 text-right font-mono font-semibold">{cost.totalMel.toFixed(3)}</td>
                <td />
                <td />
              </tr>
              <tr className="border-t border-slate-100">
                <td className="px-2 py-2 font-medium text-slate-900">Wire out</td>
                {wireOutByBatch.map((qty, idx) => (
                  <td key={`wire-${idx}`} className="px-2 py-2">
                    <input className={`${inputClass} h-8 text-right tabular-nums`} type="number" min={0} step={0.001} value={qty || ''} onChange={(e) => updateVector(setWireOutByBatch, idx, parseNonNegativeNumber(e.target.value))} />
                  </td>
                ))}
                <td className="px-2 py-2 text-right font-mono font-semibold">{cost.totalWireOut.toFixed(3)}</td>
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Cost Summary</h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <Metric label="Total input kg" value={cost.totalInputKg.toFixed(3)} />
          <Metric label="Total wire out" value={cost.totalWireOut.toFixed(3)} />
          <Metric label="Total mel" value={cost.totalMel.toFixed(3)} />
          <Metric label="Coal total" value={formatInrInteger(cost.coalTotal)} />
          <Metric label="Worker salary" value={formatInrInteger(workerSalary)} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <Metric label="Metal cost/kg" value={cost.metalCostPerKg > 0 ? `₹${cost.metalCostPerKg.toFixed(2)}` : '—'} />
          <Metric label="Coal cost/kg" value={cost.coalCostPerKg > 0 ? `₹${cost.coalCostPerKg.toFixed(2)}` : '—'} />
          <Metric label="Worker cost/kg" value={cost.workerCostPerKg > 0 ? `₹${cost.workerCostPerKg.toFixed(2)}` : '—'} />
        </div>
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-700">Final casting cost/kg</p>
          <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-amber-900">{cost.finalCastingCostPerKg > 0 ? `₹${cost.finalCastingCostPerKg.toFixed(2)}` : '—'}</p>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <Metric label="1kg overhead" value={cost.overhead1Kg > 0 ? `₹${cost.overhead1Kg.toFixed(2)}` : '—'} />
          <Metric label="2kg overhead" value={cost.overhead2Kg > 0 ? `₹${cost.overhead2Kg.toFixed(2)}` : '—'} />
          <Metric label="Final product cost/kg" value={cost.finalProductCostPerKg > 0 ? `₹${cost.finalProductCostPerKg.toFixed(2)}` : '—'} emphasized />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <Metric label={`Day market rate${marketRateQuery.data?.rateDate ? ` (${marketRateQuery.data.rateDate.slice(0, 10)})` : ''}`} value={marketRateQuery.data?.rate ? `₹${marketRateQuery.data.rate.toFixed(2)}` : '—'} />
          <Metric
            label="Casting cost/kg vs market"
            value={marketRateQuery.data?.rate && cost.finalCastingCostPerKg > 0 ? `${cost.finalCastingCostPerKg >= marketRateQuery.data.rate ? '+' : ''}${(cost.finalCastingCostPerKg - marketRateQuery.data.rate).toFixed(2)}` : '—'}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={resetForm}>
            Clear
          </button>
          <div className="flex-1" />
          <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save session'}
          </button>
        </div>
      </section>
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
