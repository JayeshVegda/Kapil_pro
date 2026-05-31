import PocketBase from 'pocketbase'
import { env } from './env.js'
import type { Customer, Item, ParsedPaymentCommand, ParsedStockInCommand } from './commands.js'

type PBRecord = Record<string, unknown> & { id: string }

export type BillSummary = {
  id: string
  ref: string
  date: string
  bookNo: number
  billNo: number
  customerId: string
  customerName: string
  status: string
  total: number
  transport: number
  gstRate: number
  gstAmount: number
  lrNo: string
  items: Array<{ name: string; qty: number; rate: number; amount: number }>
}

export type BillPrintData = {
  bookNo: number
  billNo: number
  date: string
  customerName: string
  mkt: number
  itemRows: Array<{ itemName: string; qty: number; rate: number; amount: number; bags: number }>
  gstAmount: number
  transport: number
  gstRate: number
  currentBillTotal: number
  previousBalance: number
  previousBillDate: string
  periodCreditEntries: Array<{ date: string; amount: number }>
  subtotal: number
  finalTotal: number
  totalQty: number
  totalBags: number
  lrList: string[]
}

export type PaymentSummary = {
  id: string
  date: string
  customerId: string
  customerName: string
  amount: number
  mode: string
  note: string
}

export type StockInSummary = {
  id: string
  date: string
  itemId: string
  itemName: string
  customerId: string
  customerName: string
  qty: number
  note: string
}

export type StockBucketSummary = {
  itemId: string
  itemName: string
  customerId: string
  customerName: string
  unit: string
  bagWeight: number
  opening: number
  stockIn: number
  adjustment: number
  sold: number
  current: number
  monthIn: number
  monthSold: number
}

export type RateSummary = {
  date: string
  vilaity: number
  honeyGulf: number
  honeyEurope: number
  delhiLocal: number
  lme3m: number
  previousVilaity: number
}

const pb = new PocketBase(env.pocketBaseUrl)
pb.autoCancellation(false)

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const text = (value: unknown) => String(value ?? '')
const datePart = (value: unknown) => text(value).slice(0, 10)
const key = (value: unknown) => text(value).trim().toLowerCase()

