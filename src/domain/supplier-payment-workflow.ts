import type { SupplierPaymentCreateInput } from '@/data/suppliers'
import type { SupplierPurchaseContext } from './purchase-read-model'
import { bundleToSettlementInput } from './supplier-bundle'
import { supplierPaymentNeedsReference, type SupplierPaymentMode } from './supplier-payment-modes'
import { computeDaysSince } from './supplier-purchases'
import { previewSupplierPayment, settlementOrderKey, type SupplierPool } from './supplier-settlement'
import { gramsToKgText, milliToRateText } from './supplier-units'

export type SupplierPaymentKind = 'payment' | 'paid_on_behalf' | 'settle_off' | 'refund_received'

export type SupplierPaymentDraft = {
  supplierId: string
  date: string
  pool: SupplierPool
  kind: SupplierPaymentKind
  amountPaise: number
  mode: SupplierPaymentMode
  reference: string
  payeeName: string
  privateNote: string
}

export type SupplierPaymentProposal = {
  date: string
  pool: SupplierPool
  kind: SupplierPaymentKind
  amountPaise: number
  selectedBillIds: ReadonlySet<string>
  pinOrder?: 'chronological' | 'selection'
  today?: string
}

/** Compact line text used by the payment allocation table, not the printable chitty. */
function billLineLabel(lines: readonly { itemName: string; weightG: number; rateMilli: number }[]): string {
  if (lines.length === 0) return '—'
  const parts = lines.slice(0, 2).map((line) => {
    const rate = line.rateMilli > 0 ? ` @ ₹${milliToRateText(line.rateMilli)}` : ''
    return `${line.itemName} ${gramsToKgText(line.weightG)}kg${rate}`
  })
  if (lines.length > 2) parts.push(`+${lines.length - 2} more`)
  return parts.join(' · ')
}

