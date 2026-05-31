export type AppErrorCode =
  | 'VALIDATION'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'SERVER'
  | 'UNKNOWN'

export class AppError extends Error {
  code: AppErrorCode
  retryable: boolean
  operation?: string
  details?: unknown

  constructor(input: {
    code: AppErrorCode
    message: string
    retryable?: boolean
    operation?: string
    details?: unknown
    cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = 'AppError'
    this.code = input.code
    this.retryable = Boolean(input.retryable)
    this.operation = input.operation
    this.details = input.details
  }
}

type PocketBaseLikeError = {
  status?: number
  message?: unknown
  data?: unknown
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

export function normalizeError(error: unknown, context?: { operation?: string }): AppError {
  if (isAppError(error)) return error

  const operation = context?.operation
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new AppError({
      code: 'NETWORK',
      message: 'Network request failed. Please check connection and retry.',
      retryable: true,
      operation,
      cause: error,
    })
  }

  const pb = isPocketBaseError(error) ? error : null
  if (pb) {
    const status = Number(pb.status ?? 0)
    const message = extractPocketBaseMessage(pb) ?? fallbackMessageForStatus(status)
    const code = codeFromStatus(status)
    return new AppError({
      code,
      message,
      retryable: code === 'NETWORK' || code === 'RATE_LIMITED' || code === 'SERVER',
      operation,
      details: pb.data,
      cause: error,
    })
  }

  if (error instanceof Error) {
    return new AppError({
      code: 'UNKNOWN',
      message: error.message || 'Unexpected error',
      retryable: false,
      operation,
      cause: error,
    })
  }

  return new AppError({
    code: 'UNKNOWN',
    message: 'Unexpected error',
    retryable: false,
    operation,
    cause: error,
  })
}

export function toUserMessage(error: unknown) {
  const normalized = normalizeError(error)
  const message = normalized.message.trim()
  if (message && !/^unexpected error\.?$/i.test(message)) return message
  return 'Something went wrong. Please try again.'
}

function isPocketBaseError(value: unknown): value is PocketBaseLikeError {
  return typeof value === 'object' && value !== null && ('status' in value || 'data' in value || 'message' in value)
}

function extractPocketBaseMessage(error: PocketBaseLikeError) {
  const data = error.data
  if (typeof data === 'object' && data !== null) {
    const nestedData = (data as Record<string, unknown>).data
    if (typeof nestedData === 'object' && nestedData !== null) {
      for (const value of Object.values(nestedData as Record<string, unknown>)) {
        if (typeof value === 'object' && value !== null) {
          const maybeMessage = (value as Record<string, unknown>).message
          if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage.trim()
        }
      }
    }
  }
  if (typeof error.message === 'string' && error.message.trim()) return error.message.trim()
  return null
}

function codeFromStatus(status: number): AppErrorCode {
  if (status === 400) return 'VALIDATION'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'SERVER'
  return 'UNKNOWN'
}

function fallbackMessageForStatus(status: number) {
  if (status === 400) return 'Invalid request.'
  if (status === 401) return 'Session expired. Please sign in again.'
  if (status === 403) return 'You are not allowed to perform this action.'
  if (status === 404) return 'Record not found.'
  if (status === 409) return 'A conflicting record already exists.'
  if (status === 429) return 'Too many requests. Please retry shortly.'
  if (status >= 500) return 'Server error. Please retry.'
  return 'Unexpected error.'
}
