import { pb } from '@/data/pocketbase'
import { recalculateAndPersistBillStatusesForCustomer } from '@/data/bill-statuses'
import { runDataOperation } from '@/data/reliability'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { formatCustomerDisplayName } from '@/lib/customer-display'
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
  openingBalanceDate: string
  bills: LedgerBill[]
  payments: LedgerPayment[]
}

export type SavedPaymentReceipt = {
  id: string
  customerId: string
  customerName: string
  date: string
  amount: number
  mode: 'Cash' | 'Bank'
  note: string
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function loadPaymentCustomers(): Promise<PaymentCustomerOption[]> {
  const records = await pb.collection('customers').getFullList({ sort: 'company_name,name' })
  return (records as PBRecord[]).map((record) => ({
    id: record.id,
    name: formatCustomerDisplayName(record.company_name, record.name),
    openingBalance: num(record.opening_balance),
  }))
}

export async function loadCustomerPaymentLedger(customerId: string, asOfDate: string): Promise<PaymentLedgerContext> {
  const [customer, billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
    pb.collection('customers').getOne(customerId),
    pb.collection('bills').getFullList({
      sort: 'date,bill_no',
      filter: `customer = "${customerId}"`,
    }),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList({
      sort: 'date',
      filter: `customer = "${customerId}"`,
    }),
  ])

  const bills = (billsRaw as PBRecord[]).filter((bill) => datePart(bill.date) <= asOfDate)
  const billItems = billItemsRaw as PBRecord[]
  const payments = (paymentsRaw as PBRecord[]).filter((payment) => datePart(payment.date) <= asOfDate)
  const storedOpeningBalanceDate = datePart((customer as unknown as PBRecord).opening_balance_date)
  const earliestBillDate = bills.map((bill) => datePart(bill.date)).filter(Boolean).sort()[0] ?? ''
  const earliestPaymentDate = payments.map((payment) => datePart(payment.date)).filter(Boolean).sort()[0] ?? ''
  const openingBalanceDate = storedOpeningBalanceDate || [earliestBillDate, earliestPaymentDate].filter(Boolean).sort()[0] || asOfDate

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
    customerName: formatCustomerDisplayName(customer.company_name, customer.name),
    openingBalance: num(customer.opening_balance),
    openingBalanceDate,
    bills: bills.map((bill) => ({
      id: bill.id,
      businessDate: datePart(bill.date),
      createdAt: String(bill.created),
      customerId,
      customerName: formatCustomerDisplayName(customer.company_name, customer.name),
      billNo: num(bill.bill_no),
      bookNo: num(bill.book_no),
      total: calculateBillTotalFromBase(itemSumByBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount)),
      transport: num(bill.transport),
      gstRate: num(bill.gst_rate),
      mktRate: num(bill.mkt),
      lrNo: String(bill.lr_no ?? ''),
      compactDetails: (itemDetailsByBill.get(bill.id) ?? []).join(' | '),
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      businessDate: datePart(payment.date),
      createdAt: String(payment.created),
      customerId,
      customerName: formatCustomerDisplayName(customer.company_name, customer.name),
      amount: num(payment.amount),
      mode: String(payment.mode ?? ''),
      note: String(payment.note ?? ''),
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
}): Promise<SavedPaymentReceipt> {
  return runDataOperation('save-payment', async () => {
    const created = await pb.collection('payments').create({
      customer: input.customerId,
      customer_name: input.customerName,
      date: input.date,
      amount: input.amount,
      mode: input.mode,
      note: input.note ?? '',
    })
    await recalculateAndPersistBillStatusesForCustomer(input.customerId)
    return {
      id: created.id,
      customerId: input.customerId,
      customerName: input.customerName,
      date: input.date,
      amount: input.amount,
      mode: input.mode,
      note: input.note ?? '',
    }
  })
}

export async function ensurePaymentPersisted(paymentId: string) {
  // PocketBase is usually immediate, but this guards against transient read-after-write lag.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await pb.collection('payments').getOne(paymentId)
      return true
    } catch (error) {
      const status = Number((error as { status?: unknown })?.status ?? 0)
      if (status > 0 && status !== 404) {
        throw error
      }
      await sleep(200 * (attempt + 1))
    }
  }
  return false
}
