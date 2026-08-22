import type { CastingTrashEntry } from '@/domain/casting-types'

const TTL_MS = 3 * 60 * 60 * 1000

export function cleanupExpiredCastingTrash(entries: CastingTrashEntry[]): CastingTrashEntry[] {
  const now = Date.now()
  return entries.filter((e) => e.deletedAt + TTL_MS > now)
}
