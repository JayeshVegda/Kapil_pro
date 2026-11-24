import { inputClass as baseInputClass } from '@/components/ui/form-control-classes'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toUserMessage } from '@/app/errors'
import { AppError } from '@/app/errors'
import { loadCastingMaterials, loadLatestCastingDefaults, loadMarketRateForDate, saveCastingSession } from '@/data/casting'
import { loadCastingSessionDraft } from '@/data/casting-session-drafts'
import { matchCastingMaterial } from '@/domain/casting-session-draft'
import { itemNameKey } from '@/domain/purchase-item-name'
import { Panel } from '@/components/ui/panel'
import { buttonClass } from '@/components/ui/form-control-classes'
import { z } from 'zod'
import { calculateCastingCost, type CastingBatchCostInput } from '@/domain/casting-calculations'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/casting/new-session')({
  validateSearch: z.object({ draftId: z.string().regex(/^[a-z0-9]{15}$/).optional() }),
  component: CastingNewSessionPage,
})

const DEFAULT_MATERIALS = ['Brass', 'Pata', 'Aux Chol', 'Merobal', 'Lead']
const DEFAULT_BATCH_COUNT = 4

type MaterialRow = {
  id: string
  materialId?: string
  name: string
  rate?: number
  qtyByBatch: number[]
}

function emptyRows(): MaterialRow[] {
  return DEFAULT_MATERIALS.map((name) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    qtyByBatch: Array(DEFAULT_BATCH_COUNT).fill(0),
  }))
}

// Utility to parse arithmetic expressions like "20+20"
function parseExpression(val: string | number): number {
  if (typeof val === 'number') return val
  const clean = String(val ?? '').replace(/\s+/g, '')
  if (!clean) return 0
  try {
    if (/^[0-9.+\-*/()]+$/.test(clean)) {
      const fn = new Function(`return (${clean})`)
      const result = Number(fn())
      return Number.isFinite(result) && result >= 0 ? result : 0
    }
  } catch {
    // Fall through to plain number parsing below.
  }
  const parsed = Number(clean)
  return Number.isFinite(parsed) ? parsed : 0
}

type MathInputProps = {
  value: number
  onChange: (val: number) => void
  className?: string
  placeholder?: string
}

function MathInput({ value, onChange, className, placeholder }: MathInputProps) {
  const [tempValue, setTempValue] = useState<string>()

  const handleBlur = () => {
    if (tempValue !== undefined) onChange(parseExpression(tempValue))
    setTempValue(undefined)
  }

  return (
    <input
      type="text"
      className={className}
      value={tempValue ?? (value ? String(value) : '')}
      onChange={(e) => setTempValue(e.target.value)}
      onBlur={handleBlur}
      placeholder={placeholder}
    />
  )
}

