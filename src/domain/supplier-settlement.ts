import { computeBillNet, type BillAdjustmentInput, type BillBardanInput, type BillLineInput } from './supplier-purchases'
import { sumPaise } from './supplier-units'

/**
 * Supplier settlement engine. PURE — no DB access, exact integer paise math.
 *
 * Runs SEPARATELY per pool (kacha | gst). Matching / FIFO / advance NEVER cross pools.
 *
 * Per-pool algorithm (approved corrections, 2026-11-03):
 *   1. Opening balance = the pool's OLDEST payable. Money credits extinguish it
 *      FIRST, before any bills. A NEGATIVE opening is that pool's advance.
 *   2. Manual payment->bill pins (supplier_payment_allocations) apply first
 *      within each payment, in chronology of the payment. Pins are recorded
 *      as-pinned even if a validation rule is broken (caller validates).
 *   3. FIFO: each payment's REMAINING amount extinguishes the opening balance
 *      (if positive), then bills in chronological order (date, created, id).
 *   4. Whatever credit remains is the pool's advance. Advance is pool-bound forever.
 *
 * Credit kinds (reduce what we owe): payment, paid_on_behalf, settle_off,
 * bardan_advance (created by a bardan "advance" settlement; unallocated).
 * Debit/owed kinds: bills, refund_received (supplier money returned to us,
 * INCREASES what we owe — treated as a payable consumed by FIFO like a bill).
 * Cancelled bills/payments have NO effect but are still returned for display.
 */

export type SupplierPool = 'kacha' | 'gst'

export type PurchaseBillSettlementInput = {
  id: string
  date: string // YYYY-MM-DD business date
  created: string
  pool: SupplierPool
  taxMode: string
  gstRateBp: number
  cancelled?: boolean
}

export type PurchaseCollectionInput = {
  billId: string
  amountPaise: number
}

export type PurchaseAdjustmentsCollectionInput = BillAdjustmentInput & { billId: string }
export type PurchaseBardanCollectionInput = BillBardanInput & {
  billId: string
  creditPaise: number
  note?: string
}

export type SupplierPaymentSettlementInput = {
  id: string
  date: string
  created: string
  pool: SupplierPool
  kind: string // payment | paid_on_behalf | settle_off | refund_received | bardan_advance
  amountPaise: number // always stored positive; direction comes from kind
  cancelled?: boolean
}

export type SupplierSettlementHeaderInput = {
  openingKachaPaise: number // signed: + we owe, - advance
  openingGstPaise: number
}

export type ManualPinCandidate = {
  billId: string
  billPool: SupplierPool
  billDuePaise: number
  pinnedPaise: number
}

export type ManualPinValidationResult = {
  valid: boolean
  error?: string
}

export function validateManualPins(
  paymentPool: SupplierPool,
  paymentAmountPaise: number,
  pins: readonly ManualPinCandidate[],
): ManualPinValidationResult {
  let totalPinned = 0
  for (const pin of pins) {
    if (pin.pinnedPaise <= 0) continue
    if (pin.billPool !== paymentPool) {
      return { valid: false, error: `Cross-pool pin rejected: bill is in ${pin.billPool} pool while payment is in ${paymentPool} pool.` }
    }
    if (pin.pinnedPaise > pin.billDuePaise) {
      return { valid: false, error: `Over-pin on bill rejected: pinned amount (${pin.pinnedPaise}) exceeds bill due (${pin.billDuePaise}).` }
    }
    totalPinned += pin.pinnedPaise
  }
  if (totalPinned > paymentAmountPaise) {
    return { valid: false, error: `Over-pin on payment rejected: total pinned (${totalPinned}) exceeds payment amount (${paymentAmountPaise}).` }
  }
  return { valid: true }
}

export type SupplierSettlementInput = {
  supplier: SupplierSettlementHeaderInput
  bills: readonly PurchaseBillSettlementInput[]
  lines: readonly PurchaseCollectionInput[]
  adjustments: readonly PurchaseAdjustmentsCollectionInput[]
  bardan: readonly PurchaseBardanCollectionInput[]
  payments: readonly SupplierPaymentSettlementInput[]
  allocations: readonly { paymentId: string; billId: string; amountPaise: number }[]
}

