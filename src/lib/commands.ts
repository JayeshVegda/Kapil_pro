import { getLocalIsoDate } from '@/lib/date'
import { findBestNameMatch } from '@/lib/search'
import { getAdminControlSettings } from '@/lib/admin-control'

export type CommandKind = 'bill' | 'payment' | 'stock' | 'print'
export const PENDING_COMMAND_STORAGE_KEY = 'kapil-pending-command-v1'

export type CommandRouteContext = 'bill' | 'payment' | 'stock' | 'print' | 'neutral'

export const commandRegistry = {
  bill: {
    aliases: ['b', 'bill', 'sale'],
    pageContexts: ['/new-bill'],
    defaultItemName: 'Spindle (8.5GM)',
  },
  payment: {
    aliases: ['p', 'pay', 'payment'],
    pageContexts: ['/new-payment'],
  },
  stock: {
    aliases: ['s', 'stock', 'stockin', 'in'],
    pageContexts: ['/stock', '/stock-in'],
  },
  print: {
    aliases: ['pr', 'print'],
    pageContexts: ['/print-bill'],
  },
} as const

export function getCommandRegistry() {
  const settings = getAdminControlSettings()
  return {
    bill: {
      ...commandRegistry.bill,
      aliases: settings.commandAliases.bill,
      defaultItemName: settings.defaultBillItemName,
    },
    payment: {
      ...commandRegistry.payment,
      aliases: settings.commandAliases.payment,
    },
    stock: {
      ...commandRegistry.stock,
      aliases: settings.commandAliases.stock,
    },
    print: {
      ...commandRegistry.print,
      aliases: settings.commandAliases.print,
    },
  } as const
}

export type CommandCustomer = {
  id: string
  name: string
  companyName?: string
  customerName?: string
}

export type CommandItem = {
  id: string
  name: string
  defaultRate?: number
  type?: string
  unit?: string
  bagWeight?: number
}

export type ParsedBillLineCommand = {
  item: CommandItem
  qty: number
  displayQty: string
  defaultRate: number
  rate: number
  manualRateEdited: boolean
}

export type ParsedBillCommand = {
  kind: 'bill'
  customer: CommandCustomer
  items: ParsedBillLineCommand[]
  item: CommandItem
  qty: number
  displayQty: string
  defaultRate: number
  rate: number
  manualRateEdited: boolean
  gstRate: number
  gstAmount: number
  gstMode: 'none' | 'percent18' | 'manual'
  transport: number
  date: string
}

export type ParsedPaymentCommand = {
  kind: 'payment'
  customer: CommandCustomer
  amount: number
  mode: 'Cash' | 'Bank'
  date: string
  note: string
}

export type ParsedStockCommand = {
  kind: 'stock'
  item: CommandItem
  qty: number
  displayQty: string
  date: string
  note: string
}

export type ParsedPrintCommand = {
  kind: 'print'
  billRef: string
}

export type ParsedCommand = ParsedBillCommand | ParsedPaymentCommand | ParsedStockCommand | ParsedPrintCommand

export type CommandParseResult<T extends ParsedCommand = ParsedCommand> = { ok: true; command: T } | { ok: false; error: string }

function getCommandAliasToKind() {
  return new Map<string, CommandKind>(
    Object.entries(getCommandRegistry()).flatMap(([kind, config]) => config.aliases.map((alias) => [alias, kind as CommandKind])),
  )
}

export function inferCommandKind(pathname: string): CommandRouteContext {
  if (pathname === '/new-bill') return 'bill'
  if (pathname === '/new-payment') return 'payment'
  if (pathname === '/stock' || pathname === '/stock-in') return 'stock'
  if (pathname === '/print-bill') return 'print'
  return 'neutral'
}

export function splitCommandPrefix(input: string, context: CommandRouteContext) {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() ?? ''
  const prefixedKind = getCommandAliasToKind().get(first)
  if (prefixedKind) return { kind: prefixedKind, body: tokens.slice(1).join(' ') }
  if (context !== 'neutral') return { kind: context, body: input.trim() }
  return { kind: null, body: input.trim() }
}

export function parseContextCommand(input: string, context: CommandRouteContext, deps: {
  customers?: CommandCustomer[]
  items?: CommandItem[]
  today: string
  mktRate?: number
}): CommandParseResult {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'Type a command first.' }
  const resolved = splitCommandPrefix(raw, context)
  if (!resolved.kind) return { ok: false, error: 'Add a prefix: b for bill, p for payment, s for stock, or pr for print.' }
  if (resolved.kind === 'bill') return parseBillCommand(resolved.body, deps.customers ?? [], deps.items ?? [], deps.today, deps.mktRate ?? 0)
  if (resolved.kind === 'payment') return parsePaymentCommand(resolved.body, deps.customers ?? [], deps.today)
  if (resolved.kind === 'stock') return parseStockCommand(resolved.body, deps.items ?? [], deps.today)
  return parsePrintCommand(resolved.body)
}

