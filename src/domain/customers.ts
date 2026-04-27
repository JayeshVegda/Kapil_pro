import { calculateBillTotalFromBase } from '@/domain/billing-calculations'

export type CustomerRecord = {
  id: string
  name: string
  active: boolean
  openingBalance: number
  phone?: string
  gstin?: string
  address?: string
  creditLimit?: number
  note?: string
}

export type BillRecord = {
  id: string
  customerId: string
  customerName: string
  date: string
  bookNo: number
  billNo: number
  transport: number
  gstRate: number
}

export type BillItemRecord = {
  billId: string
  amount: number
}

export type PaymentRecord = {
  id: string
  customerId: string
  customerName: string
  date: string
  amount: number
}

export type CustomerLedgerSummary = {
  customer: CustomerRecord
  billedTotal: number
  paidTotal: number
  openingBalance: number
  netBalance: number
  dueAmount: number
  advanceAmount: number
  balanceLabel: 'Due' | 'Advance' | 'Clear'
  lastBillDate: string
  lastPaymentDate: string
}

export function buildCustomerLedgerSummaries(params: {
  customers: CustomerRecord[]
  bills: BillRecord[]
  billItems: BillItemRecord[]
  payments: PaymentRecord[]
}): CustomerLedgerSummary[] {
  const itemSumByBill = new Map<string, number>()
  for (const row of params.billItems) {
    itemSumByBill.set(row.billId, (itemSumByBill.get(row.billId) ?? 0) + row.amount)
  }

  const billTotalByCustomer = new Map<string, number>()
  const lastBillDateByCustomer = new Map<string, string>()
  for (const bill of params.bills) {
    const billTotal = calculateBillTotalFromBase(itemSumByBill.get(bill.id) ?? 0, bill.transport, bill.gstRate)
    billTotalByCustomer.set(bill.customerId, (billTotalByCustomer.get(bill.customerId) ?? 0) + billTotal)
    const currentLast = lastBillDateByCustomer.get(bill.customerId) ?? ''
    if (bill.date > currentLast) lastBillDateByCustomer.set(bill.customerId, bill.date)
  }

  const paymentTotalByCustomer = new Map<string, number>()
  const lastPaymentDateByCustomer = new Map<string, string>()
  for (const payment of params.payments) {
    paymentTotalByCustomer.set(payment.customerId, (paymentTotalByCustomer.get(payment.customerId) ?? 0) + payment.amount)
    const currentLast = lastPaymentDateByCustomer.get(payment.customerId) ?? ''
    if (payment.date > currentLast) lastPaymentDateByCustomer.set(payment.customerId, payment.date)
  }

  return params.customers
    .map((customer) => {
      const billedTotal = billTotalByCustomer.get(customer.id) ?? 0
      const paidTotal = paymentTotalByCustomer.get(customer.id) ?? 0
      const netBalance = customer.openingBalance + billedTotal - paidTotal
      const dueAmount = netBalance > 0 ? netBalance : 0
      const advanceAmount = netBalance < 0 ? Math.abs(netBalance) : 0
      const balanceLabel: 'Due' | 'Advance' | 'Clear' = dueAmount > 0 ? 'Due' : advanceAmount > 0 ? 'Advance' : 'Clear'
      return {
        customer,
        billedTotal,
        paidTotal,
        openingBalance: customer.openingBalance,
        netBalance,
        dueAmount,
        advanceAmount,
        balanceLabel,
        lastBillDate: lastBillDateByCustomer.get(customer.id) ?? '',
        lastPaymentDate: lastPaymentDateByCustomer.get(customer.id) ?? '',
      }
    })
    .sort((a, b) => a.customer.name.localeCompare(b.customer.name))
}

