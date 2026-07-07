import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit3, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { deleteCastingSession, loadCastingMaterials, loadCastingSessions, saveCastingSession, updateCastingSession } from '@/data/casting'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import type { CastingInputRow } from '@/domain/casting-calculations'
import type { CastingSessionTrashSnapshot, CastingSessionWithInputs, CastingTrashEntry } from '@/domain/casting-types'
import { cleanupExpiredCastingTrash } from '@/domain/casting-trash'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/casting/log')({
  component: CastingLogPage,
})

const CASTING_TRASH_KEY = 'kapil-casting-trash-v1'
const CASTING_SESSIONS_KEY = ['casting-sessions'] as const
const CASTING_LOG_KEY = ['casting-log'] as const
const CASTING_MATERIALS_KEY = ['casting-materials'] as const
const pollMs = 60_000
const STANDARD_MATERIALS = ['Brass', 'Pata', 'Aux Chol', 'Merobal', 'Lead'] as const

type UiRow = CastingInputRow & { clientId: string }

function newClientId() {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function toUiRows(inputs: CastingSessionWithInputs['inputs']): UiRow[] {
  if (inputs.length === 0) return [{ clientId: newClientId(), materialName: '', qty: 0, rate: 0 }]
  return inputs.map((i) => ({
    clientId: newClientId(),
    materialName: i.materialName,
    qty: i.qty,
    rate: i.rate,
  }))
}

function readTrash(): CastingTrashEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CASTING_TRASH_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return cleanupExpiredCastingTrash(parsed as CastingTrashEntry[])
  } catch {
    return []
  }
}

function writeTrash(entries: CastingTrashEntry[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CASTING_TRASH_KEY, JSON.stringify(cleanupExpiredCastingTrash(entries)))
}

