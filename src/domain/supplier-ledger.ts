import { computeBillNet, type PurchaseTaxMode } from './supplier-purchases'
import { roundPaise, toDayKey } from './financial-math'

/**
 * Supplier purchase ledger. Pure domain.
 *
 * Walks one supplier's purchase history chronologically (date, created, id)
 * and emits a running ledger where a POSITIVE balance means "we owe them"
 * and negative means "they owe us" (pool advance).
 *
 * A positive step INCREASES what we owe: bills and refund_received.
 * A negative step DECREASES it: payment / paid_on_behalf / settle_off /
 * bardan_advance / bardan deduct.
 * in_kind and cash_back bardan render as zero-effect informational rows.
 */

export type SupplierPool = 'kacha' | 'gst'
export type PoolFilter = SupplierPool | 'all'

export type LedgerBillInput = { id: string; date: string; created: string; pool: SupplierPool; taxMode: string; gstRateBp: number; cancelled?: boolean }
export type LedgerLineInput = { billId: string; amountPaise: number }
export type LedgerAdjustmentInput = { billId: string; type: string; amountPaise: number }
export type LedgerBardanInput = { id: string; billId: string; date: string; created: string; method: string; creditPaise: number; cashAmountPaise?: number; note?: string; cancelled?: boolean }
export type LedgerPaymentInput = { id: string; date: string; created: string; pool: SupplierPool; kind: string; amountPaise: number; cancelled?: boolean }

export type SupplierLedgerInput = {
  bills: readonly LedgerBillInput[]
  lines: readonly LedgerLineInput[]
  adjustments?: readonly LedgerAdjustmentInput[]
  bardan?: readonly LedgerBardanInput[]
  payments: readonly LedgerPaymentInput[]
  openingKachaPaise: number
  openingGstPaise: number
  filter?: {
    pool?: PoolFilter
    from?: string
    to?: string
    fiscalYear?: string // "2526" style label, window Apr 1 -> Mar 31
  }
}

export type SupplierLedgerEntry = {
  id: string
  date: string
  created: string
  pool: SupplierPool
  kind: string
  /** signed delta in we-owe paise; 0 for informational rows */
  amountPaise: number
  /** running balance AFTER this entry, within the requested pool scope */
  balancePaise: number
  label?: string
}

export type SupplierLedgerResult = {
  entries: SupplierLedgerEntry[]
  openingPaise: number
  closingPaise: number
  /** zero-outstanding badge: closing <= 0 (clear, or in our favour) */
  isNil: boolean
  totalDebitsPaise: number // increases in what we owe
  totalCreditsPaise: number // decreases in what we owe
}

const CREDIT_KINDS = new Set(['payment', 'paid_on_behalf', 'settle_off', 'bardan_advance'])

function fiscalYearWindow(label: string): { from: string; to: string } {
  const start = 2000 + Number.parseInt(label.slice(0, 2), 10)
  const end = 2000 + Number.parseInt(label.slice(2, 4), 10)
  return { from: `${start}-04-01`, to: `${end}-03-31` }
}

