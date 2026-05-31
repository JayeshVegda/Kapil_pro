import { pb } from '@/data/pocketbase'
import { loadCurrentStock, type CurrentStockRecord } from '@/data/stock'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInQty, formatInrInteger } from '@/lib/inr-format'
import { getRecentQuickSearchResults } from '@/lib/recent-items'
import { matchesAnyRankedQuery } from '@/lib/search'

type PBRecord = Record<string, unknown> & { id: string }

export type QuickSearchResult = {
  id: string
  kind: 'Customer' | 'Bill' | 'Payment' | 'Rate' | 'Stock'
  title: string
  subtitle: string
  previewTitle?: string
  previewLines?: Array<{ label: string; value: string }>
  actionLabel?: string
  customerId?: string
  billId?: string
  paymentId?: string
  stockItemId?: string
  stockCustomerId?: string
  isRecent?: boolean
  details?: {
    bill?: {
      billRef: string
      date: string
      customerName: string
      items: Array<{ name: string; qty: number; rate: number; amount: number }>
      total: number
      paidAmount: number
      pendingAmount: number
      lrNo: string
      transport: number
    }
    customer?: {
      name: string
      balance: number
      balanceLabel: 'Due' | 'Advance' | 'Clear'
      lastBills: Array<{ id: string; date: string; billRef: string; amount: number }>
      lastPayment?: { date: string; amount: number }
    }
    rate?: {
      date: string
      vilaity: number
      honeyEurope: number
      honeyGulf: number
      delhiLocal: number
      lme3m: number
      change?: number
    }
    stock?: {
      itemName: string
      customerName: string
      currentQty: number
      unit: string
      lastUpdatedDate: string
    }
  }
}

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)

const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
let customerCache: Array<{ id: string; name: string; rawName: string; companyName: string; openingBalance: number }> | null = null
let customerCacheAt = 0
let stockCache: CurrentStockRecord[] | null = null
let stockCacheAt = 0
let stockCachePromise: Promise<CurrentStockRecord[]> | null = null

function escapeFilterValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function billRef(row: PBRecord) {
  return `${num(row.book_no)}/${num(row.bill_no)}`
}

function dayOfMonth(dateIso: string) {
  return Number(datePart(dateIso).slice(8, 10))
}

function currentMonthDayRange(day: number, today = new Date()) {
  const todayIso = getLocalIsoDate(today)
  const dateIso = `${todayIso.slice(0, 8)}${String(day).padStart(2, '0')}`
  if (!isRealIsoDate(dateIso)) return null
  return { start: dateIso, end: nextIsoDate(dateIso) }
}

async function loadCustomersCached() {
  if (customerCache && Date.now() - customerCacheAt < 5 * 60_000) return customerCache
  const records = await pb.collection('customers').getFullList({ sort: 'company_name,name' })
  customerCache = (records as PBRecord[]).map((row) => ({
    id: row.id,
    name: formatCustomerDisplayName(row.company_name, row.name),
    rawName: String(row.name ?? ''),
    companyName: String(row.company_name ?? ''),
    openingBalance: num(row.opening_balance),
  }))
  customerCacheAt = Date.now()
  return customerCache
}

async function loadCurrentStockCached() {
  if (stockCache && Date.now() - stockCacheAt < 60_000) return stockCache
  if (stockCachePromise) return stockCachePromise
  stockCachePromise = loadCurrentStock()
    .then((rows) => {
      stockCache = rows
      stockCacheAt = Date.now()
      return rows
    })
    .finally(() => {
      stockCachePromise = null
    })
  return stockCachePromise
}

