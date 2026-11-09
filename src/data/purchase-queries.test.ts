import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPurchaseReadModel } from '@/domain/purchase-read-model'
import { bundleFixture } from '@/test/purchase-fixtures'
import {
  purchaseAuditQueryOptions, purchaseBillQueryOptions, purchaseBillsQueryOptions,
  purchaseReadModelQueryOptions, supplierBundleQueryOptions, supplierContextQueryOptions,
  supplierListQueryOptions, supplierPaymentsQueryOptions, suppliersSummaryQueryOptions,
} from './purchase-queries'
import { listSuppliers, loadPurchaseReadModel } from './suppliers'

vi.mock('./suppliers', () => ({
  loadPurchaseReadModel: vi.fn(), listSuppliers: vi.fn(), loadPurchaseBill: vi.fn(), loadPurchaseAuditLog: vi.fn(),
}))

const bundle = bundleFixture()
const model = buildPurchaseReadModel([bundle.supplier], bundle, '2026-11-08')
let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadPurchaseReadModel).mockResolvedValue(model)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => client.clear())

describe('purchase query options', () => {
  it('shares one full snapshot while observers select their own financial projections', async () => {
    await client.fetchQuery(purchaseReadModelQueryOptions())
    const bills = new QueryObserver(client, purchaseBillsQueryOptions())
    const payments = new QueryObserver(client, supplierPaymentsQueryOptions())
    const summaries = new QueryObserver(client, suppliersSummaryQueryOptions())
    const context = new QueryObserver(client, supplierContextQueryOptions('supplier1'))
    const selectedBundle = new QueryObserver(client, supplierBundleQueryOptions('supplier1'))
    const observers = [bills, payments, summaries, context, selectedBundle]
    const unsubscribe = observers.map((observer) => observer.subscribe(() => {}))

    expect(bills.getCurrentResult().data).toEqual(model.bills)
    expect(payments.getCurrentResult().data).toEqual(model.payments)
    expect(summaries.getCurrentResult().data).toEqual(model.summaries)
    expect(context.getCurrentResult().data).toBe(model.supplierContexts.get('supplier1'))
    expect(selectedBundle.getCurrentResult().data).toBe(model.supplierContexts.get('supplier1')?.bundle)
    expect(client.getQueryData(purchaseReadModelQueryOptions().queryKey)).toBe(model)
    expect(client.getQueryCache().getAll()).toHaveLength(1)
    expect(loadPurchaseReadModel).toHaveBeenCalledTimes(1)
    unsubscribe.forEach((stop) => stop())
  })

  it('returns null for a missing supplier rather than a success-shaped empty bundle', async () => {
    await client.fetchQuery(purchaseReadModelQueryOptions())
    const context = new QueryObserver(client, supplierContextQueryOptions('missing'))
    const selectedBundle = new QueryObserver(client, supplierBundleQueryOptions('missing'))
    expect(context.getCurrentResult().data).toBeNull()
    expect(selectedBundle.getCurrentResult().data).toBeNull()
  })

  it('does not fetch contexts or bill details without an identifier', () => {
    expect(supplierContextQueryOptions('').enabled).toBe(false)
    expect(supplierBundleQueryOptions('').enabled).toBe(false)
    expect(purchaseBillQueryOptions('').enabled).toBe(false)
    const context = new QueryObserver(client, supplierContextQueryOptions(''))
    const stop = context.subscribe(() => {})
    expect(context.getCurrentResult().fetchStatus).toBe('idle')
    expect(loadPurchaseReadModel).not.toHaveBeenCalled()
    stop()
  })

  it('keeps detail, active supplier list, and audit reads isolated from the snapshot', async () => {
    expect(purchaseBillQueryOptions('bill1').queryKey).toEqual(['purchase-bill', 'bill1'])
    expect(purchaseAuditQueryOptions('2026-08-11').queryKey).toEqual(['purchase-logs-audit', '2026-08-11'])
    expect(supplierListQueryOptions().queryKey).toEqual(['suppliers-list'])
    vi.mocked(listSuppliers).mockResolvedValue([bundle.supplier])
    await expect(client.fetchQuery(supplierListQueryOptions())).resolves.toEqual([bundle.supplier])
    expect(listSuppliers).toHaveBeenCalledWith({ includeInactive: false })
    expect(loadPurchaseReadModel).not.toHaveBeenCalled()
  })
})
