import { CastingSessionEditor } from '@/components/casting/casting-session-editor'
import { inputClass as baseInputClass } from '@/components/ui/form-control-classes'
import { LogsPager, LogsTableCard, LogsToolbarCard, defaultLogFromDate, useLogsPager } from '@/components/logging/logs-shell'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit3, Eye, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { toUserMessage } from '@/app/errors'
import { deleteCastingSession, loadCastingSessions, saveCastingSession } from '@/data/casting'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { CastingTicket } from '@/components/casting/casting-ticket'
import type { CastingSessionTrashSnapshot, CastingSessionWithInputs, CastingTrashEntry } from '@/domain/casting-types'
import { cleanupExpiredCastingTrash } from '@/domain/casting-trash'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/casting/log')({
  validateSearch: z.object({
    sessionId: z.string().optional(),
    sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    action: z.enum(['edit', 'delete']).optional(),
  }),
  component: CastingLogPage,
})

const CASTING_TRASH_KEY = 'kapil-casting-trash-v1'
const CASTING_SESSIONS_KEY = ['casting-sessions'] as const
const CASTING_LOG_KEY = ['casting-log'] as const
const pollMs = 60_000
const inputClass = `${baseInputClass} h-10`
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

export function CastingLogPage() {
  const queryClient = useQueryClient()
  const { sessionId, sessionDate, action } = Route.useSearch()
  const handledAction = useRef('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState(() => sessionDate ?? defaultLogFromDate(getLocalIsoDate()))
  const [dateTo, setDateTo] = useState('')
  const [viewMode, setViewMode] = useState<'active' | 'deleted'>('active')
  const [trashEntries, setTrashEntries] = useState<CastingTrashEntry[]>(() => readTrash())
  const [statusText, setStatusText] = useState('')
  const [viewing, setViewing] = useState<CastingSessionWithInputs | null>(null)
  const [editing, setEditing] = useState<CastingSessionWithInputs | null>(null)
  const [deletingSession, setDeletingSession] = useState<CastingSessionWithInputs | null>(null)
  useEffect(() => {
    if (sessionId && sessionDate && action) {
      setDateFrom(sessionDate)
      setDateTo(sessionDate)
    }
  }, [action, sessionDate, sessionId])

  const sessionsQuery = useQuery({
    queryKey: [...CASTING_LOG_KEY, dateFrom, dateTo],
    queryFn: () =>
      loadCastingSessions({
        ...(dateFrom ? { from: dateFrom } : {}),
        ...(dateTo ? { to: dateTo } : {}),
      }),
  })
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

  const pager = useLogsPager(visibleRows)

  function snapshotToSession(snap: CastingSessionTrashSnapshot): CastingSessionWithInputs {
    return {
      id: snap.id,
      costFormulaVersion: snap.costFormulaVersion ?? 1,
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
        costFormulaVersion: session.costFormulaVersion,
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
        costFormulaVersion: s.costFormulaVersion ?? 1,
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

  async function invalidateCastingQueries(qc: ReturnType<typeof useQueryClient>) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: CASTING_SESSIONS_KEY }),
      qc.invalidateQueries({ queryKey: CASTING_LOG_KEY }),
      qc.invalidateQueries({ queryKey: ['latest-casting-defaults'] }),
    ])
  }

  function openEdit(s: CastingSessionWithInputs) {
    setEditing(s)
  }

  useEffect(() => {
    if (!sessionId || !action) {
      handledAction.current = ''
      return
    }
    const actionKey = `${sessionId}:${action}`
    if (handledAction.current === actionKey) return
    const session = sessionsQuery.data?.find((row) => row.id === sessionId)
    if (!session) return
    handledAction.current = actionKey
    if (action === 'edit') openEdit(session)
    else setDeletingSession(session)
  }, [action, sessionId, sessionsQuery.data])

  function closeEdit() {
    setEditing(null)
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

      {/* Section 1: one short card toolbar (operational redesign Phase 4) —
          the Active/Trash switch, search, date range, and quick ranges all
          share a single wrap row instead of a stacked multi-row panel. */}
      <LogsToolbarCard>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold" role="group" aria-label="Casting log view">
            <button type="button" aria-pressed={viewMode === 'active'} className={`rounded-md px-3 py-1.5 transition ${viewMode === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`} onClick={() => setViewMode('active')}>
              Active logs
            </button>
            <button type="button" aria-pressed={viewMode === 'deleted'} className={`rounded-md px-3 py-1.5 transition ${viewMode === 'deleted' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`} onClick={() => setViewMode('deleted')}>
              Temporary trash
            </button>
          </div>
          <div className="relative w-full sm:w-56">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              aria-label="Search casting sessions"
              className={`${inputClass} h-9 pl-8`}
              placeholder="Search date, note, material..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-[150px]">
            <label className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500">From</span>
              <input aria-label="From date" className={`${inputClass} w-[104px]`} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
          </div>
          <div className="w-[150px]">
            <label className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500">To</span>
              <input aria-label="To date" className={`${inputClass} w-[104px]`} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
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
              Clear filters
            </button>
          </div>
        </div>
      </LogsToolbarCard>

      {/* Section 2: Session Data Grid */}
      <LogsTableCard>
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
                {pager.pageRows.map((row, index) => (
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
                            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 px-3 py-1.5 transition shadow-sm" onClick={() => setViewing(row)}>
                              <Eye size={12} /> View
                            </button>
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
      </LogsTableCard>

      <LogsPager {...pager} />

      <ConfirmDialog
        open={Boolean(deletingSession)}
        onOpenChange={(open) => { if (!open) setDeletingSession(null) }}
        title="Delete Casting Session"
        description={deletingSession ? `Move the ${formatFullDate(deletingSession.date)} session (${deletingSession.unit} runs, ${deletingSession.wireOut.toFixed(3)} kg wire out) to temporary trash for 3 hours?` : undefined}
        confirmLabel="Delete session"
        tone="danger"
        pending={deleteMutation.isPending}
        onConfirm={() => { if (deletingSession) void deleteMutation.mutateAsync(deletingSession).then(() => setDeletingSession(null)) }}
      />

      {/* View Casting Session Modal: centered, sharing the printed ticket */}
      {viewing && (
        <Dialog open onOpenChange={(open) => { if (!open) setViewing(null) }}>
          <DialogContent showCloseButton={false} className="max-h-[92vh] sm:max-w-4xl overflow-auto border border-slate-200 bg-white p-0 shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <DialogTitle className="text-sm font-semibold text-slate-950">
                Casting session ticket — {formatFullDate(viewing.date)}
              </DialogTitle>
              <button type="button" aria-label="Close casting ticket" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 transition" onClick={() => setViewing(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              <CastingTicket session={viewing} />
              <p className="mt-2 text-center text-[11px] text-slate-400">
                Same ticket the Casting Bill page prints — values come from the saved session.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {editing && (
        <Dialog open onOpenChange={(open) => { if (!open) closeEdit() }}>
          <DialogContent showCloseButton={false} className="max-h-[92vh] gap-0 overflow-auto border border-slate-200 bg-white p-0 shadow-xl sm:max-w-[min(94vw,78rem)]">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3">
              <DialogTitle>Edit Casting Session · {formatFullDate(editing.date)}</DialogTitle>
              <button type="button" aria-label="Close casting editor" className="rounded p-1 hover:bg-slate-100" onClick={closeEdit}><X size={16} /></button>
            </div>
            <CastingSessionEditor key={editing.id} initialSession={editing} onSaved={() => {
              closeEdit()
              setStatusText('Session updated.')
            }} />
          </DialogContent>
        </Dialog>
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