function nextIsoDate(dateIso: string) {
  const d = new Date(`${dateIso}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function normalizeYear(input: string, fallbackYear: number) {
  const parsed = Number(input)
  if (!Number.isFinite(parsed)) return fallbackYear
  return parsed < 100 ? 2000 + parsed : parsed
}

function isRealIsoDate(dateIso: string) {
  const parsed = new Date(`${dateIso}T00:00:00`)
  return !Number.isNaN(parsed.getTime()) && getLocalIsoDate(parsed) === dateIso
}

function parseRateQueryDate(query: string, today = new Date()): string {
  const trimmed = query.trim().toLowerCase().replace(/\s+/g, ' ')
  const match = /^(?:rate|rates|vilaity|vilaty|brass rate)\s+(.+)$/.exec(trimmed)
  if (!match) return ''

  const raw = match[1].trim()
  const todayIso = getLocalIsoDate(today)
  const fallbackYear = Number(todayIso.slice(0, 4))
  if (raw === 'today' || raw === '0') return todayIso
  if (raw === 'yesterday' || raw === 'yday' || raw === '-1') {
    const d = new Date(`${todayIso}T00:00:00`)
    d.setDate(d.getDate() - 1)
    return getLocalIsoDate(d)
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw)
  if (iso) {
    const dateIso = `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`
    return isRealIsoDate(dateIso) ? dateIso : ''
  }

  const numeric = /^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/.exec(raw)
  if (numeric) {
    const year = numeric[3] ? normalizeYear(numeric[3], fallbackYear) : fallbackYear
    const dateIso = `${year}-${String(Number(numeric[2])).padStart(2, '0')}-${String(Number(numeric[1])).padStart(2, '0')}`
    return isRealIsoDate(dateIso) ? dateIso : ''
  }

  const named = /^(\d{1,2})[-/ ]([a-z]{3,9})(?:[-/ ](\d{2,4}))?$/.exec(raw)
  if (named) {
    const monthIndex = monthNames.findIndex((name) => named[2].startsWith(name))
    if (monthIndex < 0) return ''
    const year = named[3] ? normalizeYear(named[3], fallbackYear) : fallbackYear
    const dateIso = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(Number(named[1])).padStart(2, '0')}`
    return isRealIsoDate(dateIso) ? dateIso : ''
  }

  return ''
}

async function loadRateQuickSearchResult(query: string): Promise<QuickSearchResult[]> {
  const rateDate = parseRateQueryDate(query)
  if (!rateDate) return []

  const start = rateDate
  const end = nextIsoDate(rateDate)
  const record = await pb.collection('brass_rates').getFirstListItem(`date >= "${start}" && date < "${end}"`).catch(() => null)
  if (!record) {
    return [{
      id: `rate-missing-${rateDate}`,
      kind: 'Rate',
      title: `No rate saved for ${formatFullDate(rateDate)}`,
      subtitle: 'Try another bulletin date, for example rate 23-may',
    }]
  }

  const previous = await pb.collection('brass_rates').getList(1, 1, {
    filter: `date < "${rateDate}" && vilaity > 0`,
    sort: '-date',
  }).catch(() => ({ items: [] }))

  const currentVilaity = num(record.vilaity)
  const previousVilaity = num(previous.items[0]?.vilaity)
  const change = currentVilaity > 0 && previousVilaity > 0 ? currentVilaity - previousVilaity : null
  const changeLabel =
    change == null
      ? ''
      : change > 0
        ? ` · +${formatInrInteger(change)} vs previous`
        : change < 0
          ? ` · -${formatInrInteger(Math.abs(change))} vs previous`
          : ' · stable vs previous'

  const details = [
    `Honey Gulf ${formatInrInteger(num(record.honey_gulf))}`,
    `Honey Europe ${formatInrInteger(num(record.honey_europe))}`,
    `Delhi Local ${formatInrInteger(num(record.delhi_local))}`,
    `LME 3M ${num(record.lme_3m) || '-'}`,
  ]

  return [{
    id: `rate-${record.id}`,
    kind: 'Rate',
    title: `Vilaity ${formatInrInteger(currentVilaity)}`,
    subtitle: `${formatFullDate(rateDate)}${changeLabel} · ${details.join(' · ')}`,
    previewTitle: `Market rate for ${formatFullDate(rateDate)}`,
    previewLines: [
      { label: 'Vilaity', value: formatInrInteger(currentVilaity) },
      { label: 'Previous', value: previousVilaity > 0 ? formatInrInteger(previousVilaity) : '-' },
      { label: 'Change', value: change == null ? '-' : `${change >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(change))}` },
      { label: 'Source', value: 'Saved brass rate' },
    ],
    actionLabel: 'Use in Bill',
    details: {
      rate: {
        date: rateDate,
        vilaity: currentVilaity,
        honeyEurope: num(record.honey_europe),
        honeyGulf: num(record.honey_gulf),
        delhiLocal: num(record.delhi_local),
        lme3m: num(record.lme_3m),
        change: change ?? undefined,
      },
    },
  }]
}

function parseRateDayQuery(query: string) {
  const match = /^(?:r|rate|rates)\s+(\d{1,2})$/.exec(query.trim().toLowerCase())
  if (!match) return null
  const day = Number(match[1])
  return day >= 1 && day <= 31 ? day : null
}

