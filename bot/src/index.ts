import { findBestCustomer, findBestItem, findDefaultSpindle, isDateToken, parseDateToken, parsePaymentCommand, parseStockInCommand, todayIso } from './commands.js'
import { createBillPrintJpeg } from './bill-image.js'
import { b, clampTelegramCaption, code, escapeHtml, fullDate, heading, i, inr, joinBlocks, paginatePreTable, pre, qty, truncateText } from './format.js'
import { env } from './env.js'
import { getChatId, getMessageText, isAllowed, TelegramClient, type TelegramUpdate } from './telegram.js'
import {
  connectPocketBase,
  getRecentPaymentsForCustomer,
  listCustomers,
  listItems,
  listPaymentsForDate,
  listStockInForDate,
  loadBillPrintData,
  loadCustomerBalance,
  loadLatestRate,
  loadStockBuckets,
  savePayment,
  saveStockIn,
  searchBills,
  type BillSummary,
  type PaymentSummary,
  type StockBucketSummary,
  type StockInSummary,
} from './pocketbase.js'

const telegram = new TelegramClient()
const BULLET = '•'

type HelpTopic = {
  title: string
  purpose: string
  syntax?: string[]
  examples: string[]
  notes: string[]
  related?: string[]
}

const helpTopics: Record<string, HelpTopic> = {
  payment: {
    title: 'Payment',
    purpose: 'Save a payment and refresh Kapil Pro bill statuses.',
    syntax: ['p <party> <amount> [cash|bank] [date] ["note"]'],
    examples: [
      'p sambhu 2.4l',
      'p sambhu 0.2l bank yday',
      'p sambhu 20k cash',
      'p sambhu 1l "upi received"',
    ],
    notes: ['Cash is default.', '40 means 40 rupees.', 'Supported amount suffixes: k, l, lakh, c, crore.'],
    related: ['help amounts', 'help dates', 'sambhu'],
  },
  p: {
    title: 'Payment',
    purpose: 'Save a payment and refresh Kapil Pro bill statuses.',
    syntax: ['p <party> <amount> [cash|bank] [date] ["note"]'],
    examples: [
      'p sambhu 2.4l',
      'p sambhu 0.2l bank yday',
      'p sambhu 20k cash',
      'p sambhu 1l "upi received"',
    ],
    notes: ['Cash is default.', '40 means 40 rupees.', 'Supported amount suffixes: k, l, lakh, c, crore.'],
    related: ['help amounts', 'help dates', 'sambhu'],
  },
  stock: {
    title: 'Stock',
    purpose: 'Read stock buckets or save General stock-in.',
    syntax: ['s [item] <qty> [date] ["note"]', 'stock [item/customer]'],
    examples: ['s 2', 's spindle 2 yday', 's tapper 4 "received"', 'stock', 'stock tapper'],
    notes: ['Bare s 2 means General Spindle, 2 bags, today.', 'Use kg for kilogram input, for example s 100kg.', 'Stock adjustments and openings are not writable from Telegram.'],
    related: ['help dates', 'stock tapper', 's 2'],
  },
  s: {
    title: 'Stock',
    purpose: 'Read stock buckets or save General stock-in.',
    syntax: ['s [item] <qty> [date] ["note"]', 'stock [item/customer]'],
    examples: ['s 2', 's spindle 2 yday', 's tapper 4 "received"', 'stock', 'stock tapper'],
    notes: ['Bare s 2 means General Spindle, 2 bags, today.', 'Use kg for kilogram input, for example s 100kg.', 'Stock adjustments and openings are not writable from Telegram.'],
    related: ['help dates', 'stock tapper', 's 2'],
  },
  bill: {
    title: 'Bill Search',
    purpose: 'Read-only bill lookup from Kapil Pro.',
    syntax: ['bill <book/bill>', 'bill <party>', 'bill <date>', 'bill <party> <date>'],
    examples: ['bill 52/14', 'bill sambhu', 'bill 23-may', 'bill sambhu yday'],
    notes: ['Telegram never creates or edits bills.', 'Create bills only inside Kapil Pro.', 'Single exact bill lookups also send a bill photo preview.'],
    related: ['sambhu', 'day yday', 'help dates'],
  },
  day: {
    title: 'Day Report',
    purpose: 'Send a focused day pack: summary, sales, payments, and stock movement.',
    syntax: ['day [date]'],
    examples: ['day', 'day yday', 'day 23-may', 'day 23-05-2026'],
    notes: ['Reports stay split into multiple Telegram messages so each section is easy to scan.', 'Sales use bill summaries from Kapil Pro.'],
    related: ['bill yday', 'rate yday', 'help dates'],
  },
  rate: {
    title: 'Rate',
    purpose: 'Show latest or date-based brass rate.',
    syntax: ['rate [date]'],
    examples: ['rate', 'rate yday', 'rate 23-may'],
    notes: ['For a date, the bot shows the nearest saved rate on or before that date.'],
    related: ['help dates', 'day yday'],
  },
  party: {
    title: 'Party',
    purpose: 'Quick ledger snapshot by fuzzy party name.',
    syntax: ['<party name>', 'party <party name>', 'balance <party name>'],
    examples: ['sambhu', 'a s patel', 'bal sambhu'],
    notes: ['Shows due/advance status, billed vs paid totals, recent bills, and recent payments.', 'If the match is unclear, the bot lists possible parties.'],
    related: ['bill sambhu', 'p sambhu 20k cash', 'help payment'],
  },
  dates: {
    title: 'Date Formats',
    purpose: 'Use the same date shortcuts across reports and writes.',
    syntax: ['today', 'yday', '-1', '23-may', '23-05-2026'],
    examples: ['day yday', 'bill 23-may', 'p sambhu 20k yday'],
    notes: ['Date defaults to today for payment, stock-in, and day report.'],
    related: ['help payment', 'help stock', 'help day'],
  },
  amounts: {
    title: 'Amount Formats',
    purpose: 'Indian amount shorthand for payments.',
    syntax: ['2.4l', '0.2l', '20k', '40'],
    examples: ['2.4l = 240000', '0.2l = 20000', '20k = 20000', '40 = 40'],
    notes: ['Plain numbers are literal rupees. The bot does not guess 40 as 40k.'],
    related: ['help payment'],
  },
}

