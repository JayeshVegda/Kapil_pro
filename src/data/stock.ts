import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { isGasStockItem, loadItems } from '@/data/items'
import { getLocalIsoDate } from '@/lib/date'

type PBRecord = Record<string, unknown> & { id: string }

export type StockInRecord = {
  id: string
  itemId: string
  itemName: string
  date: string
  qty: number
  note: string
}

export type StockAdjustmentRecord = {
  id: string
  itemId: string
  itemName: string
  date: string
  qty: number
  note: string
}

export type CurrentStockRecord = {
  id: string
  name: string
  type: string
  unit: string
  bagWeight: number
  openingStock: number
  openingStockDate: string
  totalIn: number
  totalAdjustment: number
  totalOut: number
  currentStock: number
  stockInThisMonth: number
  adjustmentThisMonth: number
  soldThisMonth: number
}

export type StockLedgerRow = {
  id: string
  date: string
  itemId: string
  itemName: string
  type: 'Opening' | 'Stock In' | 'Adjustment' | 'Sold'
  inQty: number
  outQty: number
  balance: number
  note: string
}

export type MonthlyStockReportRow = {
  id: string
  name: string
  type: string
  unit: string
  opening: number
  stockIn: number
  sold: number
  adjustment: number
  closing: number
}

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)
const nameKey = (value: unknown) => String(value ?? '').trim().toLowerCase()

function currentMonthKey() {
  return getLocalIsoDate().slice(0, 7)
}

function mapStockIn(row: PBRecord): StockInRecord {
  const expandedItem = row.expand && typeof row.expand === 'object' ? (row.expand as Record<string, unknown>).item : null
  const itemName =
    expandedItem && typeof expandedItem === 'object' ? String((expandedItem as Record<string, unknown>).name ?? row.item_name ?? '') : String(row.item_name ?? '')
  return {
    id: row.id,
    itemId: String(row.item ?? ''),
    itemName,
    date: datePart(row.date),
    qty: num(row.qty),
    note: String(row.note ?? ''),
  }
}

function mapStockAdjustment(row: PBRecord): StockAdjustmentRecord {
  const expandedItem = row.expand && typeof row.expand === 'object' ? (row.expand as Record<string, unknown>).item : null
  const itemName =
    expandedItem && typeof expandedItem === 'object' ? String((expandedItem as Record<string, unknown>).name ?? row.item_name ?? '') : String(row.item_name ?? '')
  return {
    id: row.id,
    itemId: String(row.item ?? ''),
    itemName,
    date: datePart(row.date),
    qty: num(row.qty),
    note: String(row.note ?? ''),
  }
}

function rowMatchesItem(row: PBRecord, itemId: string, itemName: string) {
  const relation = String(row.item ?? '')
  if (relation) return relation === itemId
  return nameKey(row.item_name) === nameKey(itemName)
}

function billItemOutQty(row: PBRecord, _type: string, _bagWeight: number) {
  return num(row.qty)
}

function isOnOrAfterOpening(date: string, openingDate: string) {
  if (!openingDate) return true
  if (!date) return false
  return date >= openingDate
}

function isBefore(date: string, cutoff: string) {
  return Boolean(date && date < cutoff)
}

function isInRange(date: string, start: string, end: string) {
  return Boolean(date && date >= start && date <= end)
}

function monthBounds(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const start = `${yearRaw}-${monthRaw}-01`
  const endDate = new Date(year, month, 0)
  const end = `${yearRaw}-${monthRaw}-${String(endDate.getDate()).padStart(2, '0')}`
  return { start, end }
}

export async function loadStockIn(): Promise<StockInRecord[]> {
  const records = await pb.collection('stock_in').getFullList({ sort: '-date', expand: 'item' })
  return (records as PBRecord[]).map(mapStockIn)
}

export async function saveStockIn(payload: { itemId: string; itemName: string; date: string; qty: number; note: string }) {
  await runDataOperation('save-stock-in', async () => {
    await assertGasStockItem(payload.itemId)
    await pb.collection('stock_in').create({
      item: payload.itemId,
      item_name: payload.itemName.trim(),
      date: payload.date,
      qty: payload.qty,
      note: payload.note.trim(),
    })
  })
}

export async function deleteStockIn(id: string) {
  await runDataOperation('delete-stock-in', async () => {
    await pb.collection('stock_in').delete(id)
  })
}

export async function updateStockIn(id: string, payload: { itemId: string; itemName: string; date: string; qty: number; note: string }) {
  await runDataOperation('update-stock-in', async () => {
    await assertGasStockItem(payload.itemId)
    await pb.collection('stock_in').update(id, {
      item: payload.itemId,
      item_name: payload.itemName.trim(),
      date: payload.date,
      qty: payload.qty,
      note: payload.note.trim(),
    })
  })
}

export async function loadStockAdjustments(): Promise<StockAdjustmentRecord[]> {
  const records = await pb.collection('stock_adjustments').getFullList({ sort: '-date', expand: 'item' })
  return (records as PBRecord[]).map(mapStockAdjustment)
}

