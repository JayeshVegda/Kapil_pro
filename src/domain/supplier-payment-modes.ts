export const SUPPLIER_PAYMENT_MODES = ['cash', 'upi', 'rtgs', 'neft', 'cheque', 'other'] as const
export type SupplierPaymentMode = (typeof SUPPLIER_PAYMENT_MODES)[number]

export function supplierPaymentNeedsReference(mode: string): boolean {
  return ['upi', 'rtgs', 'neft', 'cheque'].includes(mode)
}

export function validateSupplierPaymentMode(mode: string, reference = ''): void {
  if (!SUPPLIER_PAYMENT_MODES.includes(mode as SupplierPaymentMode)) throw new Error('Select a supported payment mode.')
  if (supplierPaymentNeedsReference(mode) && !reference.trim()) throw new Error(`Reference is required for ${mode.toUpperCase()}.`)
}
