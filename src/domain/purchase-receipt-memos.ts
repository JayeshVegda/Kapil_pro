const MEMO_PREFIX = '[purchase_line_memos_v1:'
const MEMO_PATTERN = /\[purchase_line_memos_v1:([^\]\r\n]*)\]\n?/g

export function parsePurchaseLineMemos(note = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of note.matchAll(MEMO_PATTERN)) {
    try {
      const value: unknown = JSON.parse(decodeURIComponent(match[1]))
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      for (const [id, memo] of Object.entries(value)) {
        if (typeof memo === 'string' && memo.trim()) result[id] = memo.trim()
      }
    } catch {
      // Legacy or damaged metadata cannot prevent opening a bill.
    }
  }
  return result
}

export function removePurchaseLineMemoMetadata(note: string): string {
  return note.replace(MEMO_PATTERN, '').trim()
}

export function formatPurchaseLineMemos(note: string, memos: Readonly<Record<string, string>>): string {
  const cleanNote = removePurchaseLineMemoMetadata(note)
  const entries = Object.entries(memos).filter(([, value]) => value.trim()).map(([id, value]) => [id, value.trim()])
  if (entries.length === 0) return cleanNote
  const tag = `${MEMO_PREFIX}${encodeURIComponent(JSON.stringify(Object.fromEntries(entries)))}]`
  return cleanNote ? `${tag}\n${cleanNote}` : tag
}

export function purchaseReceiptMemoText(memo: string): string {
  const clean = memo.trim()
  if (/^0+(?:\.0+)?(?:\s*(?:bags?|kg))?$/i.test(clean)) return ''
  return clean && Number.isFinite(Number(clean)) ? `${clean} bags` : clean
}

export function purchaseReceiptBagCount(memo = ''): number {
  const match = /^\s*(\d+)(?:\s*bags?)?\s*$/i.exec(memo)
  const count = match ? Number(match[1]) : 0
  return Number.isSafeInteger(count) ? count : 0
}

const settledBagCountTag = /^\[settled_bags_v1:(\d+)\]\n?/

export function readSettledBagCount(note: string) {
  return {
    bagCount: purchaseReceiptBagCount(settledBagCountTag.exec(note)?.[1]) || undefined,
    note: note.replace(settledBagCountTag, ''),
  }
}

export function writeSettledBagCount(note: string, bagCount?: number) {
  const clean = readSettledBagCount(note).note
  return bagCount && Number.isSafeInteger(bagCount) && bagCount > 0
    ? `[settled_bags_v1:${bagCount}]\n${clean}`
    : clean
}

export function remainingPurchaseBags(
  line: { id: string; receiptMemo?: string },
  entries: ReadonlyArray<{ rateLineId: string; bagCount?: number }>,
) {
  const count = purchaseReceiptBagCount(line.receiptMemo)
  const linked = entries.filter((entry) => entry.rateLineId === line.id)
  // Old entries recorded weight only. Treat a linked historical entry as settled.
  if (linked.some((entry) => entry.bagCount === undefined)) return 0
  return Math.max(0, count - linked.reduce((sum, entry) => sum + (entry.bagCount ?? 0), 0))
}

export function hasPendingPurchaseBardan(
  lines: ReadonlyArray<{ id: string; receiptMemo?: string }>,
  entries: ReadonlyArray<{ rateLineId: string; bagCount?: number }>,
  receiptKg: number | null,
): boolean {
  const expected = lines.filter((line) => purchaseReceiptBagCount(line.receiptMemo) > 0)
  if (!expected.length) return (receiptKg ?? 0) > 0 && entries.length === 0
  if (expected.length === 1 && entries.some((entry) => !entry.rateLineId)) return false
  return expected.some((line) => remainingPurchaseBags(line, entries) > 0)
}
