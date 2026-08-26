import type { BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { dedupeBillPreviewCredits } from '@/domain/bill-preview'

/**
 * Balance context for a bill preview: everything known about the party's
 * standing BEFORE this bill. Both the Ctrl+K palette preview and the New Bill
 * page preview build their print props through here so the math can never
 * drift between them.
 */
export type BillPreviewBalanceContext = {
  previousBalanceDate: string
  previousBalanceAmount: number
  credits: Array<{ id: string; date: string; amount: number }>
}

export type BillPreviewItemRow = {
  itemName: string
  qty: number
  rate: number
  amount: number
  bags: number
  type: string
  unit: string
}

export function buildBillPreviewProps(input: {
  bookNo: number
  billNo: number
  date: string
  customerName: string
  mktRate: number
  itemRows: BillPreviewItemRow[]
  gstAmount: number
  transport: number
  gstRate: number
  currentBillTotal: number
  balance: BillPreviewBalanceContext | null
  /** Same-day payments attached to this bill (quick payments / command payments). */
  quickPayments?: Array<{ id: string; date: string; amount: number }>
  totalQty: number
  totalBags: number
  lrList: Array<string>
}): BillPrintLayoutProps {
  const balance = input.balance
  const previousBalance = balance?.previousBalanceAmount ?? 0
  const creditEntries = [
    ...(balance?.credits ?? []).filter((entry) => entry.amount > 0),
    ...(input.quickPayments ?? []).filter((entry) => entry.amount > 0),
  ]
  const periodCreditEntries = dedupeBillPreviewCredits(creditEntries)
  const totalCredits = periodCreditEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const subtotal = input.currentBillTotal + previousBalance
  return {
    bookNo: input.bookNo,
    billNo: input.billNo,
    date: input.date,
    customerName: input.customerName,
    mkt: input.mktRate,
    itemRows: input.itemRows,
    gstAmount: input.gstAmount,
    transport: input.transport,
    gstRate: input.gstRate,
    currentBillTotal: input.currentBillTotal,
    previousBalance,
    previousBillDate: balance?.previousBalanceDate ?? input.date,
    periodCreditEntries,
    subtotal,
    finalTotal: subtotal - totalCredits,
    totalQty: input.totalQty,
    totalBags: input.totalBags,
    lrList: input.lrList,
  }
}