function escapeFilter(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function customerName(row: PBRecord) {
  const companyName = text(row.company_name).trim()
  const name = text(row.name).trim()
  if (companyName && name && companyName.toLowerCase() !== name.toLowerCase()) return `${companyName} (${name})`
  return companyName || name || row.id
}

function printCustomerName(row: PBRecord) {
  return text(row.company_name).trim() || text(row.name).trim() || row.id
}

function billRef(row: PBRecord) {
  return `${num(row.book_no)}/${num(row.bill_no)}`
}

function billTotal(items: Array<{ amount: number }>, transport: number, gstRate: number, gstAmount: number) {
  const itemTotal = items.reduce((sum, item) => sum + num(item.amount), 0)
  const gst = gstAmount > 0 ? gstAmount : (itemTotal * gstRate) / 100
  return itemTotal + transport + gst
}

function monthKey(date: string) {
  return date.slice(0, 7)
}

function isOnOrBeforeDay(date: string, cutoff: string) {
  return datePart(date) <= datePart(cutoff)
}

export async function connectPocketBase() {
  await pb.collection('_superusers').authWithPassword(env.pocketBaseEmail, env.pocketBasePassword)
}

export async function listCustomers(): Promise<Customer[]> {
  const records = await pb.collection('customers').getFullList({ sort: 'company_name,name' })
  return (records as PBRecord[]).map((row) => ({
    id: row.id,
    name: customerName(row),
    companyName: text(row.company_name),
    customerName: text(row.name),
    openingBalance: num(row.opening_balance),
  }))
}

export async function listItems(): Promise<Item[]> {
  const records = await pb.collection('items').getFullList({ sort: 'name' })
  return (records as PBRecord[]).map((row) => ({
    id: row.id,
    name: text(row.name),
    type: text(row.type),
    unit: text(row.unit),
    bagWeight: num(row.bag_weight) || 50,
    defaultRate: num(row.default_rate),
  }))
}

export async function getGeneralCustomer() {
  const row = (await pb
    .collection('customers')
    .getFirstListItem('name = "General" || company_name = "General"')) as PBRecord
  return {
    id: row.id,
    name: customerName(row),
    companyName: text(row.company_name),
    customerName: text(row.name),
    openingBalance: num(row.opening_balance),
  }
}

async function getBillItemsByBillIds(billIds: string[]) {
  if (billIds.length === 0) return new Map<string, PBRecord[]>()
  const filter = billIds.map((id) => `bill = "${escapeFilter(id)}"`).join(' || ')
  const records = (await pb.collection('bill_items').getFullList({ filter })) as PBRecord[]
  const byBill = new Map<string, PBRecord[]>()
  for (const row of records) {
    const billId = text(row.bill)
    byBill.set(billId, [...(byBill.get(billId) ?? []), row])
  }
  return byBill
}

function mapBill(row: PBRecord, itemRows: PBRecord[], customers: Map<string, Customer>): BillSummary {
  const items = itemRows.map((item) => ({
    name: text(item.item_name) || 'Item',
    qty: num(item.qty),
    rate: num(item.rate),
    amount: num(item.amount) || num(item.qty) * num(item.rate),
  }))
  const customerId = text(row.customer)
  const customerDisplay = customers.get(customerId)?.name || text(row.customer_name)
  const transport = num(row.transport)
  const gstRate = num(row.gst_rate)
  const gstAmount = num(row.gst_amount)
  return {
    id: row.id,
    ref: billRef(row),
    date: datePart(row.date),
    bookNo: num(row.book_no),
    billNo: num(row.bill_no),
    customerId,
    customerName: customerDisplay,
    status: text(row.status) || 'pending',
    total: billTotal(items, transport, gstRate, gstAmount),
    transport,
    gstRate,
    gstAmount,
    lrNo: text(row.lr_no),
    items,
  }
}

export async function searchBills(query: {
  ref?: string
  bookNo?: number
  customerId?: string
  date?: string
  limit?: number
}) {
  const filters: string[] = []
  if (query.ref) {
    const [book, bill] = query.ref.split('/').map((part) => Number(part))
    if (book > 0 && bill > 0) filters.push(`book_no = ${book} && bill_no = ${bill}`)
  }
  if (query.bookNo) filters.push(`book_no = ${query.bookNo}`)
  if (query.customerId) filters.push(`customer = "${escapeFilter(query.customerId)}"`)
  if (query.date) filters.push(`date >= "${query.date}" && date < "${nextIsoDate(query.date)}"`)
  const page = await pb.collection('bills').getList(1, query.limit ?? 10, {
    filter: filters.join(' && '),
    sort: '-date,-bill_no',
  })
  const bills = (page.items ?? []) as PBRecord[]
  const [itemsByBill, customers] = await Promise.all([
    getBillItemsByBillIds(bills.map((row) => row.id)),
    listCustomers(),
  ])
  const customerMap = new Map(customers.map((row) => [row.id, row]))
  return bills.map((bill) => mapBill(bill, itemsByBill.get(bill.id) ?? [], customerMap))
}

export async function loadBillPrintData(billId: string): Promise<BillPrintData> {
  const selectedBill = (await pb.collection('bills').getOne(billId)) as PBRecord
  const selectedDate = datePart(selectedBill.date)
  const customerId = text(selectedBill.customer)
  const [customer, customerBills, payments] = await Promise.all([
    pb.collection('customers').getOne(customerId) as Promise<PBRecord>,
    pb.collection('bills').getFullList({
      filter: `customer = "${escapeFilter(customerId)}" && date < "${nextIsoDate(selectedDate)}"`,
      sort: 'date,bill_no',
    }) as Promise<PBRecord[]>,
    pb.collection('payments').getFullList({
      filter: `customer = "${escapeFilter(customerId)}"`,
      sort: 'date,created',
    }) as Promise<PBRecord[]>,
  ])
  const itemsByBill = await getBillItemsByBillIds(customerBills.map((bill) => bill.id))
  const allCustomerBills = customerBills
    .filter((bill) => isOnOrBeforeDay(datePart(bill.date), selectedDate))
    .sort((a, b) => datePart(a.date).localeCompare(datePart(b.date)) || num(a.bill_no) - num(b.bill_no))
  const currentIdx = allCustomerBills.findIndex((bill) => bill.id === selectedBill.id)
  if (currentIdx < 0) throw new Error(`Bill ${billId} not found in customer bill sequence`)

  const itemRows = (itemsByBill.get(selectedBill.id) ?? []).map((row) => ({
    itemName: text(row.item_name),
    qty: num(row.qty),
    rate: num(row.rate),
    amount: num(row.amount) || num(row.qty) * num(row.rate),
    bags: num(row.bags),
  }))
  const itemBaseTotal = itemRows.reduce((sum, row) => sum + row.amount, 0)
  const gstRate = num(selectedBill.gst_rate)
  const gstAmount = num(selectedBill.gst_amount) > 0 ? num(selectedBill.gst_amount) : (itemBaseTotal * gstRate) / 100
  const transport = num(selectedBill.transport)
  const currentBillTotal = itemBaseTotal + gstAmount + transport

  let previousBalance = num(customer.opening_balance)
  for (let i = 0; i < currentIdx; i += 1) {
    const bill = allCustomerBills[i]
    const base = (itemsByBill.get(bill.id) ?? []).reduce((sum, row) => sum + (num(row.amount) || num(row.qty) * num(row.rate)), 0)
    previousBalance += billTotal([{ amount: base }], num(bill.transport), num(bill.gst_rate), num(bill.gst_amount))
  }

  const previousBillDate = currentIdx > 0 ? datePart(allCustomerBills[currentIdx - 1].date) : 'Opening'
  const paidBeforePrevious =
    currentIdx > 0
      ? payments
          .filter((entry) => isOnOrBeforeDay(datePart(entry.date), previousBillDate))
          .reduce((sum, entry) => sum + num(entry.amount), 0)
      : 0
  previousBalance -= paidBeforePrevious

  const previousCutoffDate = currentIdx > 0 ? previousBillDate : ''
  const periodCreditEntries = payments
    .filter((entry) => {
      const paymentDate = datePart(entry.date)
      if (!isOnOrBeforeDay(paymentDate, selectedDate)) return false
      if (!previousCutoffDate) return true
      return !isOnOrBeforeDay(paymentDate, previousCutoffDate)
    })
    .sort((a, b) => datePart(a.date).localeCompare(datePart(b.date)))
    .map((entry) => ({ date: datePart(entry.date), amount: num(entry.amount) }))

  const periodCredits = periodCreditEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const subtotal = previousBalance + currentBillTotal
  const finalTotal = subtotal - periodCredits

  return {
    bookNo: num(selectedBill.book_no),
    billNo: num(selectedBill.bill_no),
    date: selectedDate,
    customerName: printCustomerName(customer),
    mkt: num(selectedBill.mkt),
    itemRows,
    gstAmount,
    transport,
    gstRate,
    currentBillTotal,
    previousBalance,
    previousBillDate,
    periodCreditEntries,
    subtotal,
    finalTotal,
    totalQty: itemRows.reduce((sum, row) => sum + row.qty, 0),
    totalBags: itemRows.reduce((sum, row) => sum + row.bags, 0),
    lrList: text(selectedBill.lr_no)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  }
}

export async function listPaymentsForDate(date: string): Promise<PaymentSummary[]> {
  const rows = (await pb.collection('payments').getFullList({
    filter: `date >= "${date}" && date < "${nextIsoDate(date)}"`,
    sort: 'date,created',
  })) as PBRecord[]
  return rows.map((row) => ({
    id: row.id,
    date: datePart(row.date),
    customerId: text(row.customer),
    customerName: text(row.customer_name),
    amount: num(row.amount),
    mode: text(row.mode),
    note: text(row.note),
  }))
}

export async function getRecentPaymentsForCustomer(customerId: string, limit = 5): Promise<PaymentSummary[]> {
  const page = await pb.collection('payments').getList(1, limit, {
    filter: `customer = "${escapeFilter(customerId)}"`,
    sort: '-date,-created',
  })
  const rows = (page.items ?? []) as PBRecord[]
  return rows.map((row) => ({
    id: row.id,
    date: datePart(row.date),
    customerId: text(row.customer),
    customerName: text(row.customer_name),
    amount: num(row.amount),
    mode: text(row.mode),
    note: text(row.note),
  }))
}

export async function listStockInForDate(date: string): Promise<StockInSummary[]> {
  const rows = (await pb.collection('stock_in').getFullList({
    filter: `date >= "${date}" && date < "${nextIsoDate(date)}"`,
    sort: 'date,created',
  })) as PBRecord[]
  return rows.map((row) => ({
    id: row.id,
    date: datePart(row.date),
    itemId: text(row.item),
    itemName: text(row.item_name),
    customerId: text(row.customer),
    customerName: text(row.customer_name),
    qty: num(row.qty),
    note: text(row.note),
  }))
}

export async function savePayment(command: ParsedPaymentCommand) {
  const created = (await pb.collection('payments').create({
    customer: command.customer.id,
    customer_name: command.customer.name,
    date: command.date,
    amount: command.amount,
    mode: command.mode,
    note: command.note,
  })) as PBRecord
  await ensurePaymentPersisted(created.id)
  await recalculateBillStatusesForCustomer(command.customer.id)
  return created.id
}

async function ensurePaymentPersisted(paymentId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await pb.collection('payments').getOne(paymentId)
      return
    } catch (error) {
      const status = num((error as { status?: unknown })?.status)
      if (status > 0 && status !== 404) throw error
      await sleep(200 * (attempt + 1))
    }
  }
}

