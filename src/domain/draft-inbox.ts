export type InboxModule = 'sales' | 'purchase' | 'casting'
export type InboxKind = 'bill' | 'payment' | 'session' | 'action'
export type InboxStatus = 'pending_review' | 'approved' | 'rejected'

export type InboxEntry = {
  id: string
  module: InboxModule
  kind: InboxKind
  status: string
  created: string
  searchText: string
}

export type InboxFilters = {
  purchaseEnabled: boolean
  castingEnabled: boolean
  showHistory: boolean
  module: InboxModule | 'all'
  kind: InboxKind | 'all'
  status: InboxStatus | 'all'
  search: string
}

/** Browser-side merge. Disabled modules never contribute rows or counts. */
export function filterDraftInbox<T extends InboxEntry>(rows: T[], filters: InboxFilters): T[] {
  const needle = filters.search.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (row.module === 'purchase' && !filters.purchaseEnabled) return false
    if (row.module === 'casting' && !filters.castingEnabled) return false
    if (!filters.showHistory && row.status !== 'pending_review') return false
    if (filters.module !== 'all' && row.module !== filters.module) return false
    if (filters.kind !== 'all' && row.kind !== filters.kind) return false
    if (filters.status !== 'all' && row.status !== filters.status) return false
    return !needle || row.searchText.toLocaleLowerCase().includes(needle)
  }).sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id))
}

export function draftAge(created: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - new Date(created.replace(' ', 'T')).getTime())
  if (!Number.isFinite(elapsed)) return '—'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Keep the opening balance first, followed by its visible bills and payments. */
export function groupOpeningDrafts<T extends { id: string; waitingFor?: string; isOpeningBalance?: boolean }>(rows: T[]): T[] {
  const parents = new Map(rows.filter((row) => row.isOpeningBalance).map((row) => [row.id, row]))
  const children = new Map<string, T[]>()
  for (const row of rows) {
    if (!row.waitingFor || !parents.has(row.waitingFor)) continue
    const group = children.get(row.waitingFor) ?? []
    group.push(row)
    children.set(row.waitingFor, group)
  }
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    const parent = row.waitingFor ? parents.get(row.waitingFor) : undefined
    const root = parent ?? row
    // IDs belong to separate collections; only opening-group roots need deduplication.
    if (!root.isOpeningBalance || !children.has(root.id)) return [row]
    if (seen.has(root.id)) return []
    seen.add(root.id)
    return [root, ...children.get(root.id)!]
  })
}
