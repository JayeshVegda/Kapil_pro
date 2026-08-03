import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { buildGasSalesReport, type GasSalesGroup } from '@/domain/gas-sales-reporting'

export type ExportCustomer = { id: string; name: string; active?: boolean; openingBalance?: number }
export type ExportItem = { id: string; name: string; type: string; unit?: string }
export type ExportBill = {
  id: string
  date: string
  customerId: string
  customerName: string
  bookNo: number
  billNo: number
  marketRate: number
  transport: number
  gstRate: number
  gstAmount: number
  lrNo: string
}
export type ExportLine = {
  id: string
  billId: string
  itemId: string
  itemName: string
  qty: number
  bags: number
  rate: number
  amount: number
}
export type ExportPayment = { id: string; date: string; customerId: string; amount: number }

export type MonthlyExportSummary = {
  invoiceSales: number
  gasSales: number
  gasKg: number
  gasBags: number
  weightedSellingRate: number | null
  weightedMarketRate: number | null
  premiumPerKg: number | null
  collections: number
  billCount: number
  activeCustomerCount: number
}

export type MonthlyExportReport = {
  month: string
  summary: MonthlyExportSummary
  previous: { month: string; summary: MonthlyExportSummary }
  itemRows: Array<GasSalesGroup & { itemName: string }>
  customerRows: Array<GasSalesGroup & { customerName: string }>
  dailyRows: Array<{ date: string; invoiceSales: number; collections: number; gasSales: number; gasKg: number; gasBags: number; sellingRate: number | null; marketRate: number | null; premiumPerKg: number | null }>
}

export type SalesGroupBy = 'bill' | 'customer' | 'item' | 'day'
export type SalesItemType = 'all' | 'gas' | 'electronic'
export type OutstandingStatus = 'all' | 'positive' | 'overdue'

export type SalesDetailRow = {
  id: string
  billId: string
  date: string
  billRef: string
  customerId: string
  customerName: string
  itemId: string
  itemName: string
  itemType: string
  unit: string
  qty: number
  bags: number
  sellingRate: number
  marketRate: number | null
  premiumPerKg: number | null
  itemAmount: number
  transport: number
  gst: number
  invoiceTotal: number
  lrNo: string
}

export type SalesGroupRow = {
  key: string
  label: string
  invoiceCount: number
  itemSales: number
  quantity: number
  bags: number
  weightedSellingRate: number | null
}

const finite = (value: number) => (Number.isFinite(value) ? value : 0)
const monthOf = (date: string) => date.slice(0, 7)

