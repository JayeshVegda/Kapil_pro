import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { isGasStockItem, loadItems, type ItemRecord } from '@/data/items'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { getLocalIsoDate } from '@/lib/date'

type PBRecord = Record<string, unknown> & { id: string }

export type StockCustomerOption = {
  id: string
  name: string
  customerName: string
  companyName: string
}

export type StockOpeningRecord = {
  id: string
  itemId: string
  itemName: string
  customerId: string
  customerName: string
  date: string
  qty: number
  note: string
}

export type StockInRecord = {
  id: string
  itemId: string
  itemName: string
  customerId: string
  customerName: string
  date: string
  qty: number
  note: string
}

export type StockAdjustmentRecord = {
  id: string
  itemId: string
  itemName: string
  customerId: string
  customerName: string
  date: string
  qty: number
  note: string
}

export type CurrentStockRecord = {
  id: string
  itemId: string
  itemName: string
  customerId: string
  customerName: string
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
  customerId: string
  customerName: string
  type: 'Opening' | 'Stock In' | 'Adjustment' | 'Sold'
  inQty: number
  outQty: number
  balance: number
  note: string
}

export type MonthlyStockReportRow = {
  id: string
  itemId: string
  itemName: string
  customerId: string
  customerName: string
  name: string
  type: string
  unit: string
  bagWeight: number
  opening: number
  stockIn: number
  sold: number
  adjustment: number
  closing: number
}

const GENERAL_CUSTOMER_NAME = 'General'
const DEFAULT_STOCK_START_DATE = '2026-05-20'

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)
const nameKey = (value: unknown) => String(value ?? '').trim().toLowerCase()
const bucketKey = (itemId: string, customerId: string) => `${itemId}::${customerId}`

function currentMonthKey() {
  return getLocalIsoDate().slice(0, 7)
}

function customerDisplayFromRow(row: PBRecord) {
  return formatCustomerDisplayName(row.company_name, row.name)
}

function expandedRecord(row: PBRecord, key: string) {
  return row.expand && typeof row.expand === 'object' ? (row.expand as Record<string, unknown>)[key] : null
}

function expandedName(row: PBRecord, relationKey: string, fallback: unknown) {
  const expanded = expandedRecord(row, relationKey)
  if (expanded && typeof expanded === 'object') {
    const record = expanded as PBRecord
    if (relationKey === 'customer') return customerDisplayFromRow(record)
    return String(record.name ?? fallback ?? '')
  }
  return String(fallback ?? '')
}

function mapCustomer(row: PBRecord): StockCustomerOption {
  const companyName = String(row.company_name ?? row.name ?? '')
  const customerName = String(row.name ?? '')
  return {
    id: row.id,
    name: formatCustomerDisplayName(companyName, customerName),
    companyName,
    customerName,
  }
}

function mapStockOpening(row: PBRecord): StockOpeningRecord {
  return {
    id: row.id,
    itemId: String(row.item ?? ''),
    itemName: expandedName(row, 'item', row.item_name),
    customerId: String(row.customer ?? ''),
    customerName: expandedName(row, 'customer', row.customer_name),
    date: datePart(row.date),
    qty: num(row.qty),
    note: String(row.note ?? ''),
  }
}

function mapStockIn(row: PBRecord): StockInRecord {
  return {
    id: row.id,
    itemId: String(row.item ?? ''),
    itemName: expandedName(row, 'item', row.item_name),
    customerId: String(row.customer ?? ''),
    customerName: expandedName(row, 'customer', row.customer_name),
    date: datePart(row.date),
    qty: num(row.qty),
    note: String(row.note ?? ''),
  }
}

