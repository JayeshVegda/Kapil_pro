import { pb } from '@/data/pocketbase'
import { buildCollectionFindings, buildRateFreshnessFindings, buildSanityFindings, type CollectionProbe, type Finding } from '@/domain/health-checks'

type PBRecord = Record<string, unknown> & { id: string }

const num = (v: unknown) => (Number.isFinite(Number(v ?? 0)) ? Number(v) : 0)
const datePart = (v: unknown) => String(v ?? '').slice(0, 10)

/** Collections that must be readable for the app to work. */
const CORE_COLLECTIONS = ['bills', 'bill_items', 'payments', 'customers', 'items', 'brass_rates', 'bill_drafts'] as const
/** Locked on purpose since the Muse permissions migration (module unused). */
const GATED_COLLECTIONS = ['casting_sessions', 'casting_batches', 'casting_inputs', 'casting_materials', 'casting2_sessions', 'casting2_materials', 'casting2_inputs', 'casting_batch_inputs', 'stock_in', 'stock_adjustments', 'stock_openings'] as const

export type BackendProbe = {
  online: boolean
  latencyMs: number | null
  error: string | null
}

export async function probeBackend(): Promise<BackendProbe> {
  const started = performance.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch('/pb/api/health', { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timer)
    return { online: res.ok, latencyMs: Math.round(performance.now() - started), error: res.ok ? null : `HTTP ${res.status}` }
  } catch (error) {
    return {
      online: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : 'unreachable',
    }
  }
}

async function probeOneCollection(name: string, intentionallyGated: boolean): Promise<CollectionProbe> {
  try {
    const res = await pb.collection(name).getList(1, 1, { fields: 'id' })
    return { name, ok: true, totalItems: res.totalItems, intentionallyGated }
  } catch {
    return { name, ok: false, totalItems: null, intentionallyGated }
  }
}

export async function probeCollections(): Promise<CollectionProbe[]> {
  const core = await Promise.all(CORE_COLLECTIONS.map((name) => probeOneCollection(name, false)))
  const gated = await Promise.all(GATED_COLLECTIONS.map((name) => probeOneCollection(name, true)))
  return [...core, ...gated]
}

export async function probeMarketFeed(): Promise<{ reachable: boolean; detail: string }> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const res = await fetch('/api/market-rate', { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timer)
    return { reachable: res.ok, detail: res.ok ? 'RSS feed reachable' : `HTTP ${res.status}` }
  } catch (error) {
    return { reachable: false, detail: error instanceof Error ? error.message : 'unreachable' }
  }
}

export type SanityProbeResult = { findings: Finding[]; error: string | null }

/** Loads the minimal fields the sanity checks need and classifies them. */
export async function runSanityChecks(todayIso: string): Promise<SanityProbeResult> {
  try {
    const [billsRaw, itemsRaw, draftsRaw, paymentsRaw, customersRaw, latestRates] = await Promise.all([
      pb.collection('bills').getFullList({ fields: 'id,book_no,bill_no,customer,customer_name,date' }),
      pb.collection('bill_items').getFullList({ fields: 'id,bill' }),
      pb.collection('bill_drafts').getFullList({ fields: 'id,status,customer_name,book_no,bill_no,converted_bill,created' }),
      pb.collection('payments').getFullList({ fields: 'id,customer,amount' }),
      pb.collection('customers').getFullList({ fields: 'id' }),
      pb.collection('brass_rates').getList(1, 1, { sort: '-date', fields: 'date,vilaity' }).catch(() => null),
    ])

    const latest = latestRates?.items[0] ?? null
    const rateFindings = buildRateFreshnessFindings(latest ? datePart(latest.date) : null, todayIso)

    const findings = buildSanityFindings({
      bills: (billsRaw as PBRecord[]).map((row) => ({
        id: row.id,
        bookNo: num(row.book_no),
        billNo: num(row.bill_no),
        customer: String(row.customer ?? ''),
        customerName: String(row.customer_name ?? ''),
        date: datePart(row.date),
      })),
      items: (itemsRaw as PBRecord[]).map((row) => ({ id: row.id, bill: String(row.bill ?? '') })),
      drafts: (draftsRaw as PBRecord[]).map((row) => ({
        id: row.id,
        status: String(row.status ?? ''),
        customerName: String(row.customer_name ?? ''),
        bookNo: num(row.book_no),
        billNo: num(row.bill_no),
        convertedBill: String(row.converted_bill ?? ''),
        created: String(row.created ?? ''),
      })),
      payments: (paymentsRaw as PBRecord[]).map((row) => ({ id: row.id, customer: String(row.customer ?? ''), amount: num(row.amount) })),
      customers: (customersRaw as PBRecord[]).map((row) => ({ id: row.id })),
      todayIso,
    })

    return { findings: [...buildCollectionFindings([{ name: 'brass_rates', ok: Boolean(latestRates), totalItems: latestRates?.totalItems ?? null }]), ...rateFindings, ...findings], error: null }
  } catch (error) {
    return { findings: [], error: error instanceof Error ? error.message : 'sanity probe failed' }
  }
}
