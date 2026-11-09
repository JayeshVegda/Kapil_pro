import { pb } from '@/data/pocketbase'

export type ItemWorld = 'selling' | 'purchase' | 'casting'

export async function countItemReferences(world: ItemWorld, id: string, name: string): Promise<number> {
  const collection = world === 'selling' ? 'bill_items' : world === 'purchase' ? 'purchase_bill_lines' : 'casting_batch_inputs'
  const relation = world === 'casting' ? 'material' : 'item'
  const nameField = world === 'casting' ? 'material_name' : 'item_name'
  const rows = await pb.collection(collection).getFullList({ fields: `id,${relation},${nameField}` })
  const targetName = name.trim().toLocaleLowerCase()
  return rows.filter((row) => String(row[relation] ?? '') === id || String(row[nameField] ?? '').trim().toLocaleLowerCase() === targetName).length
}

/** Historic lines without a relation cannot follow a rename without rewriting history. */
export async function countNameOnlyReferences(world: ItemWorld, name: string): Promise<number> {
  const collection = world === 'selling' ? 'bill_items' : world === 'purchase' ? 'purchase_bill_lines' : 'casting_batch_inputs'
  const relation = world === 'casting' ? 'material' : 'item'
  const nameField = world === 'casting' ? 'material_name' : 'item_name'
  const rows = await pb.collection(collection).getFullList({ fields: `${relation},${nameField}` })
  const target = name.trim().toLocaleLowerCase()
  return rows.filter((row) => !String(row[relation] ?? '') && String(row[nameField] ?? '').trim().toLocaleLowerCase() === target).length
}