export function buildSupplierPaymentWorkflow(context: SupplierPurchaseContext, proposal: SupplierPaymentProposal) {
  const { bundle, settlement } = context
  const { pool, date, kind, amountPaise, today } = proposal
  const allowPins = kind !== 'refund_received'
  const selectedBillIds = new Set(proposal.selectedBillIds)
  const baseline = settlement.pools[pool]
  const detailById = new Map(bundle.bills.map((bill) => [bill.id, bill]))
  const linesByBill = new Map<string, typeof bundle.lines>()
  for (const line of bundle.lines) {
    const lines = linesByBill.get(line.billId) ?? []
    lines.push(line)
    linesByBill.set(line.billId, lines)
  }
  const openBills = baseline.bills
    .filter((bill) => bill.status !== 'cancelled' && bill.duePaise > 0)
    .map((bill) => {
      const detail = detailById.get(bill.billId)
      const lines = linesByBill.get(bill.billId) ?? []
      return {
        billId: bill.billId, inNo: detail?.inNo ?? '', date: detail?.date ?? '', created: detail?.created ?? '',
        itemsLabel: billLineLabel(lines), totalKg: lines.reduce((sum, line) => sum + line.weightG, 0) / 1000,
        duePaise: bill.duePaise, netPaise: bill.netPaise, daysOld: computeDaysSince(detail?.date ?? '', today),
      }
    })
    .sort((a, b) => `${a.date}|${a.created}|${a.billId}`.localeCompare(`${b.date}|${b.created}|${b.billId}`))
  const selectedBills = allowPins ? openBills.filter((bill) => selectedBillIds.has(bill.billId)) : []
  if (proposal.pinOrder === 'selection') {
    const selectedOrder = new Map([...selectedBillIds].map((billId, index) => [billId, index]))
    selectedBills.sort((a, b) => selectedOrder.get(a.billId)! - selectedOrder.get(b.billId)!)
  }
  const totalDuePaise = openBills.reduce((sum, bill) => sum + bill.duePaise, 0)
  const totalSelectedPaise = selectedBills.reduce((sum, bill) => sum + bill.duePaise, 0)
  let allocationPreview = {
    lines: openBills.map((bill) => ({ ...bill, paidNowPaise: 0, remainingDuePaise: bill.duePaise, paidPercent: 0 })),
    appliedToDuesPaise: 0, advancePaise: baseline.advancePaise, outstandingAfterPaise: baseline.outstandingPaise,
  }
  if (Number.isSafeInteger(amountPaise) && amountPaise > 0) {
    // Simulate full current dues; persisted pins below use only this payment's applied credit.
    const { after, previewPaymentId } = previewSupplierPayment(bundleToSettlementInput(bundle), {
      pool, date, kind, amountPaise, pinnedBillIds: selectedBills.map((bill) => bill.billId),
    })
    const simulated = after.pools[pool]
    const simulatedByBill = new Map(simulated.bills.map((bill) => [bill.billId, bill]))
    allocationPreview = {
      lines: openBills.map((bill) => {
        const row = simulatedByBill.get(bill.billId)
        const paidNowPaise = (row?.creditsApplied ?? [])
          .filter((credit) => credit.paymentId === previewPaymentId).reduce((sum, credit) => sum + credit.amountPaise, 0)
        return {
          ...bill, paidNowPaise, remainingDuePaise: row?.duePaise ?? bill.duePaise,
          paidPercent: bill.duePaise > 0 ? Math.min(100, Math.round(paidNowPaise / bill.duePaise * 100)) : 0,
        }
      }),
      appliedToDuesPaise: simulated.payments.find((payment) => payment.paymentId === previewPaymentId)?.appliedPaise ?? 0,
      advancePaise: simulated.advancePaise, outstandingAfterPaise: simulated.outstandingPaise,
    }
  }
  const outstandingBefore = baseline.outstandingPaise
  const coveragePercent = kind === 'refund_received' ? 0 : outstandingBefore <= 0 ? (amountPaise > 0 ? 100 : 0)
    : Math.min(100, Math.max(0, allocationPreview.appliedToDuesPaise / outstandingBefore * 100))
  const previewByBill = new Map(allocationPreview.lines.map((line) => [line.billId, line]))
  const allocations = allowPins ? selectedBills.flatMap((bill) => {
    const appliedPaise = previewByBill.get(bill.billId)?.paidNowPaise ?? 0
    return appliedPaise > 0 ? [{ billId: bill.billId, amountPaise: appliedPaise }] : []
  }) : undefined
  return {
    supplierId: bundle.supplier.id, pool, date, kind, amountPaise, selectedBillIds, allowPins,
    openBills, totalDuePaise, totalSelectedPaise, allocationPreview, allocations, outstandingBefore, coveragePercent,
    recentPayments: [...bundle.payments].sort((a, b) => settlementOrderKey(b).localeCompare(settlementOrderKey(a))).slice(0, 6),
  }
}

export type SupplierPaymentWorkflow = ReturnType<typeof buildSupplierPaymentWorkflow>

export function prepareSupplierPaymentInput(draft: SupplierPaymentDraft, workflow: SupplierPaymentWorkflow | null): SupplierPaymentCreateInput {
  if (!draft.supplierId) throw new Error('Please select a supplier.')
  if (!Number.isFinite(draft.amountPaise) || draft.amountPaise <= 0) throw new Error('Payment amount must be greater than zero.')
  if (!Number.isSafeInteger(draft.amountPaise)) throw new Error('Payment amount must be whole paise.')
  if (draft.kind === 'paid_on_behalf' && !draft.payeeName.trim()) throw new Error('Payee name is required when paying on behalf.')
  if (supplierPaymentNeedsReference(draft.mode) && !draft.reference.trim()) {
    throw new Error(`Reference number is required for ${draft.mode.toUpperCase()} payments.`)
  }
  if (!workflow || workflow.supplierId !== draft.supplierId || workflow.pool !== draft.pool || workflow.date !== draft.date
    || workflow.kind !== draft.kind || workflow.amountPaise !== draft.amountPaise) {
    throw new Error('Supplier financial context is unavailable.')
  }
  return {
    supplierId: draft.supplierId, date: draft.date, pool: draft.pool, kind: draft.kind,
    amountPaise: draft.amountPaise, mode: draft.mode, reference: draft.reference.trim(),
    payeeName: draft.kind === 'paid_on_behalf' ? draft.payeeName.trim() : undefined,
    privateNote: draft.privateNote.trim(),
    allocations: workflow.allocations,
  }
}
