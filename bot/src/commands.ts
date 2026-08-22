export type Customer = {
  id: string
  name: string
  companyName: string
  customerName: string
  openingBalance: number
}

export type Item = {
  id: string
  name: string
  type: string
  unit: string
  bagWeight: number
  defaultRate: number
}

export type ParsedPaymentCommand = {
  kind: 'payment'
  customer: Customer
  amount: number
  mode: 'Cash' | 'Bank'
  date: string
  note: string
}

export type ParsedStockInCommand = {
  kind: 'stock'
  item: Item
  qty: number
  displayQty: string
  date: string
  note: string
}

export type ParseResult<T> = { ok: true; command: T } | { ok: false; error: string }

const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function todayIso() {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}

export function parseAmountToken(token: string) {
  const normalized = token.toLowerCase().replaceAll(',', '').trim()
  if (!normalized) return 0
  if (normalized.endsWith('k')) return Number(normalized.slice(0, -1)) * 1_000
  if (normalized.endsWith('l') || normalized.endsWith('lac') || normalized.endsWith('lakh')) {
    return Number(normalized.replace(/(l|lac|lakh)$/i, '')) * 100_000
  }
  if (normalized.endsWith('c') || normalized.endsWith('cr') || normalized.endsWith('crore')) {
    return Number(normalized.replace(/(c|cr|crore)$/i, '')) * 10_000_000
  }
  return Number(normalized.replace(/(bag|bags|kg|pc|pcs|piece|pieces)$/i, ''))
}

function normalizeYear(input: string, fallbackYear: number) {
  const parsed = Number(input)
  if (!Number.isFinite(parsed)) return fallbackYear
  return parsed < 100 ? 2000 + parsed : parsed
}

function isRealIsoDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return false
  const iso = [parsed.getFullYear(), String(parsed.getMonth() + 1).padStart(2, '0'), String(parsed.getDate()).padStart(2, '0')].join('-')
  return iso === value
}