function topicAliases(topic: string) {
  const normalized = topic.trim().toLowerCase()
  if (normalized === 'payments' || normalized === 'pay') return 'payment'
  if (normalized === 'bills' || normalized === 'b') return 'bill'
  if (normalized === 'rates' || normalized === 'r') return 'rate'
  if (normalized === 'date') return 'dates'
  if (normalized === 'amount') return 'amounts'
  if (normalized === 'customer' || normalized === 'customers' || normalized === 'bal' || normalized === 'balance') return 'party'
  return normalized
}

function firstWord(text: string) {
  return text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

function stripPrefix(text: string) {
  return text.trim().split(/\s+/).slice(1).join(' ')
}

function isBillRef(value: string) {
  return /^#?\d{1,4}\/\d{1,5}$/.test(value.trim())
}

function parseBookNo(value: string) {
  return /^\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : 0
}

function field(label: string, value: unknown) {
  return `${BULLET} ${b(label)}: ${escapeHtml(value)}`
}

function fieldRaw(label: string, value: string) {
  return `${BULLET} ${b(label)}: ${value}`
}

function subLine(value: string) {
  return `  ${BULLET} ${value}`
}

function section(title: string, lines: Array<string | false | null | undefined>, icon = '') {
  const content = lines.filter((line): line is string => Boolean(line && line.trim()))
  if (content.length === 0) return ''
  return [`${icon ? `${icon} ` : ''}${b(title)}`, ...content].join('\n')
}

function emptyMessage(icon: string, titleText: string, hint: string) {
  return joinBlocks([heading(icon, titleText), escapeHtml(hint)])
}

function statusLabel(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'paid') return '✅ Paid'
  if (normalized === 'partial') return '🟡 Partial'
  return '🔴 Pending'
}

function statusWord(status: string) {
  return statusLabel(status).replace(/^[^\s]+\s/u, '')
}

function balanceLabel(balance: number) {
  if (balance > 0) return `🔴 Due ${inr(balance)}`
  if (balance < 0) return `🟢 Advance ${inr(Math.abs(balance))}`
  return `✅ Clear ${inr(0)}`
}

function billItemsTable(items: BillSummary['items']) {
  const header = `Item`.padEnd(21) + `Qty`.padStart(10) + ` Rate`.padStart(9) + ` Amount`.padStart(14)
  const rows = items.length > 0
    ? items.map((item) => `${truncateText(item.name, 20).padEnd(21)}${qty(item.qty, 'kg').padStart(10)}${inr(item.rate).padStart(9)}${inr(item.amount).padStart(14)}`)
    : ['-']
  return pre([header, '━'.repeat(header.length), ...rows].join('\n'))
}

function billTotalsTable(bill: BillSummary) {
  const itemTotal = bill.items.reduce((sum, item) => sum + item.amount, 0)
  const gst = bill.gstAmount > 0 ? bill.gstAmount : (itemTotal * bill.gstRate) / 100
  return pre([
    `Items      ${inr(itemTotal).padStart(14)}`,
    gst > 0 ? `GST        ${inr(gst).padStart(14)}` : '',
    bill.transport > 0 ? `Transport  ${inr(bill.transport).padStart(14)}` : '',
    `Grand      ${inr(bill.total).padStart(14)}`,
  ].filter(Boolean).join('\n'))
}

