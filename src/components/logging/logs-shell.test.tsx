import { describe, expect, it } from 'vitest'
import { defaultLogFromDate } from './logs-shell'

describe('logs default date window', () => {
  it('handles year and leap-day boundaries in UTC', () => {
    expect(defaultLogFromDate('2026-01-01', 1)).toBe('2025-12-31')
    expect(defaultLogFromDate('2024-03-01', 1)).toBe('2024-02-29')
  })
})