export async function saveStockIn(command: ParsedStockInCommand) {
  const general = await getGeneralCustomer()
  const created = (await pb.collection('stock_in').create({
    item: command.item.id,
    item_name: command.item.name,
    customer: general.id,
    customer_name: general.name,
    date: command.date,
    qty: command.qty,
    note: command.note,
  })) as PBRecord
  return { id: created.id, customer: general }
}

export async function loadCustomerBalance(customerId: string, asOfDate = '9999-12-31') {
  const [customer, bills, billItems, payments] = await Promise.all([
    pb.collection('customers').getOne(customerId) as Promise<PBRecord>,
    pb.collection('bills').getFullList({ filter: `customer = "${escapeFilter(customerId)}"` }) as Promise<PBRecord[]>,
    pb.collection('bill_items').getFullList({ filter: `bill.customer = "${escapeFilter(customerId)}"` }) as Promise<PBRecord[]>,
    pb.collection('payments').getFullList({ filter: `customer = "${escapeFilter(customerId)}"` }) as Promise<PBRecord[]>,
  ])
  const billIds = new Set(bills.map((bill) => bill.id))
  const itemSumByBill = new Map<string, number>()
  for (const item of billItems) {
    const billId = text(item.bill)
    if (billIds.has(billId)) itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(item.amount))
  }
  const billed = bills
    .filter((bill) => datePart(bill.date) <= asOfDate)
    .reduce((sum, bill) => sum + billTotal([{ amount: itemSumByBill.get(bill.id) ?? 0 }], num(bill.transport), num(bill.gst_rate), num(bill.gst_amount)), 0)
  const paid = payments
    .filter((payment) => datePart(payment.date) <= asOfDate)
    .reduce((sum, payment) => sum + num(payment.amount), 0)
  const balance = num(customer.opening_balance) + billed - paid
  return { customerName: customerName(customer), opening: num(customer.opening_balance), billed, paid, balance }
}

