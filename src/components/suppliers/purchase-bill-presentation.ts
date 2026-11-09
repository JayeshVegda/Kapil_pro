import type { PurchaseBillDetail } from '@/data/suppliers'
import type { SupplierPurchaseContext } from '@/domain/purchase-read-model'
import { purchaseReceiptMemoText } from '@/domain/purchase-receipt-memos'
import { extractUserNote, parseBagsAtReceiptKg } from '@/domain/supplier-purchases'
import type { BillChittyData, ChittyPaymentRow } from './bill-chitty'

export function buildPurchaseBillPresentation(
  detail: PurchaseBillDetail | null | undefined,
  context: SupplierPurchaseContext | null | undefined,
  { receiptMemosInItemName = false }: { receiptMemosInItemName?: boolean } = {},
) {
  if (!detail || !context || detail.bill.supplierId !== context.bundle.supplier.id) return null
  const { bundle, settlement } = context
  const { bill } = detail
  const settlementBillRow = settlement.pools[bill.pool].bills.find((row) => row.billId === bill.id) ?? null
  const paymentsById = new Map(bundle.payments.map((payment) => [payment.id, payment]))
  const paymentRows: ChittyPaymentRow[] = settlementBillRow?.creditsApplied?.length
    ? settlementBillRow.creditsApplied.map((credit) => {
      const payment = credit.paymentId ? paymentsById.get(credit.paymentId) : undefined
      return {
        date: credit.date || payment?.date || '',
        mode: payment?.mode ?? '',
        reference: payment?.reference || credit.reference || '',
        amountPaise: credit.amountPaise,
        pinned: credit.pinned,
      }
    })
    : detail.allocations.flatMap((pin) => {
      const payment = paymentsById.get(pin.paymentId)
      if (pin.amountPaise <= 0 || payment?.cancelled) return []
      return [{
        date: payment?.date ?? '', mode: payment?.mode ?? '', reference: payment?.reference ?? '',
        amountPaise: pin.amountPaise, pinned: true,
      }]
    })

  const chitty: BillChittyData = {
    inNo: bill.inNo,
    date: bill.date,
    supplierName: bundle.supplier.companyName,
    pool: bill.pool,
    taxMode: bill.taxMode,
    gstRateBp: bill.gstRateBp,
    supplierBillNo: bill.supplierBillNo,
    lines: detail.lines.map((line) => {
      const memo = purchaseReceiptMemoText(line.receiptMemo ?? '')
      return {
        itemName: receiptMemosInItemName && memo ? `${line.itemName} (${memo})` : line.itemName,
        weightG: line.weightG, rateMilli: line.rateMilli, amountPaise: line.amountPaise,
        bardanText: memo || undefined,
      }
    }),
    adjustments: detail.adjustments.map(({ type, amountPaise, note }) => ({ type, amountPaise, note })),
    bardan: detail.bardan.map(({ bardanG, rateMilli, method, creditPaise, cashAmountPaise, date, note }) =>
      ({ bardanG, rateMilli, method, creditPaise, cashAmountPaise, date, note })),
    paidRows: paymentRows,
    cancelled: bill.cancelled,
    cancelReason: bill.cancelReason,
    statusOverride: settlementBillRow?.status,
  }
  return {
    chitty, paymentRows, settlementBillRow,
    privateNote: bill.privateNote,
    userNote: extractUserNote(bill.privateNote),
    bagsAtReceiptKg: parseBagsAtReceiptKg(bill.privateNote),
  }
}
