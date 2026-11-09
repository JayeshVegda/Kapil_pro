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
  return clean && Number.isFinite(Number(clean)) ? `${clean} bags` : clean
}
