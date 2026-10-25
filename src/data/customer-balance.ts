import { pb } from '@/data/pocketbase'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { computeNetBalance } from '@/domain/financial-math'
import { isPaymentAttachedToPriorBill, partitionPaymentsForNextBill } from '@/domain/bill-preview'

export type CreditAdjustment = { id: string; date: string; amount: number }

export type AutoBalanceContext = {
  previousBalanceDate: string
  previousBalanceAmount: number
  credits: CreditAdjustment[]
}

type PBRecord = Record<string, unknown> & { id: string }

const num = (v: unknown) => (Number.isFinite(Number(v ?? 0)) ? Number(v) : 0)
const datePart = (v: unknown) => String(v ?? '').slice(0, 10)
const toTs = (v: unknown) => {
  const ts = new Date(String(v ?? '')).getTime()
  return Number.isFinite(ts) ? ts : 0
}

/**
 * Single source of truth for the "previous balance + period credits" context shown
 * on the New Bill preview. The bill JPG renderer must use this exact function so the
 * printed image always matches what was confirmed on screen.
 */
export async function loadCustomerAutoBalanceContext(customerId: string, date: string): Promise<AutoBalanceContext> {
  const [billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
    pb.collection('bills').getFullList({
      sort: 'date,bill_no',
      filter: `customer = "${customerId}"`,
    }),
    pb.collection('bill_items').getFullList({ filter: `bill.customer = "${customerId}"` }),
    pb.collection('payments').getFullList({
      sort: 'date',
      filter: `customer = "${customerId}"`,
    }),
  ])
  const customerRecord = await pb.collection('customers').getOne(customerId)

  const bills = (billsRaw as PBRecord[])
    .filter((bill) => datePart(bill.date) <= date)
    .sort((a, b) => {
      const d = datePart(a.date).localeCompare(datePart(b.date))
      if (d !== 0) return d
      const c = toTs(a.created) - toTs(b.created)
      if (c !== 0) return c
      return String(a.id).localeCompare(String(b.id))
    })
  const billItems = billItemsRaw as PBRecord[]
  const openingBalance = num(customerRecord.opening_balance)

  const priorBills = bills.filter((bill) => datePart(bill.date) < date)
  const priorBillRefs = new Set(
    priorBills.map((bill) => String(bill.bill_ref ?? `${num(bill.book_no)}/${num(bill.bill_no)}`)),
  )
  const allCustomerBillRefs = new Set(
    bills.map((bill) => String(bill.bill_ref ?? `${num(bill.book_no)}/${num(bill.bill_no)}`)),
  )
  const payments = (paymentsRaw as PBRecord[])
    .filter((payment) => {
      const pDate = datePart(payment.date)
      if (pDate <= date) return true
      return isPaymentAttachedToPriorBill(String(payment.note ?? ''), priorBillRefs)
    })
    .map((payment) => ({
      date: datePart(payment.date),
      amount: num(payment.amount),
      createdTs: toTs(payment.created),
      id: String(payment.id),
      note: String(payment.note ?? ''),
    }))

  if (priorBills.length === 0) {
    const openingCredits = payments.filter((entry) => entry.amount > 0)
    return { previousBalanceDate: 'Opening', previousBalanceAmount: openingBalance, credits: openingCredits }
  }

  const itemTotalByBill = new Map<string, number>()
  for (const row of billItems) {
    const billId = String(row.bill ?? '')
    itemTotalByBill.set(billId, (itemTotalByBill.get(billId) ?? 0) + num(row.amount))
  }

  const lastBill = priorBills[priorBills.length - 1]
  const lastBillDate = datePart(lastBill.date)
  const lastBillCreatedTs = toTs(lastBill.created)
  const billTotals = priorBills.map((bill) => ({
    date: datePart(bill.date),
    total: calculateBillTotalFromBase(itemTotalByBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate), num(bill.gst_amount)),
  }))

  const billedUntilLastBill = billTotals.reduce((sum, entry) => sum + entry.total, 0)
  const partitionedPayments = partitionPaymentsForNextBill(payments, {
    cutoffDate: lastBillDate,
    cutoffCreatedTs: lastBillCreatedTs,
    currentBillDate: date,
    priorBillRefs,
    allCustomerBillRefs,
  })
  const paidUntilLastBill = partitionedPayments.previousBalancePayments
    .reduce((sum, entry) => sum + entry.amount, 0)
  const previousBalanceAmount = computeNetBalance(openingBalance, billedUntilLastBill, paidUntilLastBill)

  return {
    previousBalanceDate: lastBillDate || date,
    previousBalanceAmount,
    credits: partitionedPayments.periodCredits,
  }
}