export async function loadLatestRate(date?: string): Promise<RateSummary | null> {
  const filter = date ? `date <= "${date}" && vilaity > 0` : 'vilaity > 0'
  const page = await pb.collection('brass_rates').getList(1, 1, { filter, sort: '-date' }).catch(() => ({ items: [] as PBRecord[] }))
  const row = (page.items as PBRecord[])[0]
  if (!row) return null
  const currentDate = datePart(row.date)
  const previous = await pb.collection('brass_rates').getList(1, 1, {
    filter: `date < "${currentDate}" && vilaity > 0`,
    sort: '-date',
  }).catch(() => ({ items: [] as PBRecord[] }))
  const previousRow = (previous.items as PBRecord[])[0]
  return {
    date: currentDate,
    vilaity: num(row.vilaity),
    honeyGulf: num(row.honey_gulf),
    honeyEurope: num(row.honey_europe),
    delhiLocal: num(row.delhi_local),
    lme3m: num(row.lme_3m),
    previousVilaity: num(previousRow?.vilaity),
  }
}

export async function loadStockBuckets() {
  const [items, customers, openings, stockIn, adjustments, bills, billItems] = await Promise.all([
    listItems(),
    listCustomers(),
    pb.collection('stock_openings').getFullList() as Promise<PBRecord[]>,
    pb.collection('stock_in').getFullList() as Promise<PBRecord[]>,
    pb.collection('stock_adjustments').getFullList() as Promise<PBRecord[]>,
    pb.collection('bills').getFullList() as Promise<PBRecord[]>,
    pb.collection('bill_items').getFullList() as Promise<PBRecord[]>,
  ])
  const itemMap = new Map(items.map((item) => [item.id, item]))
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]))
  const generalCustomer = customers.find((customer) => key(customer.customerName) === 'general' || key(customer.companyName) === 'general')
  const physicalBucketExists = (itemId: string, customerId: string) =>
    [...openings, ...stockIn, ...adjustments].some((row) => text(row.item) === itemId && text(row.customer) === customerId)
  const stockCustomerForBillItem = (bill: PBRecord, itemId: string) => {
    const billCustomerId = text(bill.customer)
    if (billCustomerId && physicalBucketExists(itemId, billCustomerId)) return billCustomerId
    return generalCustomer?.id || billCustomerId
  }
  const keys = new Set<string>()
  for (const row of [...openings, ...stockIn, ...adjustments]) {
    if (row.item && row.customer) keys.add(`${text(row.item)}::${text(row.customer)}`)
  }
  for (const bill of bills) {
    for (const item of billItems.filter((row) => text(row.bill) === bill.id)) {
      const itemId = text(item.item)
      const customerId = stockCustomerForBillItem(bill, itemId)
      if (itemId && customerId) keys.add(`${itemId}::${customerId}`)
    }
  }
  const todayMonth = monthKey(new Date().toISOString().slice(0, 10))
  return [...keys].map((bucket): StockBucketSummary | null => {
    const [itemId, customerId] = bucket.split('::')
    const item = itemMap.get(itemId)
    const customer = customerMap.get(customerId)
    if (!item || !customer) return null
    const opening = openings.find((row) => text(row.item) === itemId && text(row.customer) === customerId)
    const openingDate = datePart(opening?.date) || '0000-00-00'
    const openingQty = num(opening?.qty)
    const inRows = stockIn.filter((row) => text(row.item) === itemId && text(row.customer) === customerId && datePart(row.date) >= openingDate)
    const adjustmentRows = adjustments.filter((row) => text(row.item) === itemId && text(row.customer) === customerId && datePart(row.date) >= openingDate)
    const soldRows = billItems.filter((row) => {
      const bill = bills.find((candidate) => candidate.id === text(row.bill))
      return text(row.item) === itemId && bill && stockCustomerForBillItem(bill, itemId) === customerId && datePart(bill.date) >= openingDate
    })
    const stockInQty = inRows.reduce((sum, row) => sum + num(row.qty), 0)
    const adjustmentQty = adjustmentRows.reduce((sum, row) => sum + num(row.qty), 0)
    const soldQty = soldRows.reduce((sum, row) => sum + num(row.qty), 0)
    const monthInQty = inRows.filter((row) => monthKey(datePart(row.date)) === todayMonth).reduce((sum, row) => sum + num(row.qty), 0)
    const monthSoldQty = soldRows
      .filter((row) => {
        const bill = bills.find((candidate) => candidate.id === text(row.bill))
        return monthKey(datePart(bill?.date)) === todayMonth
      })
      .reduce((sum, row) => sum + num(row.qty), 0)
    return {
      itemId,
      itemName: item.name,
      customerId,
      customerName: customer.name,
      unit: item.unit || 'kg',
      bagWeight: item.bagWeight || 50,
      opening: openingQty,
      stockIn: stockInQty,
      adjustment: adjustmentQty,
      sold: soldQty,
      current: openingQty + stockInQty + adjustmentQty - soldQty,
      monthIn: monthInQty,
      monthSold: monthSoldQty,
    }
  }).filter((row): row is StockBucketSummary => row != null)
}

