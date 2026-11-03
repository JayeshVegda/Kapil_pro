import { computeBillNet, type PurchaseTaxMode } from './supplier-purchases'

/**
 * Purchase bill merge / split planning. Pure domain - NO persistence, NO
 * routes. The caller creates the new bills / cancels the sources inside one
 * transaction after reading these plans, and everything it needs (allocation
 * bans, cancellation bans) is validated here as refusal reasons.
 *
 * Rules (spec, 2026-11-03):
 * - Merge: same supplier, same pool, same tax_mode, none of the source bills
 *   cancelled, and NO payment allocation references any source bill.
 * - Both merge output and split targets share ONE new plain random group_id
 *   (lowercase alphanumerics, 15 chars). group_id is a plain random id - no
 *   ms-<seq> scheme.
 * - A cancelled source cannot be merged or split further.
 * - Merged bill lines = source-bill lines in (date, created, id) order;
 *   adjustments and bardan entries are carried over with their source bill id
 *   noted for audit. Split picks an explicit line subset per target.
 */

export type MergeBillInput = {
  id: string
  supplierId: string
  date: string
  created: string
  pool: 'kacha' | 'gst'
  taxMode: string
  gstRateBp: number
  cancelled?: boolean
}

export type MergeLineInput = { billId: string; lineId: string; amountPaise: number }
export type MergeAdjustmentInput = { billId: string; type: string; amountPaise: number }
export type MergeBardanInput = { billId: string; method: string; creditPaise: number; note?: string }

export type MergeContextInput = {
  bills: readonly MergeBillInput[]
  lines: readonly MergeLineInput[]
  adjustments?: readonly MergeAdjustmentInput[]
  bardan?: readonly MergeBardanInput[]
  /** allocations referencing (paymentId, billId); anything touching a source blocks the merge */
  allocations?: ReadonlyArray<{ paymentId: string; billId: string; amountPaise?: number }>
}

export type MergeRefusal =
  | 'need_two_or_more'
  | 'cancelled_source'
  | 'supplier_mismatch'
  | 'pool_mismatch'
  | 'tax_mode_mismatch'
  | 'allocation_referenced'

export type MergedBillPlan = {
  group_id: string
  /** source-bill ids, in merge order for the audit trail */
  fromBillIds: string[]
  lines: Array<{ billId: string; lineId: string; amountPaise: number }>
  adjustments: Array<{ billId: string; type: string; amountPaise: number }>
  bardan: Array<{ billId: string; method: string; creditPaise: number; note?: string }>
  netPaise: number
}

export type MergePlan =
  | { ok: true; group_id: string; merged: MergedBillPlan; cancelledSourceIds: string[] }
  | { ok: false; refusals: MergeRefusal[] }

/** 15-char lowercase alphanumeric id for purchase_bill group_id. */
export function newGroupId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 15; i++) {
    const index = Math.floor(Math.random() * alphabet.length)
    id += alphabet[index]
  }
  return id
}

