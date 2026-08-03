export type BillPreviewCredit = { id: string; date: string; amount: number }

export function dedupeBillPreviewCredits(entries: BillPreviewCredit[]) {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (!entry.id || seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
}