export function parseBillCommand(
  input: string,
  customers: CommandCustomer[],
  items: CommandItem[],
  today: string,
  mktRate: number,
): CommandParseResult<ParsedBillCommand> {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return { ok: false, error: 'Use: party [item qty [rate]]... [gst|cgst amount] [+t amount] [date]' }
  const { record: customer, usedWords } = resolveBestPrefix(customers, input, customerSearchText)
  if (!customer) return { ok: false, error: `Party not found in: ${input}` }

  let gstRate = 0
  let gstAmount = 0
  let gstMode: ParsedBillCommand['gstMode'] = 'none'
  let transport = 0
  let date = today
  const lineTokens: string[] = []
  for (let i = usedWords; i < tokens.length; i += 1) {
    const token = tokens[i].toLowerCase()
    if (token === 'gst' || token === 'm') {
      gstRate = 18
      gstMode = 'percent18'
      continue
    }
    if (token === 'nogst' || token === 'no-gst') {
      gstRate = 0
      gstAmount = 0
      gstMode = 'none'
      continue
    }
    if ((token === '+t' || token === 't' || token === '+transport' || token === 'transport') && i + 1 < tokens.length) {
      transport = parseAmountToken(tokens[i + 1]) || transport
      i += 1
      continue
    }
    if ((token === 'cgst' || token === 'customgst' || token === 'manualgst' || token === 'gstamt') && i + 1 < tokens.length) {
      gstRate = 0
      gstAmount = parseAmountToken(tokens[i + 1]) || 0
      gstMode = 'manual'
      i += 1
      continue
    }
    const maybeDate = parseDateToken(token, today)
    if (maybeDate !== token || /^\d{4}-\d{2}-\d{2}$/.test(maybeDate)) {
      date = maybeDate
      continue
    }
    lineTokens.push(tokens[i])
  }

  const parsedItems = parseBillLineCommands(lineTokens, items, mktRate, gstMode)
  if (!parsedItems.ok) return parsedItems
  const first = parsedItems.items[0]
  return {
    ok: true,
    command: {
      kind: 'bill',
      customer,
      items: parsedItems.items,
      item: first.item,
      qty: first.qty,
      displayQty: first.displayQty,
      defaultRate: first.defaultRate,
      rate: first.rate,
      manualRateEdited: first.manualRateEdited,
      gstRate,
      gstAmount,
      gstMode,
      transport,
      date,
    },
  }
}

export function parsePaymentCommand(input: string, customers: CommandCustomer[], today: string): CommandParseResult<ParsedPaymentCommand> {
  const raw = input.trim()
  const noteMatch = raw.match(/"([^"]*)"/)
  const note = noteMatch?.[1]?.trim() ?? ''
  const withoutNote = noteMatch ? raw.replace(noteMatch[0], '').trim() : raw
  const tokens = withoutNote.split(/\s+/).filter(Boolean)
  const amountIndex = tokens.findIndex((token) => parseAmountToken(token) > 0)
  if (amountIndex <= 0) return { ok: false, error: 'Use: party amount [mode] [date]' }
  const customerQuery = tokens.slice(0, amountIndex).join(' ')
  const customer = findBestNameMatch(customers, customerQuery, customerSearchText)
  if (!customer) return { ok: false, error: `Party not found: ${customerQuery}` }

  let mode: 'Cash' | 'Bank' = 'Cash'
  let date = today
  for (const token of tokens.slice(amountIndex + 1)) {
    const lower = token.toLowerCase()
    if (lower === 'by' || lower === 'via' || lower === 'on' || lower === 'date') continue
    if (lower === 'cash') mode = 'Cash'
    else if (lower === 'bank' || lower === 'cheque') mode = 'Bank'
    else {
      const maybeDate = parseDateToken(lower, today)
      if (isParsedDateToken(lower, maybeDate)) date = maybeDate
    }
  }
  return { ok: true, command: { kind: 'payment', customer, amount: parseAmountToken(tokens[amountIndex]), mode, date, note } }
}