export type SupplierSettlementBillRow = {
  billId: string
  date: string
  created: string
  pool: SupplierPool
  netPaise: number
  paidPaise: number
  duePaise: number
  status: 'open' | 'partial' | 'nil' | 'cancelled'
  bardanEntryCount: number
  bardanPending: boolean
  bardanNotes: string[]
}

export type SupplierSettlementPaymentRow = {
  paymentId: string
  date: string
  created: string
  pool: SupplierPool
  kind: string
  amountPaise: number
  appliedPaise: number // how much credit this payment actively distributed
  cancelled: boolean
}

export type SupplierSettlementPoolResult = {
  openingPaise: number
  openingIsAdvance: boolean
  bills: SupplierSettlementBillRow[]
  payments: SupplierSettlementPaymentRow[]
  refundTotalPaise: number
  outstandingPaise: number
  advancePaise: number
}

export type SupplierSettlementResult = {
  pools: Record<SupplierPool, SupplierSettlementPoolResult>
  combined: {
    outstandingPaise: number
    advancePaise: number
    netPositionPaise: number // outstanding - advance (we-owe positive)
  }
}

/** Chronological key used everywhere: business date, then created, then id. */
export function settlementOrderKey(year: { date: string; created: string; id: string }): string {
  return `${year.date || ''}|${year.created || ''}|${year.id || ''}`
}

export const CREDIT_KINDS = new Set(['payment', 'paid_on_behalf', 'settle_off', 'bardan_advance'])
const OWED_KINDS = new Set(['refund_received'])

/**
 * Computes the full pool-separated settlement for one supplier.
 */