function formatBillSummary(bill: BillSummary) {
  const totalQty = bill.items.reduce((sum, item) => sum + item.qty, 0)
  const gst = bill.gstAmount > 0 ? bill.gstAmount : (bill.items.reduce((sum, item) => sum + item.amount, 0) * bill.gstRate) / 100
  return joinBlocks([
    heading('🧾', `Bill ${bill.ref}`, `${statusLabel(bill.status)} · ${fullDate(bill.date)}`),
    section('Bill summary', [
      field('Party', bill.customerName),
      fieldRaw('Total', b(inr(bill.total))),
      field('Weight', qty(totalQty, 'kg')),
      field('Items', bill.items.length),
    ]),
    section('Charges', [
      gst > 0 ? field('GST', bill.gstAmount > 0 ? inr(bill.gstAmount) : `${bill.gstRate}% (${inr(gst)})`) : '',
      bill.transport > 0 ? field('Transport', inr(bill.transport)) : '',
      bill.lrNo ? field('LR No', bill.lrNo) : '',
    ]),
  ])
}

function formatBillDetails(bill: BillSummary) {
  return joinBlocks([
    section('Items', [billItemsTable(bill.items)]),
    section('Totals', [billTotalsTable(bill)]),
  ])
}

function formatBillList(title: string, bills: BillSummary[]) {
  if (bills.length === 0) return [emptyMessage('🧾', title, 'No bills found.')]
  if (bills.length === 1) return [formatBillSummary(bills[0]), formatBillDetails(bills[0])]

  const rows = bills.map((bill) => {
    const ref = truncateText(bill.ref, 7).padEnd(7)
    const date = bill.date.slice(5).padEnd(5)
    const party = truncateText(bill.customerName, 16).padEnd(16)
    const amount = inr(bill.total).padStart(11)
    const status = truncateText(statusWord(bill.status), 7).padStart(7)
    return `${ref} ${date} ${party} ${amount} ${status}`
  })

  return paginatePreTable({
    icon: '🧾',
    title,
    meta: `${bills.length} bills`,
    header: `Ref`.padEnd(7) + ` Date`.padEnd(6) + ` Party`.padEnd(17) + ` Amount`.padStart(12) + ` Status`.padStart(8),
    rows,
    emptyHint: 'No bills found.',
  })
}

async function sendBillResults(chatId: number, titleText: string, bills: BillSummary[], options: { photoForSingle?: boolean } = {}) {
  for (const message of formatBillList(titleText, bills)) {
    await telegram.sendMessage(chatId, message)
  }

  if (options.photoForSingle && bills.length === 1) {
    const bill = bills[0]
    const printData = await loadBillPrintData(bill.id)
    const image = await createBillPrintJpeg(printData)
    const captionHtml = clampTelegramCaption(joinBlocks([
      heading('🧾', `Bill ${bill.ref}`, `${statusWord(bill.status)} · ${fullDate(bill.date)}`),
      section('Preview', [
        field('Party', bill.customerName),
        fieldRaw('Total', b(inr(bill.total))),
        bill.lrNo ? field('LR No', bill.lrNo) : '',
      ]),
    ]))

    await telegram.sendPhoto(
      chatId,
      image,
      `bill-${bill.ref.replace('/', '-')}.jpg`,
      captionHtml,
    )
  }
}

function formatPayments(title: string, payments: PaymentSummary[]) {
  if (payments.length === 0) return [emptyMessage('💰', title, 'No payments.')]
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0)
  const rows = payments.map((payment) => {
    const date = payment.date.slice(5).padEnd(5)
    const party = truncateText(payment.customerName, 15).padEnd(15)
    const amount = inr(payment.amount).padStart(11)
    const mode = truncateText((payment.mode || '-').toUpperCase(), 4).padStart(4)
    const note = truncateText(payment.note || '-', 16)
    return `${date} ${party} ${amount} ${mode} ${note}`
  })
  return paginatePreTable({
    icon: '💰',
    title,
    meta: `${payments.length} payments · ${inr(total)}`,
    header: `Date`.padEnd(5) + ` Party`.padEnd(16) + ` Amount`.padStart(12) + ` Mode`.padStart(5) + ` Note`,
    rows,
    emptyHint: 'No payments.',
  })
}

