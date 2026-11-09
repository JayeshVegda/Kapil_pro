import { describe, expect, it } from 'vitest'
import { getPurchaseReadState, requirePurchaseRecord } from './purchase-read-state'

describe('purchase record read states', () => {
  it('distinguishes loading, failed, missing, and ready records', () => {
    const record = { id: 'bill1' }
    expect(getPurchaseReadState({ isLoading: true, isError: false }, undefined)).toEqual({ status: 'loading' })
    const error = new Error('Read failed')
    expect(getPurchaseReadState({ isLoading: false, isError: true, error }, undefined)).toEqual({ status: 'error', error })
    expect(getPurchaseReadState({ isLoading: false, isError: false }, null)).toEqual({ status: 'not-found' })
    expect(getPurchaseReadState({ isLoading: false, isError: false }, record)).toEqual({ status: 'ready', record })
  })

  it('does not treat stale cached records as writable after a failed read', () => {
    const error = new Error('Connection lost')
    const state = getPurchaseReadState({ isLoading: false, isError: true, error }, { id: 'stale' })
    expect(state).toEqual({ status: 'error', error })
    expect(() => requirePurchaseRecord(state, 'Bill')).toThrow('Unable to load bill.')
  })

  it.each([
    { query: { isLoading: true, isError: false }, message: 'Bill is still loading.' },
    { query: { isLoading: false, isError: true }, message: 'Unable to load bill.' },
    { query: { isLoading: false, isError: false }, message: 'Bill not found.' },
  ])('refuses a required record with $message', ({ query, message }) => {
    expect(() => requirePurchaseRecord(getPurchaseReadState(query, null), 'Bill')).toThrow(message)
  })

  it('returns the same ready record without a truthiness-based empty fallback', () => {
    expect(requirePurchaseRecord(getPurchaseReadState({ isLoading: false, isError: false }, 0), 'Payment')).toBe(0)
  })
})
