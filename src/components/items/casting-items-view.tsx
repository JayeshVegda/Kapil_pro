import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
  }, onSuccess: () => { setEditing(null); setName(''); setCode(''); setCategory(''); void refresh(); toast.success('Casting item saved') }, onError: (error) => toast.error(error.message) })
  const toggle = useMutation({ mutationFn: (item: Item) => updateCastingMaterial(item.id, { name: item.name, code: item.code, category: item.category, isActive: !item.isActive }), onSuccess: () => { void refresh(); toast.success('Casting item updated') }, onError: (error) => toast.error(error.message) })
  const remove = useMutation({ mutationFn: (item: Item) => deleteCastingMaterial(item.id), onSuccess: () => { setDeleting(null); void refresh(); toast.success('Casting item deleted') }, onError: (error) => toast.error(error.message) })
  function edit(item: Item) { setEditing(item); setName(item.name); setCode(item.code); setCategory(item.category) }
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Casting Items</h2><p className="text-xs text-slate-500">Separate furnace material master and usage history.</p></div><div className="flex gap-2"><input aria-label="Search casting items" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items" className="h-9 rounded-lg border border-slate-300 px-3 text-sm" /><select aria-label="Filter casting items" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm"><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div></div>
    <form className="mb-4 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); save.mutate() }}><input aria-label="Material name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Material name" className="h-9 rounded-lg border border-slate-300 px-3 text-sm" required /><input aria-label="Code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Code" className="h-9 rounded-lg border border-slate-300 px-3 text-sm" /><input aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Category" className="h-9 rounded-lg border border-slate-300 px-3 text-sm" /><button type="submit" disabled={save.isPending} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white">{editing ? 'Save' : 'Add item'}</button></form>
    {itemsQuery.isLoading && <div className="h-24 animate-pulse rounded-lg bg-slate-100" />}
    {itemsQuery.isError && <p role="alert" className="text-xs text-rose-700">Casting items could not load.</p>}
    {!itemsQuery.isLoading && !itemsQuery.isError && <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-xs"><thead className="bg-slate-50 text-left uppercase text-slate-500"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Sessions / inputs</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{item.name}</td><td className="px-3 py-2">{item.code || '—'}</td><td className="px-3 py-2">{item.category || '—'}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{item.usageCount}</td><td className="px-3 py-2">{item.isActive ? 'Active' : 'Inactive'}</td><td className="space-x-2 px-3 py-2"><button type="button" className="text-blue-700 hover:underline" onClick={() => edit(item)}>Edit</button><button type="button" className="text-slate-700 hover:underline" onClick={() => toggle.mutate(item)}>{item.isActive ? 'Deactivate' : 'Activate'}</button><button type="button" className="text-rose-700 hover:underline" onClick={() => setDeleting(item)}>Delete</button></td></tr>)}</tbody></table>{visible.length === 0 && <p className="p-6 text-center text-xs text-slate-500">No casting items found.</p>}</div>}
    <ConfirmDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }} title={deleting?.usageCount ? 'This item is used' : 'Delete casting item?'} description={deleting?.usageCount ? `Used in ${deleting.usageCount} casting inputs. Deactivate it instead.` : `Delete ${deleting?.name ?? ''}?`} confirmLabel={deleting?.usageCount ? 'Deactivate' : 'Delete'} tone={deleting?.usageCount ? 'primary' : 'danger'} onConfirm={() => { if (deleting) { if (deleting.usageCount) toggle.mutate(deleting); else remove.mutate(deleting); setDeleting(null) } }} />
  </section>
}
