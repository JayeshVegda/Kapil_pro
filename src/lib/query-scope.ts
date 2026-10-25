import type { QueryKey } from '@tanstack/react-query'

/**
 * Queries that stream/pollex in the background or serve throwaway lookups.
 * They are excluded from the global sync indicator and the Issues page's
 * error tracking so they never make the app look unhealthy by themselves.
 */
export const BACKGROUND_SYNC_QUERY_PREFIXES = new Set([
  'quick-search',
  'command-bar-deps',
  'print-bill-balance',
  'backup-snapshot',
  'export-reports-snapshot',
  'customer-auto-balance',
  'bill-drafts-pending',
  'bill-drafts-list',
  'issues-',
])

export function isBackgroundSyncQuery(queryKey: QueryKey) {
  return BACKGROUND_SYNC_QUERY_PREFIXES.has(String(queryKey[0] ?? ''))
}
