import type { SupplierBundle } from '@/data/suppliers'
import type { SupplierLedgerInput } from './supplier-ledger'
import type { SupplierSettlementInput } from './supplier-settlement'
import { hasPendingPurchaseBardan } from './purchase-receipt-memos'
import { parseBagsAtReceiptKg } from './supplier-purchases'

export function bundleToSettlementInput(bundle: SupplierBundle): SupplierSettlementInput {
  return {
    supplier: {
      openingKachaPaise: bundle.supplier.openingKachaPaise,
      openingGstPaise: bundle.supplier.openingGstPaise,
    },
    bills: bundle.bills.map((bill) => ({
      id: bill.id, date: bill.date, created: bill.created, pool: bill.pool,
      taxMode: bill.taxMode, gstRateBp: bill.gstRateBp, cancelled: bill.cancelled,
      bardanPending: hasPendingPurchaseBardan(
        bundle.lines.filter((line) => line.billId === bill.id),
        bundle.bardan.filter((entry) => entry.billId === bill.id),
        parseBagsAtReceiptKg(bill.privateNote),
      ),
    })),
    lines: bundle.lines.map((line) => ({ billId: line.billId, amountPaise: line.amountPaise })),
    adjustments: bundle.adjustments.map((row) => ({ billId: row.billId, type: row.type, amountPaise: row.amountPaise })),
    bardan: bundle.bardan.map((row) => ({
      billId: row.billId, method: row.method, creditPaise: row.creditPaise,
      cashAmountPaise: row.cashAmountPaise, note: row.note,
    })),
    payments: bundle.payments.map((payment) => ({
      id: payment.id, date: payment.date, created: payment.created, pool: payment.pool,
      kind: payment.kind, amountPaise: payment.amountPaise, cancelled: payment.cancelled,
    })),
    allocations: bundle.allocations.map((pin) => ({
      paymentId: pin.paymentId, billId: pin.billId, amountPaise: pin.amountPaise,
    })),
  }
}

export function bundleToLedgerInput(bundle: SupplierBundle, filter?: SupplierLedgerInput['filter']): SupplierLedgerInput {
  const billIds = new Set(bundle.bills.filter((bill) => !bill.cancelled).map((bill) => bill.id))
  return {
    bills: bundle.bills.map((bill) => ({
      id: bill.id, date: bill.date, created: bill.created, pool: bill.pool,
      taxMode: bill.taxMode, gstRateBp: bill.gstRateBp, cancelled: bill.cancelled,
    })),
    lines: bundle.lines.filter((line) => billIds.has(line.billId)).map((line) => ({ billId: line.billId, amountPaise: line.amountPaise })),
    adjustments: bundle.adjustments.filter((row) => billIds.has(row.billId))
      .map((row) => ({ billId: row.billId, type: row.type, amountPaise: row.amountPaise })),
    bardan: bundle.bardan.filter((row) => billIds.has(row.billId)).map((row) => ({
      id: row.id, billId: row.billId, date: row.date, created: row.created, method: row.method,
      creditPaise: row.creditPaise, cashAmountPaise: row.cashAmountPaise, note: row.note,
    })),
    payments: bundle.payments.map((payment) => ({
      id: payment.id, date: payment.date, created: payment.created, pool: payment.pool,
      kind: payment.kind, amountPaise: payment.amountPaise, cancelled: payment.cancelled,
    })),
    openingKachaPaise: bundle.supplier.openingKachaPaise,
    openingGstPaise: bundle.supplier.openingGstPaise,
    filter,
  }
}
