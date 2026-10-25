/**
 * Pure finding builders for the Issues page (system console).
 * Data probing lives in src/data/health.ts; this module only classifies.
 * All math must stay here so it can be unit tested without PocketBase.
 */

export type FindingSeverity = 'error' | 'warn' | 'info' | 'ok'

export type Finding = {
  severity: FindingSeverity
  title: string
  detail: string
}

const num = (v: unknown) => (Number.isFinite(Number(v ?? 0)) ? Number(v) : 0)
const datePart = (v: unknown) => String(v ?? '').slice(0, 10)

export type CollectionProbe = {
  name: string
  ok: boolean
  totalItems: number | null
  /** true when the probe got HTTP 200 but the collection is expected to be gated */
  intentionallyGated?: boolean
}

export function buildCollectionFindings(probes: CollectionProbe[]): Finding[] {
  const findings: Finding[] = []
  for (const probe of probes) {
    if (!probe.ok) {
      if (probe.intentionallyGated) {
        findings.push({
          severity: 'info',
          title: `${probe.name}: gated (expected)`,
          detail: 'This module is locked for the agent role / unused. Ignore unless you need it again.',
        })
      } else {
        findings.push({
          severity: 'error',
          title: `${probe.name}: not readable`,
          detail: 'PocketBase refused or dropped this request. If the backend is online, API rules were likely changed again.',
        })
      }
      continue
    }
    if (probe.name === 'brass_rates' && (probe.totalItems ?? 0) === 0) {
      findings.push({
        severity: 'error',
        title: 'brass_rates: market rate history is EMPTY',
        detail: 'Backdated bills and rate lookups will show MKT 0. Re-run the brass RSS sync (windows scheduled task "Kapil Brass RSS Daily") or import rates.',
      })
    }
  }
  return findings
}

export function buildRateFreshnessFindings(latestRateDate: string | null, todayIso: string): Finding[] {
  if (!latestRateDate) {
    return [{ severity: 'error', title: 'No saved market rate at all', detail: 'brass_rates has no rows the app can read. New bills will start with MKT 0 until the feed works or you type the rate.' }]
  }
  const daysOld = Math.floor((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${latestRateDate}T00:00:00Z`)) / 86_400_000)
  if (daysOld > 1) {
    return [{
      severity: 'warn',
      title: `Market rate is ${daysOld} days old (last saved ${latestRateDate})`,
      detail: 'The brass RSS feed has not saved a fresh rate. Bills created today will fall back to the old rate or MKT 0 — check the feed or enter the rate manually.',
    }]
  }
  return [{ severity: 'ok', title: `Market rate current (saved ${latestRateDate})`, detail: 'brass_rates has a recent vilaity row.' }]
}

export type SanityInputs = {
  bills: Array<{ id: string; bookNo: number; billNo: number; customer: string; customerName: string; date: string }>
  items: Array<{ id: string; bill: string }>
  drafts: Array<{ id: string; status: string; customerName: string; bookNo: number; billNo: number; convertedBill: string; created: string }>
  payments: Array<{ id: string; customer: string; amount: number }>
  customers: Array<{ id: string }>
  todayIso: string
}

export function buildSanityFindings(input: SanityInputs): Finding[] {
  const findings: Finding[] = []
  const { bills, items, drafts, payments, customers, todayIso } = input

  // 1. Duplicate (book_no, bill_no)
  const seen = new Map<string, number>()
  for (const bill of bills) {
    const key = `${bill.bookNo}/${bill.billNo}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1)
  if (duplicates.length > 0) {
    findings.push({
      severity: 'error',
      title: `${duplicates.length} duplicate bill number(s)`,
      detail: `Book/bill used more than once: ${duplicates.slice(0, 5).map(([key]) => key).join(', ')}${duplicates.length > 5 ? '…' : ''}. The (book_no, bill_no) unique index should make this impossible — check for a missing index.`,
    })
  }

  // 2. Bills without items
  const billsWithItems = new Set(items.map((row) => String(row.bill)))
  const emptyBills = bills.filter((bill) => !billsWithItems.has(bill.id))
  if (emptyBills.length > 0) {
    findings.push({
      severity: 'warn',
      title: `${emptyBills.length} bill(s) with no line items`,
      detail: emptyBills.slice(0, 5).map((bill) => `${bill.bookNo}/${bill.billNo} (${bill.customerName || 'no party'}, ${bill.date})`).join('; ') + (emptyBills.length > 5 ? '…' : ''),
    })
  }

  // 3. Items pointing at missing bills
  const billIds = new Set(bills.map((bill) => bill.id))
  const orphanItems = items.filter((row) => !billIds.has(String(row.bill)))
  if (orphanItems.length > 0) {
    findings.push({
      severity: 'error',
      title: `${orphanItems.length} orphan bill item(s)`,
      detail: 'Line items exist whose bill record is gone. Ledger totals can drift from the app — inspect bill_items directly.',
    })
  }

  // 4. Payments without a customer relation
  const customerIds = new Set(customers.map((row) => row.id))
  const headlessPayments = payments.filter((row) => !customerIds.has(String(row.customer)))
  if (headlessPayments.length > 0) {
    const total = headlessPayments.reduce((sum, row) => sum + num(row.amount), 0)
    findings.push({
      severity: 'warn',
      title: `${headlessPayments.length} payment(s) with no linked party`,
      detail: `They still count as collections in some views (total ₹${Math.round(total).toLocaleString('en-IN')}). Open Logs and attach them to a party.`,
    })
  }

  // 5. Pending drafts older than 3 days
  const stalePending = drafts.filter((draft) => {
    if (draft.status === 'approved' || draft.status === 'rejected') return false
    const created = datePart(draft.created)
    if (!created) return false
    return (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${created}T00:00:00Z`)) / 86_400_000 > 3
  })
  if (stalePending.length > 0) {
    findings.push({
      severity: 'warn',
      title: `${stalePending.length} AI draft(s) pending for more than 3 days`,
      detail: stalePending.map((draft) => `${draft.customerName || 'party'} (${draft.bookNo > 0 ? `${draft.bookNo}/${draft.billNo}` : 'auto number'})`).join('; ') + '. Approve or reject them so Muse gets feedback.',
    })
  }

  // 6. Approved drafts never converted
  const approvedUnconverted = drafts.filter((draft) => draft.status === 'approved' && !draft.convertedBill)
  if (approvedUnconverted.length > 0) {
    findings.push({
      severity: 'info',
      title: `${approvedUnconverted.length} approved draft(s) never became a bill`,
      detail: 'They were approved manually without a conversion. Re-open them as pending if the bill is still needed, or reject them.',
    })
  }

  return findings
}