function formatStockIn(title: string, rows: StockInSummary[]) {
  if (rows.length === 0) return [emptyMessage('📦', title, 'No stock-in rows.')]
  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0)
  const tableRows = rows.map((row) => {
    const date = row.date.slice(5).padEnd(5)
    const item = truncateText(row.itemName, 12).padEnd(12)
    const quantity = qty(row.qty, 'kg').padStart(10)
    const party = truncateText(row.customerName, 11).padEnd(11)
    const note = truncateText(row.note || '-', 14)
    return `${date} ${item} ${quantity} ${party} ${note}`
  })
  return paginatePreTable({
    icon: '📦',
    title,
    meta: `${rows.length} entries · ${qty(totalQty, 'kg')}`,
    header: `Date`.padEnd(5) + ` Item`.padEnd(13) + ` Qty`.padStart(11) + ` Party`.padEnd(12) + ` Note`,
    rows: tableRows,
    emptyHint: 'No stock-in rows.',
  })
}

function formatStockMovement(title: string, stockRows: StockInSummary[], bills: BillSummary[], items: Awaited<ReturnType<typeof listItems>>) {
  const stockQty = stockRows.reduce((sum, row) => sum + row.qty, 0)
  const stockInByItem = new Map<string, number>()
  for (const row of stockRows) stockInByItem.set(row.itemName, (stockInByItem.get(row.itemName) ?? 0) + row.qty)

  const soldByItem = new Map<string, number>()
  for (const bill of bills) {
    for (const item of bill.items) soldByItem.set(item.name, (soldByItem.get(item.name) ?? 0) + item.qty)
  }

  const itemUnitMap = new Map(items.map((item) => [item.name.toLowerCase(), item.unit || 'kg']))
  const allItemNames = Array.from(new Set([...stockInByItem.keys(), ...soldByItem.keys()])).sort((a, b) => a.localeCompare(b))
  const lines = allItemNames.map((name) => {
    const unit = itemUnitMap.get(name.toLowerCase()) || 'kg'
    const inQty = qty(stockInByItem.get(name) ?? 0, unit).padStart(9)
    const soldQty = qty(soldByItem.get(name) ?? 0, unit).padStart(9)
    return `${truncateText(name, 18).padEnd(18)} ${inQty} ${soldQty}`
  })

  return joinBlocks([
    heading('📦', title, `${qty(stockQty, 'kg')} stock-in total`),
    section('Movement by item', [
      allItemNames.length > 0
        ? pre([`Item`.padEnd(18) + ` In`.padStart(10) + ` Sold`.padStart(10), '━'.repeat(40), ...lines].join('\n'))
        : escapeHtml('No stock movement.'),
    ]),
  ])
}

function formatStockBucketDetailed(bucket: StockBucketSummary) {
  const change = bucket.current - bucket.opening
  return joinBlocks([
    heading('📦', `${bucket.customerName} / ${bucket.itemName}`, `${qty(bucket.current, bucket.unit)} on hand`),
    section('Current snapshot', [
      fieldRaw('Current Stock', b(qty(bucket.current, bucket.unit))),
      field('Opening Stock', qty(bucket.opening, bucket.unit)),
      field('Stock In', qty(bucket.stockIn, bucket.unit)),
      field('Sold', qty(bucket.sold, bucket.unit)),
      bucket.adjustment !== 0 ? field('Adjustment', qty(bucket.adjustment, bucket.unit)) : '',
      field('Net Change', `${change >= 0 ? '+' : '-'}${qty(Math.abs(change), bucket.unit)}`),
    ]),
    section('Month movement', [
      field('In this month', qty(bucket.monthIn, bucket.unit)),
      field('Sold this month', qty(bucket.monthSold, bucket.unit)),
      bucket.bagWeight > 0 ? field('Bag Weight', qty(bucket.bagWeight, 'kg')) : '',
    ]),
  ])
}

function formatStockBucketList(title: string, buckets: StockBucketSummary[]) {
  if (buckets.length === 0) return [emptyMessage('📦', title, 'No stock buckets found.')]
  if (buckets.length === 1) return [formatStockBucketDetailed(buckets[0])]
  const rows = buckets.map((sb) => {
    const label = truncateText(`${sb.customerName.replace(' (General)', '')} / ${sb.itemName}`, 18).padEnd(18)
    const current = qty(sb.current, sb.unit).replace(` ${sb.unit}`, '').padStart(7)
    const opening = qty(sb.opening, sb.unit).replace(` ${sb.unit}`, '').padStart(7)
    const stockIn = qty(sb.stockIn, sb.unit).replace(` ${sb.unit}`, '').padStart(7)
    const sold = qty(sb.sold, sb.unit).replace(` ${sb.unit}`, '').padStart(7)
    const month = `${qty(sb.monthIn, sb.unit).replace(` ${sb.unit}`, '')}/${qty(sb.monthSold, sb.unit).replace(` ${sb.unit}`, '')}`.padStart(11)
    return `${label} ${current} ${opening} ${stockIn} ${sold} ${month}`
  })
  return [
    ...paginatePreTable({
      icon: '📦',
      title,
      meta: `${buckets.length} buckets`,
      header: `Party / Item`.padEnd(18) + ` Current`.padStart(8) + ` Open`.padStart(8) + ` In`.padStart(8) + ` Sold`.padStart(8) + ` Month`.padStart(12),
      rows,
      emptyHint: 'No stock buckets found.',
    }),
    joinBlocks([section('Legend', [escapeHtml('Month = this month in / sold. Quantities are shown in each item unit.')])]),
  ]
}