export function planMerge(context: MergeContextInput, sourceBillIds: readonly string[]): MergePlan {
  const refusals: MergeRefusal[] = []
  const byId = new Map<string, MergeBillInput>()
  for (const bill of context.bills) byId.set(bill.id, bill)
  const sources: MergeBillInput[] = []
  for (const id of sourceBillIds) {
    const bill = byId.get(id)
    if (bill) sources.push(bill)
  }
  if (sources.length < 2) refusals.push('need_two_or_more')
  if (sources.some((source) => source.cancelled)) refusals.push('cancelled_source')
  const first = sources[0]
  if (first) {
    if (sources.some((source) => source.supplierId !== first.supplierId)) refusals.push('supplier_mismatch')
    if (sources.some((source) => source.pool !== first.pool)) refusals.push('pool_mismatch')
    if (
      sources.some((source) => source.taxMode !== first.taxMode || source.gstRateBp !== first.gstRateBp)
    )
      refusals.push('tax_mode_mismatch')
  }
  const sourceIdSet = new Set(sourceBillIds)
  const blocked = (context.allocations ?? []).some((allocation) => sourceIdSet.has(allocation.billId))
  if (blocked) refusals.push('allocation_referenced')
  if (refusals.length > 0 || !first) return { ok: false, refusals }

  const chronologicalSources = [...sources].sort((a, b) => {
    const keyA = `${a.date}|${a.created}|${a.id}`
    const keyB = `${b.date}|${b.created}|${b.id}`
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
  })

  const groupId = newGroupId()
  const mergedLines: MergedBillPlan['lines'] = []
  const mergedAdjustments: MergedBillPlan['adjustments'] = []
  const mergedBardan: MergedBillPlan['bardan'] = []
  for (const source of chronologicalSources) {
    for (const line of context.lines.filter((line) => line.billId === source.id)) {
      mergedLines.push({ billId: source.id, lineId: line.lineId, amountPaise: line.amountPaise })
    }
    for (const adjustment of (context.adjustments ?? []).filter((row) => row.billId === source.id)) {
      mergedAdjustments.push({ billId: source.id, type: adjustment.type, amountPaise: adjustment.amountPaise })
    }
    for (const bardan of (context.bardan ?? []).filter((row) => row.billId === source.id)) {
      mergedBardan.push({ billId: source.id, method: bardan.method, creditPaise: bardan.creditPaise, note: bardan.note })
    }
  }

  const merged: MergedBillPlan = {
    group_id: groupId,
    fromBillIds: chronologicalSources.map((source) => source.id),
    lines: mergedLines,
    adjustments: mergedAdjustments,
    bardan: mergedBardan,
    netPaise: computeBillNet(
      mergedLines.map((line) => ({ amountPaise: line.amountPaise })),
      mergedAdjustments.map((row) => ({ type: row.type, amountPaise: row.amountPaise })),
      mergedBardan.map((row) => ({ method: row.method, creditPaise: row.creditPaise })),
      first.taxMode as PurchaseTaxMode,
      first.gstRateBp,
    ).netPaise,
  }
  return { ok: true, group_id: groupId, merged, cancelledSourceIds: chronologicalSources.map((source) => source.id) }
}

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

export type SplitTargetPlan = {
  group_id: string
  /** new bill draft: lines chosen for this target (ordered as in the source) */
  lines: Array<{ lineId: string; amountPaise: number }>
  adjustments: Array<{ type: string; amountPaise: number }>
  /** bardan entries attached to this target (caller re-points billId) */
  bardan: Array<{ note?: string }>
  netPaise: number
}

export type SplitSourceInput = {
  bill: MergeBillInput
  lines: readonly MergeLineInput[]
  adjustments?: readonly MergeAdjustmentInput[]
  bardan?: ReadonlyArray<{ lineId?: string; method: string; creditPaise: number; note?: string }>
}

export type SplitRefusal = 'cancelled_source' | 'need_two_targets' | 'line_reused' | 'line_unknown'

export type SplitPlan =
  | { ok: true; group_id: string; targets: SplitTargetPlan[]; cancelledSourceId: string }
  | { ok: false; refusals: SplitRefusal[] }

/**
 * Splits one source bill into 2+ target plans, each holding a DISTINCT subset
 * of the source lines. Adjustments and bardan live on the source now; every
 * target starts with none unless the caller re-points them via lineId.
 */
export function planSplit(source: SplitSourceInput, targetLineIds: ReadonlyArray<readonly string[]>): SplitPlan {
  const refusals: SplitRefusal[] = []
  if (source.bill.cancelled) refusals.push('cancelled_source')
  if (targetLineIds.length < 2) refusals.push('need_two_targets')
  const byLineId = new Map<string, MergeLineInput>()
  for (const line of source.lines) byLineId.set(line.lineId, line)

  const seen = new Set<string>()
  for (const targetLines of targetLineIds) {
    for (const lineId of targetLines) {
      if (!byLineId.has(lineId)) refusals.push('line_unknown')
      if (seen.has(lineId)) refusals.push('line_reused')
      seen.add(lineId)
    }
  }
  if (refusals.length > 0) return { ok: false, refusals }

  const groupId = newGroupId()
  const targets: SplitTargetPlan[] = targetLineIds.map((lineIds) => {
    const lines = lineIds.map((lineId) => {
      const line = byLineId.get(lineId)!
      return { lineId, amountPaise: line.amountPaise }
    })
    const net = computeBillNet(
      lines.map((line) => ({ amountPaise: line.amountPaise })),
      [],
      [],
      source.bill.taxMode as PurchaseTaxMode,
      source.bill.gstRateBp,
    ).netPaise
    return { group_id: groupId, lines, adjustments: [], bardan: [], netPaise: net }
  })
  // adjustments live on the source today; the caller re-points them per target.
  // Target plans start with none of them, so the split net uses lines only.
  void source.adjustments
  void source.bardan
  return { ok: true, group_id: groupId, targets, cancelledSourceId: source.bill.id }
}
