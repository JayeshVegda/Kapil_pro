import { loadCurrentStock } from '@/data/stock'
import { pb } from '@/data/pocketbase'

type PBRecord = Record<string, unknown> & { id: string }

export type DataHealthIssue = {
  id: string
  severity: 'High' | 'Medium' | 'Low'
  area: string
  title: string
  detail: string
  fixKind?: 'link-bill-item'
}

export type DataHealthFixPreview = {
  issueId: string
  title: string
  before: string
  after: string
}

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const key = (value: unknown) => String(value ?? '').trim().toLowerCase()

export async function loadDataHealthIssues(): Promise<DataHealthIssue[]> {
  const [itemsRaw, billItemsRaw, billsRaw, currentStock] = await Promise.all([
    pb.collection('items').getFullList({ sort: 'name' }),
    pb.collection('bill_items').getFullList(),
    pb.collection('bills').getFullList({ sort: '-date,-bill_no' }),
    loadCurrentStock(),
  ])

  const issues: DataHealthIssue[] = []
  const items = itemsRaw as PBRecord[]
  const itemByName = new Map(items.map((item) => [key(item.name), item]))

  for (const item of items) {
    const type = String(item.type ?? '')
    if (!type) {
      issues.push({
        id: `item-type-${item.id}`,
        severity: 'Medium',
        area: 'Items',
        title: 'Item has no stock type',
        detail: `${String(item.name ?? 'Unknown item')} is missing electronic/gas type.`,
      })
    }
    if (type && !String(item.opening_stock_date ?? '')) {
      issues.push({
        id: `item-opening-date-${item.id}`,
        severity: 'Medium',
        area: 'Items',
        title: 'Item has no opening stock date',
        detail: `${String(item.name ?? 'Unknown item')} will count all historical movements until an opening date is set.`,
      })
    }
  }

  for (const item of currentStock) {
    if (!item.type || item.currentStock >= 0) continue
    issues.push({
      id: `negative-stock-${item.id}`,
      severity: 'High',
      area: 'Stock',
      title: 'Negative stock',
      detail: `${item.itemName} / ${item.customerName} is ${Math.abs(item.currentStock)} ${item.unit === 'piece' ? 'pieces' : item.unit} short.`,
    })
  }

  for (const row of billItemsRaw as PBRecord[]) {
    if (String(row.item ?? '')) continue
    const itemName = String(row.item_name ?? '')
    const matched = itemByName.get(key(itemName))
    issues.push({
      id: `bill-item-link-${row.id}`,
      severity: matched ? 'Low' : 'High',
      area: 'Bills',
      title: matched ? 'Bill item is not linked' : 'Bill item cannot be matched to item master',
      detail: matched ? `${itemName} can be linked to item master.` : `${itemName || 'Unnamed bill item'} has no item relation and no matching item master name.`,
      fixKind: matched ? 'link-bill-item' : undefined,
    })
  }

  const billsByRef = new Map<string, PBRecord[]>()
  for (const bill of billsRaw as PBRecord[]) {
    const ref = `${num(bill.book_no)}/${num(bill.bill_no)}`
    const rows = billsByRef.get(ref) ?? []
    rows.push(bill)
    billsByRef.set(ref, rows)
  }
  for (const [ref, rows] of billsByRef) {
    if (rows.length <= 1) continue
    issues.push({
      id: `duplicate-bill-${ref}`,
      severity: 'High',
      area: 'Bills',
      title: 'Duplicate bill number',
      detail: `Bill ${ref} appears ${rows.length} times.`,
    })
  }

  return issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.area.localeCompare(b.area))
}

export async function previewDataHealthFix(issue: DataHealthIssue): Promise<DataHealthFixPreview> {
  if (issue.fixKind !== 'link-bill-item') throw new Error('No safe automatic fix is available for this issue.')
  const billItemId = issue.id.replace('bill-item-link-', '')
  const [billItem, itemsRaw] = await Promise.all([
    pb.collection('bill_items').getOne(billItemId),
    pb.collection('items').getFullList({ sort: 'name' }),
  ])
  const itemName = String(billItem.item_name ?? '')
  const matched = (itemsRaw as PBRecord[]).find((item) => key(item.name) === key(itemName))
  if (!matched) throw new Error(`No matching item master found for ${itemName}.`)
  return {
    issueId: issue.id,
    title: 'Link bill item to item master',
    before: `${itemName} has no item relation.`,
    after: `${itemName} will link to ${String(matched.name ?? '')}.`,
  }
}

export async function applyDataHealthFix(issue: DataHealthIssue) {
  if (issue.fixKind !== 'link-bill-item') throw new Error('No safe automatic fix is available for this issue.')
  const billItemId = issue.id.replace('bill-item-link-', '')
  const [billItem, itemsRaw] = await Promise.all([
    pb.collection('bill_items').getOne(billItemId),
    pb.collection('items').getFullList({ sort: 'name' }),
  ])
  const itemName = String(billItem.item_name ?? '')
  const matched = (itemsRaw as PBRecord[]).find((item) => key(item.name) === key(itemName))
  if (!matched) throw new Error(`No matching item master found for ${itemName}.`)
  await pb.collection('bill_items').update(billItemId, { item: matched.id })
}

function severityRank(severity: DataHealthIssue['severity']) {
  if (severity === 'High') return 0
  if (severity === 'Medium') return 1
  return 2
}