async function recalculateBillStatusesForCustomer(customerId: string) {
  const [customer, bills, billItems, payments] = await Promise.all([
    pb.collection('customers').getOne(customerId) as Promise<PBRecord>,
    pb.collection('bills').getFullList({ filter: `customer = "${escapeFilter(customerId)}"`, sort: 'date,bill_no' }) as Promise<PBRecord[]>,
    pb.collection('bill_items').getFullList({ filter: `bill.customer = "${escapeFilter(customerId)}"` }) as Promise<PBRecord[]>,
    pb.collection('payments').getFullList({ filter: `customer = "${escapeFilter(customerId)}"`, sort: 'date' }) as Promise<PBRecord[]>,
  ])
  if (bills.length === 0) return
  const billIds = new Set(bills.map((bill) => bill.id))
  const itemSumByBill = new Map<string, number>()
  for (const row of billItems) {
    const billId = text(row.bill)
    if (billIds.has(billId)) itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(row.amount))
  }
  const statuses = computeBillStatuses({
    openingBalance: num(customer.opening_balance),
    bills: bills.map((bill) => ({
      id: bill.id,
      businessDate: datePart(bill.date),
      createdAt: text(bill.created),
      amount: billTotal([{ amount: itemSumByBill.get(bill.id) ?? 0 }], num(bill.transport), num(bill.gst_rate), num(bill.gst_amount)),
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      businessDate: datePart(payment.date),
      createdAt: text(payment.created),
      amount: num(payment.amount),
    })),
  })
  await Promise.all(
    bills
      .map((bill) => ({ id: bill.id, current: text(bill.status).toLowerCase() || 'pending', next: statuses.get(bill.id) ?? 'pending' }))
      .filter((row) => row.current !== row.next)
      .map((row) => pb.collection('bills').update(row.id, { status: row.next })),
  )
}

