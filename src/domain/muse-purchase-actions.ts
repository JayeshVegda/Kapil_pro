import { z } from 'zod'
import { isValidCalendarDay } from '@/lib/date'
import { calculateDraftLinePaise, purchaseBillDraftPayloadV2, parsePurchaseBillDraft, parsePurchaseDecimal } from './purchase-bill-draft'
import { MAX_PURCHASE_WEIGHT_G, MAX_PURCHASE_RATE_MILLI } from './supplier-units'

const id = z.string().regex(/^[a-z0-9]{15}$/)
export const purchaseBusinessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((date) => {
  const [year, month, day] = date.split('-').map(Number)
  return isValidCalendarDay(year, month, day)
})

const bardanAction = z.strictObject({
  kind: z.literal('bardan'),
  billId: id, lineId: id,
  bagCount: z.number().int().min(1).max(10_000),
  weightG: z.number().int().min(1).max(MAX_PURCHASE_WEIGHT_G),
  rateMilli: z.number().int().min(1).max(MAX_PURCHASE_RATE_MILLI),
  method: z.enum(['deduct', 'in_kind']),
  date: purchaseBusinessDate,
})

const newSupplierBill = z.strictObject({
  kind: z.literal('new_supplier_bill'),
  bill: purchaseBillDraftPayloadV2.pick({
    supplier_name: true, date: true, pool: true, tax_mode: true,
    gst_rate_bp: true, lines: true, supplier_bill_no: true,
  }).required({ pool: true }).extend({
    supplier_name: z.string().trim().min(2).max(140),
  }),
})

const signedPaise = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000)
const openingShape = {
  date: purchaseBusinessDate,
  kachaPaise: signedPaise,
  gstPaise: signedPaise,
}
const hasBalance = (row: { kachaPaise: number; gstPaise: number }) => row.kachaPaise !== 0 || row.gstPaise !== 0
export const openingBalanceValues = z.strictObject(openingShape).refine(hasBalance, 'Enter a nonzero balance in at least one pool.')
export type OpeningBalanceValues = z.infer<typeof openingBalanceValues>
const openingBalance = z.strictObject({
  kind: z.literal('opening_balance'), supplierId: id, supplierName: z.string().min(1), ...openingShape,
})
export const musePurchaseActionSchema = z.discriminatedUnion('kind', [bardanAction, newSupplierBill, openingBalance])
export type MusePurchaseAction = z.infer<typeof musePurchaseActionSchema>

export function openingBalanceFromRupees(date: unknown, kacha = '0', gst = '0'): OpeningBalanceValues {
  const parse = (text: string, pool: string) => {
    const trimmed = text.trim()
    const normalized = /^-?\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?$/.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed
    return parsePurchaseDecimal(normalized, 2, pool)
  }
  return openingBalanceValues.parse({
    date, kachaPaise: parse(kacha, 'Kacha'), gstPaise: parse(gst, 'GST'),
  })
}

export function prepareMusePurchaseAction(payload: unknown) {
  const action = musePurchaseActionSchema.parse(payload)
  if (action.kind === 'opening_balance') {
    if (!hasBalance(action)) throw new Error('Enter a nonzero balance in at least one pool.')
    return action
  }
  if (action.kind === 'bardan') {
    return { ...action, creditPaise: action.method === 'deduct' ? calculateDraftLinePaise(action.weightG, action.rateMilli) : 0 }
  }
  if (action.bill.pool === 'gst' && (!action.bill.tax_mode || action.bill.tax_mode === 'none' || action.bill.gst_rate_bp == null)) {
    throw new Error('Confirm the GST or RCM type and rate before approving the first bill.')
  }
  const parsed = parsePurchaseBillDraft(2, action.bill)
  if (parsed.kind === 'invalid') throw new Error(parsed.issues.join('; '))
  if (parsed.value.lines.some((line) => line.amount_paise !== calculateDraftLinePaise(line.weight_g, line.rate_milli))) {
    throw new Error('Item amount must match quantity × rate.')
  }
  return { kind: action.kind, bill: parsed.value } as const
}
