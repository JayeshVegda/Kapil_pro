import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { invalidateAfterSupplierPurchaseWrite } from './query-invalidation'

it('invalidates the purchase audit feed together with financial views after a write', async () => {
  const client = new QueryClient()
  const keys = [['purchase-read-model'], ['purchase-logs-audit'], ['purchase-bills'], ['supplier-bundle', 'supplier1']]
  for (const key of keys) client.setQueryData(key, [])

  await invalidateAfterSupplierPurchaseWrite(client, 'supplier1')

  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  client.clear()
})

it('refetches the active shared snapshot once and waits for fresh data after a confirmed write', async () => {
  const client = new QueryClient()
  const key = ['purchase-read-model']
  client.setQueryData(key, 'before')
  let finishRefresh!: (value: string) => void
  const queryFn = vi.fn(() => new Promise<string>((resolve) => { finishRefresh = resolve }))
  const observer = new QueryObserver(client, { queryKey: key, queryFn, staleTime: Infinity })
  const stop = observer.subscribe(() => {})
  let finished = false
  const refresh = invalidateAfterSupplierPurchaseWrite(client, 'supplier1').then(() => { finished = true })

  expect(queryFn).toHaveBeenCalledTimes(1)
  expect(finished).toBe(false)
  finishRefresh('after')
  await refresh

  expect(finished).toBe(true)
  expect(client.getQueryData(key)).toBe('after')
  expect(queryFn).toHaveBeenCalledTimes(1)
  stop()
  client.clear()
})
