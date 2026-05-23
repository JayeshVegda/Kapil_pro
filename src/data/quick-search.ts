import { pb } from '@/data/pocketbase'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { matchesAnyRankedQuery } from '@/lib/search'

type PBRecord = Record<string, unknown> & { id: string }

export type QuickSearchResult = {
  id: string
  kind: 'Customer' | 'Bill' | 'Payment' | 'Rate'
  title: string
  subtitle: string
  customerId?: string
  billId?: string
  paymentId?: string
}

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)

const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

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
  }]
}

export async function loadQuickSearchResults(query: string): Promise<QuickSearchResult[]> {
  const q = query.trim()
  if (!q) return []

  const rateResults = await loadRateQuickSearchResult(q)

  const [customersRaw, billsRaw, paymentsRaw] = await Promise.all([
    pb.collection('customers').getFullList({ sort: 'company_name,name' }),
    pb.collection('bills').getFullList({ sort: '-date,-bill_no' }),
    pb.collection('payments').getFullList({ sort: '-date' }),
  ])

  const customers = (customersRaw as PBRecord[]).map((row) => ({
    id: row.id,
    name: formatCustomerDisplayName(row.company_name, row.name),
    rawName: String(row.name ?? ''),
    companyName: String(row.company_name ?? ''),
  }))
  const customerById = new Map(customers.map((row) => [row.id, row]))

  const customerResults = customers
    .filter((row) => matchesAnyRankedQuery([row.name, row.rawName, row.companyName], q))
    .map((row): QuickSearchResult => ({
      id: `customer-${row.id}`,
      kind: 'Customer',
      title: row.name,
      subtitle: 'Open party ledger',
      customerId: row.id,
    }))

  const billResults = (billsRaw as PBRecord[])
    .map((row) => {
      const customerId = String(row.customer ?? '')
      const customerName = customerById.get(customerId)?.name ?? String(row.customer_name ?? '')
      const billRef = `${num(row.book_no)}/${num(row.bill_no)}`
      const date = datePart(row.date)
      return {
        id: `bill-${row.id}`,
        kind: 'Bill' as const,
        title: `Bill ${billRef}`,
        subtitle: `${formatFullDate(date)} · ${customerName}`,
        customerId,
        billId: row.id,
        searchable: [billRef, String(row.bill_ref ?? ''), customerName, date, formatFullDate(date)],
      }
    })
    .filter((row) => row.customerId && matchesAnyRankedQuery(row.searchable, q))
    .map(({ searchable: _searchable, ...row }) => row)

  const paymentResults = (paymentsRaw as PBRecord[])
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
        customerId,
        paymentId: row.id,
        searchable: [customerName, date, formatFullDate(date), String(row.mode ?? ''), String(amount)],
      }
    })
    .filter((row) => row.customerId && matchesAnyRankedQuery(row.searchable, q))
    .map(({ searchable: _searchable, ...row }) => row)

  return [...rateResults, ...customerResults, ...billResults, ...paymentResults].slice(0, 12)
}
