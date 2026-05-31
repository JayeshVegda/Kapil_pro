import type {
  BillMode,
  PurchaseDeductionLineInput,
  PurchaseEntry,
  PurchaseMaterialLineInput,
  PurchasePaidStatus,
  PurchaseTotals,
  RawMaterialStockRow,
  SupplierLedgerMovement,
  SupplierMaster,
  SupplierPayment,
} from '@/domain/scrap-buying-types'

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeBillMode(value: unknown): BillMode {
  return String(value ?? '').toLowerCase() === 'gst' ? 'gst' : 'kacha'
}

export function calculatePurchaseTotals(params: {
  materialLines: PurchaseMaterialLineInput[]
  deductionLines: PurchaseDeductionLineInput[]
  gstRate: number
  billMode: BillMode
}): PurchaseTotals {
  const lines = params.materialLines
    .map((line) => {
      const grossKg = Math.max(0, num(line.grossKg))
      const bagKg = Math.max(0, num(line.bagKg))
      const rate = Math.max(0, num(line.rate))
      const netKg = Math.max(0, grossKg - bagKg)
      const grossAmount = grossKg * rate
      const bagDeductionAmount = bagKg * rate
      const lineAmount = line.calculationMode === 'deduct_before_amount' ? netKg * rate : Math.max(0, grossAmount - bagDeductionAmount)
      return {
        materialName: String(line.materialName ?? '').trim(),
        grossKg,
        bagCount: Math.max(0, num(line.bagCount)),
        bagKg,
        netKg,
        rate,
        calculationMode: line.calculationMode,
        grossAmount,
        bagDeductionAmount,
        lineAmount,
      }
    })
    .filter((line) => line.materialName.length > 0 && line.grossKg > 0 && line.rate > 0)

  const deductions = params.deductionLines
    .map((line) => {
      const qtyKg = Math.max(0, num(line.qtyKg))
      const rate = Math.max(0, num(line.rate))
      const amount = Math.max(0, num(line.amount) || qtyKg * rate)
      return {
        kind: line.kind,
        materialName: String(line.materialName ?? '').trim(),
        description: String(line.description ?? '').trim(),
        qtyKg,
        rate,
        amount,
        affectsStock: Boolean(line.affectsStock),
      }
    })
    .filter((line) => line.amount > 0 || (line.affectsStock && line.qtyKg > 0 && line.materialName.length > 0))

  const materialTotal = lines.reduce((sum, line) => sum + line.lineAmount, 0)
  const deductionTotal = deductions.reduce((sum, line) => sum + line.amount, 0)
  const taxableValue = Math.max(0, materialTotal - deductionTotal)
  const gstAmount = params.billMode === 'gst' ? (taxableValue * Math.max(0, num(params.gstRate))) / 100 : 0
  const grandTotal = taxableValue + gstAmount

  return { materialTotal, deductionTotal, taxableValue, gstAmount, grandTotal, lines, deductions }
}

export function allocateSupplierPayment(params: {
  purchases: PurchaseEntry[]
  payments: SupplierPayment[]
  supplierId: string
  billMode: BillMode
  amount: number
}) {
  const historicalPaidByBill = new Map<string, number>()
  const scopedPayments = params.payments
    .filter((payment) => payment.supplierId === params.supplierId && payment.billModeScope === params.billMode)
    .sort(compareDateThenCreatedAsc)

  const scopedPurchases = params.purchases
    .filter((purchase) => purchase.supplierId === params.supplierId && purchase.billMode === params.billMode)
    .sort(compareDateThenCreatedAsc)

  for (const payment of scopedPayments) {
    let remaining = Math.max(0, payment.amount)
    for (const purchase of scopedPurchases) {
      if (remaining <= 0) break
      const alreadyPaid = historicalPaidByBill.get(purchase.id) ?? 0
      const due = Math.max(0, purchase.grandTotal - alreadyPaid)
      if (due <= 0) continue
      const applied = Math.min(due, remaining)
      historicalPaidByBill.set(purchase.id, alreadyPaid + applied)
      remaining -= applied
    }
  }

  let remainingNewPayment = Math.max(0, params.amount)
  const allocations: Array<{ purchaseBillId: string; amount: number; billLabel: string; billDate: string }> = []
  for (const purchase of scopedPurchases) {
    if (remainingNewPayment <= 0) break
    const alreadyPaid = historicalPaidByBill.get(purchase.id) ?? 0
    const due = Math.max(0, purchase.grandTotal - alreadyPaid)
    if (due <= 0) continue
    const applied = Math.min(due, remainingNewPayment)
    allocations.push({
      purchaseBillId: purchase.id,
      amount: applied,
      billLabel: purchase.supplierBillNo || purchase.internalRef || purchase.id,
      billDate: purchase.date,
    })
    remainingNewPayment -= applied
  }

  return {
    allocations,
    paymentApplied: Math.max(0, params.amount) - remainingNewPayment,
    advanceAfterPayment: remainingNewPayment,
  }
}