function formatTimeLeft(deletedAt: number) {
  const msLeft = Math.max(0, deletedAt + 3 * 60 * 60 * 1000 - Date.now())
  const totalMinutes = Math.ceil(msLeft / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m left`
  return `${hours}h ${minutes}m left`
}

function matchesSearch(session: CastingSessionWithInputs, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  if (session.date.includes(needle)) return true
  if (session.note.toLowerCase().includes(needle)) return true
  return session.inputs.some((i) => i.materialName.toLowerCase().includes(needle))
}

// Utility to parse arithmetic expressions like "20+20"
function parseExpression(val: string | number): number {
  if (typeof val === 'number') return val
  const clean = String(val ?? '').replace(/\s+/g, '')
  if (!clean) return 0
  try {
    if (/^[0-9.+\-*\/()]+$/.test(clean)) {
      const fn = new Function(`return (${clean})`)
      const result = Number(fn())
      return Number.isFinite(result) && result >= 0 ? result : 0
    }
  } catch {}
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
  const [tempValue, setTempValue] = useState<string>('')
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    if (!isFocused) {
      setTempValue(value ? String(value) : '')
    }
  }, [value, isFocused])

  const handleBlur = () => {
    setIsFocused(false)
    const evaluated = parseExpression(tempValue)
    onChange(evaluated)
    setTempValue(evaluated ? String(evaluated) : '')
  }

  return (
    <input
      type="text"
      className={className}
      value={tempValue}
      onChange={(e) => setTempValue(e.target.value)}
      onFocus={() => setIsFocused(true)}
      onBlur={handleBlur}
      placeholder={placeholder}
    />
  )
}

const editSchema = z
  .object({
    id: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    unit: z.number().nonnegative(),
    wireOut: z.number().nonnegative(),
    wastage: z.number().nonnegative(),
    cholIn: z.number().nonnegative(),
    note: z.string(),
    rows: z.array(z.object({ materialName: z.string(), qty: z.number(), rate: z.number() })),
  })
  .superRefine((data, ctx) => {
    const valid = data.rows.filter((r) => r.materialName.trim().length > 0 && r.qty > 0 && r.rate > 0)
    if (valid.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Add at least one material row with qty > 0 and rate > 0', path: ['rows'] })
    }
  })

function CastingLogPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [viewMode, setViewMode] = useState<'active' | 'deleted'>('active')
  const [trashEntries, setTrashEntries] = useState<CastingTrashEntry[]>(() => readTrash())
  const [statusText, setStatusText] = useState('')
  const [editing, setEditing] = useState<CastingSessionWithInputs | null>(null)
  const [deletingSession, setDeletingSession] = useState<CastingSessionWithInputs | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editUnit, setEditUnit] = useState(0)
  const [editWire, setEditWire] = useState(0)
  const [editWastage, setEditWastage] = useState(0)
  const [editChol, setEditChol] = useState(0)
  const [editNote, setEditNote] = useState('')
  const [editRows, setEditRows] = useState<UiRow[]>([])

  const sessionsQuery = useQuery({
    queryKey: [...CASTING_LOG_KEY, dateFrom, dateTo],
    queryFn: () =>
      loadCastingSessions({
        ...(dateFrom ? { from: dateFrom } : {}),
        ...(dateTo ? { to: dateTo } : {}),
      }),
  })
  const materialsQuery = useQuery({
    queryKey: CASTING_MATERIALS_KEY,
    queryFn: loadCastingMaterials,
    staleTime: 60_000,
  })
  const materialOptions = useMemo(() => {
    const set = new Set<string>(STANDARD_MATERIALS)
    for (const m of materialsQuery.data ?? []) {
      if (m.isActive && m.name.trim()) set.add(m.name.trim())
    }
    return [...set].map((name) => ({ id: name, name }))
  }, [materialsQuery.data])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTrashEntries((prev) => {
        const next = cleanupExpiredCastingTrash(prev)
        if (next.length !== prev.length) writeTrash(next)
        return next
      })
    }, pollMs)
    return () => window.clearInterval(timer)
  }, [])

  const trashMap = useMemo(() => {
    const m = new Map<string, CastingTrashEntry>()
    for (const e of trashEntries) m.set(e.key, e)
    return m
  }, [trashEntries])

  const baseSessions = sessionsQuery.data ?? []

  const filteredSessions = useMemo(() => {
    return baseSessions
      .filter((s) => matchesSearch(s, search))
  }, [baseSessions, search])

  const visibleRows = useMemo(() => {
    if (viewMode === 'active') return filteredSessions.filter((s) => !trashMap.has(`casting:${s.id}`))
    return trashEntries.map((e) => snapshotToSession(e.snapshot))
  }, [filteredSessions, trashEntries, trashMap, viewMode])

  function snapshotToSession(snap: CastingSessionTrashSnapshot): CastingSessionWithInputs {
    return {
      id: snap.id,
      date: snap.date,
      coalKg: snap.coalKg,
      coalRate: snap.coalRate,
      workerSalary: snap.workerSalary,
      unit: snap.unit,
      wireOut: snap.wireOut,
      wastage: snap.wastage,
      cholIn: snap.cholIn,
      costPerKg: snap.costPerKg,
      metalCostPerKg: snap.costPerKg,
      coalCostPerKg: 0,
      workerCostPerKg: 0,
      finalProductCostPerKg: snap.finalProductCostPerKg,
      totalWireOut: snap.wireOut,
      totalMel: snap.wastage,
      totalInputCost: snap.totalInputCost,
      totalInputKg: snap.totalInputKg,
      note: snap.note,
      createdAt: '',
      updatedAt: '',
      batches: [],
      inputs: snap.inputs.map((i, idx) => ({
        id: `snap-${idx}`,
        sessionId: snap.id,
        materialName: i.materialName,
        qty: i.qty,
        rate: i.rate,
        amount: i.amount,
      })),
    }
  }

  const deleteMutation = useMutation({
    mutationFn: async (session: CastingSessionWithInputs) => {
      const snapshot: CastingSessionTrashSnapshot = {
        id: session.id,
        date: session.date,
        coalKg: session.coalKg,
        coalRate: session.coalRate,
        workerSalary: session.workerSalary,
        unit: session.unit,
        wireOut: session.wireOut,
        wastage: session.wastage,
        cholIn: session.cholIn,
        costPerKg: session.costPerKg,
        finalProductCostPerKg: session.finalProductCostPerKg,
        totalInputCost: session.totalInputCost,
        totalInputKg: session.totalInputKg,
        note: session.note,
        inputs: session.inputs.map((i) => ({
          materialName: i.materialName,
          qty: i.qty,
          rate: i.rate,
          amount: i.amount,
        })),
      }
      await deleteCastingSession(session.id)
      return { key: `casting:${session.id}`, snapshot }
    },
    onSuccess: async ({ key, snapshot }) => {
      const next = cleanupExpiredCastingTrash([...trashEntries, { key, deletedAt: Date.now(), snapshot }])
      setTrashEntries(next)
      writeTrash(next)
      setStatusText('Session moved to temporary trash.')
      await invalidateCastingQueries(queryClient)
    },
    onError: (e) => setStatusText(toUserMessage(e)),
  })

  const restoreMutation = useMutation({
    mutationFn: async (entry: CastingTrashEntry) => {
      const s = entry.snapshot
      await saveCastingSession({
        date: s.date,
        coalKg: s.coalKg,
        coalRate: s.coalRate,
        workerSalary: s.workerSalary,
        unit: s.unit,
        wireOut: s.wireOut,
        wastage: s.wastage,
        cholIn: s.cholIn,
        note: s.note,
        inputs: s.inputs.map((i) => ({ materialName: i.materialName, qty: i.qty, rate: i.rate })),
      })
      return entry
    },
    onSuccess: async (entry) => {
      const next = trashEntries.filter((t) => t.key !== entry.key)
      setTrashEntries(next)
      writeTrash(next)
      setStatusText('Session restored.')
      await invalidateCastingQueries(queryClient)
    },
    onError: (e) => setStatusText(toUserMessage(e)),
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return
      const parsed = editSchema.safeParse({
        id: editing.id,
        date: editDate,
        unit: editUnit,
        wireOut: editWire,
        wastage: editWastage,
        cholIn: editChol,
        note: editNote,
        rows: editRows.map(({ materialName, qty, rate }) => ({ materialName, qty, rate })),
      })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid session')
      await updateCastingSession(parsed.data.id, {
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
      setStatusText('Session updated.')
      closeEdit()
      await invalidateCastingQueries(queryClient)
    },
    onError: (e) => setStatusText(toUserMessage(e)),
  })

  async function invalidateCastingQueries(qc: ReturnType<typeof useQueryClient>) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: CASTING_SESSIONS_KEY }),
      qc.invalidateQueries({ queryKey: CASTING_LOG_KEY }),
    ])
  }

  function openEdit(s: CastingSessionWithInputs) {
    setEditing(s)
    setEditDate(s.date)
    setEditUnit(s.unit)
    setEditWire(s.wireOut)
    setEditWastage(s.wastage)
    setEditChol(s.cholIn)
    setEditNote(s.note)
    setEditRows(toUiRows(s.inputs))
  }

  function closeEdit() {
    setEditing(null)
    setEditRows([])
  }

  function updateEditRow(id: string, patch: Partial<CastingInputRow>) {
    setEditRows((prev) => prev.map((r) => (r.clientId === id ? { ...r, ...patch } : r)))
  }

  function addEditRow() {
    setEditRows((prev) => [...prev, { clientId: newClientId(), materialName: '', qty: 0, rate: 0 }])
  }

  function removeEditRow(id: string) {
    setEditRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.clientId !== id)))
  }

  const totals = useMemo(() => {
    let inputKg = 0
    let inputCost = 0
    let wire = 0
    let waste = 0
    let costKgNum = 0
    let costKgDen = 0
    for (const s of visibleRows) {
      inputKg += s.totalInputKg
      inputCost += s.totalInputCost
      wire += s.wireOut
      waste += s.wastage
      if (s.totalInputKg > 0) {
        costKgNum += s.totalInputCost
        costKgDen += s.totalInputKg
      }
    }
    const avgCostKg = costKgDen > 0 ? costKgNum / costKgDen : 0
    return {
      sessions: visibleRows.length,
      inputKg,
      inputCost,
      wire,
      waste,
      avgCostKg,
    }
  }, [visibleRows])

  const helperStatus = statusText || (deleteMutation.isPending ? 'Deleting...' : '')

  return (
    <div className="w-full space-y-5 px-3 pb-8 pt-3 sm:px-4 lg:px-6">
      {helperStatus ? (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-2.5 text-xs font-semibold text-blue-700 animate-fade-in" role="status" aria-live="polite">
          {helperStatus}
        </div>
      ) : null}

      {/* Section 1: Dashboard Header & Filter Panel */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Casting Session Logs</h3>
            <p className="mt-0.5 text-xs text-slate-500">Search, filter, and manage historical furnace session outputs.</p>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold shadow-sm">
            <button type="button" className={`rounded-md px-3 py-1.5 transition ${viewMode === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`} onClick={() => setViewMode('active')}>
              Active Logs
            </button>
            <button type="button" className={`rounded-md px-3 py-1.5 transition ${viewMode === 'deleted' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`} onClick={() => setViewMode('deleted')}>
              Temporary Trash
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12 items-end">
          <div className="lg:col-span-4 relative">
            <span className="text-xs font-semibold text-slate-500 tracking-wide block mb-1.5">Search Logs</span>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className={`${inputClass} pl-8`}
                placeholder="Search date, note, material..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="lg:col-span-2">
            <Field label="From Date">
              <input className={inputClass} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </Field>
          </div>
          <div className="lg:col-span-2">
            <Field label="To Date">
              <input className={inputClass} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </Field>
          </div>
          <div className="lg:col-span-4 flex justify-end gap-1.5 h-10 items-center">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 px-3 py-2 transition shadow-sm"
              onClick={() => {
                setDateFrom(firstOfCurrentMonthIso())
                setDateTo(getLocalIsoDate())
              }}
            >
              This Month
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 px-3 py-2 transition shadow-sm"
              onClick={() => {
                setDateFrom(subtractMonthsIso(2))
                setDateTo(getLocalIsoDate())
              }}
            >
              Last 3 Months
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 px-3 py-2 transition shadow-sm"
              onClick={() => {
                setDateFrom('')
                setDateTo('')
              }}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </section>

      {/* Section 2: Session Data Grid */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Session Log Records</h3>
        {sessionsQuery.isLoading && <p className="text-sm text-slate-550 py-4">Loading casting sessions...</p>}
        {sessionsQuery.isError && <p className="text-sm text-rose-600 py-4 font-semibold">Unable to load casting sessions.</p>}
        {!sessionsQuery.isLoading && !sessionsQuery.isError && (
          <div className="overflow-x-auto rounded-lg">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider text-left bg-slate-50/50">
                  <th className="px-3 py-2.5 text-left font-bold text-slate-600">Date</th>
                  <th className="px-3 py-2.5 text-center font-bold text-slate-600 w-24">Batches</th>
                  <th className="px-3 py-2.5 text-right font-bold text-slate-600 w-32">Input kg</th>
                  <th className="px-3 py-2.5 text-right font-bold text-slate-600 w-36">Input cost</th>
                  <th className="px-3 py-2.5 text-right font-bold text-slate-600 w-40">Casting cost/kg</th>
                  <th className="px-3 py-2.5 text-right font-bold text-slate-600 w-44">Product cost/kg</th>
                  <th className="px-3 py-2.5 text-right font-bold text-slate-600 w-32">Wire out</th>
                  <th className="px-3 py-2.5 text-right font-bold text-slate-600 w-32">Wastage</th>
                  <th className="px-3 py-2.5 text-right font-bold text-slate-600 w-48">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-500">
                      No casting sessions for selected filters.
                    </td>
                  </tr>
                )}
                {visibleRows.map((row, index) => (
                  <tr key={`${row.id}-${index}`} className="hover:bg-slate-50/30 transition text-slate-800">
                    <td className="px-3 py-3 font-semibold text-slate-800">{formatFullDate(row.date)}</td>
                    <td className="px-3 py-3 text-center font-mono tabular-nums text-slate-700">{row.unit}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-700">{row.totalInputKg.toFixed(3)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-750">{formatInrInteger(row.totalInputCost)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      <span className={`inline-block rounded-md px-2 py-0.5 font-semibold text-xs border ${row.costPerKg > totals.avgCostKg ? 'bg-rose-50/60 text-rose-700 border-rose-100/50' : 'bg-emerald-50/60 text-emerald-700 border-emerald-100/50'}`}>
                        {row.costPerKg > 0 ? `₹${row.costPerKg.toFixed(2)}` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-bold tabular-nums text-blue-700">
                      {row.finalProductCostPerKg > 0 ? `₹${row.finalProductCostPerKg.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-700">{row.wireOut.toFixed(3)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-700">{row.wastage.toFixed(3)}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex justify-end gap-2">
                        {viewMode === 'active' && (
                          <>
                            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 px-3 py-1.5 transition shadow-sm" onClick={() => openEdit(row)}>
                              <Edit3 size={12} /> Edit
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-100 bg-white hover:bg-rose-50 text-xs font-semibold text-rose-600 px-3 py-1.5 transition shadow-sm"
                              onClick={() => setDeletingSession(row)}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </>
                        )}
                        {viewMode === 'deleted' && (
                          <>
                            <span className="inline-flex items-center rounded-lg bg-amber-50/60 text-amber-700 px-2 py-1 text-[11px] font-semibold border border-amber-100/50">
                              {formatTimeLeft(trashMap.get(`casting:${row.id}`)?.deletedAt ?? Date.now())}
                            </span>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-100 bg-white hover:bg-emerald-50 text-xs font-semibold text-emerald-700 px-3 py-1.5 transition shadow-sm"
                              onClick={() => {
                                const entry = trashMap.get(`casting:${row.id}`)
                                if (entry) void restoreMutation.mutateAsync(entry)
                              }}
                              disabled={restoreMutation.isPending}
                            >
                              <RotateCcw size={12} /> Restore
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      {deletingSession && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-4 py-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">Delete Casting Session</h3>
              <button type="button" className="rounded-md p-1 text-slate-400 hover:bg-slate-150 transition" onClick={() => setDeletingSession(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-650 leading-relaxed">
                Are you sure you want to delete this casting session? This will move it to the temporary trash for 3 hours.
              </p>
              <div className="rounded-lg bg-slate-50 border border-slate-150 p-3 space-y-2 text-xs">
                <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-200">
                  <span className="text-slate-500 font-semibold">Date</span>
                  <span className="font-mono text-slate-800 font-bold">{formatFullDate(deletingSession.date)}</span>
                </div>
                <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-200">
                  <span className="text-slate-500 font-semibold">Batches</span>
                  <span className="font-mono text-slate-800 font-bold">{deletingSession.unit} runs</span>
                </div>
                <div className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-200">
                  <span className="text-slate-500 font-semibold">Wire Out</span>
                  <span className="font-mono text-slate-850 font-bold">{deletingSession.wireOut.toFixed(3)} kg</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500 font-semibold">Material Value</span>
                  <span className="font-mono text-slate-900 font-bold">{formatInrInteger(deletingSession.totalInputCost)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-3">
              <button type="button" className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 px-4 py-2 transition shadow-sm" onClick={() => setDeletingSession(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white px-4 py-2 transition shadow-sm disabled:opacity-60"
                onClick={async () => {
                  await deleteMutation.mutateAsync(deletingSession)
                  setDeletingSession(null)
                }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Casting Session Modal */}
      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-xl border border-slate-200 bg-white shadow-2xl animate-scale-up">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">Edit Casting Session</h3>
              <button type="button" className="rounded-md p-1 text-slate-400 hover:bg-slate-150 transition" onClick={closeEdit}>
                <X size={16} />
              </button>
            </div>
            <div className="space-y-5 p-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
                <Field label="Date *">
                  <input className={inputClass} type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                </Field>
                <Field label="Unit (batches)">
                  <MathInput className={inputClass} placeholder="0" value={editUnit} onChange={setEditUnit} />
                </Field>
                <Field label="Wire out (kg)">
                  <MathInput className={inputClass} placeholder="0.00" value={editWire} onChange={setEditWire} />
                </Field>
                <Field label="Wastage (kg)">
                  <MathInput className={inputClass} placeholder="0.00" value={editWastage} onChange={setEditWastage} />
                </Field>
                <Field label="Chol IN (kg)">
                  <MathInput className={inputClass} placeholder="0.00" value={editChol} onChange={setEditChol} />
                </Field>
                <Field label="Remarks / Note">
                  <input className={inputClass} value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Remarks" />
                </Field>
              </div>

              {/* Nested Materials Table */}
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Materials Consumed</h4>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 px-3 py-1.5 transition shadow-sm" onClick={addEditRow}>
                    <Plus size={12} /> Add Material row
                  </button>
                </div>
                <div className="overflow-x-auto rounded-lg">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider text-left bg-slate-50/50">
                        <th className="px-3 py-2 text-left font-bold text-slate-600">Material</th>
                        <th className="px-3 py-2 text-center font-bold text-slate-600 w-32">Qty (kg)</th>
                        <th className="px-3 py-2 text-center font-bold text-slate-600 w-32">Rate / kg</th>
                        <th className="px-3 py-2 text-right font-bold text-slate-600 w-36">Amount</th>
                        <th className="px-3 py-2 text-right font-bold text-slate-600 w-24"> </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editRows.map((r) => {
                        const amt = r.qty * r.rate
                        return (
                          <tr key={r.clientId} className="hover:bg-slate-50/30 transition">
                            <td className="p-1.5 align-middle">
                              <SearchableCombobox
                                options={materialOptions}
                                value={r.materialName}
                                onChange={(nextId) => updateEditRow(r.clientId, { materialName: nextId })}
                                inputClassName="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
                                placeholder="Select material"
                                emptyText="No matching material."
                              />
                            </td>
                            <td className="p-0 align-middle text-center w-32">
                              <MathInput className="w-full h-9 bg-transparent text-center font-mono px-1 outline-none transition focus:bg-slate-50" value={r.qty} onChange={(val) => updateEditRow(r.clientId, { qty: val })} placeholder="0.00" />
                            </td>
                            <td className="p-0 align-middle text-center w-32">
                              <MathInput className="w-full h-9 bg-transparent text-center font-mono px-1 outline-none transition focus:bg-slate-50" value={r.rate} onChange={(val) => updateEditRow(r.clientId, { rate: val })} placeholder="0.00" />
                            </td>
                            <td className="px-3 py-2 align-middle text-right font-mono font-semibold text-slate-850 w-36">{formatInrInteger(amt)}</td>
                            <td className="px-3 py-2 align-middle text-right w-24">
                              <button type="button" className="text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-30 transition" onClick={() => removeEditRow(r.clientId)} disabled={editRows.length <= 1}>
                                <Trash2 size={13} className="inline mr-1" /> Remove
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3.5">
              <button type="button" className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 px-4 py-2 transition shadow-sm" onClick={closeEdit}>
                Cancel
              </button>
              <button type="button" className="rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white px-5 py-2 transition shadow-sm disabled:opacity-60" onClick={() => void updateMutation.mutateAsync()} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function firstOfCurrentMonthIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function subtractMonthsIso(monthsBack: number) {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 w-full">
      <span className="text-xs font-semibold text-slate-500 tracking-wide">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
