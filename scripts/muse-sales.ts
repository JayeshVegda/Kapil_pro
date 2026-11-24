import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { calculateBillTotals, calculateLineAmount, calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { calculateBillingLineBags, calculateGasFinalRate, getBillingBagWeight, getBillingUnit, isGasBillingItem, suggestBillingRate } from '@/domain/billing-modes'
import { buildSalesBalanceContext } from '@/domain/sales-balance-context'
import { compareBusinessDateThenCreatedDesc, computeCustomerOutstanding } from '@/domain/records'
import { roundPaise } from '@/domain/financial-math'
import { getBookRange } from '@/domain/bill-books'
import { buildBillPreviewProps } from '@/lib/bill-preview-props'
import { indiaDate, masterLookup, MusePurchaseError } from './muse-purchase-ledger'

type RecordRow = { id: string } & Record<string, unknown>
const text = (value: unknown) => String(value ?? '').trim()
const day = (value: unknown) => text(value).slice(0, 10)
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const active = (value: unknown) => value !== 0 && value !== false
const canonical = (row: RecordRow) => ({ id: row.id, date: day(row.date), createdAt: text(row.created) })
const labelKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

export function readMuseSalesLedger(databasePath: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 1500 })
  try {
    db.exec('PRAGMA query_only=ON; BEGIN')
    const rows = (table: string) => db.prepare('SELECT * FROM ' + table).all() as RecordRow[]
    return { customers: rows('customers'), items: rows('items'), bills: rows('bills'), billItems: rows('bill_items'),
      payments: rows('payments'), rates: db.prepare('SELECT id, date, vilaity FROM brass_rates WHERE vilaity > 0 ORDER BY date DESC, id DESC').all() as RecordRow[] }
  } finally { db.close() }
}
export type MuseSalesLedger = ReturnType<typeof readMuseSalesLedger>

export function salesCustomerChoices(ledger: MuseSalesLedger) {
  return ledger.customers.map((row) => {
    const aliases = text(row.aliases)
    return { id: row.id, name: text(row.company_name) || text(row.name),
      aliases: [text(row.name), aliases, ...aliases.split(/[\s,]+/)].filter(Boolean).join(','), active: active(row.active) }
  })
}

export function salesCustomer(ledger: MuseSalesLedger, query: string, allowInactive = false) {
  const selected = masterLookup(query, salesCustomerChoices(ledger), allowInactive)
  return { ...selected, row: ledger.customers.find((row) => row.id === selected.id)! }
}

export function salesItem(ledger: MuseSalesLedger, query: string) {
  const selected = masterLookup(query, ledger.items.map((row) => {
    const aliases = text(row.aliases)
    return { id: row.id, name: text(row.name), aliases: [aliases, ...aliases.split(/[\s,/|]+/)].filter(Boolean).join(','), active: active(row.active) }
  }))
  const row = ledger.items.find((row) => row.id === selected.id)!
  return { ...selected, type: text(row.type), unit: text(row.unit), bagWeight: num(row.bag_weight), defaultRate: num(row.default_rate) }
}

