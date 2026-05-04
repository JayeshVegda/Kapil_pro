/**
 * Data shapes for Scrap Buying — mirrors billing/payments for supplier-side procurement.
 * Not wired to PocketBase yet; used for typings and placeholder UI only.
 */

export type SupplierId = string

export interface SupplierMaster {
  id: SupplierId
  name: string
  active: boolean
  phone?: string
  gstin?: string
  address?: string
  note?: string
  /** Opening payable (supplier is creditor) — positive means we owe. */
  openingPayable: number
  openingPayableDate?: string
  createdAt: string
  updatedAt: string
}

/** One purchase line — raw material weighed in. */
export interface PurchaseMaterialLine {
  id: string
  materialName: string
  qtyKg: number
  ratePerKg: number
  lineTotal: number
}

/** Deductions reduce net payable (returns, packaging / bardan credit, etc.). */
export interface PurchaseDeductionLine {
  id: string
  kind: 'material_return' | 'bardan' | 'other'
  description: string
  amount: number
}

export interface PurchaseEntry {
  id: string
  businessDate: string
  supplierId: SupplierId
  supplierName: string
  bookRef?: string
  note?: string
  materialLines: PurchaseMaterialLine[]
  deductionLines: PurchaseDeductionLine[]
  grossAmount: number
  totalDeductions: number
  netPayable: number
  createdAt: string
  updatedAt: string
}

export type SupplierPaymentMode = 'Cash' | 'Bank'

export interface SupplierPayment {
  id: string
  businessDate: string
  supplierId: SupplierId
  supplierName: string
  amount: number
  mode: SupplierPaymentMode
  note?: string
  createdAt: string
  updatedAt: string
}

export type PurchaseLogRow =
  | { kind: 'purchase'; record: PurchaseEntry }
  | { kind: 'payment'; record: SupplierPayment }

export interface SupplierLedgerOpening {
  asOfDate: string
  openingPayable: number
}

export interface SupplierLedgerMovement {
  id: string
  businessDate: string
  direction: 'debit_payable' | 'credit_payable'
  narration: string
  amount: number
  balanceAfter: number
}
