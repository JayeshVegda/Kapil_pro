import { pb } from '@/data/pocketbase'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import type { LedgerBill, LedgerPayment } from '@/domain/payment-ledger'

type PBRecord = Record<string, unknown> & { id: string }

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)

export type PaymentCustomerOption = {
  id: string
  name: string
  openingBalance: number
}

export type PaymentLedgerContext = {
  customerId: string
  customerName: string
  openingBalance: number
  bills: LedgerBill[]
  payments: LedgerPayment[]
}

export async function loadPaymentCustomers(): Promise<PaymentCustomerOption[]> {
  const records = await pb.collection('customers').getFullList({ sort: 'name' })
  return (records as PBRecord[]).map((record) => ({
    id: record.id,
    name: String(record.name ?? ''),
    openingBalance: num(record.opening_balance),
  }))
}

export async function loadCustomerPaymentLedger(customerId: string, asOfDate: string): Promise<PaymentLedgerContext> {
  const [customer, billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
    pb.collection('customers').getOne(customerId),
    pb.collection('bills').getFullList({
      sort: 'date,bill_no',
      filter: `customer = "${customerId}" && date <= "${asOfDate}"`,
    }),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList({
      sort: 'date',
      filter: `customer = "${customerId}" && date <= "${asOfDate}"`,
    }),
  ])

  const bills = billsRaw as PBRecord[]
  const billItems = billItemsRaw as PBRecord[]
  const payments = paymentsRaw as PBRecord[]

  const itemSumByBill = new Map<string, number>()
  const itemDetailsByBill = new Map<string, string[]>()
  for (const row of billItems) {
    const billId = String(row.bill ?? '')
    itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(row.amount))
    const itemName = String(row.item_name ?? '').trim() || 'Item'
    const qty = num(row.qty)
    const rate = num(row.rate)
    const detail = `${itemName} ${qty}kg @ ${rate}`
    const prev = itemDetailsByBill.get(billId) ?? []
    prev.push(detail)
    itemDetailsByBill.set(billId, prev)
  }

  return {
    customerId,
    customerName: String(customer.name ?? ''),
    openingBalance: num(customer.opening_balance),
    bills: bills.map((bill) => ({
      id: bill.id,
      date: datePart(bill.date),
      billNo: num(bill.bill_no),
      bookNo: num(bill.book_no),
      total: calculateBillTotalFromBase(itemSumByBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate)),
      compactDetails: (itemDetailsByBill.get(bill.id) ?? []).join(' | '),
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      date: datePart(payment.date),
      amount: num(payment.amount),
      mode: String(payment.mode ?? ''),
    })),
  }
}

export async function savePayment(input: {
  customerId: string
  customerName: string
  date: string
  amount: number
  mode: 'Cash' | 'Bank'
  note?: string
}) {
  await pb.collection('payments').create({
    customer: input.customerId,
    customer_name: input.customerName,
    date: input.date,
    amount: input.amount,
    mode: input.mode,
    note: input.note ?? '',
  })
}

