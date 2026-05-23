import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { compareBusinessDateThenCreatedDesc, type CanonicalBillRecord, type CanonicalPaymentRecord } from '@/domain/records'
import { matchesAnyRankedQuery } from '@/lib/search'

export type BillItemSnapshot = {
  itemId?: string
  itemName: string
  qty: number
  rate: number
}

export type BillSnapshot = CanonicalBillRecord & {
  date: string
  businessDate?: string
  createdAt?: string
  customerId: string
  customerName: string
  bookNo: number
  billNo: number
  mktRate: number
  transport: number
  gstRate: number
  gstAmount?: number
  lrNo: string
  items: BillItemSnapshot[]
}

export type PaymentSnapshot = CanonicalPaymentRecord & {
  date: string
  businessDate?: string
  createdAt?: string
  customerId: string
  customerName: string
  mode: 'Cash' | 'Bank'
  note: string
}

export type TransactionRow =
  | {
      key: string
      id: string
      kind: 'bill'
      date: string
      businessDate: string
      createdAt: string
      customerId: string
      customerName: string
      reference: string
      amount: number
      subtitle: string
      bill: BillSnapshot
    }
  | {
      key: string
      id: string
      kind: 'payment'
      date: string
      businessDate: string
      createdAt: string
      customerId: string
      customerName: string
      reference: string
      amount: number
      subtitle: string
      payment: PaymentSnapshot
    }

export type TrashEntry = {
  key: string
  deletedAt: number
  snapshot: TransactionRow
}

type BuildRowsInput = {
  bills: Array<{
    id: string
    date?: string
    businessDate?: string
    createdAt?: string
    customerId: string
    customerName: string
    bookNo: number
    billNo: number
    mktRate: number
    transport: number
    gstRate: number
    gstAmount?: number
    lrNo: string
  }>
  billItems: Array<{
    billId: string
    itemId?: string
    itemName: string
    qty: number
    rate: number
    amount: number
  }>
  payments: PaymentSnapshot[]
}

export const TRASH_TTL_MS = 3 * 60 * 60 * 1000

export function buildTransactionRows(input: BuildRowsInput): TransactionRow[] {
  const itemsByBill = new Map<string, BillItemSnapshot[]>()
  const amountByBill = new Map<string, number>()
  for (const item of input.billItems) {
    const list = itemsByBill.get(item.billId) ?? []
    list.push({ itemId: item.itemId, itemName: item.itemName, qty: item.qty, rate: item.rate })
    itemsByBill.set(item.billId, list)
    amountByBill.set(item.billId, (amountByBill.get(item.billId) ?? 0) + item.amount)
  }

  const billRows: TransactionRow[] = input.bills.map((bill) => ({
    key: `bill:${bill.id}`,
    id: bill.id,
    kind: 'bill',
    date: bill.date ?? bill.businessDate ?? '',
    businessDate: bill.businessDate ?? bill.date ?? '',
    createdAt: bill.createdAt ?? '',
    customerId: bill.customerId,
    customerName: bill.customerName,
    reference: `${bill.bookNo}/${bill.billNo}`,
    amount: calculateBillTotalFromBase(amountByBill.get(bill.id) ?? 0, bill.transport, bill.gstRate, bill.gstAmount),
    subtitle: 'Bill',
    bill: {
      id: bill.id,
      businessDate: bill.businessDate ?? bill.date ?? '',
      createdAt: bill.createdAt ?? '',
      date: bill.date ?? bill.businessDate ?? '',
      customerId: bill.customerId,
      customerName: bill.customerName,
      bookNo: bill.bookNo,
      billNo: bill.billNo,
      mktRate: bill.mktRate,
      transport: bill.transport,
      gstRate: bill.gstRate,
      gstAmount: bill.gstAmount,
      lrNo: bill.lrNo,
      items: itemsByBill.get(bill.id) ?? [],
    },
  }))

  const paymentRows: TransactionRow[] = input.payments.map((payment) => ({
    key: `payment:${payment.id}`,
    id: payment.id,
    kind: 'payment',
    businessDate: payment.businessDate ?? payment.date ?? '',
    createdAt: payment.createdAt ?? '',
    date: payment.date ?? payment.businessDate ?? '',
    customerId: payment.customerId,
    customerName: payment.customerName,
    reference: payment.mode,
    amount: payment.amount,
    subtitle: 'Payment',
    payment,
  }))

  return [...billRows, ...paymentRows].sort(compareBusinessDateThenCreatedDesc)
}

export function matchesTransactionSearch(row: TransactionRow, search: string) {
  return matchesAnyRankedQuery([row.customerName, row.reference, row.subtitle], search)
}

export function cleanupExpiredTrash(entries: TrashEntry[], nowMs = Date.now(), ttlMs = TRASH_TTL_MS): TrashEntry[] {
  return entries.filter((entry) => nowMs - entry.deletedAt < ttlMs)
}
