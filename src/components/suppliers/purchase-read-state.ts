export type PurchaseReadState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'not-found' }
  | { status: 'ready'; record: T }

export function getPurchaseReadState<T>(
  query: { isLoading: boolean; isError: boolean; error?: unknown },
  record: T | null | undefined,
): PurchaseReadState<T> {
  if (query.isError) return { status: 'error', error: query.error }
  if (query.isLoading) return { status: 'loading' }
  if (record == null) return { status: 'not-found' }
  return { status: 'ready', record }
}

export function requirePurchaseRecord<T>(state: PurchaseReadState<T>, subject: string): T {
  if (state.status === 'loading') throw new Error(`${subject} is still loading.`)
  if (state.status === 'error') throw new Error(`Unable to load ${subject.toLowerCase()}.`)
  if (state.status === 'not-found') throw new Error(`${subject} not found.`)
  return state.record
}