function formatTopicHelp(topic: HelpTopic) {
  return joinBlocks([
    heading('📘', topic.title),
    escapeHtml(topic.purpose),
    topic.syntax?.length ? section('Syntax', [pre(topic.syntax.join('\n'))]) : '',
    section('Examples', [pre(topic.examples.join('\n'))]),
    section('Notes', topic.notes.map((note) => `${BULLET} ${escapeHtml(note)}`)),
    topic.related?.length ? section('Try next', [topic.related.map((item) => code(item)).join(' · ')]) : '',
  ])
}

async function handlePayment(chatId: number, body: string) {
  const customers = await listCustomers()
  const parsed = parsePaymentCommand(body, customers)
  if (!parsed.ok) {
    await telegram.sendMessage(chatId, joinBlocks([
      heading('⚠️', 'Payment not saved'),
      escapeHtml(parsed.error),
      section('Try', [`${code('p sambhu 2.4l bank yday')}`]),
    ]))
    return
  }
  const id = await savePayment(parsed.command)
  const [dateBalance, currentBalance] = await Promise.all([
    loadCustomerBalance(parsed.command.customer.id, parsed.command.date),
    loadCustomerBalance(parsed.command.customer.id),
  ])
  const currentDiffers = Math.round(dateBalance.balance) !== Math.round(currentBalance.balance)
  await telegram.sendMessage(chatId, joinBlocks([
    heading('✅', 'Payment saved'),
    section('Saved entry', [
      field('Party', parsed.command.customer.name),
      fieldRaw('Amount', b(inr(parsed.command.amount))),
      field('Mode', parsed.command.mode),
      field('Date', fullDate(parsed.command.date)),
      parsed.command.note ? field('Note', parsed.command.note) : '',
    ]),
    section('Account status', [
      fieldRaw(`Balance on ${fullDate(parsed.command.date)}`, b(balanceLabel(dateBalance.balance))),
      currentDiffers ? fieldRaw('Current Balance', b(balanceLabel(currentBalance.balance))) : '',
      fieldRaw('Reference', code(id)),
    ]),
  ]))
}

async function handleStockWrite(chatId: number, body: string) {
  const items = await listItems()
  const parsed = parseStockInCommand(body, items)
  if (!parsed.ok) {
    await telegram.sendMessage(chatId, joinBlocks([
      heading('⚠️', 'Stock not saved'),
      escapeHtml(parsed.error),
      section('Try', [`${code('s 2')} · ${code('s tapper 4 yday')}`]),
    ]))
    return
  }
  const saved = await saveStockIn(parsed.command)
  const buckets = await loadStockBuckets()
  const bucket = buckets.find((row) => row.itemId === parsed.command.item.id && row.customerId === saved.customer.id)
  await telegram.sendMessage(chatId, joinBlocks([
    heading('✅', 'Stock-in saved'),
    section('Saved entry', [
      field('Bucket', `${saved.customer.name} / ${parsed.command.item.name}`),
      fieldRaw('Qty', b(parsed.command.displayQty)),
      field('Date', fullDate(parsed.command.date)),
      parsed.command.note ? field('Note', parsed.command.note) : '',
    ]),
    section('Bucket status', [
      bucket ? fieldRaw('Current Stock', b(qty(bucket.current, bucket.unit))) : '',
      fieldRaw('Reference', code(saved.id)),
    ]),
  ]))
}

async function handleRate(chatId: number, body: string) {
  const token = body.trim()
  const date = token && isDateToken(token) ? parseDateToken(token) : undefined
  const rate = await loadLatestRate(date)
  if (!rate) {
    await telegram.sendMessage(chatId, emptyMessage('📈', 'Brass rate', 'No saved rate found.'))
    return
  }
  const change = rate.previousVilaity > 0 ? rate.vilaity - rate.previousVilaity : 0
  await telegram.sendMessage(chatId, joinBlocks([
    heading('📈', 'Brass rate', fullDate(rate.date)),
    section('Market snapshot', [
      fieldRaw('Vilaity', b(inr(rate.vilaity))),
      field('Honey Gulf', inr(rate.honeyGulf)),
      field('Honey Europe', inr(rate.honeyEurope)),
      field('Delhi Local', inr(rate.delhiLocal)),
      field('LME 3M', rate.lme3m || '-'),
      rate.previousVilaity > 0 ? field('Change vs previous', `${change >= 0 ? '🟢 +' : '🔴 -'}${inr(Math.abs(change))}`) : '',
    ]),
  ]))
}

