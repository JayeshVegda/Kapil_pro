import type { SupplierView, PurchaseItemView, PurchaseBillView, PurchaseLineView, PurchaseAdjustmentView, PurchaseBardanView, SupplierPaymentView, SupplierAllocationView } from './suppliers'
import { readSettledBagCount } from '@/domain/purchase-receipt-memos'

export type PBRow = Record<string, unknown> & { id: string }

export function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function text(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

export function day(value: unknown): string {
  return text(value).slice(0, 10)
}

export function bool(value: unknown): boolean {
  return value === true || value === 1
}

function photoList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

export const mapSupplier = (row: PBRow): SupplierView => ({
  id: row.id,
  companyName: text(row.company_name),
  aliases: text(row.aliases),
  contactName: text(row.contact_name),
  phone: text(row.phone),
  gstNo: text(row.gst_no),
  city: text(row.city),
  notes: text(row.notes),
  openingKachaPaise: num(row.opening_kacha_paise),
  openingGstPaise: num(row.opening_gst_paise),
  openingBalanceDate: day(row.opening_balance_date),
  active: row.active === undefined ? true : bool(row.active),
  created: text(row.created),
})

export const mapItem = (row: PBRow): PurchaseItemView => ({
  id: row.id,
  name: text(row.name),
  aliases: text(row.aliases),
  active: row.active === undefined ? true : bool(row.active),
  created: text(row.created),
})

export const mapBill = (row: PBRow): PurchaseBillView => ({
  id: row.id,
  supplierId: text(row.supplier),
  inNo: text(row.in_no),
  supplierBillNo: text(row.supplier_bill_no),
  date: day(row.date),
  pool: text(row.pool) === 'gst' ? 'gst' : 'kacha',
  taxMode: text(row.tax_mode) || 'none',
  gstRateBp: num(row.gst_rate_bp),
  groupId: text(row.group_id),
  vehicleNo: text(row.vehicle_no),
  privateNote: text(row.private_note),
  photos: photoList(row.photos),
  cancelled: bool(row.cancelled),
  cancelReason: text(row.cancel_reason),
  created: text(row.created),
})

export const mapLine = (row: PBRow): PurchaseLineView => ({
  id: row.id,
  billId: text(row.bill),
  itemId: text(row.item),
  itemName: text(row.item_name),
  weightG: num(row.weight_g),
  rateMilli: num(row.rate_milli),
  amountPaise: num(row.amount_paise),
  created: text(row.created),
})

export const mapAdjustment = (row: PBRow): PurchaseAdjustmentView => ({
  id: row.id,
  billId: text(row.bill),
  type: text(row.type),
  amountPaise: num(row.amount_paise),
  note: text(row.note),
  created: text(row.created),
})

export const mapBardan = (row: PBRow): PurchaseBardanView => ({
  id: row.id,
  billId: text(row.bill),
  bardanG: num(row.bardan_g),
  rateLineId: text(row.rate_line),
  rateMilli: num(row.rate_milli),
  method: text(row.method),
  creditPaise: num(row.credit_paise),
  cashAmountPaise: num(row.cash_amount_paise),
  date: day(row.date),
  ...readSettledBagCount(text(row.note)),
  created: text(row.created),
})

export const mapPayment = (row: PBRow): SupplierPaymentView => ({
  id: row.id,
  supplierId: text(row.supplier),
  date: day(row.date),
  pool: text(row.pool) === 'gst' ? 'gst' : 'kacha',
  kind: text(row.kind),
  amountPaise: num(row.amount_paise),
  mode: text(row.mode),
  reference: text(row.reference),
  payeeName: text(row.payee_name),
  privateNote: text(row.private_note),
  photos: photoList(row.photos),
  cancelled: bool(row.cancelled),
  cancelReason: text(row.cancel_reason),
  created: text(row.created),
})

export const mapAllocation = (row: PBRow): SupplierAllocationView => ({
  id: row.id,
  paymentId: text(row.payment),
  billId: text(row.bill),
  amountPaise: num(row.amount_paise),
  created: text(row.created),
})