export function deriveReportDefaults(bills: ExportBill[]) {
  let latest: ExportBill | undefined
  for (const bill of bills) {
    if (!latest || bill.date > latest.date || (bill.date === latest.date && bill.billNo > latest.billNo)) latest = bill
  }
  return latest ? { customerId: latest.customerId, month: monthOf(latest.date) } : { customerId: '', month: '' }
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function billTotals(bills: ExportBill[], lines: ExportLine[]) {
  const baseByBill = new Map<string, number>()
  for (const line of lines) baseByBill.set(line.billId, (baseByBill.get(line.billId) ?? 0) + finite(line.amount))
  return new Map(bills.map((bill) => [bill.id, calculateBillTotalFromBase(baseByBill.get(bill.id) ?? 0, finite(bill.transport), finite(bill.gstRate), finite(bill.gstAmount))]))
}

function gasReportFor(bills: ExportBill[], lines: ExportLine[], items: ExportItem[]) {
  const itemById = new Map(items.map((item) => [item.id, item]))
  return buildGasSalesReport({
    bills: bills.map((bill) => ({ id: bill.id, date: bill.date, customerId: bill.customerId, customerName: bill.customerName, marketRate: bill.marketRate })),
    lines: lines.map((line) => ({
      billId: line.billId,
      itemId: line.itemId,
      itemName: line.itemName,
      itemType: itemById.get(line.itemId)?.type ?? 'gas',
      qty: line.qty,
      bags: line.bags,
      amount: line.amount,
    })),
  })
}

function monthlySummary(month: string, bills: ExportBill[], lines: ExportLine[], payments: ExportPayment[], items: ExportItem[]): MonthlyExportSummary {
  const monthBills = bills.filter((bill) => monthOf(bill.date) === month)
  const monthBillIds = new Set(monthBills.map((bill) => bill.id))
  const monthLines = lines.filter((line) => monthBillIds.has(line.billId))
  const totals = billTotals(monthBills, monthLines)
  const gas = gasReportFor(monthBills, monthLines, items).overall
  return {
    invoiceSales: [...totals.values()].reduce((sum, value) => sum + value, 0),
    gasSales: gas.sales,
    gasKg: gas.kg,
    gasBags: gas.bags,
    weightedSellingRate: gas.weightedSellingRate,
    weightedMarketRate: gas.weightedMarketRate,
    premiumPerKg: gas.premiumPerKg,
    collections: payments.filter((payment) => monthOf(payment.date) === month).reduce((sum, payment) => sum + finite(payment.amount), 0),
    billCount: monthBills.length,
    activeCustomerCount: new Set(monthBills.map((bill) => bill.customerId)).size,
  }
}

export function buildMonthlyExportReport(input: { month: string; bills: ExportBill[]; lines: ExportLine[]; customers: ExportCustomer[]; items: ExportItem[]; payments: ExportPayment[] }): MonthlyExportReport {
  const monthBills = input.bills.filter((bill) => monthOf(bill.date) === input.month)
  const billIds = new Set(monthBills.map((bill) => bill.id))
  const monthLines = input.lines.filter((line) => billIds.has(line.billId))
  const totals = billTotals(monthBills, monthLines)
  const gas = gasReportFor(monthBills, monthLines, input.items)
  const paymentByDay = new Map<string, number>()
  for (const payment of input.payments.filter((row) => monthOf(row.date) === input.month)) paymentByDay.set(payment.date, (paymentByDay.get(payment.date) ?? 0) + payment.amount)
  const salesByDay = new Map<string, number>()
  for (const bill of monthBills) salesByDay.set(bill.date, (salesByDay.get(bill.date) ?? 0) + (totals.get(bill.id) ?? 0))
  const gasByDay = new Map(gas.byDay.map((row) => [row.key, row]))
  const days = new Set([...salesByDay.keys(), ...paymentByDay.keys(), ...gasByDay.keys()])
  const previous = previousMonth(input.month)
  return {
    month: input.month,
    summary: monthlySummary(input.month, input.bills, input.lines, input.payments, input.items),
    previous: { month: previous, summary: monthlySummary(previous, input.bills, input.lines, input.payments, input.items) },
    itemRows: gas.byItem.map((row) => ({ ...row, itemName: row.label })),
    customerRows: gas.byCustomer.map((row) => ({ ...row, customerName: row.label })),
    dailyRows: [...days].sort().map((date) => {
      const dayGas = gasByDay.get(date)
      return {
        date,
        invoiceSales: salesByDay.get(date) ?? 0,
        collections: paymentByDay.get(date) ?? 0,
        gasSales: dayGas?.sales ?? 0,
        gasKg: dayGas?.kg ?? 0,
        gasBags: dayGas?.bags ?? 0,
        sellingRate: dayGas?.weightedSellingRate ?? null,
        marketRate: dayGas?.weightedMarketRate ?? null,
        premiumPerKg: dayGas?.premiumPerKg ?? null,
      }
    }),
  }
}

export function buildSalesExportReport(input: {
  from: string
  to: string
  customerId: string
  itemId: string
  itemType: SalesItemType
  groupBy: SalesGroupBy
  bills: ExportBill[]
  lines: ExportLine[]
  customers: ExportCustomer[]
  items: ExportItem[]
}) {
  const itemById = new Map(input.items.map((item) => [item.id, item]))
  const candidateBills = input.bills.filter((bill) => bill.date >= input.from && bill.date <= input.to && (!input.customerId || bill.customerId === input.customerId))
  const candidateIds = new Set(candidateBills.map((bill) => bill.id))
  const matchingLines = input.lines.filter((line) => {
    if (!candidateIds.has(line.billId)) return false
    if (input.itemId && line.itemId !== input.itemId) return false
    const type = itemById.get(line.itemId)?.type ?? 'gas'
    return input.itemType === 'all' || type === input.itemType
  })
  const matchedBillIds = new Set(matchingLines.map((line) => line.billId))
  const matchedBills = candidateBills.filter((bill) => matchedBillIds.has(bill.id))
  const allCandidateLines = input.lines.filter((line) => matchedBillIds.has(line.billId))
  const totals = billTotals(matchedBills, allCandidateLines)
  const billById = new Map(matchedBills.map((bill) => [bill.id, bill]))
  const detailRows: SalesDetailRow[] = matchingLines.map((line) => {
    const bill = billById.get(line.billId)!
    const item = itemById.get(line.itemId)
    const type = item?.type ?? 'gas'
    return {
      id: line.id,
      billId: bill.id,
      date: bill.date,
      billRef: `${bill.bookNo}/${bill.billNo}`,
      customerId: bill.customerId,
      customerName: bill.customerName,
      itemId: line.itemId,
      itemName: line.itemName,
      itemType: type,
      unit: type === 'gas' ? 'kg' : item?.unit || 'piece',
      qty: line.qty,
      bags: type === 'gas' ? line.bags : 0,
      sellingRate: line.rate,
      marketRate: type === 'gas' && bill.marketRate > 0 ? bill.marketRate : null,
      premiumPerKg: type === 'gas' && bill.marketRate > 0 ? line.rate - bill.marketRate : null,
      itemAmount: line.amount,
      transport: bill.transport,
      gst: bill.gstAmount,
      invoiceTotal: totals.get(bill.id) ?? 0,
      lrNo: bill.lrNo,
    }
  }).sort((a, b) => a.date.localeCompare(b.date) || a.billRef.localeCompare(b.billRef) || a.itemName.localeCompare(b.itemName))

  const grouped = new Map<string, { label: string; billIds: Set<string>; itemSales: number; quantity: number; bags: number; rateValue: number; rateQty: number }>()
  for (const row of detailRows) {
    const key = input.groupBy === 'customer' ? row.customerId : input.groupBy === 'item' ? row.itemId : input.groupBy === 'day' ? row.date : row.billId
    const label = input.groupBy === 'customer' ? row.customerName : input.groupBy === 'item' ? row.itemName : input.groupBy === 'day' ? row.date : `Bill ${row.billRef} · ${row.customerName}`
    const current = grouped.get(key) ?? { label, billIds: new Set<string>(), itemSales: 0, quantity: 0, bags: 0, rateValue: 0, rateQty: 0 }
    current.billIds.add(row.billId)
    current.itemSales += row.itemAmount
    current.quantity += row.qty
    current.bags += row.bags
    if (row.itemType === 'gas' && row.qty > 0) {
      current.rateValue += row.itemAmount
      current.rateQty += row.qty
    }
    grouped.set(key, current)
  }
  const groupRows: SalesGroupRow[] = [...grouped.entries()].map(([key, row]) => ({
    key,
    label: row.label,
    invoiceCount: row.billIds.size,
    itemSales: row.itemSales,
    quantity: row.quantity,
    bags: row.bags,
    weightedSellingRate: row.rateQty > 0 ? row.rateValue / row.rateQty : null,
  })).sort((a, b) => b.itemSales - a.itemSales || a.label.localeCompare(b.label))
  const gasRows = detailRows.filter((row) => row.itemType === 'gas' && row.qty > 0)
  const gasSales = gasRows.reduce((sum, row) => sum + row.itemAmount, 0)
  const gasQty = gasRows.reduce((sum, row) => sum + row.qty, 0)
  return {
    summary: {
      invoiceCount: matchedBills.length,
      invoiceTotal: [...totals.values()].reduce((sum, value) => sum + value, 0),
      itemSales: detailRows.reduce((sum, row) => sum + row.itemAmount, 0),
      quantity: detailRows.reduce((sum, row) => sum + row.qty, 0),
      bags: detailRows.reduce((sum, row) => sum + row.bags, 0),
      weightedSellingRate: gasQty > 0 ? gasSales / gasQty : null,
    },
    detailRows,
    groupRows,
  }
}

export function buildRateAnalysisReport(input: {
  from: string
  to: string
  customerId: string
  itemId: string
  bills: ExportBill[]
  lines: ExportLine[]
  items: ExportItem[]
}) {
  const itemById = new Map(input.items.map((item) => [item.id, item]))
  const billById = new Map(input.bills.filter((bill) => bill.date >= input.from && bill.date <= input.to && (!input.customerId || bill.customerId === input.customerId)).map((bill) => [bill.id, bill]))
  const groups = new Map<string, { customerId: string; customerName: string; itemId: string; itemName: string; sales: number; kg: number; bags: number; marketValue: number; min: number; max: number }>()
  for (const line of input.lines) {
    const bill = billById.get(line.billId)
    const item = itemById.get(line.itemId)
    if (!bill || item?.type !== 'gas' || (input.itemId && line.itemId !== input.itemId) || line.qty <= 0) continue
    const key = `${bill.customerId}:${line.itemId}`
    const row = groups.get(key) ?? { customerId: bill.customerId, customerName: bill.customerName, itemId: line.itemId, itemName: line.itemName || item.name, sales: 0, kg: 0, bags: 0, marketValue: 0, min: line.rate, max: line.rate }
    row.sales += line.amount
    row.kg += line.qty
    row.bags += line.bags
    row.marketValue += bill.marketRate * line.qty
    row.min = Math.min(row.min, line.rate)
    row.max = Math.max(row.max, line.rate)
    groups.set(key, row)
  }
  const rows = [...groups.values()].map((row) => {
    const weightedSellingRate = row.sales / row.kg
    const weightedMarketRate = row.marketValue / row.kg
    return { customerId: row.customerId, customerName: row.customerName, itemId: row.itemId, itemName: row.itemName, gasSales: row.sales, gasKg: row.kg, gasBags: row.bags, weightedSellingRate, weightedMarketRate, premiumPerKg: weightedSellingRate - weightedMarketRate, minSellingRate: row.min, maxSellingRate: row.max }
  }).sort((a, b) => b.gasSales - a.gasSales)
  const gasSales = rows.reduce((sum, row) => sum + row.gasSales, 0)
  const gasKg = rows.reduce((sum, row) => sum + row.gasKg, 0)
  const marketValue = rows.reduce((sum, row) => sum + row.weightedMarketRate * row.gasKg, 0)
  const weightedSellingRate = gasKg ? gasSales / gasKg : null
  const weightedMarketRate = gasKg ? marketValue / gasKg : null
  return { summary: { gasSales, gasKg, gasBags: rows.reduce((sum, row) => sum + row.gasBags, 0), weightedSellingRate, weightedMarketRate, premiumPerKg: weightedSellingRate != null && weightedMarketRate != null ? weightedSellingRate - weightedMarketRate : null }, rows }
}

export function buildOutstandingReport(input: {
  asOf: string
  customerId: string
  status: OutstandingStatus
  customers: ExportCustomer[]
  bills: ExportBill[]
  lines: ExportLine[]
  payments: ExportPayment[]
}) {
  const eligibleBills = input.bills.filter((bill) => bill.date <= input.asOf)
  const totals = billTotals(eligibleBills, input.lines)
  const rows = input.customers.filter((customer) => !input.customerId || customer.id === input.customerId).map((customer) => {
    const customerBills = eligibleBills.filter((bill) => bill.customerId === customer.id)
    const billedAmount = customerBills.reduce((sum, bill) => sum + (totals.get(bill.id) ?? 0), 0)
    const payments = input.payments.filter((payment) => payment.customerId === customer.id && payment.date <= input.asOf).reduce((sum, payment) => sum + payment.amount, 0)
    const openingBalance = customer.openingBalance ?? 0
    const closingBalance = openingBalance + billedAmount - payments
    const oldestActivityDate = customerBills[0]?.date ?? ''
    const ageDays = oldestActivityDate ? Math.max(0, Math.floor((Date.parse(input.asOf) - Date.parse(oldestActivityDate)) / 86_400_000)) : 0
    const ageingBand = ageDays > 90 ? '90+ days' : ageDays > 60 ? '61–90 days' : ageDays > 30 ? '31–60 days' : '0–30 days'
    return { customerId: customer.id, customerName: customer.name, openingBalance, billedAmount, payments, closingBalance, oldestActivityDate, ageDays, ageingBand }
  }).filter((row) => input.status === 'all' ? row.closingBalance !== 0 : input.status === 'positive' ? row.closingBalance > 0 : row.closingBalance > 0 && row.ageDays > 30).sort((a, b) => b.closingBalance - a.closingBalance)
  const positiveRows = rows.filter((row) => row.closingBalance > 0)
  return { summary: { totalOutstanding: positiveRows.reduce((sum, row) => sum + row.closingBalance, 0), customerCount: positiveRows.length, overdueAmount: positiveRows.filter((row) => row.ageDays > 30).reduce((sum, row) => sum + row.closingBalance, 0), largestBalance: positiveRows[0]?.closingBalance ?? 0 }, rows }
}
