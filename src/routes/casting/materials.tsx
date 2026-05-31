import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Save } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toUserMessage } from '@/app/errors'
import {
  createCastingMaterial,
  loadCastingMaterials,
  loadCastingSessions,
  syncCastingMaterialMaster,
  updateCastingMaterial,
} from '@/data/casting'
import type { CastingMaterialRecord } from '@/domain/casting-types'
import { useEffect } from 'react'

export const Route = createFileRoute('/casting/materials')({
  component: CastingMaterialsPage,
})

const MATERIALS_KEY = ['casting-materials'] as const
const SESSIONS_KEY = ['casting-sessions'] as const
const LOG_KEY = ['casting-log'] as const

function CastingMaterialsPage() {
  const qc = useQueryClient()
  const [statusText, setStatusText] = useState('')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const materialsQuery = useQuery({
    queryKey: MATERIALS_KEY,
    queryFn: loadCastingMaterials,
  })
  const sessionsQuery = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => loadCastingSessions(),
  })

  const usageByMaterial = useMemo(() => {
    const byId = new Map<string, { rows: number; qty: number; amount: number }>()
    const byName = new Map<string, { rows: number; qty: number; amount: number }>()
    for (const s of sessionsQuery.data ?? []) {
      for (const i of s.inputs) {
        if (i.materialId) {
          const prev = byId.get(i.materialId) ?? { rows: 0, qty: 0, amount: 0 }
          prev.rows += 1
          prev.qty += i.qty
          prev.amount += i.amount
          byId.set(i.materialId, prev)
        }
        const nk = i.materialName.trim().toLowerCase()
        if (nk) {
          const prev = byName.get(nk) ?? { rows: 0, qty: 0, amount: 0 }
          prev.rows += 1
          prev.qty += i.qty
          prev.amount += i.amount
          byName.set(nk, prev)
        }
      }
    }
    return { byId, byName }
  }, [sessionsQuery.data])

  const rows = useMemo(() => {
    return (materialsQuery.data ?? []).map((m) => {
      const fromId = usageByMaterial.byId.get(m.id)
      const fromName = usageByMaterial.byName.get(m.name.trim().toLowerCase())
      const stats = fromId ?? fromName ?? { rows: 0, qty: 0, amount: 0 }
      return { material: m, ...stats }
    })
  }, [materialsQuery.data, usageByMaterial])

  const createMutation = useMutation({
    mutationFn: async () => {
      return createCastingMaterial({ name: newName })
    },
    onSuccess: async () => {
      setStatusText('Material created.')
      setNewName('')
      await qc.invalidateQueries({ queryKey: MATERIALS_KEY })
    },
    onError: (e) => setStatusText(toUserMessage(e)),
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingId) throw new Error('No material selected')
      return updateCastingMaterial(editingId, {
        name: editName,
      })
    },
    onSuccess: async () => {
      setStatusText('Material updated.')
      closeEdit()
      await qc.invalidateQueries({ queryKey: MATERIALS_KEY })
      await Promise.all([qc.invalidateQueries({ queryKey: SESSIONS_KEY }), qc.invalidateQueries({ queryKey: LOG_KEY })])
    },
    onError: (e) => setStatusText(toUserMessage(e)),
  })

  const syncMutation = useMutation({
    mutationFn: syncCastingMaterialMaster,
    onSuccess: async (result) => {
      setStatusText(`Material sync complete: +${result.created} created, ${result.linkedRows} rows linked.`)
      await Promise.all([
        qc.invalidateQueries({ queryKey: MATERIALS_KEY }),
        qc.invalidateQueries({ queryKey: SESSIONS_KEY }),
        qc.invalidateQueries({ queryKey: LOG_KEY }),
      ])
    },
    onError: (e) => setStatusText(toUserMessage(e)),
  })

  useEffect(() => {
    if (materialsQuery.isLoading) return
    if ((materialsQuery.data ?? []).length > 0) return
    void syncMutation.mutateAsync()
  }, [materialsQuery.isLoading, materialsQuery.data])

  function startEdit(m: CastingMaterialRecord) {
    setEditingId(m.id)
    setEditName(m.name)
  }

  function closeEdit() {
    setEditingId(null)
    setEditName('')
  }

  const helperText = statusText

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {helperText ? <p className="text-xs text-slate-500">{helperText}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Add material</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
          <input className={inputClass} placeholder="Material name *" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center gap-1 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            onClick={() => void createMutation.mutateAsync()}
            disabled={createMutation.isPending}
          >
            <Plus size={14} /> {createMutation.isPending ? 'Adding...' : 'Add'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Sync</h3>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            onClick={() => void syncMutation.mutateAsync()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? 'Syncing...' : 'Sync from DB/XLS template'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Material master list</h3>
        {materialsQuery.isLoading && <p className="text-sm text-slate-500">Loading materials...</p>}
        {materialsQuery.isError && <p className="text-sm text-red-600">Unable to load materials.</p>}
        {!materialsQuery.isLoading && !materialsQuery.isError && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Name</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Usage rows</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Total qty</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Total cost</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.material.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{r.material.name}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{r.rows}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{r.qty.toFixed(3)} kg</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">₹{Math.round(r.amount).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => startEdit(r.material)}>
                        <Pencil size={12} /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                      No materials yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editingId && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Edit material</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-1">
            <input className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Material name" />
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={closeEdit}>
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              onClick={() => void updateMutation.mutateAsync()}
              disabled={updateMutation.isPending}
            >
              <Save size={14} /> {updateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30'