export function computePurchasePaidStatuses(purchases: PurchaseEntry[], payments: SupplierPayment[]): Map<string, PurchasePaidStatus> {
  const status = new Map<string, PurchasePaidStatus>()
  const grouped = new Map<string, { purchases: PurchaseEntry[]; payments: SupplierPayment[] }>()

  for (const purchase of purchases) {
    const key = `${purchase.supplierId}::${purchase.billMode}`
    const bucket = grouped.get(key) ?? { purchases: [], payments: [] }
    bucket.purchases.push(purchase)
    grouped.set(key, bucket)
  }
  for (const payment of payments) {
    const key = `${payment.supplierId}::${payment.billModeScope}`
    const bucket = grouped.get(key) ?? { purchases: [], payments: [] }
    bucket.payments.push(payment)
    grouped.set(key, bucket)
  }

  for (const bucket of grouped.values()) {
    const paidByBill = new Map<string, number>()
    const sortedPurchases = [...bucket.purchases].sort(compareDateThenCreatedAsc)
    const sortedPayments = [...bucket.payments].sort(compareDateThenCreatedAsc)
    for (const payment of sortedPayments) {
      let remaining = Math.max(0, payment.amount)
      for (const purchase of sortedPurchases) {
        if (remaining <= 0) break
        const paid = paidByBill.get(purchase.id) ?? 0
        const due = Math.max(0, purchase.grandTotal - paid)
        if (due <= 0) continue
        const applied = Math.min(due, remaining)
        paidByBill.set(purchase.id, paid + applied)
        remaining -= applied
      }
    }
    for (const purchase of sortedPurchases) {
      const paid = paidByBill.get(purchase.id) ?? 0
      status.set(purchase.id, paid <= 0 ? 'pending' : paid >= purchase.grandTotal ? 'paid' : 'partial')
    }
  }

  return status
}

export function buildSupplierLedger(params: {
  supplier: SupplierMaster
  purchases: PurchaseEntry[]
  payments: SupplierPayment[]
  modeFilter: 'all' | BillMode
}): SupplierLedgerMovement[] {
  const movements: Array<Omit<SupplierLedgerMovement, 'balanceAfter'>> = []
  if (params.modeFilter === 'all' && params.supplier.openingPayable > 0) {
    movements.push({
      id: `opening-${params.supplier.id}`,
      date: params.supplier.openingPayableDate || '0000-00-00',
      createdAt: '',
      kind: 'opening',
      narration: 'Opening payable',
      debit: params.supplier.openingPayable,
      credit: 0,
    })
  }
  for (const purchase of params.purchases) {
    if (purchase.supplierId !== params.supplier.id) continue
    if (params.modeFilter !== 'all' && purchase.billMode !== params.modeFilter) continue
    movements.push({
      id: `purchase-${purchase.id}`,
      date: purchase.date,
      createdAt: purchase.createdAt,
      kind: 'purchase',
      billMode: purchase.billMode,
      narration: `${purchase.billMode.toUpperCase()} purchase ${purchase.supplierBillNo || purchase.internalRef || ''}`.trim(),
      debit: purchase.grandTotal,
      credit: 0,
    })
  }
  for (const payment of params.payments) {
    if (payment.supplierId !== params.supplier.id) continue
    if (params.modeFilter !== 'all' && payment.billModeScope !== params.modeFilter) continue
    movements.push({
      id: `payment-${payment.id}`,
      date: payment.date,
      createdAt: payment.createdAt,
      kind: 'payment',
      billMode: payment.billModeScope,
      narration: `${payment.billModeScope.toUpperCase()} payment · ${payment.mode}`,
      debit: 0,
      credit: payment.amount,
    })
  }

  let balance = 0
  return movements
    .sort(compareDateThenCreatedAsc)
    .map((row) => {
      balance += row.debit - row.credit
      return { ...row, balanceAfter: balance }
    })
    .reverse()
}

export function buildRawMaterialStock(purchases: PurchaseEntry[]): RawMaterialStockRow[] {
  const byMaterial = new Map<string, RawMaterialStockRow>()
  for (const purchase of purchases) {
    for (const line of purchase.materialLines) {
      const key = line.materialName.toLowerCase()
      const row = byMaterial.get(key) ?? {
        materialName: line.materialName,
        purchasedKg: 0,
        faultyReturnKg: 0,
        currentKg: 0,
        purchaseValue: 0,
        returnValue: 0,
      }
      row.purchasedKg += line.netKg
      row.purchaseValue += line.lineAmount
      byMaterial.set(key, row)
    }
    for (const deduction of purchase.deductionLines) {
      if (!deduction.affectsStock || deduction.qtyKg <= 0 || !deduction.materialName) continue
      const key = deduction.materialName.toLowerCase()
      const row = byMaterial.get(key) ?? {
        materialName: deduction.materialName,
        purchasedKg: 0,
        faultyReturnKg: 0,
        currentKg: 0,
        purchaseValue: 0,
        returnValue: 0,
      }
      row.faultyReturnKg += deduction.qtyKg
      row.returnValue += deduction.amount
      byMaterial.set(key, row)
    }
  }

  return [...byMaterial.values()]
    .map((row) => ({ ...row, currentKg: row.purchasedKg - row.faultyReturnKg }))
    .sort((a, b) => a.materialName.localeCompare(b.materialName))
}

function compareDateThenCreatedAsc(a: { date: string; createdAt?: string }, b: { date: string; createdAt?: string }) {
  const dateCompare = (a.date || '0000-00-00').localeCompare(b.date || '0000-00-00')
  if (dateCompare !== 0) return dateCompare
  return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
}