export function parseStockCommand(input: string, items: CommandItem[], today: string): CommandParseResult<ParsedStockCommand> {
  const noteMatch = input.match(/"([^"]*)"/)
  const note = noteMatch?.[1]?.trim() ?? ''
  const withoutNote = noteMatch ? input.replace(noteMatch[0], '').trim() : input.trim()
  const tokens = withoutNote.split(/\s+/).filter(Boolean)
  const qtyIndex = findFirstQuantityIndex(tokens, 0)
  if (qtyIndex <= 0) return { ok: false, error: 'Use: item qty [date] ["note"]' }
  const itemQuery = tokens.slice(0, qtyIndex).join(' ')
  const item = findBestNameMatch(items, itemQuery, (row) => row.name)
  if (!item) return { ok: false, error: `Item not found: ${itemQuery}` }
  if (String(item.type ?? '').toLowerCase() !== 'gas') return { ok: false, error: 'Stock commands are only for gas part items.' }
  const qtyInfo = parseItemQuantity(tokens[qtyIndex], item, true)
  let date = today
  for (const token of tokens.slice(qtyIndex + 1)) {
    const lower = token.toLowerCase()
    if (lower === 'on' || lower === 'date') continue
    const maybeDate = parseDateToken(lower, today)
    if (isParsedDateToken(lower, maybeDate)) date = maybeDate
  }
  return { ok: true, command: { kind: 'stock', item, qty: qtyInfo.qty, displayQty: qtyInfo.display, date, note } }
}

export function parsePrintCommand(input: string): CommandParseResult<ParsedPrintCommand> {
  const billRef = input.trim()
  if (!billRef) return { ok: false, error: 'Use: bill reference, for example 51/24.' }
  return { ok: true, command: { kind: 'print', billRef } }
}

export function parseAmountToken(token: string) {
  const normalized = token.toLowerCase().replaceAll(',', '')
  if (normalized.endsWith('k')) return Number(normalized.slice(0, -1)) * 1000
  if (normalized.endsWith('l')) return Number(normalized.slice(0, -1)) * 100000
  if (normalized.endsWith('c')) return Number(normalized.slice(0, -1)) * 10000000
  return Number(normalized.replace(/(bag|bags|kg|pc|pcs|piece|pieces)$/i, ''))
}

export function parseDateToken(token: string, today: string) {
  const normalized = token.trim().toLowerCase()
  if (normalized === 'today' || normalized === '0') return today
  if (normalized === 'tomorrow' || normalized === 'tmrw' || normalized === '+1') {
    const d = new Date(`${today}T00:00:00`)
    d.setDate(d.getDate() + 1)
    return getLocalIsoDate(d)
  }
  if (normalized === '-1' || normalized === 'yday' || normalized === 'yesterday') {
    const d = new Date(`${today}T00:00:00`)
    d.setDate(d.getDate() - 1)
    return getLocalIsoDate(d)
  }
  const m = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  const shortMonth = normalized.match(/^(\d{1,2})[-/ ]([a-z]{3,9})(?:[-/ ](\d{2,4}))?$/)
  if (shortMonth) {
    const month = monthNumber(shortMonth[2])
    if (month) {
      const todayYear = Number(today.slice(0, 4))
      const yearRaw = shortMonth[3]
      const year = yearRaw ? normalizeYear(yearRaw) : todayYear
      return `${year}-${month}-${String(Number(shortMonth[1])).padStart(2, '0')}`
    }
  }
  const slash = normalized.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (slash) {
    const todayYear = Number(today.slice(0, 4))
    const year = slash[3] ? normalizeYear(slash[3]) : todayYear
    return `${year}-${String(Number(slash[2])).padStart(2, '0')}-${String(Number(slash[1])).padStart(2, '0')}`
  }
  return token
}

