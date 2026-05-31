import { normalizeError } from '@/app/errors'

export async function runDataOperation<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    const normalized = normalizeError(error, { operation })
    console.error(`[data:${operation}]`, normalized)
    throw normalized
  }
}
