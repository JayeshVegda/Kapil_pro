import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { countItemReferences, countNameOnlyReferences } from '@/data/item-usage'
import { normalizeItemName, itemNameKey } from '@/domain/purchase-item-name'

type PBRecord = Record<string, unknown> & { id: string }

export type ItemRecord = {
  id: string
  name: string
  defaultRate: number
  type: string
  unit: string
  bagWeight: number
  group: string
  active: boolean
  usageCount: number
  lastUsedDate: string
}

/** Family name used to group variants in reports: "Spindle (7.5GM)" -> "Spindle". */
export function suggestItemGroup(name: string) {
  const base = String(name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()
  return base || String(name ?? '').trim()
}

export function isGasItem(item: Pick<ItemRecord, 'type'>) {
  return String(item.type ?? '').toLowerCase() === 'gas'
}

export function normalizeItemFields(input: {
  type: string
  unit: string
  bagWeight: number
}) {
  if (!isGasItem(input)) {
    return {
      type: input.type,
      unit: input.unit,
      bagWeight: 0,
    }
  }

  return {
    type: input.type,
    unit: input.unit,
    bagWeight: input.bagWeight,
  }
}

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)

export async function loadItemsWithUsage(): Promise<ItemRecord[]> {
  const [itemsRaw, billItemsRaw, billsRaw] = await Promise.all([
    pb.collection('items').getFullList({ sort: 'name' }),
    pb.collection('bill_items').getFullList(),
    pb.collection('bills').getFullList({ sort: 'date' }),
  ])

  const billDateById = new Map<string, string>()
  for (const bill of billsRaw as PBRecord[]) {
    billDateById.set(bill.id, datePart(bill.date))
  }

  const usageByItem = new Map<string, { count: number; lastUsedDate: string }>()
  const usageById = new Map<string, { count: number; lastUsedDate: string }>()
  for (const row of billItemsRaw as PBRecord[]) {
    const itemName = String(row.item_name ?? '').trim().toLowerCase()
    const itemId = String(row.item ?? '')
    if (!itemName && !itemId) continue
    const billId = String(row.bill ?? '')
    const billDate = billDateById.get(billId) ?? ''
    for (const [map, key] of [[usageByItem, itemName], [usageById, itemId]] as const) {
      if (!key) continue
      const usage = map.get(key) ?? { count: 0, lastUsedDate: '' }
      usage.count += 1
      if (billDate > usage.lastUsedDate) usage.lastUsedDate = billDate
      map.set(key, usage)
    }
  }

  return (itemsRaw as PBRecord[])
    .map((row) => {
      const key = String(row.name ?? '').trim().toLowerCase()
      const usage = usageById.get(row.id) ?? usageByItem.get(key)
      return {
        id: row.id,
        name: String(row.name ?? ''),
        defaultRate: num(row.default_rate),
        type: String(row.type ?? ''),
        unit: String(row.unit ?? ''),
        bagWeight: num(row.bag_weight) || 50,
        group: String(row.group ?? '') || suggestItemGroup(String(row.name ?? '')),
        active: Boolean(row.active ?? true),
        usageCount: usage?.count ?? 0,
        lastUsedDate: usage?.lastUsedDate ?? '',
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadItems(): Promise<ItemRecord[]> {
  return loadItemsWithUsage()
}

export async function createItem(input: { name: string; defaultRate: number; type: string; unit: string; bagWeight: number; group?: string }) {
  return runDataOperation('create-item', async () => {
    const normalizedName = normalizeItemName(input.name)
    const existing = await pb.collection('items').getFullList({ fields: 'id,name' })
    if (existing.some((row) => itemNameKey(String(row.name ?? '')) === itemNameKey(normalizedName))) throw new Error('This Sale item already exists')
    const itemFields = normalizeItemFields(input)
    const created = (await pb.collection('items').create({
      name: normalizedName,
      active: true,
      default_rate: input.defaultRate,
      type: itemFields.type,
      unit: itemFields.unit,
      bag_weight: itemFields.bagWeight,
      group: (input.group ?? '').trim() || suggestItemGroup(input.name),
    })) as PBRecord
    return created.id
  })
}

export async function updateItem(
  itemId: string,
  input: { name: string; defaultRate: number; type: string; unit: string; bagWeight: number; group?: string },
) {
  await runDataOperation('update-item', async () => {
    const normalizedName = normalizeItemName(input.name)
    const existing = await pb.collection('items').getFullList({ fields: 'id,name' })
    if (existing.some((row) => row.id !== itemId && itemNameKey(String(row.name ?? '')) === itemNameKey(normalizedName))) throw new Error('This Sale item already exists')
    const current = existing.find((row) => row.id === itemId)
    if (current && itemNameKey(String(current.name ?? '')) !== itemNameKey(normalizedName) && await countNameOnlyReferences('selling', String(current.name ?? '')) > 0) throw new Error('Old bills use this name without an item link. Deactivate it and add a new item instead.')
    const itemFields = normalizeItemFields(input)
    await pb.collection('items').update(itemId, {
      name: normalizedName,
      default_rate: input.defaultRate,
      type: itemFields.type,
      unit: itemFields.unit,
      bag_weight: itemFields.bagWeight,
      group: (input.group ?? '').trim() || suggestItemGroup(input.name),
    })
  })
}

export async function deleteItem(itemId: string) {
  await runDataOperation('delete-item', async () => {
    const row = await pb.collection('items').getOne(itemId)
    const count = await countItemReferences('selling', itemId, String(row.name ?? ''))
    if (count > 0) throw new Error(`Used in ${count} bill lines. Deactivate this item instead.`)
    await pb.collection('items').delete(itemId)
  })
}


export async function setItemActive(itemId: string, active: boolean) {
  return runDataOperation('set-item-active', async () => {
    await pb.collection('items').update(itemId, { active })
  })
}

export type ItemOption = {
  id: string
  name: string
  defaultRate: number
  type: string
  unit: string
  bagWeight: number
  aliases?: string
}

export async function loadItemOptions(): Promise<ItemOption[]> {
  return runDataOperation('load-item-options', async () => {
    const records = await pb.collection('items').getFullList({ sort: 'name' })
    return (records as PBRecord[]).filter((r) => Boolean(r.active ?? true)).map((r) => ({
      id: r.id,
      name: String(r.name ?? ''),
      defaultRate: num(r.default_rate),
      type: String(r.type ?? ''),
      unit: String(r.unit ?? ''),
      bagWeight: num(r.bag_weight) || 50,
      aliases: String(r.aliases ?? ''),
    }))
  })
}