function parseBillLineCommands(
  tokens: string[],
  items: CommandItem[],
  mktRate: number,
  gstMode: ParsedBillCommand['gstMode'],
): { ok: true; items: ParsedBillLineCommand[] } | { ok: false; error: string } {
  if (items.length === 0) return { ok: false, error: 'Item list is empty.' }
  const fallbackItem = findDefaultBillItem(items)
  if (!fallbackItem) return { ok: false, error: 'Item list is empty.' }
  if (tokens.length === 0) return { ok: false, error: 'Add item quantity, for example spindle 2.' }

  const lines: ParsedBillLineCommand[] = []
  let i = 0
  while (i < tokens.length) {
    while (i < tokens.length && isLineSeparator(tokens[i])) i += 1
    if (i >= tokens.length) break

    const qtyIndex = findBillLineQuantityIndex(tokens, i)
    if (qtyIndex < 0) {
      const itemQuery = tokens.slice(i).filter((token) => !isLineSeparator(token) && !isBillRateModifier(token)).join(' ')
      const item = itemQuery ? findBestNameMatch(items, itemQuery, (row) => row.name) : fallbackItem
      return { ok: false, error: item ? `Add quantity for ${item.name}. Example: ${item.name} 1` : `Add item quantity. Example: spindle 1` }
    }
    const itemQuery = tokens.slice(i, qtyIndex).filter((token) => !isLineSeparator(token) && !isBillRateModifier(token)).join(' ')
    const item = itemQuery ? findBestNameMatch(items, itemQuery, (row) => row.name) : fallbackItem
    if (!item) return { ok: false, error: `Item not found: ${itemQuery}` }

    const qtyInfo = parseItemQuantity(tokens[qtyIndex], item, true)
    if (!(qtyInfo.qty > 0)) return { ok: false, error: `Invalid quantity for ${item.name}.` }

    let defaultRate = Number(item.defaultRate ?? 0)
    let rate = Math.max(0, defaultRate + mktRate - (gstMode === 'percent18' ? 30 : 0))
    let manualRateEdited = false
    i = qtyIndex + 1

    while (i < tokens.length) {
      const token = tokens[i].toLowerCase()
      if (isLineSeparator(token)) {
        i += 1
        break
      }
      if (token === 'rate' || token === 'final' || token === 'f' || token === 'fr') {
        const next = parseAmountToken(tokens[i + 1] ?? '')
        if (next > 0) {
          rate = next
          defaultRate = Math.max(0, rate - mktRate + (gstMode === 'percent18' ? 30 : 0))
          manualRateEdited = true
          i += 2
          continue
        }
      }
      if (token === 'default' || token === 'dr' || token === 'base') {
        const next = parseAmountToken(tokens[i + 1] ?? '')
        if (next > 0) {
          defaultRate = next
          rate = Math.max(0, defaultRate + mktRate - (gstMode === 'percent18' ? 30 : 0))
          manualRateEdited = false
          i += 2
          continue
        }
      }
      const numeric = parseAmountToken(token)
      if (numeric > 0) {
        rate = numeric
        defaultRate = Math.max(0, rate - mktRate + (gstMode === 'percent18' ? 30 : 0))
        manualRateEdited = true
        i += 1
        continue
      }
      break
    }

    lines.push({ item, qty: qtyInfo.qty, displayQty: qtyInfo.display, defaultRate, rate, manualRateEdited })
  }

  if (lines.length === 0) return { ok: false, error: 'No bill items found.' }
  return { ok: true, items: lines }
}

function isLineSeparator(token: string) {
  return token === ',' || token === '+' || token === 'and' || token === '&' || token === '|'
}

function isBillRateModifier(token: string) {
  return ['rate', 'final', 'f', 'fr', 'default', 'dr', 'base'].includes(token.toLowerCase())
}

function findBillLineQuantityIndex(tokens: string[], start: number) {
  for (let i = start; i < tokens.length; i += 1) {
    if (i > start && isBillRateModifier(tokens[i - 1])) continue
    if (parseAmountToken(tokens[i]) > 0) return i
  }
  return -1
}

function monthNumber(input: string) {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const index = months.findIndex((month) => input.startsWith(month))
  return index >= 0 ? String(index + 1).padStart(2, '0') : ''
}

function normalizeYear(input: string) {
  const year = Number(input)
  if (!Number.isFinite(year)) return new Date().getFullYear()
  return year < 100 ? 2000 + year : year
}

function isParsedDateToken(token: string, parsed: string) {
  return parsed !== token || /^\d{4}-\d{2}-\d{2}$/.test(parsed)
}

function findFirstQuantityIndex(tokens: string[], start: number) {
  for (let i = start; i < tokens.length; i += 1) {
    if (parseAmountToken(tokens[i]) > 0) return i
  }
  return -1
}

function parseItemQuantity(token: string, item: CommandItem, preferBagsForGas: boolean) {
  const rawQty = parseAmountToken(token)
  const lower = token.toLowerCase()
  const isGas = String(item.type ?? '').toLowerCase() === 'gas'
  const bagWeight = Number(item.bagWeight ?? 50) || 50
  if (isGas && preferBagsForGas && !lower.includes('kg') && !lower.includes('pc') && rawQty <= 50) {
    const kg = rawQty * bagWeight
    return { qty: kg, display: `${rawQty} bags / ${kg} kg` }
  }
  if (isGas) return { qty: rawQty, display: `${rawQty} kg / ${(rawQty / bagWeight).toFixed(rawQty % bagWeight === 0 ? 0 : 1)} bags` }
  const unit = item.unit || 'piece'
  return { qty: rawQty, display: `${rawQty} ${unit}` }
}

function findDefaultBillItem(items: CommandItem[]) {
  const defaultName = getCommandRegistry().bill.defaultItemName
  return items.find((item) => item.name.toLowerCase() === defaultName.toLowerCase()) ?? items[0]
}

function customerSearchText(customer: CommandCustomer) {
  return [customer.name, customer.companyName, customer.customerName].filter(Boolean).join(' ')
}

function resolveBestPrefix<T>(records: T[], input: string, getName: (record: T) => string) {
  const words = input.split(/\s+/).filter(Boolean)
  for (let take = words.length; take >= 1; take -= 1) {
    const query = words.slice(0, take).join(' ')
    const record = findBestNameMatch(records, query, getName)
    if (record) return { record, usedWords: take }
  }
  return { record: null, usedWords: 0 }
}