async function loadRateListResults(query: string): Promise<QuickSearchResult[]> {
  const trimmed = query.trim().toLowerCase()
  if (!['r', 'rate', 'rates'].includes(trimmed) && parseRateDayQuery(trimmed) == null) return []

  const day = parseRateDayQuery(trimmed)
  const page = await pb.collection('brass_rates').getList(1, day == null ? 30 : 20, { sort: '-date' }).catch(() => ({ items: [] as PBRecord[] }))
  return (page.items as PBRecord[])
    .filter((record) => day == null || dayOfMonth(String(record.date ?? '')) === day || String(dayOfMonth(String(record.date ?? ''))).includes(String(day)))
    .slice(0, 10)
    .map((record) => {
      const date = datePart(record.date)
      const vilaity = num(record.vilaity)
      return {
        id: `rate-${record.id}`,
        kind: 'Rate' as const,
        title: `Vilaity ${formatInrInteger(vilaity)}`,
        subtitle: `${formatFullDate(date)} · Honey Gulf ${formatInrInteger(num(record.honey_gulf))} · Honey Europe ${formatInrInteger(num(record.honey_europe))}`,
        previewTitle: `Market rate for ${formatFullDate(date)}`,
        actionLabel: 'Use in Bill',
        details: {
          rate: {
            date,
            vilaity,
            honeyEurope: num(record.honey_europe),
            honeyGulf: num(record.honey_gulf),
            delhiLocal: num(record.delhi_local),
            lme3m: num(record.lme_3m),
          },
        },
      }
    })
}

async function loadTodayRateResult(): Promise<QuickSearchResult[]> {
  const today = getLocalIsoDate()
  const result = await loadRateQuickSearchResult(`rate ${today}`)
  return result.map((row) => ({ ...row, subtitle: `Today · ${row.subtitle}` }))
}

async function loadBillItemsForBills(billIds: string[]) {
  if (billIds.length === 0) return new Map<string, PBRecord[]>()
  const filter = billIds.map((id) => `bill = "${escapeFilterValue(id)}"`).join(' || ')
  const rows = await pb.collection('bill_items').getFullList({ filter }).catch(() => [])
  const byBill = new Map<string, PBRecord[]>()
  for (const row of rows as PBRecord[]) {
    const billId = String(row.bill ?? '')
    byBill.set(billId, [...(byBill.get(billId) ?? []), row])
  }
  return byBill
}

async function loadPaymentsForCustomers(customerIds: string[]) {
  if (customerIds.length === 0) return [] as PBRecord[]
  const filter = customerIds.map((id) => `customer = "${escapeFilterValue(id)}"`).join(' || ')
  return (await pb.collection('payments').getFullList({ filter, sort: '-date' }).catch(() => [])) as PBRecord[]
}

function makeBillResult(row: PBRecord, customerName: string, items: PBRecord[]): QuickSearchResult {
  const billId = row.id
  const ref = billRef(row)
  const date = datePart(row.date)
  const billItems = items.map((item) => ({
    name: String(item.item_name ?? 'Item'),
    qty: num(item.qty),
    rate: num(item.rate),
    amount: num(item.amount) || num(item.qty) * num(item.rate),
  }))
  const itemBase = billItems.reduce((sum, item) => sum + item.amount, 0)
  const total = calculateBillTotalFromBase(itemBase, num(row.transport), num(row.gst_rate), num(row.gst_amount))
  const isPaid = String(row.status ?? '').toLowerCase() === 'paid'
  const paidAmount = isPaid ? total : 0
  const pendingAmount = isPaid ? 0 : total
  return {
    id: `bill-${billId}`,
    kind: 'Bill',
    title: `Bill ${ref}`,
    subtitle: `${formatFullDate(date)} · ${customerName}`,
    previewTitle: `Bill ${ref}`,
    previewLines: [
      { label: 'Date', value: formatFullDate(date) },
      { label: 'Party', value: customerName },
      { label: 'Total', value: formatInrInteger(total) },
      { label: 'Status', value: pendingAmount <= 1 ? 'Paid' : 'Pending' },
    ],
    actionLabel: 'Open print preview',
    customerId: String(row.customer ?? ''),
    billId,
    details: {
      bill: {
        billRef: ref,
        date,
        customerName,
        items: billItems,
        total,
        paidAmount,
        pendingAmount,
        lrNo: String(row.lr_no ?? ''),
        transport: num(row.transport),
      },
    },
  }
}

