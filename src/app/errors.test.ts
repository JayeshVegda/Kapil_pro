import { describe, expect, it } from 'vitest'
import { AppError, normalizeError, toUserMessage } from '@/app/errors'
import { runDataOperation } from '@/data/reliability'

describe('error normalization', () => {
  it('maps pocketbase conflict to app error', () => {
    const input = {
      status: 409,
      message: 'duplicate value',
      data: {
        data: {
          name: {
            code: 'validation_not_unique',
            message: 'name must be unique',
          },
        },
      },
    }

    const error = normalizeError(input, { operation: 'create-item' })

    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe('CONFLICT')
    expect(error.retryable).toBe(false)
    expect(error.message.toLowerCase()).toContain('unique')
  })

  it('marks network-like failures as retryable', () => {
    const error = normalizeError(new TypeError('Failed to fetch'), { operation: 'save-payment' })
    expect(error.code).toBe('NETWORK')
    expect(error.retryable).toBe(true)
  })

  it('provides safe user message fallback', () => {
    const text = toUserMessage(new Error(''))
    expect(text).toBe('Something went wrong. Please try again.')
  })
})

describe('runDataOperation', () => {
  it('wraps unknown errors as app errors', async () => {
    await expect(
      runDataOperation('test-operation', async () => {
        throw 'boom'
      }),
    ).rejects.toBeInstanceOf(AppError)
  })
})
