import type { PurchaseBillDetail } from '@/data/suppliers'
import type { SupplierPurchaseContext } from '@/domain/purchase-read-model'
import type { SupplierSettlementPoolResult } from '@/domain/supplier-settlement'
import { purchaseReceiptMemoText } from '@/domain/purchase-receipt-memos'
import { extractUserNote, parseBagsAtReceiptKg } from '@/domain/supplier-purchases'
import type { BillChittyData, ChittyPaymentRow } from './bill-chitty'

export function purchaseChittyCreditLabel(kind: string | undefined, reference: string | undefined, hasPayment: boolean) {
  if (kind === 'bardan_advance') return 'Bardan advance applied'
  if (kind === 'settle_off') return 'Settlement credit applied'
  if (kind === 'paid_on_behalf') return 'Paid on behalf'
  if (!hasPayment) return reference === 'Opening Advance' ? 'Opening Advance' : 'Credit applied'
  return undefined
}

export function hasPurchasePaymentNote(value?: string): boolean {
  const note = value?.trim()
  return Boolean(note && !/^Paid with purchase bill \S+$/i.test(note))
}

export function purchaseChittyAdvance(
  billId: string,
  payments: SupplierSettlementPoolResult['payments'],
  allocations: ReadonlyArray<{ paymentId: string; billId: string; amountPaise: number }>,
): number {
  const linkedPaymentIds = new Set(allocations.filter((pin) => pin.billId === billId && pin.amountPaise > 0).map((pin) => pin.paymentId))
  for (const pin of allocations) {
    if (pin.billId !== billId && pin.amountPaise > 0) linkedPaymentIds.delete(pin.paymentId)
  }
  return payments.reduce((sum, payment) => (
    linkedPaymentIds.has(payment.paymentId) && !payment.cancelled && payment.kind === 'payment'
      ? sum + Math.max(0, payment.amountPaise - payment.appliedPaise)
      : sum
  ), 0)
}

export function buildPurchaseBillPresentation(
  detail: PurchaseBillDetail | null | undefined,
  context: SupplierPurchaseContext | null | undefined,
  { receiptMemosInItemName = false }: { receiptMemosInItemName?: boolean } = {},
) {
  if (!detail || !context || detail.bill.supplierId !== context.bundle.supplier.id) return null
  const { bundle, settlement } = context
  const { bill } = detail
  const bagsAtReceiptKg = parseBagsAtReceiptKg(bill.privateNote)
  const settlementBillRow = settlement.pools[bill.pool].bills.find((row) => row.billId === bill.id) ?? null
  const paymentsById = new Map(bundle.payments.map((payment) => [payment.id, payment]))
  const paymentRows: ChittyPaymentRow[] = settlementBillRow?.creditsApplied?.length
    ? settlementBillRow.creditsApplied.map((credit) => {
      const payment = credit.paymentId ? paymentsById.get(credit.paymentId) : undefined
      return {
        date: credit.date || payment?.date || '',
        mode: payment?.mode ?? '',
        reference: payment?.reference || credit.reference || '',
        creditLabel: purchaseChittyCreditLabel(payment?.kind, credit.reference, Boolean(payment)),
        ...(hasPurchasePaymentNote(payment?.privateNote) ? { hasNote: true } : {}),
        amountPaise: credit.amountPaise,
        pinned: credit.pinned,
      }
    })
    : detail.allocations.flatMap((pin) => {
      const payment = paymentsById.get(pin.paymentId)
      if (pin.amountPaise <= 0 || payment?.cancelled) return []
      return [{
        date: payment?.date ?? '', mode: payment?.mode ?? '', reference: payment?.reference ?? '',
        creditLabel: purchaseChittyCreditLabel(payment?.kind, undefined, Boolean(payment)),
        ...(hasPurchasePaymentNote(payment?.privateNote) ? { hasNote: true } : {}),
        amountPaise: pin.amountPaise, pinned: true,
      }]
    })

  const advancePaise = purchaseChittyAdvance(bill.id, settlement.pools[bill.pool].payments, bundle.allocations)
  const chitty: BillChittyData = {
    inNo: bill.inNo,
    date: bill.date,
    supplierName: bundle.supplier.companyName,
    pool: bill.pool,
    taxMode: bill.taxMode,
    gstRateBp: bill.gstRateBp,
    supplierBillNo: bill.supplierBillNo,
    bagsAtReceiptKg,
    vehicleNo: bill.vehicleNo,
    lines: detail.lines.map((line) => {
      const memo = purchaseReceiptMemoText(line.receiptMemo ?? '')
      return {
        itemName: receiptMemosInItemName && memo ? `${line.itemName} (${memo})` : line.itemName,
        weightG: line.weightG, rateMilli: line.rateMilli, amountPaise: line.amountPaise,
        bardanText: memo || undefined,
      }
    }),
    adjustments: detail.adjustments.map(({ type, amountPaise, note }) => ({ type, amountPaise, note })),
    bardan: detail.bardan.map((entry) => ({
      ...entry,
      itemName: detail.lines.find((line) => line.id === entry.rateLineId)?.itemName,
    })),
    paidRows: paymentRows,
    advancePaise,
    cancelled: bill.cancelled,
    cancelReason: bill.cancelReason,
    statusOverride: settlementBillRow?.status,
  }
  return {
    chitty, paymentRows, settlementBillRow,
    privateNote: bill.privateNote,
    userNote: extractUserNote(bill.privateNote),
    bagsAtReceiptKg,
  }
}
