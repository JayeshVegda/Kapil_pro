import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'

type PBRecord = Record<string, unknown> & { id: string }

export type ItemRecord = {
  id: string
  name: string
  defaultRate: number
  type: string
  unit: string
  bagWeight: number
  group: string
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
  for (const row of billItemsRaw as PBRecord[]) {
    const itemName = String(row.item_name ?? '').trim().toLowerCase()
    if (!itemName) continue
    const billId = String(row.bill ?? '')
    const billDate = billDateById.get(billId) ?? ''
    const usage = usageByItem.get(itemName) ?? { count: 0, lastUsedDate: '' }
    usage.count += 1
    if (billDate > usage.lastUsedDate) usage.lastUsedDate = billDate
    usageByItem.set(itemName, usage)
  }

  return (itemsRaw as PBRecord[])
    .map((row) => {
      const key = String(row.name ?? '').trim().toLowerCase()
      const usage = usageByItem.get(key)
      return {
        id: row.id,
        name: String(row.name ?? ''),
        defaultRate: num(row.default_rate),
        type: String(row.type ?? ''),
        unit: String(row.unit ?? ''),
        bagWeight: num(row.bag_weight) || 50,
        group: String(row.group ?? '') || suggestItemGroup(String(row.name ?? '')),
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
    const itemFields = normalizeItemFields(input)
    const created = (await pb.collection('items').create({
      name: input.name.trim(),
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
    const itemFields = normalizeItemFields(input)
    await pb.collection('items').update(itemId, {
      name: input.name.trim(),
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
    await pb.collection('items').delete(itemId)
  })
}