export function salesDues(ledger: MuseSalesLedger, asOf: string, query?: string) {
  const customer = query ? salesCustomer(ledger, query, true) : undefined
  const byBill = new Map<string, number>()
  for (const row of ledger.billItems) {
    const id = text(row.bill)
    byBill.set(id, (byBill.get(id) ?? 0) + num(row.amount))
  }
  const group = (rows: RecordRow[]) => {
    const map = new Map<string, RecordRow[]>()
    for (const row of rows) {
      const key = text(row.customer)
      const records = map.get(key) ?? []
      records.push(row)
      map.set(key, records)
    }
    return map
  }
  const billsByCustomer = group(ledger.bills)
  const paymentsByCustomer = group(ledger.payments)
  const customers = (customer ? [customer.row] : ledger.customers).map((row) => {
    const balance = computeCustomerOutstanding({
      asOfDate: asOf,
      openingBalance: day(row.opening_balance_date) <= asOf ? num(row.opening_balance) : 0,
      bills: (billsByCustomer.get(row.id) ?? []).map((bill) => ({
        ...canonical(bill), total: calculateBillTotalFromBase(byBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount)),
      })),
      payments: (paymentsByCustomer.get(row.id) ?? []).map((payment) => ({ ...canonical(payment), amount: num(payment.amount) })),
    })
    return { customerId: row.id, customer: text(row.company_name) || text(row.name), ...balance }
  }).sort((a, b) => b.dueAmount - a.dueAmount || a.customer.localeCompare(b.customer) || a.customerId.localeCompare(b.customerId))
  const sum = (key: 'dueAmount' | 'advanceAmount') => roundPaise(customers.reduce((total, row) => total + row[key], 0))
  const customerBills = customer ? billsByCustomer.get(customer.id) ?? [] : []
  const customerBillIds = new Set(customerBills.map((bill) => bill.id))
  const billPreviewBalance = customer ? buildSalesBalanceContext(customer.row, customerBills,
    ledger.billItems.filter((line) => customerBillIds.has(text(line.bill))), paymentsByCustomer.get(customer.id) ?? [], asOf) : undefined
  return { asOf, currency: 'INR', totalDueRs: sum('dueAmount'), totalAdvanceRs: sum('advanceAmount'), customers,
    ...(billPreviewBalance ? { billPreviewBalance: {
      ...billPreviewBalance, creditsTotalRs: roundPaise(billPreviewBalance.credits.reduce((total, credit) => total + credit.amount, 0)),
    } } : {}),
  }
}

const short = z.string().trim().min(1).max(150)
const money = z.number().finite().nonnegative().max(100_000_000)
const mode = z.enum(['Cash', 'Bank'])
const date = z.iso.date()
const sourceIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9:_./-]+$/)
const header = { customer: short, date, confidence: z.number().min(0).max(1).optional() }
const receipt = z.strictObject({ amount: money.positive(), mode, date: date.optional(), note: z.string().max(1000).optional() })
const billPayload = z.strictObject({
  ...header, book_no: z.number().int().positive().optional(), bill_no: z.number().int().positive().optional(),
  mkt: money.positive().optional(), transport: money.optional(), gst_mode: z.enum(['none', 'percent18', 'manual']).optional(),
  gst_amount: money.positive().optional(), lr_no: z.string().max(200).optional(), notes: z.string().max(1000).optional(),
  items: z.array(z.strictObject({
    item: short, qty: z.number().finite().positive().max(1_000_000), unit: z.enum(['bags', 'kg', 'piece']),
    rate: money.positive().optional(), default_rate: money.optional(),
  })).min(1).max(24),
  payments: z.array(receipt).max(5).optional(),
})
const paymentPayload = z.strictObject({ ...header, ...receipt.shape, date })
const envelope = z.strictObject({
  sourceId: sourceIdSchema, originalMessage: z.string().trim().min(1).max(4000), payload: z.record(z.string(), z.unknown()),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})
export type SalesProposalKind = 'bill' | 'payment' | 'new-customer-bill'

function bad(message: string): never { throw new MusePurchaseError(422, 'CHECK_SALES_PROPOSAL', message) }

export function parseSalesRequest(kind: SalesProposalKind, input: unknown) {
  const result = envelope.parse(input)
  if ('mkt_rate' in result.payload) bad('mkt_rate is not supported. Use mkt for the market rate.')
  if ('gst_rate' in result.payload) bad('Use gst_mode: none, percent18, or manual. For manual GST, send gst_amount.')
  if ('converted_bill' in result.payload || 'converted_payment' in result.payload) bad('Omit converted_bill and converted_payment, even when empty. Kapil sets the converted record on approval.')
  if (typeof result.payload.confidence === 'number' && result.payload.confidence > 1) bad('Confidence is a fraction from 0 to 1; use 0.95, not 95.')
  return kind !== 'payment'
    ? { ...result, kind, payload: billPayload.parse(result.payload) } as const
    : { ...result, kind, payload: paymentPayload.parse(result.payload) } as const
}

