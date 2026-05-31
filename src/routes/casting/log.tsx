import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Edit3, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { deleteCastingSession, loadCastingMaterials, loadCastingSessions, saveCastingSession, updateCastingSession } from '@/data/casting'
import { SearchableCombobox } from '@/components/ui/searchable-combobox'
import type { CastingInputRow } from '@/domain/casting-calculations'
import type { CastingSessionTrashSnapshot, CastingSessionWithInputs, CastingTrashEntry } from '@/domain/casting-types'
import { cleanupExpiredCastingTrash } from '@/domain/casting-trash'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger, parseNonNegativeNumber } from '@/lib/inr-format'

export const Route = createFileRoute('/casting/log')({
  component: CastingLogPage,
})

const CASTING_TRASH_KEY = 'kapil-casting-trash-v1'
const CASTING_SESSIONS_KEY = ['casting-sessions'] as const
const CASTING_LOG_KEY = ['casting-log'] as const
const CASTING_MATERIALS_KEY = ['casting-materials'] as const
const pollMs = 60_000

const STANDARD_MATERIALS = ['Brass', 'Chol', 'Plate', 'Zinc', 'Lead'] as const

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

function weekBucketLabel(iso: string) {
  const parts = iso.split('-').map(Number)
  const y = parts[0] ?? 1970
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const dt = new Date(y, m - 1, d)
  const start = new Date(y, 0, 0)
  const dayOfYear = Math.floor((dt.getTime() - start.getTime()) / 86400000)
  const w = Math.ceil(dayOfYear / 7)
  return `${y} · Week ${String(w).padStart(2, '0')}`
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function stdRow(inputs: CastingSessionWithInputs['inputs'], std: string) {
  const key = std.toLowerCase()
  const hit = inputs.find((i) => i.materialName.trim().toLowerCase() === key)
  return { qty: hit?.qty ?? 0, rate: hit?.rate ?? 0 }
}

function otherMaterialsCol(inputs: CastingSessionWithInputs['inputs']) {
  const stdSet = new Set(STANDARD_MATERIALS.map((s) => s.toLowerCase()))
  const extras = inputs.filter((i) => !stdSet.has(i.materialName.trim().toLowerCase()))
  return extras.map((i) => `${i.materialName}:${i.qty}:${i.rate}`).join(';')
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
      unit: snap.unit,
      wireOut: snap.wireOut,
      wastage: snap.wastage,
      cholIn: snap.cholIn,
      costPerKg: snap.costPerKg,
      totalInputCost: snap.totalInputCost,
      totalInputKg: snap.totalInputKg,
      note: snap.note,
      createdAt: '',
      updatedAt: '',
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
        unit: session.unit,
        wireOut: session.wireOut,
        wastage: session.wastage,
        cholIn: session.cholIn,
        costPerKg: session.costPerKg,
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

  const costKgStats = useMemo(() => {
    let latest: { date: string; value: number } | null = null
    let min = Number.POSITIVE_INFINITY
    let max = 0
    for (const s of visibleRows) {
      if (!(s.costPerKg > 0)) continue
      if (!latest || s.date > latest.date) latest = { date: s.date, value: s.costPerKg }
      if (s.costPerKg < min) min = s.costPerKg
      if (s.costPerKg > max) max = s.costPerKg
    }
    return {
      latest,
      min: Number.isFinite(min) ? min : 0,
      max,
    }
  }, [visibleRows])

  const weekly = useMemo(() => {
    const map = new Map<string, { sessions: number; kg: number; cost: number; wire: number }>()
    for (const s of visibleRows) {
      const wk = weekBucketLabel(s.date)
      const cur = map.get(wk) ?? { sessions: 0, kg: 0, cost: 0, wire: 0 }
      cur.sessions += 1
      cur.kg += s.totalInputKg
      cur.cost += s.totalInputCost
      cur.wire += s.wireOut
      map.set(wk, cur)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visibleRows])

  const perMaterial = useMemo(() => {
    const acc = new Map<string, { kg: number; cost: number }>()
    for (const s of visibleRows) {
      for (const i of s.inputs) {
        const key = i.materialName.trim() || 'Unknown'
        const cur = acc.get(key) ?? { kg: 0, cost: 0 }
        cur.kg += i.qty
        cur.cost += i.amount
        acc.set(key, cur)
      }
    }
    return [...acc.entries()]
      .map(([name, v]) => ({
        name,
        kg: v.kg,
        cost: v.cost,
        avgRate: v.kg > 0 ? v.cost / v.kg : 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [visibleRows])

  const trend6w = useMemo(() => {
    const labels: string[] = []
    const d = new Date()
    for (let i = 5; i >= 0; i -= 1) {
      const x = new Date(d)
      x.setDate(x.getDate() - i * 7)
      labels.push(weekBucketLabel(getLocalIsoDateFromDate(x)))
    }
    const uniq = [...new Set(labels)]
    return uniq.map((label) => {
      let kg = 0
      let cost = 0
      for (const s of visibleRows) {
        if (weekBucketLabel(s.date) === label) {
          kg += s.totalInputKg
          cost += s.totalInputCost
        }
      }
      const ckg = kg > 0 ? cost / kg : 0
      return { label, kg, cost, ckg }
    })
  }, [visibleRows])

  const maxTrend = useMemo(() => Math.max(1e-9, ...trend6w.map((t) => t.ckg)), [trend6w])

  function exportCsv() {
    const header = [
      'Date',
      'Batches',
      'Brass Qty',
      'Brass Rate',
      'Chol Qty',
      'Chol Rate',
      'Plate Qty',
      'Plate Rate',
      'Zinc Qty',
      'Zinc Rate',
      'Lead Qty',
      'Lead Rate',
      'Other Materials',
      'Total Input Kg',
      'Total Input Cost',
      'Cost/kg',
      'Wire Out',
      'Wastage',
      'Chol IN',
      'Note',
    ]
    const lines = [header.join(',')]
    for (const s of visibleRows) {
      const brass = stdRow(s.inputs, 'Brass')
      const chol = stdRow(s.inputs, 'Chol')
      const plate = stdRow(s.inputs, 'Plate')
      const zinc = stdRow(s.inputs, 'Zinc')
      const lead = stdRow(s.inputs, 'Lead')
      const row = [
        s.date,
        String(s.unit),
        String(brass.qty),
        String(brass.rate),
        String(chol.qty),
        String(chol.rate),
        String(plate.qty),
        String(plate.rate),
        String(zinc.qty),
        String(zinc.rate),
        String(lead.qty),
        String(lead.rate),
        otherMaterialsCol(s.inputs),
        String(s.totalInputKg),
        String(s.totalInputCost),
        String(s.costPerKg),
        String(s.wireOut),
        String(s.wastage),
        String(s.cholIn),
        s.note,
      ].map((c) => csvEscape(String(c)))
      lines.push(row.join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `casting-export-${getLocalIsoDate()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setStatusText('CSV exported.')
  }

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Filters & Actions</h3>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className={inputClass}
              placeholder="Search date, note, material..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Field label="From">
            <input className={inputClass} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input className={inputClass} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Field>
          <div className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white p-1">
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setDateFrom(firstOfCurrentMonthIso())
                setDateTo(getLocalIsoDate())
              }}
            >
              This Month
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setDateFrom(subtractMonthsIso(2))
                setDateTo(getLocalIsoDate())
              }}
            >
              Last 3 Months
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setDateFrom('')
                setDateTo('')
              }}
            >
              All Time
            </button>
          </div>
          <div className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5 text-xs">
            <button type="button" className={`rounded px-3 py-1.5 ${viewMode === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`} onClick={() => setViewMode('active')}>
              Active
            </button>
            <button type="button" className={`rounded px-3 py-1.5 ${viewMode === 'deleted' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`} onClick={() => setViewMode('deleted')}>
              Deleted
            </button>
          </div>
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </button>
        </div>
        {statusText ? <p className="text-xs text-slate-500">{statusText}</p> : null}
      </section>

      <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Session Table</h3>
        {sessionsQuery.isLoading && <p className="text-sm text-slate-500">Loading sessions...</p>}
        {sessionsQuery.isError && <p className="text-sm text-red-600">Unable to load casting sessions.</p>}
        {!sessionsQuery.isLoading && !sessionsQuery.isError && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Date</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Batches</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Input kg</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Input cost</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Cost/kg</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Wire out</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Wastage</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Chol IN</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-500">
                      No casting sessions for selected filters.
                    </td>
                  </tr>
                )}
                {visibleRows.map((row, index) => (
                  <tr key={`${row.id}-${index}`} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                    <td className="px-3 py-3 font-medium text-slate-800">{formatFullDate(row.date)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.unit}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{row.totalInputKg.toFixed(3)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{formatInrInteger(row.totalInputCost)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      <span className={`rounded px-1.5 py-0.5 ${row.costPerKg > totals.avgCostKg ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {row.costPerKg > 0 ? `₹${row.costPerKg.toFixed(2)}` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{row.wireOut.toFixed(3)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{row.wastage.toFixed(3)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{row.cholIn.toFixed(3)}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-2">
                        {viewMode === 'active' && (
                          <>
                            <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100" onClick={() => openEdit(row)}>
                              <Edit3 size={12} /> Edit
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                              onClick={() => void deleteMutation.mutateAsync(row)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </>
                        )}
                        {viewMode === 'deleted' && (
                          <>
                            <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                              {formatTimeLeft(trashMap.get(`casting:${row.id}`)?.deletedAt ?? Date.now())}
                            </span>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
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

      <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Summary and Analytics</h3>
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          <SummaryTile label="Sessions" value={String(totals.sessions)} />
          <SummaryTile label="Total input kg" value={totals.inputKg.toFixed(3)} />
          <SummaryTile label="Total input cost" value={formatInrInteger(totals.inputCost)} />
          <SummaryTile label="Total wire out" value={totals.wire.toFixed(3)} />
          <SummaryTile label="Primary KPI · Avg cost/kg (weighted)" value={totals.avgCostKg > 0 ? `₹${totals.avgCostKg.toFixed(2)}` : '—'} emphasized />
        </div>
        <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-3">
          <SummaryTile label="Latest cost/kg" value={costKgStats.latest ? `₹${costKgStats.latest.value.toFixed(2)} (${formatFullDate(costKgStats.latest.date)})` : '—'} />
          <SummaryTile label="Min cost/kg" value={costKgStats.min > 0 ? `₹${costKgStats.min.toFixed(2)}` : '—'} />
          <SummaryTile label="Max cost/kg" value={costKgStats.max > 0 ? `₹${costKgStats.max.toFixed(2)}` : '—'} />
        </div>

        <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Weekly breakdown</h4>
        <div className="mb-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Week</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Sessions</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Input kg</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Input cost</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Wire out</th>
              </tr>
            </thead>
            <tbody>
              {weekly.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                    No weekly groups.
                  </td>
                </tr>
              ) : (
                weekly.map(([label, v]) => (
                  <tr key={label} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.sessions}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{v.kg.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatInrInteger(v.cost)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{v.wire.toFixed(3)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Per-material (visible sessions)</h4>
        <div className="mb-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Material</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Total kg</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Avg rate</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Total cost</th>
              </tr>
            </thead>
            <tbody>
              {perMaterial.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                    No materials.
                  </td>
                </tr>
              ) : (
                perMaterial.map((m) => (
                  <tr key={m.name} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{m.name}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{m.kg.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{m.avgRate > 0 ? `₹${m.avgRate.toFixed(2)}` : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatInrInteger(m.cost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Cost/kg trend (rolling weeks)</h4>
        <ul className="space-y-2">
          {trend6w.map((t) => (
            <li key={t.label} className="flex items-center gap-3 text-sm">
              <span className="w-36 shrink-0 truncate text-slate-600" title={t.label}>
                {t.label}
              </span>
              <div className="h-2 flex-1 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(100, (t.ckg / maxTrend) * 100)}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right font-mono text-xs text-slate-800">{t.ckg > 0 ? `₹${t.ckg.toFixed(2)}` : '—'}</span>
            </li>
          ))}
        </ul>
      </section>

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Edit casting session</h3>
              <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100" onClick={closeEdit}>
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Date *">
                  <input className={inputClass} type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                </Field>
                <Field label="Unit (batches)">
                  <input className={inputClass} type="number" min={0} value={editUnit || ''} onChange={(e) => setEditUnit(parseNonNegativeNumber(e.target.value))} />
                </Field>
                <Field label="Wire out (kg)">
                  <input className={inputClass} type="number" min={0} value={editWire || ''} onChange={(e) => setEditWire(parseNonNegativeNumber(e.target.value))} />
                </Field>
                <Field label="Wastage (kg)">
                  <input className={inputClass} type="number" min={0} value={editWastage || ''} onChange={(e) => setEditWastage(parseNonNegativeNumber(e.target.value))} />
                </Field>
                <Field label="Chol IN (kg)">
                  <input className={inputClass} type="number" min={0} value={editChol || ''} onChange={(e) => setEditChol(parseNonNegativeNumber(e.target.value))} />
                </Field>
                <Field label="Note">
                  <input className={inputClass} value={editNote} onChange={(e) => setEditNote(e.target.value)} />
                </Field>
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900">Materials</h4>
                  <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={addEditRow}>
                    <Plus size={12} /> Add row
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-2 py-2 text-left text-xs font-semibold text-slate-600">Material</th>
                        <th className="px-2 py-2 text-right text-xs font-semibold text-slate-600">Qty</th>
                        <th className="px-2 py-2 text-right text-xs font-semibold text-slate-600">Rate</th>
                        <th className="px-2 py-2 text-right text-xs font-semibold text-slate-600">Amount</th>
                        <th className="px-2 py-2 text-right text-xs font-semibold text-slate-600"> </th>
                      </tr>
                    </thead>
                    <tbody>
                      {editRows.map((r) => {
                        const amt = r.qty * r.rate
                        return (
                          <tr key={r.clientId} className="border-t border-slate-100">
                            <td className="px-2 py-1">
                              <SearchableCombobox
                                options={materialOptions}
                                value={r.materialName}
                                onChange={(nextId) => updateEditRow(r.clientId, { materialName: nextId })}
                                inputClassName={inputClass}
                                placeholder="Select material"
                                emptyText="No matching material."
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input className={`${inputClass} text-right tabular-nums`} type="number" min={0} value={r.qty || ''} onChange={(e) => updateEditRow(r.clientId, { qty: parseNonNegativeNumber(e.target.value) })} />
                            </td>
                            <td className="px-2 py-1">
                              <input className={`${inputClass} text-right tabular-nums`} type="number" min={0} value={r.rate || ''} onChange={(e) => updateEditRow(r.clientId, { rate: parseNonNegativeNumber(e.target.value) })} />
                            </td>
                            <td className="px-2 py-2 text-right font-mono">{formatInrInteger(amt)}</td>
                            <td className="px-2 py-1 text-right">
                              <button type="button" className="text-xs text-rose-600 hover:underline disabled:opacity-50" onClick={() => removeEditRow(r.clientId)} disabled={editRows.length <= 1}>
                                Remove
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
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={closeEdit}>
                Cancel
              </button>
              <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60" onClick={() => void updateMutation.mutateAsync()} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function getLocalIsoDateFromDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
    <label className="flex min-w-[140px] flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function SummaryTile({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-md border p-2.5 ${emphasized ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono tabular-nums ${emphasized ? 'text-lg font-bold text-amber-800' : 'text-base font-semibold text-slate-900'}`}>{value}</p>
    </div>
  )
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
