import { describe, expect, it } from 'vitest'
import { filterDraftInbox, type InboxEntry, type InboxFilters } from '@/domain/draft-inbox'

const rows: InboxEntry[] = [
  { id: 'sales', module: 'sales', kind: 'bill', status: 'pending_review', created: '2026-11-15 10:00:00', searchText: 'VEC brass' },
  { id: 'purchase', module: 'purchase', kind: 'payment', status: 'pending_review', created: '2026-11-16 10:00:00', searchText: 'Maruti Brass' },
  { id: 'casting', module: 'casting', kind: 'session', status: 'pending_review', created: '2026-11-16 11:00:00', searchText: 'Coal' },
  { id: 'old', module: 'purchase', kind: 'bill', status: 'approved', created: '2026-11-14 10:00:00', searchText: 'Maruti scrap' },
  { id: 'rejected', module: 'sales', kind: 'payment', status: 'rejected', created: '2026-11-13 10:00:00', searchText: 'VEC receipt' },
]

const base: InboxFilters = {
  purchaseEnabled: true, castingEnabled: true, showHistory: false,
  module: 'all', kind: 'all', status: 'all', search: '',
}

describe('unified draft inbox', () => {
  it('shows pending rows from all enabled lanes, newest first; history is opt in', () => {
    expect(filterDraftInbox(rows, base).map((row) => row.id)).toEqual(['casting', 'purchase', 'sales'])
    expect(filterDraftInbox(rows, { ...base, showHistory: true }).map((row) => row.id)).toEqual(['casting', 'purchase', 'sales', 'old', 'rejected'])
    expect(filterDraftInbox(rows, { ...base, showHistory: true, status: 'rejected' }).map((row) => row.id)).toEqual(['rejected'])
  })

  it('hides disabled module rows and restores them when enabled', () => {
    expect(filterDraftInbox(rows, { ...base, purchaseEnabled: false, castingEnabled: false }).map((row) => row.id)).toEqual(['sales'])
    expect(filterDraftInbox(rows, base).map((row) => row.id)).toEqual(['casting', 'purchase', 'sales'])
    expect(filterDraftInbox(rows, { ...base, module: 'purchase', search: 'maruti' }).map((row) => row.id)).toEqual(['purchase'])
  })
})