export function computeSupplierSettlement(input: SupplierSettlementInput): SupplierSettlementResult {
  const pools: Record<SupplierPool, SupplierSettlementPoolResult> = {
    kacha: emptyPoolResult(),
    gst: emptyPoolResult(),
  }

  // ---- precompute bill nets (cancelled bills keep the row but get zero effect)
  const netByBill = new Map<string, number>()
  for (const bill of input.bills) {
    if (netByBill.has(bill.id)) continue
    netByBill.set(bill.id, NaN)
  }
  const linesByBill = new Map<string, BillLineInput[]>()
  const adjustmentsByBill = new Map<string, Array<{ type: string; amountPaise: number }>>()
  const bardanByBill = new Map<
    string,
    Array<{ method: string; creditPaise: number; cashAmountPaise?: number; note?: string }>
  >()

  for (const line of input.lines) {
    const list = linesByBill.get(line.billId) ?? []
    list.push({ amountPaise: line.amountPaise })
    linesByBill.set(line.billId, list)
  }
  for (const adjustment of input.adjustments) {
    const list = adjustmentsByBill.get(adjustment.billId) ?? []
    list.push({ type: adjustment.type, amountPaise: adjustment.amountPaise })
    adjustmentsByBill.set(adjustment.billId, list)
  }
  for (const bardan of input.bardan) {
    const list = bardanByBill.get(bardan.billId) ?? []
    list.push({ method: bardan.method, creditPaise: bardan.creditPaise, cashAmountPaise: bardan.cashAmountPaise, note: bardan.note })
    bardanByBill.set(bardan.billId, list)
  }

  for (const bill of input.bills) {
    const net = computeBillNet(
      linesByBill.get(bill.id) ?? [],
      adjustmentsByBill.get(bill.id) ?? [],
      bardanByBill.get(bill.id) ?? [],
      bill.taxMode,
      bill.gstRateBp,
    ).netPaise
    netByBill.set(bill.id, bill.cancelled ? 0 : net)
  }

  // ---- walk pools
  const poolIds: SupplierPool[] = ['kacha', 'gst']
  for (const pool of poolIds) {
    const result = pools[pool]
    const opening = pool === 'kacha' ? input.supplier.openingKachaPaise : input.supplier.openingGstPaise
    result.openingPaise = opening
    result.openingIsAdvance = opening < 0

    const poolBills = input.bills.filter((bill) => bill.pool === pool)
    const poolPayments = input.payments.filter((payment) => payment.pool === pool)

    // FIFO queues: payables to be extinguished (opening first, then bills/refunds
    // in chronological order). Each queue entry = { key, billId?, refundPaymentId? }.
    type Payable = { key: string; billId?: string; refundPaymentId?: string; remaining: number }
    const payables: Payable[] = []

    // 1) opening = the pool's oldest payable (positive opening only)
    if (opening > 0) payables.push({ key: '', remaining: opening })
    if (opening < 0) result.advancePaise += -opening // negative opening = advance

    // bills + refunds enter the FIFO in (date, created, id) order
    const owedEntries: Payable[] = []
    for (const bill of poolBills) {
      const net = Math.max(0, netByBill.get(bill.id) ?? 0)
      const row: SupplierSettlementBillRow = {
        billId: bill.id,
        date: bill.date,
        created: bill.created,
        pool,
        netPaise: bill.cancelled ? 0 : net,
        paidPaise: 0,
        duePaise: bill.cancelled ? 0 : net,
        status: bill.cancelled ? 'cancelled' : openStatus(net),
        bardanEntryCount: (bardanByBill.get(bill.id) ?? []).length,
        bardanPending: !bill.cancelled && (bardanByBill.get(bill.id) ?? []).length === 0,
        bardanNotes: (bardanByBill.get(bill.id) ?? []).map((entry) => entry.note ?? ''),
      }
      result.bills.push(row)
      if (!bill.cancelled && net > 0) {
        owedEntries.push({ key: settlementOrderKey(bill), billId: bill.id, remaining: net })
      }
    }
    for (const payment of poolPayments) {
      if (payment.cancelled) continue
      if (OWED_KINDS.has(payment.kind)) {
        const amount = Math.max(0, payment.amountPaise)
        owedEntries.push({ key: settlementOrderKey(payment), refundPaymentId: payment.id, remaining: amount })
      }
    }
    owedEntries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    payables.push(...owedEntries)

    const payableByBill = new Map<string, Payable>()
    for (const payable of payables) {
      if (payable.billId && !payableByBill.has(payable.billId)) payableByBill.set(payable.billId, payable)
    }

    // 2) manual pins, in chronology of their payment, then 3) FIFO leftovers
    const sortedPayments = poolPayments
      .filter((payment) => !payment.cancelled && CREDIT_KINDS.has(payment.kind) && payment.amountPaise > 0)
      .map((payment) => ({ payment, remaining: Math.max(0, payment.amountPaise) }))
    sortedPayments.sort((a, b) => {
      const keyA = settlementOrderKey(a.payment)
      const keyB = settlementOrderKey(b.payment)
      if (keyA !== keyB) return keyA < keyB ? -1 : 1
      return 0
    })

    const pinsByPayment = new Map<string, Array<{ billId: string; amountPaise: number }>>()
    for (const allocation of input.allocations) {
      const payment = input.payments.find((candidate) => candidate.id === allocation.paymentId)
      if (!payment) continue
      if (payment.pool !== pool) continue // cross-pool pins are validation errors, never applied
      const list = pinsByPayment.get(allocation.paymentId) ?? []
      list.push({ billId: allocation.billId, amountPaise: allocation.amountPaise })
      pinsByPayment.set(allocation.paymentId, list)
    }

    const paymentRowById = new Map<string, SupplierSettlementPaymentRow>()
    for (const payment of poolPayments) {
      paymentRowById.set(payment.id, {
        paymentId: payment.id,
        date: payment.date,
        created: payment.created,
        pool,
        kind: payment.kind,
        amountPaise: payment.amountPaise,
        appliedPaise: 0,
        cancelled: Boolean(payment.cancelled),
      })
    }

    const drain = (creditOwner: { remaining: number }, rowForApplied: SupplierSettlementPaymentRow | null): number => {
      let consumedTotal = 0
      // pins first — the queue entry IS the bill's remaining due
      if (rowForApplied) {
        const pins = pinsByPayment.get(rowForApplied.paymentId) ?? []
        for (const pin of pins) {
          const target = payableByBill.get(pin.billId)
          if (!target) continue
          const applied = Math.min(pin.amountPaise, creditOwner.remaining, target.remaining)
          if (applied <= 0) continue
          creditOwner.remaining -= applied
          target.remaining -= applied
          consumedTotal += applied
          rowForApplied.appliedPaise += applied
        }
        pinsByPayment.set(rowForApplied.paymentId, [])
      }
      // then FIFO queue (opening first because payables were built that way)
      let payableIndex = 0
      while (creditOwner.remaining > 0 && payableIndex < payables.length) {
        const payable = payables[payableIndex]
        if (payable.remaining <= 0) {
          payableIndex++
          continue
        }
        const applied = Math.min(creditOwner.remaining, payable.remaining)
        creditOwner.remaining -= applied
        payable.remaining -= applied
        consumedTotal += applied
        if (rowForApplied) rowForApplied.appliedPaise += applied
        payableIndex++ // forward-only FIFO: never come back
      }
      return consumedTotal
    }

    for (const { payment, remaining } of sortedPayments) {
      const row = paymentRowById.get(payment.id)
      if (!row) continue
      const consumed = drain({ remaining }, row)
      if (consumed > 0) {
        result.advancePaise += remaining - consumed // unapplied leftover = this pool's advance
      } else {
        result.advancePaise += remaining
      }
      result.payments.push(row)
    }

    // cancelled payments of every kind also appear (no effect), plus refund rows
    for (const payment of poolPayments) {
      const row = paymentRowById.get(payment.id)
      if (!row) continue
      if (result.payments.some((existing) => existing.paymentId === payment.id)) continue
      result.payments.push(row)
    }

    // bill statuses from the final dues (the queue payable is the single source of truth)
    for (const row of result.bills) {
      if (row.status === 'cancelled') continue
      const due = payableByBill.get(row.billId)?.remaining ?? row.duePaise
      row.duePaise = due
      row.paidPaise = row.netPaise - due
      row.status = due === 0 ? 'nil' : row.paidPaise > 0 ? 'partial' : 'open'
    }

    result.refundTotalPaise = sumPaise(
      poolPayments.filter((payment) => !payment.cancelled && payment.kind === 'refund_received').map((payment) => payment.amountPaise),
    )

    // outstanding = unpaid opening + unpaid bill dues + unpaid refund payables
    const openingPayable = opening > 0 ? payables.find((payable) => !payable.billId && !payable.refundPaymentId) : null
    let outstanding = 0
    if (openingPayable) outstanding += Math.max(0, openingPayable.remaining)
    for (const row of result.bills) if (row.status !== 'cancelled') outstanding += row.duePaise
    for (const payable of payables) {
      if (payable.refundPaymentId && payable.remaining > 0) outstanding += payable.remaining
    }
    result.outstandingPaise = outstanding
  }

  const combinedOutstanding = pools.kacha.outstandingPaise + pools.gst.outstandingPaise
  const combinedAdvance = pools.kacha.advancePaise + pools.gst.advancePaise
  return {
    pools,
    combined: {
      outstandingPaise: combinedOutstanding,
      advancePaise: combinedAdvance,
      netPositionPaise: combinedOutstanding - combinedAdvance,
    },
  }
}

function openStatus(net: number): 'open' | 'nil' {
  return net === 0 ? 'nil' : 'open'
}

function emptyPoolResult(): SupplierSettlementPoolResult {
  return {
    openingPaise: 0,
    openingIsAdvance: false,
    bills: [],
    payments: [],
    refundTotalPaise: 0,
    outstandingPaise: 0,
    advancePaise: 0,
  }
}
