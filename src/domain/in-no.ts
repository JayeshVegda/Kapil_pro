/**
 * Purchase Bill "IN" document numbers. Pure domain - no persistence, no route.
 *
 * Format (spec): IN-<FY pair>-<4-digit seq>
 *   IN-2526-0001     first purchase bill of FY 2025-26 (Apr 2025 - Mar 2026)
 *
 * Rules (2026-11-03 corrections):
 * - Fiscal year runs April 1 -> March 31.
 * - next = max(existing seq in that FY) + 1; gaps are NEVER back-filled and
 *   sequences never reset inside a FY (module restart = continue the seq).
 * - Cancelled bills still count: their in_no stays spent.
 * - Legacy/foreign numbers that don't parse are ignored, not rejected.
 */

const IN_NO_PATTERN = /^IN-(\d{4})-(\d{1,6})$/

export function fiscalYearLabel(dateYyyyMmDd: string): string {
  const yearText = (dateYyyyMmDd || '').slice(0, 4)
  const year = Number.parseInt(yearText, 10)
  if (!Number.isInteger(year)) return ''
  const month = Number.parseInt(dateYyyyMmDd.slice(5, 7), 10)
  // April..December belongs to the FY anchored on `year`; Jan..Mar to the prior
  // FY (label pair = fiscalStart %100 + (fiscalStart+1) %100)
  const fiscalStart = month >= 4 ? year : year - 1
  return `${String(fiscalStart % 100).padStart(2, '0')}${String((fiscalStart + 1) % 100).padStart(2, '0')}`
}

export function parseInNo(inNo: string): { fiscal: string; seq: number } | null {
  const match = IN_NO_PATTERN.exec(String(inNo ?? '').trim())
  if (!match) return null
  const seq = Number.parseInt(match[2], 10)
  if (!Number.isInteger(seq) || seq < 1) return null
  return { fiscal: match[1], seq }
}

/**
 * Next document number for a bill dated `dateYyyyMmDd`, given every in_no
 * already used (any state, including cancelled).
 */
export function nextPurchaseInNo(existingInNos: Array<string>, dateYyyyMmDd: string): string {
  const fiscal = fiscalYearLabel(dateYyyyMmDd)
  let maxSeq = 0
  for (const existing of existingInNos ?? []) {
    const parsed = parseInNo(existing)
    if (parsed && parsed.fiscal === fiscal && parsed.seq > maxSeq) maxSeq = parsed.seq
  }
  return `IN-${fiscal}-${String(maxSeq + 1).padStart(4, '0')}`
}
