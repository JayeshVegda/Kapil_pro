import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ItemRowActions } from '@/components/items/item-row-actions'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { TabBar } from '@/components/ui/business-kit'
import { inputClass } from '@/components/ui/form-control-classes'
import { createCastingMaterial, deleteCastingMaterial, loadCastingItemsWithUsage, updateCastingMaterial } from '@/data/casting'
import type { CastingMaterialRecord } from '@/domain/casting-types'
import { normalizeItemName, itemNameKey } from '@/domain/purchase-item-name'

type Item = CastingMaterialRecord & { usageCount: number }
const queryKey = ['casting-items'] as const

export function CastingItemsView() {
  const client = useQueryClient()
  const itemsQuery = useQuery({ queryKey, queryFn: loadCastingItemsWithUsage })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [editing, setEditing] = useState<Item | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [category, setCategory] = useState('')
  const [deleting, setDeleting] = useState<Item | null>(null)
  const items = itemsQuery.data ?? []
  const visible = useMemo(() => items.filter((item) => (filter === 'all' || item.isActive === (filter === 'active')) && `${item.name} ${item.code} ${item.category}`.toLowerCase().includes(search.toLowerCase())), [items, filter, search])
  const refresh = () => client.invalidateQueries({ queryKey })
  const save = useMutation({ mutationFn: async () => {
    const cleanName = normalizeItemName(name)
    if (!cleanName) throw new Error('Name is required')
    if (items.some((item) => item.id !== editing?.id && itemNameKey(item.name) === itemNameKey(cleanName))) throw new Error('This Casting item already exists')
    if (editing) return updateCastingMaterial(editing.id, { name: cleanName, code, category, isActive: editing.isActive })
    return createCastingMaterial({ name: cleanName, code, category })
  }, onSuccess: () => { setFormOpen(false); setEditing(null); setName(''); setCode(''); setCategory(''); void refresh(); toast.success('Casting item saved') }, onError: (error) => toast.error(error.message) })
  const toggle = useMutation({ mutationFn: (item: Item) => updateCastingMaterial(item.id, { name: item.name, code: item.code, category: item.category, isActive: !item.isActive }), onSuccess: () => { void refresh(); toast.success('Casting item updated') }, onError: (error) => toast.error(error.message) })
  const remove = useMutation({ mutationFn: (item: Item) => deleteCastingMaterial(item.id), onSuccess: () => { setDeleting(null); void refresh(); toast.success('Casting item deleted') }, onError: (error) => toast.error(error.message) })
  function edit(item: Item | null) { setEditing(item); setName(item?.name ?? ''); setCode(item?.code ?? ''); setCategory(item?.category ?? ''); setFormOpen(true) }
  return <div className="space-y-3">
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-sm font-semibold text-slate-900">Casting materials</h2><p className="text-xs text-slate-500">Separate furnace catalog · {items.length} items · {items.filter((item) => item.isActive).length} active</p></div>
        <button type="button" onClick={() => edit(null)} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white">+ Add material</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label="Search casting items" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, code or category" className={`${inputClass} min-w-48 flex-1`} />
        <TabBar label="Casting item status" options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} value={filter} onChange={setFilter} />
      </div>
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {itemsQuery.isLoading && <div className="h-24 animate-pulse bg-slate-100" />}
      {itemsQuery.isError && <p role="alert" className="p-5 text-sm text-rose-700">Casting materials could not load.</p>}
      {!itemsQuery.isLoading && !itemsQuery.isError && <>
        <div className="hidden overflow-x-auto sm:block"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Material</th><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Inputs</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="px-3 py-2"><strong className="font-semibold text-slate-900">{item.name}</strong><span className="ml-2 text-xs text-slate-500">{item.code}</span></td><td className="px-3 py-2 text-slate-600">{item.category || '—'}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{item.usageCount}</td><td className="px-3 py-2"><span className={item.isActive ? 'rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700' : 'rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500'}>{item.isActive ? 'Active' : 'Inactive'}</span></td><td className="whitespace-nowrap px-3 py-2 text-right"><ItemRowActions name={item.name} active={item.isActive} onEdit={() => edit(item)} onToggleActive={() => toggle.mutate(item)} onDelete={() => setDeleting(item)} /></td></tr>)}</tbody></table></div>
        <div className="divide-y divide-slate-100 sm:hidden">{visible.map((item) => <div key={item.id} className="p-3"><div className="flex justify-between gap-2"><div><strong className="text-sm text-slate-900">{item.name}</strong><p className="text-xs text-slate-500">{item.category || 'No category'} · {item.usageCount} inputs</p></div><span className="text-xs text-slate-600">{item.isActive ? 'Active' : 'Inactive'}</span></div><div className="mt-2"><ItemRowActions name={item.name} active={item.isActive} onEdit={() => edit(item)} onToggleActive={() => toggle.mutate(item)} onDelete={() => setDeleting(item)} /></div></div>)}</div>
        {visible.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No casting materials match these filters.</p>}
      </>}
    </section>
    <Dialog open={formOpen} onOpenChange={setFormOpen}><DialogContent className="w-[calc(100vw-2rem)] max-w-md"><DialogTitle>{editing ? 'Edit casting material' : 'Add casting material'}</DialogTitle><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save.mutate() }}><label className="block text-xs font-semibold text-slate-600">Material name<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} className={`${inputClass} mt-1 w-full`} /></label><label className="block text-xs font-semibold text-slate-600">Code<input value={code} onChange={(event) => setCode(event.target.value)} className={`${inputClass} mt-1 w-full`} /></label><label className="block text-xs font-semibold text-slate-600">Category<input value={category} onChange={(event) => setCategory(event.target.value)} className={`${inputClass} mt-1 w-full`} /></label>{editing && editing.usageCount > 0 && <p className="text-xs text-slate-500">Historical inputs keep their recorded name. Legacy name-only inputs may block a rename.</p>}<div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setFormOpen(false)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs">Cancel</button><button type="submit" disabled={save.isPending} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save material'}</button></div></form></DialogContent></Dialog>
    <ConfirmDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }} title={deleting?.usageCount ? 'This material is used' : 'Delete casting material?'} description={deleting?.usageCount ? `Used in ${deleting.usageCount} casting inputs. Deactivate it instead.` : `Delete ${deleting?.name ?? ''}?`} confirmLabel={deleting?.usageCount ? 'Deactivate' : 'Delete'} tone={deleting?.usageCount ? 'primary' : 'danger'} onConfirm={() => { if (deleting) { if (deleting.usageCount) toggle.mutate(deleting); else remove.mutate(deleting); setDeleting(null) } }} />
  </div>
}