function computeBillStatuses(params: {
  openingBalance: number
  bills: Array<{ id: string; businessDate: string; createdAt: string; amount: number }>
  payments: Array<{ id: string; businessDate: string; createdAt: string; amount: number }>
}) {
  const compare = <T extends { id: string; businessDate: string; createdAt: string }>(a: T, b: T) => {
    const dateDiff = a.businessDate.localeCompare(b.businessDate)
    if (dateDiff !== 0) return dateDiff
    const createdDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    if (Number.isFinite(createdDiff) && createdDiff !== 0) return createdDiff
    return a.id.localeCompare(b.id)
  }
  let remainingPayments = params.payments.sort(compare).reduce((sum, payment) => sum + payment.amount, 0)
  remainingPayments = Math.max(0, remainingPayments - Math.max(0, params.openingBalance))
  const statuses = new Map<string, 'pending' | 'partial' | 'paid'>()
  for (const bill of params.bills.sort(compare)) {
    const amount = Math.max(0, bill.amount)
    const applied = Math.min(amount, remainingPayments)
    remainingPayments -= applied
    statuses.set(bill.id, applied <= 0 ? 'pending' : applied < amount ? 'partial' : 'paid')
  }
  return statuses
}

function nextIsoDate(date: string) {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

export function recordKey(value: unknown) {
  return key(value)
}