function CastingNewSessionPage() {
  const { draftId } = Route.useSearch()
  const queryClient = useQueryClient()
  const today = useMemo(() => getLocalIsoDate(), [])
  const [date, setDate] = useState(today)
  const [coalKgOverride, setCoalKg] = useState<number>()
  const [coalRateOverride, setCoalRate] = useState<number>()
  const [workerSalaryOverride, setWorkerSalary] = useState<number>()
  const [note, setNote] = useState('')
  const [baseRows, setRows] = useState<MaterialRow[]>(emptyRows)
  const [wireOutByBatch, setWireOutByBatch] = useState<number[]>(() => Array(DEFAULT_BATCH_COUNT).fill(0))
  const [melByBatch, setMelByBatch] = useState<number[]>(() => Array(DEFAULT_BATCH_COUNT).fill(0))
  const [statusText, setStatusText] = useState('')
  const [draftSaved, setDraftSaved] = useState(false)
  const [convertedSessionId, setConvertedSessionId] = useState('')
  const draftAppliedRef = useRef('')

  const draftQuery = useQuery({ queryKey: ['casting-session-draft', draftId], queryFn: () => loadCastingSessionDraft(draftId!), enabled: Boolean(draftId), refetchOnWindowFocus: true })
  const materialsQuery = useQuery({ queryKey: ['casting-materials'], queryFn: loadCastingMaterials, enabled: Boolean(draftId) })

  useEffect(() => {
    if (!draftId || !draftQuery.data || !materialsQuery.data || draftAppliedRef.current === draftId) return
    const draft = draftQuery.data
    if (draft.status !== 'pending_review' || draft.parsed.kind !== 'valid') return
    const p = draft.parsed
    const count = p.batches.length
    const mappedRows: MaterialRow[] = p.batches.flatMap((batch, batchIndex) => batch.inputs.map((input) => {
      const material = matchCastingMaterial(input.materialName, input.materialId, materialsQuery.data)
      const quantities = Array(count).fill(0) as number[]
      quantities[batchIndex] = input.qty
      return { id: crypto.randomUUID(), materialId: material?.id ?? '', name: material?.name ?? input.materialName, rate: input.rate, qtyByBatch: quantities }
    }))
    setDate(p.value.date)
    setCoalKg(p.coalKg)
    setCoalRate(p.coalRate)
    setWorkerSalary(p.workerSalary)
    setNote(p.value.note ?? '')
    setRows(mappedRows)
    setWireOutByBatch(p.batches.map((batch) => batch.wireOut))
    setMelByBatch(p.batches.map((batch) => batch.mel))
    draftAppliedRef.current = draftId
  }, [draftId, draftQuery.data, materialsQuery.data])

  const defaultsQuery = useQuery({
    queryKey: ['latest-casting-defaults'],
    queryFn: loadLatestCastingDefaults,
    enabled: !draftId,
    staleTime: 0,
  })

  const marketRateQuery = useQuery({
    queryKey: ['casting-market-rate', date],
    queryFn: () => loadMarketRateForDate(date),
    staleTime: 60_000,
  })

  // Keep defaults separate from inputs so loading or refreshing can't overwrite edits.
  const defaults = draftId ? undefined : defaultsQuery.data
  const coalKg = coalKgOverride ?? defaults?.coalKg ?? 0
  const coalRate = coalRateOverride ?? defaults?.coalRate ?? 0
  const workerSalary = workerSalaryOverride ?? defaults?.workerSalary ?? 0
  const rows = useMemo(() => baseRows.map((row) => ({
    ...row,
    rate: row.rate ?? defaults?.materialRates[itemNameKey(row.name)] ?? 0,
  })), [baseRows, defaults])

  const batchCount = wireOutByBatch.length
  const batches = useMemo<CastingBatchCostInput[]>(() => {
    return Array.from({ length: batchCount }, (_, batchIndex) => ({
      batchNumber: batchIndex + 1,
      wireOut: wireOutByBatch[batchIndex] ?? 0,
      mel: melByBatch[batchIndex] ?? 0,
      inputs: rows
        .map((row) => ({
          materialId: row.materialId,
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
      if (draftId && (draftSaved || draftQuery.data?.status !== 'pending_review' || draftQuery.data.parsed.kind !== 'valid')) throw new Error('This draft is invalid or was already processed.')
      if (draftId && batches.some((batch) => batch.inputs.some((input) => !input.materialId))) throw new Error('Match every draft input to a Casting material.')
      return saveCastingSession({
        draftId,
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
      if (draftId) {
        setDraftSaved(true)
        void queryClient.invalidateQueries({ queryKey: ['casting-session-draft', draftId] })
        void queryClient.invalidateQueries({ queryKey: ['casting-session-drafts'] })
        void queryClient.invalidateQueries({ queryKey: ['casting-session-drafts-count'] })
      }
      resetForm()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['casting-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['casting-log'] }),
        queryClient.invalidateQueries({ queryKey: ['latest-casting-defaults'] }),
      ])
    },
    onError: (err) => {
      if (err instanceof AppError && err.code === 'CONFLICT' && err.details && typeof err.details === 'object' && 'sessionId' in err.details) setConvertedSessionId(String(err.details.sessionId))
      setStatusText(toUserMessage(err))
    },
  })

  function resetForm() {
    setDate(getLocalIsoDate())
    setCoalKg(undefined)
    setCoalRate(undefined)
    setWorkerSalary(undefined)
    setNote('')
    setRows(emptyRows())
    setWireOutByBatch(Array(DEFAULT_BATCH_COUNT).fill(0))
    setMelByBatch(Array(DEFAULT_BATCH_COUNT).fill(0))
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
    <div className="w-full space-y-5 px-3 pb-8 pt-3 sm:px-4 lg:px-6">
      {draftId && <Panel className="border-blue-200 bg-blue-50 text-sm text-slate-900">{draftQuery.isLoading ? 'Loading Casting draft…' : draftQuery.data?.parsed.kind === 'invalid' ? `Invalid draft — editor unavailable: ${draftQuery.data.parsed.issues.join('; ')}` : draftQuery.data?.status !== 'pending_review' || draftSaved ? 'This draft has already been processed.' : 'Muse Casting draft · Review materials, weights and costs before saving.'}{convertedSessionId && <a className="ml-2 font-semibold underline" href="/casting/log">View saved session in Casting Logs</a>}</Panel>}
      {helperStatus ? (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-2.5 text-xs font-semibold text-blue-700" role="status" aria-live="polite">
          {helperStatus}
        </div>
      ) : null}
      {!draftId && defaultsQuery.isError && !defaults && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900" role="status">
          Couldn’t load values from the last casting log. You can enter them manually.
        </p>
      )}

      {/* Section 1: Session Parameters */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3.5">Session Parameters</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Coal Consumed (kg)">
            <MathInput className={inputClass} placeholder="0.00" value={coalKg} onChange={setCoalKg} />
          </Field>
          <Field label="Coal Rate (₹/kg)">
            <MathInput className={inputClass} placeholder="0.00" value={coalRate} onChange={setCoalRate} />
          </Field>
          <Field label="Worker Wages (₹)">
            <MathInput className={inputClass} placeholder="0" value={workerSalary} onChange={setWorkerSalary} />
          </Field>
          <Field label="Remarks / Note">
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional notes" />
          </Field>
        </div>
      </section>

      {/* Section 2: Batch Intake Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Batch Intake Grid</h3>
          </div>
          <div className="flex items-center gap-2">
            {draftId && <button type="button" className={buttonClass('secondary')} onClick={() => setRows((current) => [...current, { id: crypto.randomUUID(), materialId: '', name: '', rate: 0, qtyByBatch: Array(batchCount).fill(0) }])}><Plus size={14} /> Add material</button>}
            <button type="button" className={buttonClass('secondary')} onClick={addBatch}><Plus size={14} /> Add Batch run</button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg">
          <table className="w-full min-w-[750px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider text-left bg-slate-50/50">
                <th className="sticky left-0 bg-white px-3 py-2.5 text-left font-bold text-slate-600 w-36">Raw Material</th>
                {Array.from({ length: batchCount }, (_, idx) => (
                  <th key={idx} className="w-16 px-0.5 py-2.5 text-center font-bold text-slate-600">
                    <span className="inline-flex items-center justify-center gap-1">
                      <span className="text-[11px] tracking-tight bg-slate-100 px-1 py-0.5 rounded text-slate-500 uppercase font-semibold">B{idx + 1}</span>
                      <button type="button" className="rounded text-rose-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30 transition" onClick={() => removeBatch(idx)} disabled={batchCount <= 1} aria-label={`Remove batch ${idx + 1}`}>
                        <Trash2 size={11} />
                      </button>
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-bold text-slate-700 w-28">Total Weight</th>
                <th className="px-3 py-2.5 text-right font-bold text-slate-700 w-28">Rate / kg</th>
                <th className="px-3 py-2.5 text-right font-bold text-slate-900 w-32">Total Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const totalKg = row.qtyByBatch.reduce((sum, qty) => sum + qty, 0)
                return (
                  <tr key={row.id} className="hover:bg-slate-50/30 transition text-slate-800">
                    <td className="sticky left-0 bg-white px-3 py-2.5 font-semibold text-slate-800 w-36">{draftId ? <div className="flex items-center gap-1"><select aria-label={`Material for ${row.name || 'new row'}`} className="max-w-36 rounded-md border border-slate-300 bg-white px-1 py-1 text-xs" value={row.materialId ?? ''} onChange={(event) => { const material = materialsQuery.data?.find((entry) => entry.id === event.target.value); setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, materialId: material?.id ?? '', name: material?.name ?? entry.name } : entry)) }}><option value="">{row.name ? `Match ${row.name}` : 'Select material'}</option>{(materialsQuery.data ?? []).filter((entry) => entry.isActive).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select><button type="button" aria-label={`Remove ${row.name || 'material row'}`} onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))} className="rounded p-1 text-rose-700"><Trash2 size={13} /></button></div> : row.name}</td>
                    {row.qtyByBatch.map((qty, idx) => (
                      <td key={`${row.id}-${idx}`} className="p-0 text-center w-16">
                        <MathInput className="w-full h-9 bg-transparent text-center font-mono px-1 outline-none transition focus:bg-slate-50/80" value={qty} onChange={(val) => updateQty(row.id, idx, val)} placeholder="—" />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-900 bg-slate-50/30 w-28">{totalKg > 0 ? formatKg(totalKg) : '—'}</td>
                    <td className="p-0 text-right w-28">
                      <MathInput className="w-full h-9 bg-transparent text-right font-mono font-bold px-2 outline-none transition focus:bg-slate-50/80" value={row.rate} onChange={(val) => updateRate(row.id, val)} placeholder="—" />
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-extrabold tabular-nums text-slate-950 bg-slate-50/50 w-32">{totalKg * row.rate > 0 ? formatInrInteger(totalKg * row.rate) : '—'}</td>
                  </tr>
                )
              })}
              {/* Mel / Wastage Row */}
              <tr className="bg-amber-50/20 text-amber-900 border-t border-slate-200">
                <td className="sticky left-0 bg-amber-50/30 px-3 py-2.5 font-bold w-36">Furnace Wastage (Mel)</td>
                {melByBatch.map((qty, idx) => (
                  <td key={`mel-${idx}`} className="p-0 text-center w-16">
                    <MathInput className="w-full h-9 bg-transparent text-center font-mono px-1 outline-none transition focus:bg-amber-100/30" value={qty} onChange={(val) => updateVector(setMelByBatch, idx, val)} placeholder="—" />
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono font-bold text-amber-900 bg-amber-50/40 w-28">{cost.totalMel > 0 ? formatKg(cost.totalMel) : '—'}</td>
                <td className="bg-slate-50/10 w-28" />
                <td className="bg-slate-50/10 w-32" />
              </tr>
              {/* Wire Out Row */}
              <tr className="bg-blue-50/20 text-blue-900">
                <td className="sticky left-0 bg-blue-50/30 px-3 py-2.5 font-bold w-36">Total Wire Out (Rod)</td>
                {wireOutByBatch.map((qty, idx) => (
                  <td key={`wire-${idx}`} className="p-0 text-center w-16">
                    <MathInput className="w-full h-9 bg-transparent text-center font-mono px-1 outline-none transition focus:bg-blue-100/30" value={qty} onChange={(val) => updateVector(setWireOutByBatch, idx, val)} placeholder="—" />
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono font-bold text-blue-900 bg-blue-50/40 w-28">{cost.totalWireOut > 0 ? formatKg(cost.totalWireOut) : '—'}</td>
                <td className="bg-slate-50/10 w-28" />
                <td className="bg-slate-50/10 w-32" />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 3: Cost Chain Calculations & Estimates */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Card: Furnace day calculations (7 cols) */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-7 flex flex-col justify-between">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3.5">Furnace Day Costs</h4>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-100">
                <span className="text-slate-500">Total Metal Intake Weight</span>
                <span className="font-mono font-bold text-slate-900">{formatKg(cost.totalInputKg)}</span>
              </div>
              <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-100">
                <span className="text-slate-500">Total Wire Out Weight</span>
                <span className="font-mono font-bold text-slate-900">{formatKg(cost.totalWireOut)}</span>
              </div>
              <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-100">
                <span className="text-slate-500">Mel / Loss Weight</span>
                <span className="font-mono font-bold text-amber-700">{formatKg(cost.totalMel)}</span>
              </div>
              <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-100">
                <span className="text-slate-500">Metal Raw Cost Value</span>
                <span className="font-mono font-bold text-slate-900">{formatInrInteger(cost.totalInputCost)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
                <div className="rounded-lg bg-slate-50 border border-slate-150 p-2">
                  <span className="block text-[11px] uppercase font-bold text-slate-400">Metal / kg</span>
                  <span className="font-mono font-bold text-slate-800">{cost.metalCostPerKg > 0 ? `₹${cost.metalCostPerKg.toFixed(1)}` : '—'}</span>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-150 p-2">
                  <span className="block text-[11px] uppercase font-bold text-slate-400">Coal / kg</span>
                  <span className="font-mono font-bold text-slate-800">{cost.coalCostPerKg > 0 ? `₹${cost.coalCostPerKg.toFixed(1)}` : '—'}</span>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-150 p-2">
                  <span className="block text-[11px] uppercase font-bold text-slate-400">Worker / kg</span>
                  <span className="font-mono font-bold text-slate-800">{cost.workerCostPerKg > 0 ? `₹${cost.workerCostPerKg.toFixed(1)}` : '—'}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
            <div>
              <span className="block text-[11px] uppercase font-bold text-slate-400">Final Casting Rod Cost</span>
              <span className="text-xs text-slate-500">Loaded cost per kg of wire</span>
            </div>
            <span className="font-mono text-xl font-extrabold text-amber-800">{cost.finalCastingCostPerKg > 0 ? `₹${cost.finalCastingCostPerKg.toFixed(2)}/kg` : '—'}</span>
          </div>
        </div>

        {/* Right Card: Ready cost estimation (5 cols) */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-5 flex flex-col justify-between">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3.5">Ready Material Estimate</h4>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-100">
                <span className="text-slate-500">Base Metal Cost / kg</span>
                <span className="font-mono font-bold text-slate-900">{cost.metalCostPerKg > 0 ? `₹${cost.metalCostPerKg.toFixed(2)}` : '—'}</span>
              </div>
              <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-100">
                <span className="text-slate-500">Chitty Brass rate / kg</span>
                <span className="font-mono font-bold text-slate-900">{cost.brassRatePerKg > 0 ? `₹${cost.brassRatePerKg.toFixed(2)}` : '—'}</span>
              </div>
              <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-100">
                <span className="text-slate-500">Baravo · 7% × 2</span>
                <span className="font-mono font-bold text-slate-900">{cost.baravoCostPerKg > 0 ? `₹${(cost.baravoCostPerKg * 2).toFixed(2)}` : '₹0.00'}</span>
              </div>
              <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-100">
                <span className="text-slate-500">Coal / wire kg × 2</span>
                <span className="font-mono font-bold text-slate-900">₹{(cost.coalCostPerKg * 2).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-100">
                <span className="text-slate-500">Worker / wire kg × 2</span>
                <span className="font-mono font-bold text-slate-900">₹{(cost.workerCostPerKg * 2).toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3.5 border-t-2 border-double border-slate-200 flex items-center justify-between">
            <div>
              <span className="block text-[11px] uppercase font-bold text-slate-400">Final Ready Cost</span>
              <span className="text-xs text-slate-500">Metal + double Baravo, coal and worker</span>
            </div>
            <span className="font-mono text-2xl font-black text-slate-900">{cost.finalProductCostPerKg > 0 ? `₹${cost.finalProductCostPerKg.toFixed(2)}/kg` : '—'}</span>
          </div>
        </div>
      </section>

      {/* Section 4: Market Delta and Actions */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="text-xs">
            <span className="block font-bold text-slate-400 uppercase tracking-wider text-[11px]">Vilaity Market Rate</span>
            <span className="font-mono text-sm font-semibold text-slate-900 mt-0.5 block">
              {marketRateQuery.data?.rate ? `₹${marketRateQuery.data.rate.toFixed(2)}` : '—'}
              {marketRateQuery.data?.rateDate && <span className="text-slate-400 font-normal"> ({formatFullDate(marketRateQuery.data.rateDate)})</span>}
            </span>
          </div>
          <div className="text-xs">
            <span className="block font-bold text-slate-400 uppercase tracking-wider text-[11px]">Casting cost vs Market</span>
            <span className="font-mono text-sm font-semibold text-slate-900 mt-0.5 block">
              {marketRateQuery.data?.rate && cost.finalCastingCostPerKg > 0 ? (
                <span className={cost.finalCastingCostPerKg >= marketRateQuery.data.rate ? 'text-rose-600' : 'text-emerald-600'}>
                  {cost.finalCastingCostPerKg >= marketRateQuery.data.rate ? '+' : ''}
                  {(cost.finalCastingCostPerKg - marketRateQuery.data.rate).toFixed(2)}
                </span>
              ) : '—'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 px-4 py-2 transition shadow-sm" onClick={resetForm}>
            Clear Form
          </button>
          <button type="button" className={buttonClass('primary')} onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || (Boolean(draftId) && (draftSaved || draftQuery.data?.status !== 'pending_review' || draftQuery.data.parsed.kind !== 'valid'))}>
            {saveMutation.isPending ? 'Saving...' : 'Save Session'}
          </button>
        </div>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-slate-500 tracking-wide">{label}</span>
      {children}
    </label>
  )
}

function formatKg(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(3)} kg`
}

const inputClass = `${baseInputClass} h-10`