export async function saveStockAdjustment(payload: { itemId: string; itemName: string; date: string; qty: number; note: string }) {
  await runDataOperation('save-stock-adjustment', async () => {
    await assertGasStockItem(payload.itemId)
    await pb.collection('stock_adjustments').create({
      item: payload.itemId,
      item_name: payload.itemName.trim(),
      date: payload.date,
      qty: payload.qty,
      note: payload.note.trim(),
    })
  })
}

export async function deleteStockAdjustment(id: string) {
  await runDataOperation('delete-stock-adjustment', async () => {
    await pb.collection('stock_adjustments').delete(id)
  })
}

export async function loadCurrentStock(): Promise<CurrentStockRecord[]> {
  const [items, stockInRaw, adjustmentsRaw, billItemsRaw, billsRaw] = await Promise.all([
    loadItems(),
    pb.collection('stock_in').getFullList(),
    pb.collection('stock_adjustments').getFullList(),
    pb.collection('bill_items').getFullList(),
    pb.collection('bills').getFullList(),
  ])

  const monthKey = currentMonthKey()
  const billDateById = new Map<string, string>()
  for (const bill of billsRaw as PBRecord[]) {
    billDateById.set(bill.id, datePart(bill.date))
  }

  const stockInRows = stockInRaw as PBRecord[]
  const adjustmentRows = adjustmentsRaw as PBRecord[]
  const billItemRows = billItemsRaw as PBRecord[]

  return items.filter(isGasStockItem).map((item) => {
    const itemId = item.id
    const openingDate = item.openingStockDate
    const totalIn = stockInRows
      .filter((row) => rowMatchesItem(row, itemId, item.name) && isOnOrAfterOpening(datePart(row.date), openingDate))
      .reduce((sum, row) => sum + num(row.qty), 0)
    const stockInThisMonth = stockInRows
      .filter((row) => rowMatchesItem(row, itemId, item.name) && isOnOrAfterOpening(datePart(row.date), openingDate) && datePart(row.date).slice(0, 7) === monthKey)
      .reduce((sum, row) => sum + num(row.qty), 0)
    const totalAdjustment = adjustmentRows
      .filter((row) => rowMatchesItem(row, itemId, item.name) && isOnOrAfterOpening(datePart(row.date), openingDate))
      .reduce((sum, row) => sum + num(row.qty), 0)
    const adjustmentThisMonth = adjustmentRows
      .filter((row) => rowMatchesItem(row, itemId, item.name) && isOnOrAfterOpening(datePart(row.date), openingDate) && datePart(row.date).slice(0, 7) === monthKey)
      .reduce((sum, row) => sum + num(row.qty), 0)

    let totalOut = 0
    let soldThisMonth = 0
    for (const row of billItemRows) {
      if (!rowMatchesItem(row, itemId, item.name)) continue
      const billDate = billDateById.get(String(row.bill ?? '')) ?? ''
      if (!isOnOrAfterOpening(billDate, openingDate)) continue
      const outQty = billItemOutQty(row, item.type, item.bagWeight)
      totalOut += outQty
      if (billDate.slice(0, 7) === monthKey) soldThisMonth += outQty
    }

    const openingStock = item.openingStock
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      unit: item.unit,
      bagWeight: item.bagWeight,
      openingStock,
      openingStockDate: item.openingStockDate,
      totalIn,
      totalAdjustment,
      totalOut,
      currentStock: openingStock + totalIn + totalAdjustment - totalOut,
      stockInThisMonth,
      adjustmentThisMonth,
      soldThisMonth,
    }
  })
}

