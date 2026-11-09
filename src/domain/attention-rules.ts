import { diffDays } from './period-helpers'

export const CUSTOMER_UNPAID_OVERDUE_DAYS = 45
export const SUPPLIER_DUE_OVERDUE_DAYS = 30
export const BARDAN_PENDING_OVERDUE_DAYS = 10
export const DRAFTS_WAITING_OVERDUE_DAYS = 3
export const BRASS_RATE_STALE_DAYS = 3

export type AttentionItemId =
  | 'customer_overdue'
  | 'supplier_due'
  | 'bardan_pending'
  | 'drafts_waiting'
  | 'brass_rate_stale'

export type AttentionItem = {
  id: AttentionItemId
  label: string
  count: number
  tone: 'amber' | 'rose'
  href: string
  detail?: string
}

export type AttentionSummary = {
  items: AttentionItem[]
  allClear: boolean
}

export type AttentionRulesInput = {
  customers?: Array<{ id: string; name: string; dueDays: number; dueAmount: number }>
  suppliers?: Array<{ id: string; name: string; oldestDueDays: number | null; duePaise: number }>
  bardanPendingBills?: Array<{ id: string; inNo: string; supplierName: string; daysOld: number }>
  pendingDraftsCount?: number
  oldestDraftDays?: number
  latestBrassRateDate?: string | null
  asOfDate: string
}

export function buildAttentionItems(input: AttentionRulesInput): AttentionSummary {
  const items: AttentionItem[] = []

  // 1. Overdue Customers (>45 days)
  const overdueCustomers = (input.customers ?? []).filter(
    (c) => c.dueAmount > 0 && c.dueDays > CUSTOMER_UNPAID_OVERDUE_DAYS,
  )
  if (overdueCustomers.length > 0) {
    items.push({
      id: 'customer_overdue',
      label: `${overdueCustomers.length} customer${overdueCustomers.length > 1 ? 's' : ''} overdue (>45d)`,
      count: overdueCustomers.length,
      tone: 'rose',
      href: '/ledger?tab=customers',
      detail: `Total overdue: ₹${Math.round(overdueCustomers.reduce((s, c) => s + c.dueAmount, 0)).toLocaleString('en-IN')}`,
    })
  }

  // 2. Suppliers Due (>30 days)
  const dueSuppliers = (input.suppliers ?? []).filter(
    (s) => s.duePaise > 0 && s.oldestDueDays != null && s.oldestDueDays > SUPPLIER_DUE_OVERDUE_DAYS,
  )
  if (dueSuppliers.length > 0) {
    items.push({
      id: 'supplier_due',
      label: `${dueSuppliers.length} supplier${dueSuppliers.length > 1 ? 's' : ''} due (>30d)`,
      count: dueSuppliers.length,
      tone: 'amber',
      href: '/ledger?tab=suppliers',
      detail: `${dueSuppliers.length} accounts waiting for payment`,
    })
  }

  // 3. Bardan Pending (>10 days)
  const bardanOverdue = (input.bardanPendingBills ?? []).filter(
    (b) => b.daysOld > BARDAN_PENDING_OVERDUE_DAYS,
  )
  if (bardanOverdue.length > 0) {
    const oldest = Math.max(...bardanOverdue.map((b) => b.daysOld))
    items.push({
      id: 'bardan_pending',
      label: `${bardanOverdue.length} bardan pending (${oldest}d oldest)`,
      count: bardanOverdue.length,
      tone: 'amber',
      href: '/purchase-bills?tab=bardan',
      detail: `${bardanOverdue.length} bills missing empty bag settlement`,
    })
  }

  // 4. Drafts Waiting (>3 days or general pending)
  const draftsCount = input.pendingDraftsCount ?? 0
  if (draftsCount > 0) {
    const isOld = (input.oldestDraftDays ?? 0) >= DRAFTS_WAITING_OVERDUE_DAYS
    items.push({
      id: 'drafts_waiting',
      label: `${draftsCount} draft${draftsCount > 1 ? 's' : ''} waiting`,
      count: draftsCount,
      tone: isOld ? 'rose' : 'amber',
      href: '/drafts',
      detail: isOld ? 'Some drafts waiting >3 days' : 'Awaiting owner review',
    })
  }

  // 5. Brass Rate Stale (>3 days old)
  if (input.latestBrassRateDate) {
    const daysSince = diffDays(input.latestBrassRateDate, input.asOfDate)
    if (daysSince > BRASS_RATE_STALE_DAYS) {
      items.push({
        id: 'brass_rate_stale',
        label: `Brass rate is ${daysSince}d stale`,
        count: daysSince,
        tone: 'rose',
        href: '/items?tab=sale',
        detail: `Last rate saved on ${input.latestBrassRateDate}`,
      })
    }
  }

  return {
    items,
    allClear: items.length === 0,
  }
}