export function prepareSalesProposal(request: ReturnType<typeof parseSalesRequest>, ledger: MuseSalesLedger) {
  const newCustomer = request.kind === 'new-customer-bill'
  let similarCustomers: unknown[] = []
  if (newCustomer) {
    try {
      salesCustomer(ledger, request.payload.customer, true)
      bad('This customer already exists. Use a normal Sales bill draft.')
    } catch (error) {
      if (!(error instanceof MusePurchaseError) || error.code !== 'NO_EXACT_MATCH') throw error
      if (Array.isArray(error.details)) similarCustomers = error.details
    }
  }
  const customer = newCustomer
    ? { id: '', name: request.payload.customer, row: { id: '', opening_balance: 0 } }
    : salesCustomer(ledger, request.payload.customer)
  const customerFields = { customer: customer.id, customer_name: customer.name, date: request.payload.date }
  const metadata = { confidence: request.payload.confidence ?? 0.95, raw_text: request.originalMessage }
  if (request.kind === 'payment') {
    const p = request.payload
    const before = salesDues(ledger, p.date, customer.id).customers[0]
    const nextNet = roundPaise(before.netBalance - p.amount)
    return {
      header: { ...customerFields, ...metadata, amount: p.amount, mode: p.mode, note: p.note ?? '' }, items: [], payments: [],
      preview: { ...customerFields, mode: p.mode, amountRs: p.amount, beforeDueRs: before.dueAmount, afterDueRs: Math.max(0, nextNet), afterAdvanceRs: Math.max(0, -nextNet) },
    }
  }
  const p = request.payload
  if (p.bill_no && !p.book_no) bad('Provide book_no with bill_no, or leave both for the app to assign.')
  if (p.bill_no && p.book_no) {
    const range = getBookRange(p.book_no)
    if (p.bill_no < range.firstBillNo || p.bill_no > range.lastBillNo) bad('Bill number is outside this book.')
    if (ledger.bills.some((bill) => num(bill.bill_no) === p.bill_no)) bad('That bill number has already been used.')
  }
  const gstMode = p.gst_mode ?? 'none'
  if ((gstMode === 'manual') !== (p.gst_amount !== undefined)) bad('Provide gst_amount only with gst_mode manual.')
  const customerBills = newCustomer ? [] : ledger.bills.filter((row) => text(row.customer) === customer.id)
  const billById = new Map(customerBills.map((row) => [row.id, row]))
  const customerLines = ledger.billItems.filter((row) => billById.has(text(row.bill)))
  const customerPayments = newCustomer ? [] : ledger.payments.filter((row) => text(row.customer) === customer.id)
  const market = ledger.rates.find((row) => day(row.date) <= p.date && num(row.vilaity) > 0)
  const mkt = p.mkt ?? num(market?.vilaity)
  const rows = p.items.map((input) => {
    const item = salesItem(ledger, input.item)
    const gas = isGasBillingItem(item)
    if (gas && input.unit === 'piece' || !gas && input.unit !== 'piece') bad(`Use ${gas ? 'bags or kg' : 'piece'} for ${item.name}.`)
    if (input.unit !== 'kg' && !Number.isInteger(input.qty)) bad(`Use a whole quantity for ${input.unit}.`)
    if (input.rate !== undefined && input.default_rate !== undefined) bad('Provide only rate or default_rate for a line.')
    if (!gas && input.default_rate !== undefined) bad('Electronic items take a unit rate, not default_rate.')
    if (gas && mkt <= 0) bad('No saved market rate for this date. Provide mkt explicitly.')
    const prior = customerLines
      .filter((row) => (text(row.item) ? text(row.item) === item.id : labelKey(text(row.item_name)) === labelKey(item.name)) && num(row.rate) > 0)
      .map((line) => ({ line, bill: billById.get(text(line.bill))! }))
      .filter(({ bill }) => day(bill.date) <= p.date && (!gas || num(bill.mkt) > 0))
      .sort((a, b) => compareBusinessDateThenCreatedDesc(canonical(a.bill), canonical(b.bill)) || b.line.id.localeCompare(a.line.id))[0]
    const suggested = suggestBillingRate({ item, mktRate: mkt, gstMode, lastRate: prior ? {
      rate: num(prior.line.rate), mktRate: num(prior.bill.mkt), gstRate: num(prior.bill.gst_rate),
    } : undefined })
    const rate = input.rate ?? (input.default_rate !== undefined ? calculateGasFinalRate(input.default_rate, mkt, gstMode) : suggested.rate)
    if (rate <= 0) bad(`No positive rate available for ${item.name}. Provide the final rate.`)
    const qty = input.unit === 'bags' ? input.qty * getBillingBagWeight(item) : input.qty
    return { itemId: item.id, itemName: item.name, qty, rate, amount: calculateLineAmount({ qty, rate }),
      bags: input.unit === 'bags' ? input.qty : calculateBillingLineBags({ qty, item }), type: item.type, unit: getBillingUnit(item),
      rateSource: input.rate !== undefined ? 'explicit_final' : input.default_rate !== undefined ? 'explicit_differential' : prior ? 'last_customer_item_bill' : 'item_default',
      differential: gas ? roundPaise(rate - mkt) : null,
      ...(prior ? { history: { billRef: text(prior.bill.bill_ref), date: day(prior.bill.date), finalRate: num(prior.line.rate), mkt: num(prior.bill.mkt) } } : {}),
    }
  })
  const payments = (p.payments ?? []).map((row) => ({ ...customerFields, ...row, date: row.date ?? p.date, note: row.note ?? '' }))
  if (payments.some((row) => row.date !== p.date)) bad('Use a separate payment draft for a different payment date.')
  const totals = calculateBillTotals({ items: rows, transport: p.transport ?? 0, gstRate: gstMode === 'percent18' ? 18 : 0, gstAmountOverride: p.gst_amount })
  const balance = buildSalesBalanceContext(customer.row, customerBills, customerLines, customerPayments, p.date)
  const preview = buildBillPreviewProps({
    bookNo: p.book_no ?? 0, billNo: p.bill_no ?? 0, date: p.date, customerName: customer.name, mktRate: mkt,
    itemRows: rows, gstAmount: totals.gstAmount, transport: totals.transport, gstRate: totals.gstRate,
    currentBillTotal: totals.grandTotal, balance, quickPayments: payments.map((row, i) => ({ id: `proposal-${i}`, date: row.date, amount: row.amount })),
    totalQty: totals.totalQty, totalBags: rows.reduce((sum, row) => sum + row.bags, 0), lrList: p.lr_no ? [p.lr_no] : [],
  })
  return {
    header: { ...customerFields, ...metadata, mkt, book_no: p.book_no ?? 0, bill_no: p.bill_no ?? 0,
      ...(newCustomer ? { muse_new_customer: true } : {}),
      transport: totals.transport, gst_mode: gstMode, gst_rate: totals.gstRate, gst_amount: totals.gstAmount,
      bill_total: totals.grandTotal, lr_no: p.lr_no ?? '', notes: p.notes ?? '' },
    items: rows.map((row) => ({ item: row.itemId, item_name: row.itemName, qty: row.qty, bags: row.bags, rate: row.rate, amount: row.amount })),
    payments,
    preview: { ...preview, ...(newCustomer ? { newCustomer: true, similarCustomers } : {}), itemRows: rows, currency: 'INR', marketSource: p.mkt ? 'explicit' : market ? 'saved_vilaity' : 'not_required',
      marketDate: !p.mkt && market ? day(market.date) : null,
      creditsTotalRs: roundPaise(preview.periodCreditEntries.reduce((total, credit) => total + credit.amount, 0)),
      dueRs: Math.max(0, roundPaise(preview.finalTotal)), advanceRs: Math.max(0, -roundPaise(preview.finalTotal)) },
  }
}

export function salesAsOf(value?: string | null) { const asOf = date.parse(value ?? indiaDate()); if (asOf > indiaDate()) bad('As-of date cannot be in the future.'); return asOf }
