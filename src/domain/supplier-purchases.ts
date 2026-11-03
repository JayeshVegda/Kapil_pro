import { applyBasisPoints, sumPaise } from './supplier-units'

/**
 * Purchase bill net computation. PURE — no DB access.
 *
 * Contract (spec + approved corrections, 2026-11-03):
 *
 * - taxable = sum(line amounts)
 *             - bardan DEDUCT credits            (subtract from material value)
 *             - quality_cut adjustments          (stored positive = deduction)
 *   taxable is floored at 0 (see assumptions: no negative-taxable bills).
 * - GST mode  : tax = roundHalfUp(taxable * gst_rate_bp / 10000), ADDED to payable.
 * - RCM mode  : same tax, but returned ONLY as rcmLiability — NOT added to payable
 *               (we are the one liable; supplier cash payable excludes it).
 * - `none`    : no tax at all.
 * - Other adjustments (labour | transport | other) are SIGNED paise and apply
 *   after tax (positive increases payable, negative decreases).
 *
 * Presidential round-off (approved correction #2): computeBillNet ALWAYS computes
 * roundOffPaise itself so that netPaise is a whole rupee (multiples of 100 paise).
 * There is no manual `round_off` adjustment type; the data layer stores the
 * computed round-off as a visible line — it is never hand-entered.
 *
 * All arithmetic is integer paise.
 */

export type PurchaseTaxMode = 'none' | 'gst' | 'rcm'

export const PURCHASE_ADJUSTMENT_TYPES = ['labour', 'transport', 'quality_cut', 'other'] as const
export type PurchaseAdjustmentType = (typeof PURCHASE_ADJUSTMENT_TYPES)[number]

export const PURCHASE_BARDAN_METHODS = ['deduct', 'in_kind', 'cash_back', 'advance'] as const
export type PurchaseBardanMethod = (typeof PURCHASE_BARDAN_METHODS)[number]

export type SupplierPool = 'kacha' | 'gst'

/**
 * Pool-to-tax-mode rule:
 * - Kacha pool forces tax mode 'none'.
 * - GST pool allows 'gst' or 'rcm' only (defaults to 'gst' if 'none' is passed).
 */
export function allowedTaxModesForPool(pool: SupplierPool): readonly PurchaseTaxMode[] {
  return pool === 'kacha' ? ['none'] : ['gst', 'rcm']
}

export function resolveTaxModeForPool(pool: SupplierPool, requestedMode?: string): PurchaseTaxMode {
  if (pool === 'kacha') return 'none'
  if (requestedMode === 'rcm') return 'rcm'
  return 'gst'
}

/**
 * Bardan pending age buckets:
 * - < 7 days: fresh (normal)
 * - 7 to 10 days: warning (amber)
 * - > 10 days: critical (red)
 */
export type BardanAgeBucket = 'fresh' | 'warning' | 'critical'

export function computeBardanAgeBucket(daysSinceBill: number): BardanAgeBucket {
  if (daysSinceBill > 10) return 'critical'
  if (daysSinceBill >= 7) return 'warning'
  return 'fresh'
}

/** Days difference between a target date and today (or reference date). */
export function computeDaysSince(isoDate: string, referenceDateIso?: string): number {
  if (!isoDate) return 0
  const ref = referenceDateIso ? new Date(referenceDateIso) : new Date()
  const target = new Date(isoDate)
  const diffMs = ref.getTime() - target.getTime()
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
}

/** Memo field helpers for bags weighed at receipt (kg) stored in private_note. */
export function formatPrivateNoteWithBags(note: string, bagsKg: number | null): string {
  const cleanNote = extractUserNote(note)
  if (bagsKg == null || isNaN(bagsKg) || bagsKg <= 0) {
    return cleanNote
  }
  const tag = `[bags_at_receipt:${bagsKg.toFixed(3)}]`
  return cleanNote ? `${tag}\n${cleanNote}` : tag
}

export function parseBagsAtReceiptKg(rawNote?: string): number | null {
  if (!rawNote) return null
  const match = rawNote.match(/\[bags_at_receipt:([\d.]+)\]/)
  if (!match) return null
  const val = parseFloat(match[1])
  return Number.isFinite(val) ? val : null
}

export function extractUserNote(rawNote?: string): string {
  if (!rawNote) return ''
  return rawNote.replace(/\[bags_at_receipt:[\d.]+\]\n?/, '').trim()
}

export type BillLineInput = { amountPaise: number }

export type BillAdjustmentInput = {
  type: PurchaseAdjustmentType | string
  amountPaise: number // signed; quality_cut stored positive and treated as a deduction
}

export type BillBardanInput = {
  method: PurchaseBardanMethod | string
  creditPaise: number // meaningful for deduct only
  cashAmountPaise?: number // info-only for cash_back
}

export type BillNetResult = {
  linesTotalPaise: number
  bardanDeductPaise: number
  qualityCutPaise: number
  taxablePaise: number
  taxPaise: number
  rcmLiabilityPaise: number
  otherAdjustmentsPaise: number
  roundOffPaise: number
  netPaise: number
}

export function computeBillNet(
  lines: readonly BillLineInput[],
  adjustments: readonly BillAdjustmentInput[],
  bardan: readonly BillBardanInput[],
  taxMode: PurchaseTaxMode | string,
  gstRateBp: number,
): BillNetResult {
  const linesTotalPaise = sumPaise(lines.map((line) => line.amountPaise))

  let bardanDeductPaise = 0
  for (const entry of bardan) {
    if (entry.method === 'deduct') bardanDeductPaise += Math.trunc(Number(entry.creditPaise ?? 0)) || 0
    // in_kind -> credit 0 by definition; cash_back -> no payable effect at all;
    // advance -> creates a supplier_payments `bardan_advance` row instead, never a credit here.
  }

  let qualityCutPaise = 0
  let otherAdjustmentsPaise = 0
  for (const adjustment of adjustments) {
    const amount = Math.trunc(Number(adjustment.amountPaise ?? 0)) || 0
    if (adjustment.type === 'quality_cut') {
      qualityCutPaise += amount // positive amounts are the usual direction
    } else {
      otherAdjustmentsPaise += amount
    }
  }

  const taxablePaise = Math.max(0, linesTotalPaise - bardanDeductPaise - qualityCutPaise)

  let taxPaise = 0
  if (taxMode === 'gst') taxPaise = applyBasisPoints(taxablePaise, gstRateBp)
  if (taxMode === 'rcm') taxPaise = applyBasisPoints(taxablePaise, gstRateBp)
  const rcmLiabilityPaise = taxMode === 'rcm' ? taxPaise : 0

  const beforeRoundPaise = taxablePaise + (taxMode === 'gst' ? taxPaise : 0) + otherAdjustmentsPaise
  // Round to the NEAREST whole rupee; exact .50 rounds UP (half away from zero,
  // 62.50 -> 63, 62.01 -> 62, 62.49 -> 62). Rounds toward we-owe at the midpoint,
  // which is the safe direction for a supplier payable.
  const remainder = beforeRoundPaise % 100
  const roundOffPaise = beforeRoundPaise < 0 || remainder === 0 ? 0 : remainder < 50 ? -remainder : 100 - remainder
  const finalNetPaise = Math.max(0, beforeRoundPaise + roundOffPaise)

  return {
    linesTotalPaise,
    bardanDeductPaise,
    qualityCutPaise,
    taxablePaise,
    taxPaise: taxPaise,
    rcmLiabilityPaise,
    otherAdjustmentsPaise,
    roundOffPaise,
    netPaise: finalNetPaise,
  }
}
