export type TransactionEditorKind = 'bill' | 'payment'

type TransactionEditorDetail = {
  kind: TransactionEditorKind
  id: string
}

const TRANSACTION_EDITOR_EVENT = 'kapil:open-transaction-editor'

export function openTransactionEditor(kind: TransactionEditorKind, id: string) {
  if (typeof window === 'undefined' || !id) return
  window.dispatchEvent(new CustomEvent<TransactionEditorDetail>(TRANSACTION_EDITOR_EVENT, { detail: { kind, id } }))
}

export function subscribeTransactionEditor(listener: (detail: TransactionEditorDetail) => void) {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => listener((event as CustomEvent<TransactionEditorDetail>).detail)
  window.addEventListener(TRANSACTION_EDITOR_EVENT, handler)
  return () => window.removeEventListener(TRANSACTION_EDITOR_EVENT, handler)
}