export function parseDateToken(token: string, today = todayIso()) {
  const normalized = token.trim().toLowerCase()
  if (normalized === 'today' || normalized === '0') return today
  if (normalized === 'tomorrow' || normalized === 'tmrw' || normalized === '+1') {
    const d = new Date(`${today}T00:00:00`)
    d.setDate(d.getDate() + 1)
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
  }
  if (normalized === '-1' || normalized === 'yday' || normalized === 'yesterday') {
    const d = new Date(`${today}T00:00:00`)
    d.setDate(d.getDate() - 1)
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
  }
  const iso = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const value = `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`
    return isRealIsoDate(value) ? value : token
  }
  const ddmmyyyy = normalized.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/)
  if (ddmmyyyy) {
    const fallbackYear = Number(today.slice(0, 4))
    const year = ddmmyyyy[3] ? normalizeYear(ddmmyyyy[3], fallbackYear) : fallbackYear
    const value = `${year}-${String(Number(ddmmyyyy[2])).padStart(2, '0')}-${String(Number(ddmmyyyy[1])).padStart(2, '0')}`
    return isRealIsoDate(value) ? value : token
  }
  const named = normalized.match(/^(\d{1,2})[-/ ]([a-z]{3,9})(?:[-/ ](\d{2,4}))?$/)
  if (named) {
    const monthIndex = monthNames.findIndex((month) => named[2].startsWith(month))
    if (monthIndex >= 0) {
      const fallbackYear = Number(today.slice(0, 4))
      const year = named[3] ? normalizeYear(named[3], fallbackYear) : fallbackYear
      const value = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(Number(named[1])).padStart(2, '0')}`
      return isRealIsoDate(value) ? value : token
    }
  }
  return token
}

export function isDateToken(token: string, today = todayIso()) {
  return parseDateToken(token, today) !== token || /^\d{4}-\d{2}-\d{2}$/.test(token)
}

function clean(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function scoreName(query: string, candidates: string[]) {
  const q = clean(query)
  if (!q) return 0
  let best = 0
  for (const raw of candidates) {
    const name = clean(raw)
    if (!name) continue
    if (name === q) best = Math.max(best, 100)
    else if (name.startsWith(q)) best = Math.max(best, 90)
    else if (name.includes(q)) best = Math.max(best, 75)
    else {
      const words = q.split(/\s+/).filter(Boolean)
      const matched = words.filter((word) => name.includes(word)).length
      if (matched) best = Math.max(best, Math.round((matched / words.length) * 60))
    }
  }
  return best
}

export function findBestCustomer(customers: Customer[], query: string) {
  const ranked = customers
    .map((customer) => ({
      customer,
      score: scoreName(query, [customer.name, customer.companyName, customer.customerName]),
    }))
    .filter((row) => row.score >= 50)
    .sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name))
  const first = ranked[0]
  const second = ranked[1]
  if (!first) return { match: null, ambiguous: [] as Customer[] }
  if (second && first.score === second.score) return { match: null, ambiguous: ranked.slice(0, 5).map((row) => row.customer) }
  return { match: first.customer, ambiguous: [] as Customer[] }
}

export function findBestItem(items: Item[], query: string) {
  const gasItems = items.filter((item) => item.type.toLowerCase() === 'gas')
  const ranked = gasItems
    .map((item) => ({ item, score: scoreName(query, [item.name]) }))
    .filter((row) => row.score >= 50)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
  const first = ranked[0]
  const second = ranked[1]
  if (!first) return { match: null, ambiguous: [] as Item[] }
  if (second && first.score === second.score) return { match: null, ambiguous: ranked.slice(0, 5).map((row) => row.item) }
  return { match: first.item, ambiguous: [] as Item[] }
}

export function findDefaultSpindle(items: Item[]) {
  const gasItems = items.filter((item) => item.type.toLowerCase() === 'gas')
  return (
    gasItems.find((item) => clean(item.name).includes('spindle')) ??
    gasItems[0] ??
    null
  )
}

function parseQuantity(token: string, item: Item) {
  const rawQty = parseAmountToken(token)
  const lower = token.toLowerCase()
  const bagWeight = Number(item.bagWeight || 50)
  if (item.type.toLowerCase() === 'gas' && !lower.includes('kg') && !lower.includes('pc') && rawQty <= 50) {
    const kg = rawQty * bagWeight
    return { qty: kg, displayQty: `${rawQty} bags / ${kg} kg` }
  }
  if (item.type.toLowerCase() === 'gas') {
    const bags = rawQty / bagWeight
    return { qty: rawQty, displayQty: `${rawQty} kg / ${bags.toFixed(Number.isInteger(bags) ? 0 : 1)} bags` }
  }
  return { qty: rawQty, displayQty: `${rawQty} ${item.unit || 'piece'}` }
}

export function parsePaymentCommand(input: string, customers: Customer[], today = todayIso()): ParseResult<ParsedPaymentCommand> {
  const noteMatch = input.match(/"([^"]*)"/)
  const note = noteMatch?.[1]?.trim() ?? ''
  const withoutNote = noteMatch ? input.replace(noteMatch[0], '').trim() : input.trim()
  const tokens = withoutNote.split(/\s+/).filter(Boolean)
  const amountIndex = tokens.findIndex((token) => parseAmountToken(token) > 0)
  if (amountIndex <= 0) return { ok: false, error: 'Use: p party amount [cash|bank] [date] ["note"]' }
  const customerQuery = tokens.slice(0, amountIndex).join(' ')
  const resolved = findBestCustomer(customers, customerQuery)
  if (resolved.ambiguous.length) return { ok: false, error: `Ambiguous party: ${resolved.ambiguous.map((row) => row.name).join(', ')}` }
  if (!resolved.match) return { ok: false, error: `Party not found: ${customerQuery}` }

  let mode: 'Cash' | 'Bank' = 'Cash'
  let date = today
  for (const token of tokens.slice(amountIndex + 1)) {
    const lower = token.toLowerCase()
    if (lower === 'cash') mode = 'Cash'
    else if (lower === 'bank' || lower === 'cheque') mode = 'Bank'
    else if (isDateToken(lower, today)) date = parseDateToken(lower, today)
  }

  return { ok: true, command: { kind: 'payment', customer: resolved.match, amount: parseAmountToken(tokens[amountIndex]), mode, date, note } }
}

export function parseStockInCommand(input: string, items: Item[], today = todayIso()): ParseResult<ParsedStockInCommand> {
  const noteMatch = input.match(/"([^"]*)"/)
  const note = noteMatch?.[1]?.trim() ?? ''
  const withoutNote = noteMatch ? input.replace(noteMatch[0], '').trim() : input.trim()
  const tokens = withoutNote.split(/\s+/).filter(Boolean)
  const qtyIndex = tokens.findIndex((token) => parseAmountToken(token) > 0)
  if (qtyIndex < 0) return { ok: false, error: 'Use: s [item] qty [date] ["note"]' }

  const itemQuery = tokens.slice(0, qtyIndex).join(' ')
  const itemResult = itemQuery ? findBestItem(items, itemQuery) : { match: findDefaultSpindle(items), ambiguous: [] as Item[] }
  if (itemResult.ambiguous.length) return { ok: false, error: `Ambiguous item: ${itemResult.ambiguous.map((row) => row.name).join(', ')}` }
  if (!itemResult.match) return { ok: false, error: itemQuery ? `Item not found: ${itemQuery}` : 'Default Spindle item not found.' }

  let date = today
  for (const token of tokens.slice(qtyIndex + 1)) {
    const lower = token.toLowerCase()
    if (isDateToken(lower, today)) date = parseDateToken(lower, today)
  }

  const qtyInfo = parseQuantity(tokens[qtyIndex], itemResult.match)
  if (!(qtyInfo.qty > 0)) return { ok: false, error: `Invalid quantity: ${tokens[qtyIndex]}` }
  return { ok: true, command: { kind: 'stock', item: itemResult.match, qty: qtyInfo.qty, displayQty: qtyInfo.displayQty, date, note } }
}