async function handleStockRead(chatId: number, body: string) {
  const [buckets, items] = await Promise.all([loadStockBuckets(), listItems()])
  const query = body.trim().toLowerCase()
  if (!query) {
    const defaultItem = findDefaultSpindle(items)
    const bucket = buckets.find((row) => row.customerName.toLowerCase().includes('general') && row.itemId === defaultItem?.id)
    await telegram.sendMessage(chatId, bucket ? formatStockBucketDetailed(bucket) : emptyMessage('📦', 'Stock', 'Default General Spindle bucket not found.'))
    return
  }
  const matches = buckets
    .filter((row) => `${row.customerName} ${row.itemName}`.toLowerCase().includes(query) || query.split(/\s+/).every((part) => `${row.customerName} ${row.itemName}`.toLowerCase().includes(part)))
    .slice(0, 8)
  if (matches.length === 0) {
    const item = findBestItem(items, query).match
    const itemMatches = item ? buckets.filter((row) => row.itemId === item.id).slice(0, 8) : []
    const messages = itemMatches.length ? formatStockBucketList(`Stock buckets · ${item?.name}`, itemMatches) : [emptyMessage('📦', 'Stock', `No stock bucket found for ${query}.`)]
    for (const message of messages) await telegram.sendMessage(chatId, message)
    return
  }
  for (const message of formatStockBucketList('Stock buckets', matches)) {
    await telegram.sendMessage(chatId, message)
  }
}

