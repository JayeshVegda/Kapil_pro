import type { QuickSearchResult } from '@/data/quick-search'

export const RECENT_QUICK_SEARCH_STORAGE_KEY = 'kapil-quick-search-recents-v1'

export type RecentQuickSearchItem = {
  id: string
  kind: QuickSearchResult['kind']
  title: string
  subtitle: string
  customerId?: string
  billId?: string
  paymentId?: string
  stockItemId?: string
  stockCustomerId?: string
  viewedAt: number
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function readRecentItems(): RecentQuickSearchItem[] {
  if (!canUseStorage()) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_QUICK_SEARCH_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((row): row is RecentQuickSearchItem => Boolean(row && typeof row === 'object' && typeof row.id === 'string' && typeof row.kind === 'string'))
      .sort((a, b) => b.viewedAt - a.viewedAt)
  } catch {
    return []
  }
}

function writeRecentItems(items: RecentQuickSearchItem[]) {
  if (!canUseStorage()) return
  window.localStorage.setItem(RECENT_QUICK_SEARCH_STORAGE_KEY, JSON.stringify(items.slice(0, 30)))
}

export function getRecentQuickSearchItems() {
  return readRecentItems()
}

export function getRecentQuickSearchResults(): QuickSearchResult[] {
  return readRecentItems().map((item) => ({
    id: `recent-${item.id}`,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    previewTitle: item.title,
    previewLines: [
      { label: 'Recent', value: new Date(item.viewedAt).toLocaleString() },
      { label: 'Type', value: item.kind },
    ],
    actionLabel: item.kind === 'Bill' ? 'Open print preview' : item.kind === 'Customer' ? 'Open ledger' : 'Open',
    customerId: item.customerId,
    billId: item.billId,
    paymentId: item.paymentId,
    stockItemId: item.stockItemId,
    stockCustomerId: item.stockCustomerId,
    isRecent: true,
  }))
}

export function rememberQuickSearchResult(result: QuickSearchResult) {
  if (result.kind === 'Rate') return
  const stableId = `${result.kind}-${result.billId ?? result.customerId ?? result.paymentId ?? `${result.stockItemId ?? ''}-${result.stockCustomerId ?? ''}`}`
  const nextItem: RecentQuickSearchItem = {
    id: stableId,
    kind: result.kind,
    title: result.title,
    subtitle: result.subtitle,
    customerId: result.customerId,
    billId: result.billId,
    paymentId: result.paymentId,
    stockItemId: result.stockItemId,
    stockCustomerId: result.stockCustomerId,
    viewedAt: Date.now(),
  }
  const existing = readRecentItems().filter((item) => item.id !== stableId)
  writeRecentItems([nextItem, ...existing])
}
