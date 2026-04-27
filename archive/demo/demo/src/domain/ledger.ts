import { calculateBillTotalFromBase } from '@/domain/billing-calculations'

export type PartyEvent = {
  id: string
  date: string
  type: 'Opening' | 'Bill' | 'Payment'
  details: string
  debit: number
  credit: number
  balance: number
}

export type PartyRow = {
  customerId: string
  customerName: string
  active: boolean
  openingBalance: number
  billCount: number
  billedTotal: number
  paidTotal: number
  totalWeight: number
  totalBags: number
  totalTransport: number
  totalGst: number
  averageSellingRate: number
  averageSellingWeight: number
  netBalance: number
  dueAmount: number
  advanceAmount: number
  lastBillDate: string
  lastPaymentDate: string
  latestActivityDate: string
  overdueDays: number
  status: 'Clear' | 'Pending' | 'Overdue' | 'Advance'
}

export type PartyKpis = {
  totalDue: number
  totalAdvance: number
  pendingParties: number
  overdueParties: number
}

export type LedgerBill = {
  id: string
  customerId: string
  date: string
  bookNo: number
  billNo: number
  transport: number
  gstRate: number
}

export type LedgerBillItem = {
  billId: string
  amount: number
  qty: number
  bags: number
}

export type LedgerPayment = {
  id: string
  customerId: string
  date: string
  amount: number
  mode: string
}

export type LedgerCustomer = {
  id: string
  name: string
  active: boolean
  openingBalance: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysBetween(fromIsoDate: string, toIsoDate: string) {
  if (!fromIsoDate || !toIsoDate) return 0
  const from = new Date(`${fromIsoDate}T00:00:00`)
  const to = new Date(`${toIsoDate}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY))
}

export function buildPartyRows(params: {
  customers: LedgerCustomer[]
  bills: LedgerBill[]
  billItems: LedgerBillItem[]
  payments: LedgerPayment[]
  asOfDate: string
  overdueDaysThreshold: number
}): PartyRow[] {
  const itemSumByBill = new Map<string, number>()
  const itemQtyByBill = new Map<string, number>()
  const itemBagsByBill = new Map<string, number>()
  for (const item of params.billItems) {
    itemSumByBill.set(item.billId, (itemSumByBill.get(item.billId) ?? 0) + item.amount)
    itemQtyByBill.set(item.billId, (itemQtyByBill.get(item.billId) ?? 0) + item.qty)
    itemBagsByBill.set(item.billId, (itemBagsByBill.get(item.billId) ?? 0) + item.bags)
  }

  return params.customers
    .map((customer) => {
      const bills = params.bills.filter((bill) => bill.customerId === customer.id && bill.date <= params.asOfDate)
      const payments = params.payments.filter((payment) => payment.customerId === customer.id && payment.date <= params.asOfDate)
      const billCount = bills.length
      const totalItemAmount = bills.reduce((sum, bill) => sum + (itemSumByBill.get(bill.id) ?? 0), 0)
      const totalWeight = bills.reduce((sum, bill) => sum + (itemQtyByBill.get(bill.id) ?? 0), 0)
      const totalBags = bills.reduce((sum, bill) => sum + (itemBagsByBill.get(bill.id) ?? 0), 0)
      const totalTransport = bills.reduce((sum, bill) => sum + bill.transport, 0)
      const totalGst = bills.reduce((sum, bill) => sum + ((itemSumByBill.get(bill.id) ?? 0) * bill.gstRate) / 100, 0)
      const billedTotal = bills.reduce((sum, bill) => sum + calculateBillTotalFromBase(itemSumByBill.get(bill.id) ?? 0, bill.transport, bill.gstRate), 0)
      const paidTotal = payments.reduce((sum, payment) => sum + payment.amount, 0)
      const averageSellingRate = totalWeight > 0 ? totalItemAmount / totalWeight : 0
      const averageSellingWeight = billCount > 0 ? totalWeight / billCount : 0
      const netBalance = customer.openingBalance + billedTotal - paidTotal
      const dueAmount = netBalance > 0 ? netBalance : 0
      const advanceAmount = netBalance < 0 ? Math.abs(netBalance) : 0
      const lastBillDate = bills.map((bill) => bill.date).sort().at(-1) ?? ''
      const lastPaymentDate = payments.map((payment) => payment.date).sort().at(-1) ?? ''
      const latestActivityDate = [lastBillDate, lastPaymentDate].filter(Boolean).sort().at(-1) ?? ''
      const overdueDays = dueAmount > 0 ? daysBetween(lastBillDate || latestActivityDate, params.asOfDate) : 0
      const status: PartyRow['status'] =
        dueAmount <= 0 ? (advanceAmount > 0 ? 'Advance' : 'Clear') : overdueDays >= params.overdueDaysThreshold ? 'Overdue' : 'Pending'
      return {
        customerId: customer.id,
        customerName: customer.name,
        active: customer.active,
        openingBalance: customer.openingBalance,
        billCount,
        billedTotal,
        paidTotal,
        totalWeight,
        totalBags,
        totalTransport,
        totalGst,
        averageSellingRate,
        averageSellingWeight,
        netBalance,
        dueAmount,
        advanceAmount,
        lastBillDate,
        lastPaymentDate,
        latestActivityDate,
        overdueDays,
        status,
      }
    })
    .sort((a, b) => b.dueAmount - a.dueAmount || a.customerName.localeCompare(b.customerName))
}

export function buildPartyKpis(rows: PartyRow[]): PartyKpis {
  return {
    totalDue: rows.reduce((sum, row) => sum + row.dueAmount, 0),
    totalAdvance: rows.reduce((sum, row) => sum + row.advanceAmount, 0),
    pendingParties: rows.filter((row) => row.status === 'Pending' || row.status === 'Overdue').length,
    overdueParties: rows.filter((row) => row.status === 'Overdue').length,
  }
}

export function buildPartyEvents(params: {
  openingBalance: number
  bills: Array<{ id: string; date: string; bookNo: number; billNo: number; total: number }>
  payments: Array<{ id: string; date: string; amount: number; mode: string }>
}): PartyEvent[] {
  const timeline: Array<{
    key: string
    date: string
    sortOrder: number
    type: PartyEvent['type']
    details: string
    debit: number
    credit: number
  }> = []

  timeline.push({
    key: 'opening-balance',
    date: '',
    sortOrder: -1,
    type: 'Opening',
    details: 'Opening Balance',
    debit: params.openingBalance > 0 ? params.openingBalance : 0,
    credit: params.openingBalance < 0 ? Math.abs(params.openingBalance) : 0,
  })

  for (const bill of params.bills) {
    timeline.push({
      key: `bill-${bill.id}`,
      date: bill.date,
      sortOrder: 1,
      type: 'Bill',
      details: `Bill ${bill.bookNo}/${bill.billNo}`,
      debit: bill.total,
      credit: 0,
    })
  }

  for (const payment of params.payments) {
    timeline.push({
      key: `payment-${payment.id}`,
      date: payment.date,
      sortOrder: 2,
      type: 'Payment',
      details: `Payment (${payment.mode || 'Bank'})`,
      debit: 0,
      credit: payment.amount,
    })
  }

  timeline.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.sortOrder - b.sortOrder
  })

  let runningBalance = 0
  return timeline.map((entry) => {
    runningBalance += entry.debit - entry.credit
    return {
      id: entry.key,
      date: entry.date || '-',
      type: entry.type,
      details: entry.details,
      debit: entry.debit,
      credit: entry.credit,
      balance: runningBalance,
    }
  })
}