function mapStockAdjustment(row: PBRecord): StockAdjustmentRecord {
  return {
    id: row.id,
    itemId: String(row.item ?? ''),
    itemName: expandedName(row, 'item', row.item_name),
    customerId: String(row.customer ?? ''),
    customerName: expandedName(row, 'customer', row.customer_name),
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

function rowMatchesCustomer(row: PBRecord, customerId: string, customerName: string) {
  const relation = String(row.customer ?? '')
  if (relation) return relation === customerId
  return nameKey(row.customer_name) === nameKey(customerName)
}

function findGeneralCustomer(customers: StockCustomerOption[]) {
  return customers.find((row) => nameKey(row.customerName) === nameKey(GENERAL_CUSTOMER_NAME) || nameKey(row.companyName) === nameKey(GENERAL_CUSTOMER_NAME))
}

function physicalBucketExists(data: StockData, item: ItemRecord, customer: StockCustomerOption) {
  return (
    data.openings.some((row) => rowMatchesItem(row, item.id, item.name) && rowMatchesCustomer(row, customer.id, customer.customerName)) ||
    data.stockInRows.some((row) => rowMatchesItem(row, item.id, item.name) && rowMatchesCustomer(row, customer.id, customer.customerName)) ||
    data.adjustmentRows.some((row) => rowMatchesItem(row, item.id, item.name) && rowMatchesCustomer(row, customer.id, customer.customerName))
  )
}

function billItemStockCustomer(data: StockData, row: PBRecord, bill: PBRecord) {
  const item = data.items.find((entry) => rowMatchesItem(row, entry.id, entry.name))
  if (!item) return null

  const billCustomer = data.customers.find((entry) => entry.id === String(bill.customer ?? ''))
  if (billCustomer && physicalBucketExists(data, item, billCustomer)) return billCustomer
  return findGeneralCustomer(data.customers) ?? billCustomer ?? null
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

export async function loadStockCustomers(): Promise<StockCustomerOption[]> {
  const records = await pb.collection('customers').getFullList({ sort: 'company_name,name' })
  return (records as PBRecord[]).map(mapCustomer)
}

export async function ensureGeneralCustomer(): Promise<StockCustomerOption> {
  const existing = await pb
    .collection('customers')
    .getFirstListItem('name = "General" || company_name = "General"')
    .catch(() => null)
  const payload = {
    company_name: GENERAL_CUSTOMER_NAME,
    name: GENERAL_CUSTOMER_NAME,
    active: true,
    opening_balance: 0,
    opening_balance_date: '',
    phone: '',
    gstin: '',
    address: '',
    credit_limit: 0,
    note: 'Regular Stock',
  }
  if (existing) {
    const updated = await pb.collection('customers').update(existing.id, payload)
    return mapCustomer(updated as PBRecord)
  }
  const created = await pb.collection('customers').create(payload)
  return mapCustomer(created as PBRecord)
}

export async function loadStockOpenings(): Promise<StockOpeningRecord[]> {
  const records = await pb.collection('stock_openings').getFullList({ sort: 'item_name,customer_name', expand: 'item,customer' })
  return (records as PBRecord[]).map(mapStockOpening)
}

export async function saveStockOpening(payload: { itemId: string; itemName: string; customerId: string; customerName: string; date: string; qty: number; note: string }) {
  await runDataOperation('save-stock-opening', async () => {
    await assertGasStockItem(payload.itemId)
    const existing = await pb
      .collection('stock_openings')
      .getFirstListItem(`item = "${payload.itemId}" && customer = "${payload.customerId}"`)
      .catch(() => null)
    const writePayload = {
      item: payload.itemId,
      item_name: payload.itemName.trim(),
      customer: payload.customerId,
      customer_name: payload.customerName.trim(),
      date: payload.date,
      qty: payload.qty,
      note: payload.note.trim(),
    }
    if (existing) await pb.collection('stock_openings').update(existing.id, writePayload)
    else await pb.collection('stock_openings').create(writePayload)
  })
}

export async function loadStockIn(): Promise<StockInRecord[]> {
  const records = await pb.collection('stock_in').getFullList({ sort: '-date', expand: 'item,customer' })
  return (records as PBRecord[]).map(mapStockIn)
}

export async function saveStockIn(payload: { itemId: string; itemName: string; customerId: string; customerName: string; date: string; qty: number; note: string }) {
  await runDataOperation('save-stock-in', async () => {
    await assertGasStockItem(payload.itemId)
    await pb.collection('stock_in').create({
      item: payload.itemId,
      item_name: payload.itemName.trim(),
      customer: payload.customerId,
      customer_name: payload.customerName.trim(),
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

export async function updateStockIn(id: string, payload: { itemId: string; itemName: string; customerId: string; customerName: string; date: string; qty: number; note: string }) {
  await runDataOperation('update-stock-in', async () => {
    await assertGasStockItem(payload.itemId)
    await pb.collection('stock_in').update(id, {
      item: payload.itemId,
      item_name: payload.itemName.trim(),
      customer: payload.customerId,
      customer_name: payload.customerName.trim(),
      date: payload.date,
      qty: payload.qty,
      note: payload.note.trim(),
    })
  })
}

export async function loadStockAdjustments(): Promise<StockAdjustmentRecord[]> {
  const records = await pb.collection('stock_adjustments').getFullList({ sort: '-date', expand: 'item,customer' })
  return (records as PBRecord[]).map(mapStockAdjustment)
}

export async function saveStockAdjustment(payload: { itemId: string; itemName: string; customerId: string; customerName: string; date: string; qty: number; note: string }) {
  await runDataOperation('save-stock-adjustment', async () => {
    await assertGasStockItem(payload.itemId)
    await pb.collection('stock_adjustments').create({
      item: payload.itemId,
      item_name: payload.itemName.trim(),
      customer: payload.customerId,
      customer_name: payload.customerName.trim(),
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

type StockData = {
  items: ItemRecord[]
  customers: StockCustomerOption[]
  openings: PBRecord[]
  stockInRows: PBRecord[]
  adjustmentRows: PBRecord[]
  billItemRows: PBRecord[]
  billById: Map<string, PBRecord>
}

async function loadStockData(): Promise<StockData> {
  const [items, customers, openingsRaw, stockInRaw, adjustmentsRaw, billItemsRaw, billsRaw] = await Promise.all([
    loadItems(),
    loadStockCustomers(),
    pb.collection('stock_openings').getFullList(),
    pb.collection('stock_in').getFullList(),
    pb.collection('stock_adjustments').getFullList(),
    pb.collection('bill_items').getFullList(),
    pb.collection('bills').getFullList(),
  ])
  return {
    items: items.filter(isGasStockItem),
    customers,
    openings: openingsRaw as PBRecord[],
    stockInRows: stockInRaw as PBRecord[],
    adjustmentRows: adjustmentsRaw as PBRecord[],
    billItemRows: billItemsRaw as PBRecord[],
    billById: new Map((billsRaw as PBRecord[]).map((bill) => [bill.id, bill])),
  }
}

function collectBucketKeys(data: StockData) {
  const keys = new Set<string>()
  for (const row of data.openings) if (row.item && row.customer) keys.add(bucketKey(String(row.item), String(row.customer)))
  for (const row of data.stockInRows) if (row.item && row.customer) keys.add(bucketKey(String(row.item), String(row.customer)))
  for (const row of data.adjustmentRows) if (row.item && row.customer) keys.add(bucketKey(String(row.item), String(row.customer)))
  for (const row of data.billItemRows) {
    const bill = data.billById.get(String(row.bill ?? ''))
    if (!bill) continue
    const item = data.items.find((entry) => rowMatchesItem(row, entry.id, entry.name))
    const stockCustomer = billItemStockCustomer(data, row, bill)
    if (item && stockCustomer) keys.add(bucketKey(item.id, stockCustomer.id))
  }
  return keys
}

function bucketContext(data: StockData, key: string) {
  const [itemId, customerId] = key.split('::')
  const item = data.items.find((row) => row.id === itemId)
  const customer = data.customers.find((row) => row.id === customerId)
  if (!item || !customer) return null
  const opening = data.openings.find((row) => rowMatchesItem(row, item.id, item.name) && rowMatchesCustomer(row, customer.id, customer.customerName))
  const openingDate = datePart(opening?.date) || DEFAULT_STOCK_START_DATE
  const openingStock = opening ? num(opening.qty) : 0
  return { item, customer, opening, openingDate, openingStock }
}

export async function loadCurrentStock(): Promise<CurrentStockRecord[]> {
  const data = await loadStockData()
  const monthKey = currentMonthKey()
  const keys = collectBucketKeys(data)

  return Array.from(keys)
    .map((key) => {
      const context = bucketContext(data, key)
      if (!context) return null
      const { item, customer, openingDate, openingStock } = context
      const totalIn = data.stockInRows
        .filter((row) => rowMatchesItem(row, item.id, item.name) && rowMatchesCustomer(row, customer.id, customer.customerName) && isOnOrAfterOpening(datePart(row.date), openingDate))
        .reduce((sum, row) => sum + num(row.qty), 0)
      const stockInThisMonth = data.stockInRows
        .filter((row) => rowMatchesItem(row, item.id, item.name) && rowMatchesCustomer(row, customer.id, customer.customerName) && isOnOrAfterOpening(datePart(row.date), openingDate) && datePart(row.date).slice(0, 7) === monthKey)
        .reduce((sum, row) => sum + num(row.qty), 0)
      const totalAdjustment = data.adjustmentRows
        .filter((row) => rowMatchesItem(row, item.id, item.name) && rowMatchesCustomer(row, customer.id, customer.customerName) && isOnOrAfterOpening(datePart(row.date), openingDate))
        .reduce((sum, row) => sum + num(row.qty), 0)
      const adjustmentThisMonth = data.adjustmentRows
        .filter((row) => rowMatchesItem(row, item.id, item.name) && rowMatchesCustomer(row, customer.id, customer.customerName) && isOnOrAfterOpening(datePart(row.date), openingDate) && datePart(row.date).slice(0, 7) === monthKey)
        .reduce((sum, row) => sum + num(row.qty), 0)

      let totalOut = 0
      let soldThisMonth = 0
      for (const row of data.billItemRows) {
        if (!rowMatchesItem(row, item.id, item.name)) continue
        const bill = data.billById.get(String(row.bill ?? ''))
        if (!bill || billItemStockCustomer(data, row, bill)?.id !== customer.id) continue
        const billDate = datePart(bill.date)
        if (!isOnOrAfterOpening(billDate, openingDate)) continue
        const outQty = billItemOutQty(row, item.type, item.bagWeight)
        totalOut += outQty
        if (billDate.slice(0, 7) === monthKey) soldThisMonth += outQty
      }

      return {
        id: key,
        itemId: item.id,
        itemName: item.name,
        customerId: customer.id,
        customerName: customer.name,
        name: item.name,
        type: item.type,
        unit: item.unit,
        bagWeight: item.bagWeight,
        openingStock,
        openingStockDate: openingDate,
        totalIn,
        totalAdjustment,
        totalOut,
        currentStock: openingStock + totalIn + totalAdjustment - totalOut,
        stockInThisMonth,
        adjustmentThisMonth,
        soldThisMonth,
      }
    })
    .filter((row): row is CurrentStockRecord => row !== null && (row.openingStock !== 0 || row.totalIn !== 0 || row.totalAdjustment !== 0 || row.totalOut !== 0))
    .sort((a, b) => a.itemName.localeCompare(b.itemName) || a.customerName.localeCompare(b.customerName))
}

export async function loadStockLedger(itemId: string, customerId: string): Promise<StockLedgerRow[]> {
  if (!itemId || !customerId) return []
  const data = await loadStockData()
  const context = bucketContext(data, bucketKey(itemId, customerId))
  if (!context) return []
  const { item, customer, opening, openingDate, openingStock } = context

  const movements: Array<Omit<StockLedgerRow, 'balance'>> = [
    {
      id: `opening-${item.id}-${customer.id}`,
      date: openingDate,
      itemId: item.id,
      itemName: item.name,
      customerId: customer.id,
      customerName: customer.name,
      type: 'Opening',
      inQty: openingStock,
      outQty: 0,
      note: String(opening?.note ?? '') || (openingDate ? `Opening stock as on ${openingDate}` : 'Opening stock'),
    },
  ]

  for (const row of data.stockInRows) {
    if (!rowMatchesItem(row, item.id, item.name) || !rowMatchesCustomer(row, customer.id, customer.customerName)) continue
    if (!isOnOrAfterOpening(datePart(row.date), openingDate)) continue
    movements.push({
      id: `in-${row.id}`,
      date: datePart(row.date),
      itemId: item.id,
      itemName: item.name,
      customerId: customer.id,
      customerName: customer.name,
      type: 'Stock In',
      inQty: num(row.qty),
      outQty: 0,
      note: String(row.note ?? ''),
    })
  }

  for (const row of data.adjustmentRows) {
    if (!rowMatchesItem(row, item.id, item.name) || !rowMatchesCustomer(row, customer.id, customer.customerName)) continue
    if (!isOnOrAfterOpening(datePart(row.date), openingDate)) continue
    const qty = num(row.qty)
    movements.push({
      id: `adj-${row.id}`,
      date: datePart(row.date),
      itemId: item.id,
      itemName: item.name,
      customerId: customer.id,
      customerName: customer.name,
      type: 'Adjustment',
      inQty: qty > 0 ? qty : 0,
      outQty: qty < 0 ? Math.abs(qty) : 0,
      note: String(row.note ?? ''),
    })
  }

  for (const row of data.billItemRows) {
    if (!rowMatchesItem(row, item.id, item.name)) continue
    const bill = data.billById.get(String(row.bill ?? ''))
    if (!bill || billItemStockCustomer(data, row, bill)?.id !== customer.id) continue
    const billDate = datePart(bill.date)
    if (!isOnOrAfterOpening(billDate, openingDate)) continue
    const billCustomer = data.customers.find((entry) => entry.id === String(bill.customer ?? ''))
    const buyerName = billCustomer?.name || String(bill.customer_name ?? '').trim()
    const noteSuffix = buyerName && buyerName !== customer.name ? ` - ${buyerName}` : ''
    movements.push({
      id: `sold-${row.id}`,
      date: billDate,
      itemId: item.id,
      itemName: item.name,
      customerId: customer.id,
      customerName: customer.name,
      type: 'Sold',
      inQty: 0,
      outQty: billItemOutQty(row, item.type, item.bagWeight),
      note: `Bill ${num(bill.book_no)}/${num(bill.bill_no)}${noteSuffix}`,
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
  const data = await loadStockData()
  const keys = collectBucketKeys(data)

  return Array.from(keys)
    .map((key) => {
      const context = bucketContext(data, key)
      if (!context) return null
      const { item, customer, openingDate, openingStock } = context
      const stockInRows = data.stockInRows.filter((row) => rowMatchesItem(row, item.id, item.name) && rowMatchesCustomer(row, customer.id, customer.customerName))
      const adjustmentRows = data.adjustmentRows.filter((row) => rowMatchesItem(row, item.id, item.name) && rowMatchesCustomer(row, customer.id, customer.customerName))
      const billItemRows = data.billItemRows.filter((row) => {
        if (!rowMatchesItem(row, item.id, item.name)) return false
        const bill = data.billById.get(String(row.bill ?? ''))
        return Boolean(bill && billItemStockCustomer(data, row, bill)?.id === customer.id)
      })

      const baseline = !openingDate || openingDate <= end ? openingStock : 0
      const priorIn = stockInRows
        .filter((row) => isOnOrAfterOpening(datePart(row.date), openingDate) && isBefore(datePart(row.date), start))
        .reduce((sum, row) => sum + num(row.qty), 0)
      const priorAdjustment = adjustmentRows
        .filter((row) => isOnOrAfterOpening(datePart(row.date), openingDate) && isBefore(datePart(row.date), start))
        .reduce((sum, row) => sum + num(row.qty), 0)
      const priorSold = billItemRows
        .filter((row) => {
          const billDate = datePart(data.billById.get(String(row.bill ?? ''))?.date)
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
          const billDate = datePart(data.billById.get(String(row.bill ?? ''))?.date)
          return isOnOrAfterOpening(billDate, openingDate) && isInRange(billDate, start, end)
        })
        .reduce((sum, row) => sum + billItemOutQty(row, item.type, item.bagWeight), 0)

      return {
        id: key,
        itemId: item.id,
        itemName: item.name,
        customerId: customer.id,
        customerName: customer.name,
        name: item.name,
        type: item.type,
        unit: item.unit,
        bagWeight: item.bagWeight,
        opening,
        stockIn,
        sold,
        adjustment,
        closing: opening + stockIn + adjustment - sold,
      }
    })
    .filter((row): row is MonthlyStockReportRow => row !== null && (row.opening !== 0 || row.stockIn !== 0 || row.sold !== 0 || row.adjustment !== 0 || row.closing !== 0))
    .sort((a, b) => a.itemName.localeCompare(b.itemName) || a.customerName.localeCompare(b.customerName))
}

async function assertGasStockItem(itemId: string) {
  const items = await loadItems()
  const item = items.find((row) => row.id === itemId)
  if (!item || !isGasStockItem(item)) throw new Error('Stock tracking is only enabled for gas part items.')
}