async function handleBill(chatId: number, body: string) {
  const query = body.trim()
  if (!query) {
    await sendBillResults(chatId, 'Recent bills', await searchBills({ limit: 10 }))
    return
  }
  const tokens = query.split(/\s+/).filter(Boolean)
  const refToken = tokens.find(isBillRef)
  if (refToken) {
    await sendBillResults(chatId, `Bill ${refToken}`, await searchBills({ ref: refToken.replace(/^#/, ''), limit: 5 }), { photoForSingle: true })
    return
  }
  const dateToken = tokens.find((token) => isDateToken(token))
  const date = dateToken ? parseDateToken(dateToken) : ''
  const remaining = tokens.filter((token) => token !== dateToken).join(' ')
  const bookNo = !date && tokens.length === 1 ? parseBookNo(tokens[0]) : 0
  if (bookNo > 0) {
    await sendBillResults(chatId, `Book ${bookNo}`, await searchBills({ bookNo, limit: 20 }))
    return
  }
  const customers = await listCustomers()
  const customer = remaining ? findBestCustomer(customers, remaining).match : null
  await sendBillResults(chatId, 'Bills', await searchBills({ customerId: customer?.id, date: date || undefined, limit: 20 }), { photoForSingle: true })
}

async function handleDay(chatId: number, body: string) {
  const token = body.trim()
  const date = token && isDateToken(token) ? parseDateToken(token) : todayIso()
  const [bills, payments, stockRows, items] = await Promise.all([
    searchBills({ date, limit: 100 }),
    listPaymentsForDate(date),
    listStockInForDate(date),
    listItems(),
  ])
  const salesTotal = bills.reduce((sum, bill) => sum + bill.total, 0)
  const paymentTotal = payments.reduce((sum, payment) => sum + payment.amount, 0)
  const cashPayments = payments.filter((payment) => payment.mode.toLowerCase() === 'cash')
  const bankPayments = payments.filter((payment) => payment.mode.toLowerCase() === 'bank')
  const cashTotal = cashPayments.reduce((sum, payment) => sum + payment.amount, 0)
  const bankTotal = bankPayments.reduce((sum, payment) => sum + payment.amount, 0)
  const topSale = bills.length > 0 ? [...bills].sort((a, b) => b.total - a.total)[0] : null
  const topPayment = payments.length > 0 ? [...payments].sort((a, b) => b.amount - a.amount)[0] : null

  const summaryMsg = joinBlocks([
    heading('📅', 'Day report', fullDate(date)),
    section('Financial summary', [
      fieldRaw('Sales', `${b(inr(salesTotal))} (${bills.length} bills)`),
      fieldRaw('Payments', `${b(inr(paymentTotal))} (${payments.length} payments)`),
      field('Cash', inr(cashTotal)),
      field('Bank', inr(bankTotal)),
      fieldRaw('Net position', b(inr(salesTotal - paymentTotal))),
    ]),
    section('Top highlights', [
      topSale ? field('Top sale', `${topSale.customerName} · ${inr(topSale.total)} · Bill ${topSale.ref}`) : `${BULLET} No sales found.`,
      topPayment ? field('Top payment', `${topPayment.customerName} · ${inr(topPayment.amount)} · ${(topPayment.mode || 'cash').toUpperCase()}`) : `${BULLET} No payments found.`,
    ]),
  ])

  await telegram.sendMessage(chatId, summaryMsg)
  for (const message of formatBillList(`Sales · ${fullDate(date)}`, bills)) await telegram.sendMessage(chatId, message)
  for (const message of formatPayments(`Payments · ${fullDate(date)}`, payments)) await telegram.sendMessage(chatId, message)

  await telegram.sendMessage(chatId, formatStockMovement(`Stock movement · ${fullDate(date)}`, stockRows, bills, items))
  for (const message of formatStockIn(`Stock-in rows · ${fullDate(date)}`, stockRows)) await telegram.sendMessage(chatId, message)
}

async function handleParty(chatId: number, raw: string) {
  const customers = await listCustomers()
  const resolved = findBestCustomer(customers, raw)
  if (resolved.ambiguous.length) {
    await telegram.sendMessage(chatId, joinBlocks([
      heading('🔎', 'Which party?'),
      pre(resolved.ambiguous.map((row, index) => `${index + 1}. ${row.name}`).join('\n')),
      `Send a more specific name, for example ${code('bal sambhu')}.`,
    ]))
    return
  }
  if (!resolved.match) {
    await telegram.sendMessage(chatId, emptyMessage('🔎', 'Party not found', `No party matched ${raw}.`))
    return
  }
  const [balance, bills, recentPayments] = await Promise.all([
    loadCustomerBalance(resolved.match.id),
    searchBills({ customerId: resolved.match.id, limit: 8 }),
    getRecentPaymentsForCustomer(resolved.match.id, 8),
  ])

  const latestBill = bills[0]
  const latestPayment = recentPayments[0]
  await telegram.sendMessage(chatId, joinBlocks([
    heading('👤', resolved.match.name, balanceLabel(balance.balance)),
    section('Account snapshot', [
      field('Opening Balance', inr(balance.opening)),
      field('Total Billed', inr(balance.billed)),
      field('Total Paid', inr(balance.paid)),
      fieldRaw('Current Balance', b(balanceLabel(balance.balance))),
    ]),
    section('Recent activity', [
      latestBill ? field('Latest bill', `${latestBill.ref} · ${fullDate(latestBill.date)} · ${inr(latestBill.total)}`) : '',
      latestPayment ? field('Latest payment', `${fullDate(latestPayment.date)} · ${inr(latestPayment.amount)} · ${(latestPayment.mode || 'cash').toUpperCase()}`) : '',
    ]),
  ]))

  for (const message of formatBillList('Recent bills', bills)) await telegram.sendMessage(chatId, message)
  for (const message of formatPayments('Recent payments', recentPayments)) await telegram.sendMessage(chatId, message)
}

function startMessage() {
  return joinBlocks([
    heading('🏭', 'Kapil Pro Companion Bot', 'Fast Telegram access for Kapil Pro'),
    section('What this bot is for', [
      `${BULLET} Quick read access to party, bill, day, stock, and rate info.`,
      `${BULLET} Quick writes only for payments and stock-in.`,
      `${BULLET} Kapil Pro remains the source of truth.`,
    ]),
    section('Write commands', [
      `${BULLET} ${b('Payment')}: ${code('p <party> <amount> [cash|bank] [date] ["note"]')}`,
      subLine(`${i('Example')}: ${code('p sambhu 2.4l bank yday "advance"')}`),
      `${BULLET} ${b('Stock-in')}: ${code('s [item] <qty> [date] ["note"]')}`,
      subLine(`${i('Example')}: ${code('s spindle 2 yday')}`),
    ], '⚡'),
    section('Read commands', [
      `${BULLET} ${b('Party')}: ${code('sambhu')} or ${code('party sambhu')}`,
      `${BULLET} ${b('Bill')}: ${code('bill 52/14')} or ${code('bill sambhu')}`,
      `${BULLET} ${b('Day')}: ${code('day')} or ${code('day yday')}`,
      `${BULLET} ${b('Stock')}: ${code('stock')} or ${code('stock tapper')}`,
      `${BULLET} ${b('Rate')}: ${code('rate')} or ${code('rate yday')}`,
    ], '🔎'),
    section('Get help fast', [
      `${BULLET} Full guide: ${code('/help')}`,
      `${BULLET} Topic guides: ${code('help payment')} · ${code('help stock')} · ${code('help bill')} · ${code('help day')}`,
    ], '📘'),
    section('Business rules', [
      `${BULLET} Bills are read-only in Telegram.`,
      `${BULLET} Telegram must never create or edit bills, customers, items, stock openings, or stock adjustments.`,
      `${BULLET} Only payments and stock-in can be saved from this bot.`,
    ], '🔒'),
  ])
}

function helpMessage(topicRaw = '') {
  const topicKey = topicAliases(topicRaw)
  if (topicKey) {
    const topic = helpTopics[topicKey]
    if (topic) return formatTopicHelp(topic)
    return joinBlocks([
      heading('📘', 'Help topic not found'),
      `Try ${code('help payment')}, ${code('help stock')}, ${code('help bill')}, ${code('help day')}, ${code('help rate')}, or ${code('help party')}.`,
    ])
  }
  return joinBlocks([
    heading('📘', 'Kapil Pro command guide', 'Telegram quick-access workflows'),
    section('Write workflows', [
      `${BULLET} ${b('Payment')}: ${code('p <party> <amount> [cash|bank] [date] ["note"]')}`,
      subLine('Saves a payment and refreshes bill paid / partial / pending status in Kapil Pro.'),
      `${BULLET} ${b('Stock-in')}: ${code('s [item] <qty> [date] ["note"]')}`,
      subLine('Saves stock-in only for the General bucket flow.'),
    ], '⚡'),
    section('Read reports', [
      `${BULLET} ${b('Party')}: ${code('sambhu')} or ${code('party sambhu')}`,
      `${BULLET} ${b('Bill')}: ${code('bill 52/14')} · ${code('bill sambhu')} · ${code('bill yday')}`,
      `${BULLET} ${b('Day')}: ${code('day [date]')}`,
      `${BULLET} ${b('Stock')}: ${code('stock [item/customer]')}`,
      `${BULLET} ${b('Rate')}: ${code('rate [date]')}`,
    ], '🔎'),
    section('Shortcuts', [
      `${BULLET} ${b('Dates')}: ${code('today')} · ${code('yday')} · ${code('-1')} · ${code('23-may')}`,
      `${BULLET} ${b('Amounts')}: ${code('2.4l')} · ${code('20k')} · ${code('40')}`,
    ], '🧩'),
    section('Topic guides', [
      `${code('help payment')} · ${code('help stock')} · ${code('help bill')} · ${code('help day')} · ${code('help party')} · ${code('help dates')} · ${code('help amounts')}`,
    ], '📘'),
    section('Boundaries', [
      `${BULLET} Kapil Pro is the source of truth.`,
      `${BULLET} Telegram can only write payments and stock-in.`,
      `${BULLET} Bills, customers, items, stock openings, and stock adjustments stay read-only here.`,
    ], '🔒'),
  ])
}

async function route(update: TelegramUpdate) {
  const chatId = getChatId(update)
  const text = getMessageText(update)
  if (!chatId || !text) return
  if (!isAllowed(update)) {
    await telegram.sendMessage(chatId, `${heading('🔒', 'Access denied')}\nThis Telegram user is not allowed for Kapil Pro Bot.`)
    return
  }
  const command = firstWord(text)
  const body = stripPrefix(text)
  if (command === '/start') await telegram.sendMessage(chatId, startMessage())
  else if (command === '/ping' || command === 'ping') await telegram.sendMessage(chatId, `${heading('✅', 'Kapil Pro Bot')}\nPocketBase connected.`)
  else if (command === '/help' || command === 'help') await telegram.sendMessage(chatId, helpMessage(body))
  else if (command === 'p' || command === 'pay' || command === 'payment') await handlePayment(chatId, body)
  else if (command === 's') await handleStockWrite(chatId, body)
  else if (command === 'stock') await handleStockRead(chatId, body)
  else if (command === 'rate' || command === 'rates') await handleRate(chatId, body)
  else if (command === 'day') await handleDay(chatId, body)
  else if (command === 'bill' || command === 'b') await handleBill(chatId, body)
  else if (command === 'bal' || command === 'balance' || command === 'party') await handleParty(chatId, body || text)
  else await handleParty(chatId, text)
}

async function main() {
  await connectPocketBase()
  console.log(`Kapil Pro Telegram bot connected to ${env.pocketBaseUrl}`)
  let offset = 0
  for (;;) {
    try {
      const updates = await telegram.getUpdates(offset)
      for (const update of updates) {
        offset = update.update_id + 1
        route(update).catch(async (error: unknown) => {
          const chatId = getChatId(update)
          console.error(error)
          if (chatId) await telegram.sendMessage(chatId, `${heading('⚠️', 'Error')}\n${escapeHtml(error instanceof Error ? error.message : String(error))}`).catch(() => undefined)
        })
      }
    } catch (error) {
      console.error(error)
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