export function buildSupplierLedger(input: SupplierLedgerInput): SupplierLedgerResult {
  const filter = input.filter ?? {}
  const poolFilter: PoolFilter = filter.pool ?? 'all'
  let from = filter.from ?? ''
  let to = filter.to ?? ''
  if (filter.fiscalYear) {
    const window = fiscalYearWindow(filter.fiscalYear)
    from = from || window.from
    to = to || window.to
  }

  type Event = SupplierLedgerEntry & { inWindow: boolean }
  const events: Event[] = []
  const push = (event: SupplierLedgerEntry, inWindow: boolean) => events.push({ ...event, inWindow })

  const poolByBill = new Map<string, SupplierPool>()
  for (const bill of input.bills) poolByBill.set(bill.id, bill.pool)

  // ---- bills (cancelled -> excluded; zero effect) ----
  const linesByBill = new Map<string, LedgerLineInput[]>()
  const adjustmentsByBill = new Map<string, LedgerAdjustmentInput[]>()
  for (const line of input.lines) {
    const list = linesByBill.get(line.billId) ?? []
    list.push({ billId: line.billId, amountPaise: line.amountPaise })
    linesByBill.set(line.billId, list)
  }
  for (const adjustment of input.adjustments ?? []) {
    const list = adjustmentsByBill.get(adjustment.billId) ?? []
    list.push({ billId: adjustment.billId, type: adjustment.type, amountPaise: adjustment.amountPaise })
    adjustmentsByBill.set(adjustment.billId, list)
  }
  const bardanEntries = input.bardan ?? []

  for (const bill of input.bills) {
    if (bill.cancelled) continue
    const net = computeBillNet(
      linesByBill.get(bill.id) ?? [],
      adjustmentsByBill.get(bill.id) ?? [],
      [], // bardan deduct is its own ledger row; including it here would double-count
      bill.taxMode as PurchaseTaxMode,
      bill.gstRateBp,
    ).netPaise
    push(
      {
        id: bill.id,
        date: bill.date,
        created: bill.created,
        pool: bill.pool,
        kind: 'bill',
        amountPaise: net,
        balancePaise: 0,
        label: bill.taxMode === 'gst' ? 'GST bill' : bill.taxMode === 'rcm' ? 'RCM bill' : 'purchase bill',
      },
      inWindow(bill.date, from, to),
    )
  }

  // ---- bardan rows (pooled via their bill) ----
  for (const entry of bardanEntries) {
    if (entry.cancelled) continue
    const zeroEffect = entry.method === 'in_kind' || entry.method === 'cash_back'
    push(
      {
        id: entry.id,
        date: entry.date,
        created: entry.created,
        pool: poolByBill.get(entry.billId) ?? 'kacha',
        kind: entry.method === 'deduct' ? 'bardan_deduct' : entry.method === 'advance' ? 'bardan_advance' : entry.method,
        amountPaise: zeroEffect ? 0 : -Math.abs(entry.creditPaise),
        balancePaise: 0,
        label: entry.note ?? '',
      },
      inWindow(entry.date, from, to),
    )
  }

  // ---- payments ----
  for (const payment of input.payments) {
    if (payment.cancelled) continue
    const credit = CREDIT_KINDS.has(payment.kind)
    const refund = payment.kind === 'refund_received'
    if (!credit && !refund) continue
    const amount = Math.max(0, payment.amountPaise)
    push(
      {
        id: payment.id,
        date: payment.date,
        created: payment.created,
        pool: payment.pool,
        kind: payment.kind,
        amountPaise: refund ? amount : -amount,
        balancePaise: 0,
        label: '',
      },
      inWindow(payment.date, from, to),
    )
  }

  events.sort((a, b) => {
    const keyA = `${toDayKey(a.date)}|${a.created}|${a.id}`
    const keyB = `${toDayKey(b.date)}|${b.created}|${b.id}`
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
  })

  // running per-pool balances; "all" vision shows the combined balance.
  // opening = the running balance just BEFORE the first in-window event,
  // so pre-window history carries forward automatically.
  const balances: Record<SupplierPool, number> = {
    kacha: input.openingKachaPaise,
    gst: input.openingGstPaise,
  }
  const scopeBalanceAtStart = visibleBalance(poolFilter, balances)
  let openingPaise = scopeBalanceAtStart
  let sawInWindow = false
  const entries: SupplierLedgerEntry[] = []
  let closingPaise = scopeBalanceAtStart
  let totalDebitsPaise = 0
  let totalCreditsPaise = 0

  for (const event of events) {
    if (outOfPoolScope(event.pool, poolFilter)) continue
    if (event.inWindow && !sawInWindow) {
      openingPaise = visibleBalance(poolFilter, balances)
      sawInWindow = true
    }
    balances[event.pool] += event.amountPaise
    if (!event.inWindow) continue
    const { inWindow: _ignored, ...entry } = event
    void _ignored
    entry.balancePaise = visibleBalance(poolFilter, balances)
    entries.push(entry)
    closingPaise = entry.balancePaise
    if (entry.amountPaise > 0) totalDebitsPaise += entry.amountPaise
    else totalCreditsPaise += -entry.amountPaise
  }

  return {
    entries,
    openingPaise: roundPaise(openingPaise),
    closingPaise: roundPaise(closingPaise),
    isNil: closingPaise <= 0,
    totalDebitsPaise: roundPaise(totalDebitsPaise),
    totalCreditsPaise: roundPaise(totalCreditsPaise),
  }
}

function inWindow(date: string, from: string, to: string): boolean {
  const day = toDayKey(date)
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

function outOfPoolScope(pool: SupplierPool, filter: PoolFilter): boolean {
  return filter !== 'all' && pool !== filter
}

function visibleBalance(poolFilter: PoolFilter, balances: Record<SupplierPool, number>): number {
  if (poolFilter === 'all') return balances.kacha + balances.gst
  return balances[poolFilter]
}
