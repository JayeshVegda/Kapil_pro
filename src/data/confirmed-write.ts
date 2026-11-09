import { AppError } from '@/app/errors'
import { pb } from './pocketbase'

type RecordRow = Record<string, unknown> & { id: string }
type BatchResult = { status: number; body: unknown }
type BatchSender = { send: () => Promise<BatchResult[]> }
type PendingWrite = { id: string; fingerprint: string; label: string }
const pendingWrites = new Map<string, PendingWrite>()
const activeWrites = new Map<string, Promise<RecordRow>>()

export function generatePurchaseRecordId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(15)), (byte) => chars[byte % chars.length]).join('')
}

function writeKey(collection: string, scope: string) {
  return `kapil.pending-purchase.v1:${encodeURIComponent(pb.baseUrl || '')}:${pb.authStore.record?.id || ''}:${collection}:${scope}`
}

function readPending(key: string): PendingWrite | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const value = JSON.parse(raw) as PendingWrite
      if (/^[a-z0-9]{15}$/.test(value.id) && typeof value.fingerprint === 'string' && typeof value.label === 'string') return value
    }
  } catch {
    // Memory still protects retries when browser storage is unavailable.
  }
  return pendingWrites.get(key) ?? null
}

function storePending(key: string, value: PendingWrite | null) {
  if (value) pendingWrites.set(key, value)
  else pendingWrites.delete(key)
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
    pendingWrites.delete(key)
  } catch {
    // Saving business records must not depend on browser storage quotas.
  }
}

function canonicalInput(value: unknown): unknown {
  if (typeof File !== 'undefined' && value instanceof File) {
    return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified }
  }
  if (Array.isArray(value)) return value.map(canonicalInput)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).filter((key) => key !== 'requestId').sort().map((key) => [key, canonicalInput(record[key])]))
  }
  return value
}

async function inputFingerprint(input: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalInput(input)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function statusOf(error: unknown): number {
  return error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0
}

function uncertainWrite(label: string, id: string, cause: unknown) {
  return new AppError({
    code: 'NETWORK', retryable: false,
    message: `${label} could not be confirmed. Check the purchase bill list or supplier payment history before saving again. Retry the same entry to check its original save; it will not create a second transaction.`,
    details: { recordId: id, uncertain: true }, cause,
  })
}

async function readConfirmation(collection: string, id: string): Promise<RecordRow | null> {
  try {
    return await pb.collection(collection).getOne(id) as RecordRow
  } catch (error) {
    if (statusOf(error) === 404) return null
    throw error
  }
}

/** A pending id survives lost responses and reloads; retries reconcile or reuse it. */
export async function executeConfirmedBatch(options: {
  confirmationCollection: string
  scope: string
  label: string
  input: unknown
  build: (confirmationId: string) => { batch: BatchSender; record: RecordRow } | Promise<{ batch: BatchSender; record: RecordRow }>
  recover?: (confirmation: RecordRow) => RecordRow
}): Promise<RecordRow> {
  const key = writeKey(options.confirmationCollection, options.scope)
  const active = activeWrites.get(key)
  if (active) {
    await active
    throw new AppError({ code: 'CONFLICT', message: 'The previous save has finished. Review it before starting another transaction.' })
  }

  const action = async () => {
    const fingerprint = await inputFingerprint(options.input)
    const pending = readPending(key)
    const id = pending?.id ?? generatePurchaseRecordId()
    if (pending) {
      let existing: RecordRow | null
      try {
        existing = await readConfirmation(options.confirmationCollection, id)
      } catch (error) {
        throw uncertainWrite(pending.label, id, error)
      }
      if (existing) {
        storePending(key, null)
        if (pending.fingerprint !== fingerprint) {
          throw new AppError({ code: 'CONFLICT', message: `${pending.label} was already saved. Review it before saving the changed values.` })
        }
        return options.recover ? options.recover(existing) : existing
      }
      if (pending.fingerprint !== fingerprint) throw uncertainWrite(pending.label, id, new Error('The pending entry has different values.'))
    }

    const { batch, record } = await options.build(id)
    storePending(key, { id, fingerprint, label: options.label })
    try {
      const results = await batch.send()
      const failed = results?.find((result) => result.status < 200 || result.status >= 300)
      if (failed) {
        throw Object.assign(new Error('Purchase transaction rejected.'), { status: failed.status, data: failed.body })
      }
      const saved = results?.[0]?.body
      if (!saved || typeof saved !== 'object' || !('id' in saved) || saved.id !== record.id) {
        throw new Error('The save response did not include the committed record.')
      }
      storePending(key, null)
      return saved as RecordRow
    } catch (error) {
      const status = statusOf(error)
      const definitive = status >= 400 && status < 500 && status !== 408
      if (definitive && !pending) {
        storePending(key, null)
        throw error
      }
      try {
        const existing = await readConfirmation(options.confirmationCollection, id)
        if (existing) {
          storePending(key, null)
          return options.recover ? options.recover(existing) : existing
        }
        if (definitive) {
          storePending(key, null)
          throw error
        }
      } catch (confirmationError) {
        if (confirmationError === error && definitive) throw error
      }
      throw uncertainWrite(options.label, id, error)
    }
  }
  const promise = action()
  activeWrites.set(key, promise)
  try {
    return await promise
  } finally {
    activeWrites.delete(key)
  }
}