export async function loadQuickSearchResults(query: string): Promise<QuickSearchResult[]> {
  const q = query.trim()
  if (!q) {
    const recent = getRecentQuickSearchResults()
    const recentBills = recent.filter((row) => row.kind === 'Bill').slice(0, 5)
    const recentCustomers = recent.filter((row) => row.kind === 'Customer').slice(0, 3)
    const todayRate = await loadTodayRateResult()
    return [...recentBills, ...recentCustomers, ...todayRate]
  }

  const rateResults = [...(await loadRateQuickSearchResult(q)), ...(await loadRateListResults(q))]
  if (/^(?:r|rate|rates)(?:\s|$)/i.test(q)) return rateResults

  const customers = await loadCustomersCached()
  const customerById = new Map(customers.map((row) => [row.id, row]))
  const cleaned = escapeFilterValue(q.replace(/^(?:bill|b|customer|c|payment|p)\s+/i, '').trim() || q)
  const isBillCommand = /^(?:b|bill)\b/i.test(q)
  const isBareBillCommand = /^(?:b|bill)$/i.test(q)
  const isCustomerCommand = /^(?:c|customer)\b/i.test(q)
  const isPaymentCommand = /^(?:p|pay|payment)\b/i.test(q)
  const dayMatch = /^(\d{1,2})$/.exec(cleaned)
  const dayRange = dayMatch ? currentMonthDayRange(Number(dayMatch[1])) : null

  const [customersRaw, billsPage, paymentsPage, stockRows] = await Promise.all([
    isBillCommand || isPaymentCommand
      ? Promise.resolve({ items: [] })
      : isCustomerCommand || cleaned.length > 0
        ? pb.collection('customers').getList(1, 15, {
            filter: `company_name ~ "${cleaned}" || name ~ "${cleaned}"`,
            sort: 'company_name,name',
          }).catch(() => ({ items: [] }))
        : Promise.resolve({ items: [] }),
    isCustomerCommand || isPaymentCommand
      ? Promise.resolve({ items: [] })
      : isBareBillCommand
        ? pb.collection('bills').getList(1, 20, { sort: '-date,-bill_no' }).catch(() => ({ items: [] }))
        : pb.collection('bills').getList(1, 20, {
            filter: [
              `bill_no ~ "${cleaned}" || book_no ~ "${cleaned}" || bill_ref ~ "${cleaned}" || customer_name ~ "${cleaned}"`,
              dayRange ? `(date >= "${dayRange.start}" && date < "${dayRange.end}")` : '',
            ].filter(Boolean).join(' || '),
            sort: '-date,-bill_no',
          }).catch(() => ({ items: [] })),
    isBillCommand || isCustomerCommand
      ? Promise.resolve({ items: [] })
      : pb.collection('payments').getList(1, 15, {
          filter: `customer_name ~ "${cleaned}" || mode ~ "${cleaned}" || amount ~ "${cleaned}" || note ~ "${cleaned}"`,
          sort: '-date',
        }).catch(() => ({ items: [] })),
    loadCurrentStockCached().catch(() => []),
  ])

  const searchedCustomers = ((customersRaw.items ?? []) as PBRecord[]).map((row) => ({
    id: row.id,
    name: formatCustomerDisplayName(row.company_name, row.name),
    rawName: String(row.name ?? ''),
    companyName: String(row.company_name ?? ''),
    openingBalance: num(row.opening_balance),
  }))

  const customerResultsBase = (searchedCustomers.length ? searchedCustomers : customers)
    .filter((row) => matchesAnyRankedQuery([row.name, row.rawName, row.companyName], q))
    .slice(0, 8)

  const customerIds = customerResultsBase.map((row) => row.id)
  const customerBills = customerIds.length
    ? ((await pb.collection('bills').getFullList({
        filter: customerIds.map((id) => `customer = "${escapeFilterValue(id)}"`).join(' || '),
        sort: '-date,-bill_no',
      }).catch(() => [])) as PBRecord[])
    : []
  const customerBillItemsByBill = await loadBillItemsForBills(customerBills.map((row) => row.id))
  const customerPayments = await loadPaymentsForCustomers(customerIds)
  const customerResults = customerResultsBase.map((row): QuickSearchResult => {
    const bills = customerBills.filter((bill) => String(bill.customer ?? '') === row.id)
    const payments = customerPayments.filter((payment) => String(payment.customer ?? '') === row.id)
    const lastBills = bills.slice(0, 3).map((bill) => {
      const items = customerBillItemsByBill.get(bill.id) ?? []
      const itemTotal = items.reduce((sum, item) => sum + num(item.amount), 0)
      return {
        id: bill.id,
        date: datePart(bill.date),
        billRef: billRef(bill),
        amount: calculateBillTotalFromBase(itemTotal, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount)),
      }
    })
    const totalBills = bills.reduce((sum, bill) => {
      const items = customerBillItemsByBill.get(bill.id) ?? []
      return sum + calculateBillTotalFromBase(items.reduce((itemSum, item) => itemSum + num(item.amount), 0), num(bill.transport), num(bill.gst_rate), num(bill.gst_amount))
    }, 0)
    const totalPayments = payments.reduce((sum, payment) => sum + num(payment.amount), 0)
    const balance = row.openingBalance + totalBills - totalPayments
    const balanceLabel = balance > 0 ? 'Due' : balance < 0 ? 'Advance' : 'Clear'
    const lastPayment = payments[0] ? { date: datePart(payments[0].date), amount: num(payments[0].amount) } : undefined
    return {
      id: `customer-${row.id}`,
      kind: 'Customer',
      title: row.name,
      subtitle: 'Open party ledger',
      previewTitle: row.name,
      previewLines: [
        { label: 'Type', value: 'Customer ledger' },
        { label: 'Company', value: row.companyName || '-' },
        { label: 'Contact', value: row.rawName || '-' },
      ],
      actionLabel: 'Open ledger',
      customerId: row.id,
      details: { customer: { name: row.name, balance, balanceLabel, lastBills, lastPayment } },
    }
  })

  const billsRaw = ((billsPage.items ?? []) as PBRecord[])
  const billItemsByBill = await loadBillItemsForBills(billsRaw.map((row) => row.id))
  const billResults = billsRaw
    .map((row) => makeBillResult(
      row,
      customerById.get(String(row.customer ?? ''))?.name ?? String(row.customer_name ?? ''),
      billItemsByBill.get(row.id) ?? [],
    ))
    .filter((row) => row.customerId && matchesAnyRankedQuery([row.title, row.subtitle, row.details?.bill?.date ?? ''], q))

  const paymentResults = ((paymentsPage.items ?? []) as PBRecord[])
    .map((row) => {
      const customerId = String(row.customer ?? '')
      const customerName = customerById.get(customerId)?.name ?? String(row.customer_name ?? '')
      const date = datePart(row.date)
      const amount = num(row.amount)
      return {
        id: `payment-${row.id}`,
        kind: 'Payment' as const,
        title: `Payment ${formatInrInteger(amount)}`,
        subtitle: `${formatFullDate(date)} · ${customerName} · ${String(row.mode ?? 'Bank')}`,
        previewTitle: `Payment ${formatInrInteger(amount)}`,
        previewLines: [
          { label: 'Date', value: formatFullDate(date) },
          { label: 'Party', value: customerName },
          { label: 'Mode', value: String(row.mode ?? 'Bank') },
          { label: 'Note', value: String(row.note ?? '-') || '-' },
        ],
        actionLabel: 'Open transaction',
        customerId,
        paymentId: row.id,
        searchable: [customerName, date, formatFullDate(date), String(row.mode ?? ''), String(amount)],
      }
    })
    .filter((row) => row.customerId && matchesAnyRankedQuery(row.searchable, q))
    .map(({ searchable: _searchable, ...row }) => row)

  const stockResults = stockRows
    .filter((row) => matchesAnyRankedQuery([row.itemName, row.customerName, row.name, row.type, 'stock inventory current closing'], q))
    .map((row): QuickSearchResult => ({
      id: `stock-${row.itemId}-${row.customerId}`,
      kind: 'Stock',
      title: row.itemName,
      subtitle: `${row.customerName} · ${formatInQty(row.currentStock, row.unit || 'kg')} current`,
      previewTitle: `${row.itemName} stock`,
      previewLines: [
        { label: 'Party', value: row.customerName },
        { label: 'Current', value: formatInQty(row.currentStock, row.unit || 'kg') },
        { label: 'In month', value: formatInQty(row.stockInThisMonth, row.unit || 'kg') },
        { label: 'Sold month', value: formatInQty(row.soldThisMonth, row.unit || 'kg') },
      ],
      actionLabel: 'Open stock',
      stockItemId: row.itemId,
      stockCustomerId: row.customerId,
      details: {
        stock: {
          itemName: row.itemName,
          customerName: row.customerName,
          currentQty: row.currentStock,
          unit: row.unit || 'kg',
          lastUpdatedDate: row.openingStockDate,
        },
      },
    }))

  return [...billResults, ...customerResults, ...paymentResults, ...rateResults, ...stockResults]
}
