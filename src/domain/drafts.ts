/**
 * Pure draft view model for the AI Drafts page. Data access lives in
 * src/data/bill-drafts.ts; this module only shapes and computes.
 */

export type DraftItemMaster = {
  id: string
  name: string
  type: string
  unit: string
  bagWeight: number
  aliases?: string
}

export type DraftRecordInput = {
  id: string
  created?: string
  status?: string
  customer?: string
  customer_name?: string
  book_no?: number
  bill_no?: number
  date?: string
  mkt?: number
  transport?: number
  gst_mode?: string
  gst_rate?: number
  gst_amount?: number
  lr_no?: string
  confidence?: number
  notes?: string
  raw_text?: string
  converted_bill?: string
  expand?: {
    customer?: { id: string; name?: string; company_name?: string } | null
  }
}

export type DraftPaymentInput = {
  id?: string
  amount: number
  mode?: string
  date?: string
  note?: string
}

export type DraftItemRow = {
  itemName: string
  qty: number
  bags: number
  rate: number
  amount: number
  isGas: boolean
  matched: boolean
  unit: string
}

export type DraftView = {
  id: string
  created: string
  status: string
  customerId: string
  customerName: string
  isPartyLinked: boolean
  confidence: number
  date: string
  bookNo: number
  billNo: number
  mkt: number
  transport: number
  gstMode: string
  gstRate: number
  gstAmount: number
  lrNo: string
  notes: string
  convertedBill: string
  rows: DraftItemRow[]
  payments: DraftPaymentInput[]
  itemsSubtotal: number
  grandTotal: number
  totalQty: number
  totalBags: number
  advanceTotal: number
  /** true when at least one row has no rate yet (Muse left it for auto-suggest) */
  hasAutoRates: boolean
  /** grand total only counts rows with rates; when hasAutoRates, it is an estimate */
  isEstimate: boolean
}

const num = (v: unknown) => {
  const parsed = Number(v ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const round2 = (v: number) => Math.round(v * 100) / 100

function matchItemByName(name: string, itemId: string, items: DraftItemMaster[]): DraftItemMaster | null {
  const target = name.trim().toLowerCase()
  if (itemId) {
    const byId = items.find((item) => item.id === itemId)
    if (byId) return byId
  }
  if (!target) return null
  const byName = items.find((item) => item.name.trim().toLowerCase() === target)
  if (byName) return byName
  return (
    items.find((item) => {
      if (!item.aliases) return false
      // Aliases mix phrases ("spindle 8.5") and tokens ("de") with unknown
      // separators (space/comma). Normalize separators to spaces and require the
      // target to appear on word boundaries — exact, no substring false positives.
      const haystack = ` ${item.aliases.toLowerCase().replace(/[,/|]+/g, ' ').replace(/\s+/g, ' ')} `
      return haystack.includes(` ${target} `)
    }) ?? null
  )
}

export function buildDraftView(draft: DraftRecordInput, itemRows: Array<Record<string, unknown>>, payments: DraftPaymentInput[], items: DraftItemMaster[]): DraftView {
  const customerName =
    String(draft.customer_name ?? '') ||
    String(draft.expand?.customer?.company_name ?? '') ||
    String(draft.expand?.customer?.name ?? '') ||
    ''
  const customerId = String(draft.customer || draft.expand?.customer?.id || '')

  const rows: DraftItemRow[] = itemRows.map((row) => {
    const rawName = String(row.item_name ?? 'Item')
    const master = matchItemByName(rawName, String(row.item ?? ''), items)
    const bagWeight = num(master?.bagWeight) || 50
    const qty = num(row.qty) > 0 ? num(row.qty) : num(row.bags) > 0 ? num(row.bags) * bagWeight : 0
    const bags = num(row.bags) > 0 ? num(row.bags) : Math.round(qty / bagWeight)
    const rate = num(row.rate)
    const amount = num(row.amount) > 0 ? num(row.amount) : round2(qty * rate)
    return {
      itemName: master?.name ?? rawName,
      qty,
      bags,
      rate,
      amount,
      isGas: String(master?.type ?? 'gas') === 'gas',
      matched: Boolean(master),
      unit: String(master?.unit ?? (String(master?.type ?? 'gas') === 'gas' ? 'kg' : 'pcs')),
    }
  })

  const itemsSubtotal = round2(rows.reduce((sum, row) => sum + row.amount, 0))
  const gstMode = String(draft.gst_mode ?? '')
  const dictatedGstAmount = num(draft.gst_amount)
  const gstRate = num(draft.gst_rate)
  const gstAmount =
    gstMode === 'manual' && dictatedGstAmount > 0
      ? dictatedGstAmount
      : gstRate > 0
        ? round2((itemsSubtotal * gstRate) / 100)
        : 0
  const transport = num(draft.transport)
  const grandTotal = round2(itemsSubtotal + gstAmount + transport)
  const hasAutoRates = rows.some((row) => row.rate <= 0 && row.qty > 0)

  return {
    id: draft.id,
    created: String(draft.created ?? ''),
    status: String(draft.status ?? 'pending_review'),
    customerId,
    customerName,
    isPartyLinked: Boolean(customerId),
    confidence: num(draft.confidence),
    date: String(draft.date ?? '').slice(0, 10),
    bookNo: num(draft.book_no),
    billNo: num(draft.bill_no),
    mkt: num(draft.mkt),
    transport,
    gstMode: gstMode || (gstRate > 0 ? 'percent18' : 'none'),
    gstRate,
    gstAmount,
    lrNo: String(draft.lr_no ?? ''),
    notes: String(draft.notes ?? ''),
    convertedBill: String(draft.converted_bill ?? ''),
    rows,
    payments,
    itemsSubtotal,
    grandTotal,
    totalQty: rows.reduce((sum, row) => sum + row.qty, 0),
    totalBags: rows.reduce((sum, row) => sum + row.bags, 0),
    advanceTotal: round2(payments.reduce((sum, payment) => sum + num(payment.amount), 0)),
    hasAutoRates,
    isEstimate: hasAutoRates,
  }
}
