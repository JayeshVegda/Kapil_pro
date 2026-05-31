export type BillMode = 'kacha' | 'gst'
export type SupplierPaymentMode = 'cash' | 'bank' | 'upi' | 'cheque' | 'other'
export type PurchaseCalculationMode = 'deduct_before_amount' | 'deduct_after_amount'
export type PurchaseDeductionKind = 'faulty_return' | 'rate_cut' | 'bardan' | 'other'
export type PurchasePaidStatus = 'pending' | 'partial' | 'paid'

export type SupplierMaster = {
  id: string
  name: string
  active: boolean
  phone: string
  gstin: string
  address: string
  defaultBillMode: BillMode
  openingPayable: number
  openingPayableDate: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type PurchaseMaterialLineInput = {
  materialName: string
  grossKg: number
  bagCount: number
  bagKg: number
  rate: number
  calculationMode: PurchaseCalculationMode
}

export type PurchaseMaterialLine = PurchaseMaterialLineInput & {
  id: string
  purchaseBillId: string
  netKg: number
  grossAmount: number
  bagDeductionAmount: number
  lineAmount: number
}

export type PurchaseDeductionLineInput = {
  kind: PurchaseDeductionKind
  materialName: string
  description: string
  qtyKg: number
  rate: number
  amount: number
  affectsStock: boolean
}

export type PurchaseDeductionLine = PurchaseDeductionLineInput & {
  id: string
  purchaseBillId: string
}

export type PurchaseEntry = {
  id: string
  date: string
  supplierId: string
  supplierName: string
  billMode: BillMode
  supplierBillNo: string
  internalRef: string
  materialTotal: number
  deductionTotal: number
  taxableValue: number
  gstRate: number
  gstAmount: number
  grandTotal: number
  paidStatus: PurchasePaidStatus
  supplierGstin: string
  invoiceNo: string
  invoiceDate: string
  note: string
  createdAt: string
  updatedAt: string
  materialLines: PurchaseMaterialLine[]
  deductionLines: PurchaseDeductionLine[]
}

export type SupplierPayment = {
  id: string
  date: string
  supplierId: string
  supplierName: string
  amount: number
  mode: SupplierPaymentMode
  billModeScope: BillMode
  note: string
  createdAt: string
  updatedAt: string
}

export type SupplierPaymentAllocation = {
  id: string
  supplierPaymentId: string
  purchaseBillId: string
  amount: number
}

export type SupplierLedgerMovement = {
  id: string
  date: string
  createdAt: string
  kind: 'opening' | 'purchase' | 'payment'
  billMode?: BillMode
  narration: string
  debit: number
  credit: number
  balanceAfter: number
}

export type RawMaterialStockRow = {
  materialName: string
  purchasedKg: number
  faultyReturnKg: number
  currentKg: number
  purchaseValue: number
  returnValue: number
}

export type PurchaseTotals = {
  materialTotal: number
  deductionTotal: number
  taxableValue: number
  gstAmount: number
  grandTotal: number
  lines: Array<Omit<PurchaseMaterialLine, 'id' | 'purchaseBillId'>>
  deductions: PurchaseDeductionLineInput[]
}