export async function loadStockLedger(itemId: string): Promise<StockLedgerRow[]> {
  if (!itemId) return []
  const [items, stockInRaw, adjustmentsRaw, billItemsRaw, billsRaw] = await Promise.all([
    loadItems(),
    pb.collection('stock_in').getFullList(),
    pb.collection('stock_adjustments').getFullList(),
    pb.collection('bill_items').getFullList(),
    pb.collection('bills').getFullList(),
  ])
  const item = items.find((row) => row.id === itemId)
  if (!item || !isGasStockItem(item)) return []

  const billDateById = new Map<string, { date: string; ref: string }>()
  for (const bill of billsRaw as PBRecord[]) {
    billDateById.set(bill.id, {
      date: datePart(bill.date),
      ref: `${num(bill.book_no)}/${num(bill.bill_no)}`,
    })
  }

  const movements: Array<Omit<StockLedgerRow, 'balance'>> = [
    {
      id: `opening-${item.id}`,
      date: item.openingStockDate,
      itemId: item.id,
      itemName: item.name,
      type: 'Opening',
      inQty: item.openingStock,
      outQty: 0,
      note: item.openingStockDate ? `Opening stock as on ${item.openingStockDate}` : 'Opening stock',
    },
  ]

  for (const row of stockInRaw as PBRecord[]) {
    if (!rowMatchesItem(row, item.id, item.name)) continue
    if (!isOnOrAfterOpening(datePart(row.date), item.openingStockDate)) continue
    movements.push({
      id: `in-${row.id}`,
      date: datePart(row.date),
      itemId: item.id,
      itemName: item.name,
      type: 'Stock In',
      inQty: num(row.qty),
      outQty: 0,
      note: String(row.note ?? ''),
    })
  }

  for (const row of adjustmentsRaw as PBRecord[]) {
    if (!rowMatchesItem(row, item.id, item.name)) continue
    if (!isOnOrAfterOpening(datePart(row.date), item.openingStockDate)) continue
    const qty = num(row.qty)
    movements.push({
      id: `adj-${row.id}`,
      date: datePart(row.date),
      itemId: item.id,
      itemName: item.name,
      type: 'Adjustment',
      inQty: qty > 0 ? qty : 0,
      outQty: qty < 0 ? Math.abs(qty) : 0,
      note: String(row.note ?? ''),
    })
  }

  for (const row of billItemsRaw as PBRecord[]) {
    if (!rowMatchesItem(row, item.id, item.name)) continue
    const bill = billDateById.get(String(row.bill ?? ''))
    if (!isOnOrAfterOpening(bill?.date ?? '', item.openingStockDate)) continue
    movements.push({
      id: `sold-${row.id}`,
      date: bill?.date ?? '',
      itemId: item.id,
      itemName: item.name,
      type: 'Sold',
      inQty: 0,
      outQty: billItemOutQty(row, item.type, item.bagWeight),
      note: bill ? `Bill ${bill.ref}` : 'Bill',
    })
  }

  let balance = 0
  return movements
    .sort((a, b) => {
      const dateCompare = (a.date || '0000-00-00').localeCompare(b.date || '0000-00-00')
      if (dateCompare !== 0) return dateCompare
      return a.type.localeCompare(b.type)
    })
    .map((row) => {
      balance += row.inQty - row.outQty
      return { ...row, balance }
    })
    .reverse()
}

export async function loadMonthlyStockReport(monthKey: string): Promise<MonthlyStockReportRow[]> {
  const { start, end } = monthBounds(monthKey)
  const [items, stockInRaw, adjustmentsRaw, billItemsRaw, billsRaw] = await Promise.all([
    loadItems(),
    pb.collection('stock_in').getFullList(),
    pb.collection('stock_adjustments').getFullList(),
    pb.collection('bill_items').getFullList(),
    pb.collection('bills').getFullList(),
  ])

  const billDateById = new Map<string, string>()
  for (const bill of billsRaw as PBRecord[]) {
    billDateById.set(bill.id, datePart(bill.date))
  }

  return items
    .filter(isGasStockItem)
    .map((item) => {
      const openingDate = item.openingStockDate
      const stockInRows = (stockInRaw as PBRecord[]).filter((row) => rowMatchesItem(row, item.id, item.name))
      const adjustmentRows = (adjustmentsRaw as PBRecord[]).filter((row) => rowMatchesItem(row, item.id, item.name))
      const billItemRows = (billItemsRaw as PBRecord[]).filter((row) => rowMatchesItem(row, item.id, item.name))

      const baseline = !openingDate || openingDate <= end ? item.openingStock : 0
      const priorIn = stockInRows
        .filter((row) => isOnOrAfterOpening(datePart(row.date), openingDate) && isBefore(datePart(row.date), start))
        .reduce((sum, row) => sum + num(row.qty), 0)
      const priorAdjustment = adjustmentRows
        .filter((row) => isOnOrAfterOpening(datePart(row.date), openingDate) && isBefore(datePart(row.date), start))
        .reduce((sum, row) => sum + num(row.qty), 0)
      const priorSold = billItemRows
        .filter((row) => {
          const billDate = billDateById.get(String(row.bill ?? '')) ?? ''
          return isOnOrAfterOpening(billDate, openingDate) && isBefore(billDate, start)
        })
        .reduce((sum, row) => sum + billItemOutQty(row, item.type, item.bagWeight), 0)

      const opening = baseline + priorIn + priorAdjustment - priorSold
      const stockIn = stockInRows
        .filter((row) => isOnOrAfterOpening(datePart(row.date), openingDate) && isInRange(datePart(row.date), start, end))
        .reduce((sum, row) => sum + num(row.qty), 0)
      const adjustment = adjustmentRows
        .filter((row) => isOnOrAfterOpening(datePart(row.date), openingDate) && isInRange(datePart(row.date), start, end))
        .reduce((sum, row) => sum + num(row.qty), 0)
      const sold = billItemRows
        .filter((row) => {
          const billDate = billDateById.get(String(row.bill ?? '')) ?? ''
          return isOnOrAfterOpening(billDate, openingDate) && isInRange(billDate, start, end)
        })
        .reduce((sum, row) => sum + billItemOutQty(row, item.type, item.bagWeight), 0)

      return {
        id: item.id,
        name: item.name,
        type: item.type,
        unit: item.unit,
        opening,
        stockIn,
        sold,
        adjustment,
        closing: opening + stockIn + adjustment - sold,
      }
    })
}

async function assertGasStockItem(itemId: string) {
  const items = await loadItems()
  const item = items.find((row) => row.id === itemId)
  if (!item || !isGasStockItem(item)) throw new Error('Stock tracking is only enabled for gas part items.')
}
