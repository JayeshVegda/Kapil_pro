import { describe, expect, it } from 'vitest'
import {
  aggregatePaymentModes,
  selectTopItemsWithFallback,
} from './sales-dashboard'

describe('Sales Dashboard Domain Helpers', () => {
  describe('aggregatePaymentModes', () => {
    it('aggregates payments and sums to exact total amount', () => {
      const payments = [
        { amount: 50_000, mode: 'cash' },
        { amount: 150_000, mode: 'RTGS' },
        { amount: 75_000, mode: 'rtgs' },
        { amount: 25_000, mode: 'cheque' },
        { amount: 10_000, mode: null },
      ]

      const slices = aggregatePaymentModes(payments)
      const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0)
      const slicesSum = slices.reduce((sum, s) => sum + s.value, 0)

      expect(slicesSum).toBe(totalAmount)
      expect(slices).toEqual([
        { key: 'rtgs', label: 'RTGS', value: 225_000 },
        { key: 'cash', label: 'Cash', value: 50_000 },
        { key: 'cheque', label: 'Cheque', value: 25_000 },
        { key: 'other', label: 'Other', value: 10_000 },
      ])
    })

    it('returns empty array when payments are empty', () => {
      expect(aggregatePaymentModes([])).toEqual([])
    })

    it('collapses more than 6 modes into top 5 plus Other', () => {
      const payments = [
        { amount: 100, mode: 'm1' },
        { amount: 90, mode: 'm2' },
        { amount: 80, mode: 'm3' },
        { amount: 70, mode: 'm4' },
        { amount: 60, mode: 'm5' },
        { amount: 50, mode: 'm6' },
        { amount: 40, mode: 'm7' },
      ]

      const slices = aggregatePaymentModes(payments)
      expect(slices).toHaveLength(6)
      expect(slices[5].label).toBe('Other')
      expect(slices[5].value).toBe(90) // 50 + 40
      const total = payments.reduce((sum, p) => sum + p.amount, 0)
      expect(slices.reduce((sum, s) => sum + s.value, 0)).toBe(total)
    })
  })

  describe('selectTopItemsWithFallback', () => {
    it('returns period items when period items exist', () => {
      const period = [
        { itemName: 'Spindle 10mm', kg: 500, bags: 10 },
      ]
      const fallback = [
        { itemName: 'Tapper Plug', kg: 1200, bags: 24 },
      ]

      const res = selectTopItemsWithFallback(period, fallback)
      expect(res.isFallback).toBe(false)
      expect(res.items).toEqual(period)
    })

    it('falls back to secondary items when period is empty or zero', () => {
      const period: Array<{ itemName: string; kg: number; bags: number }> = []
      const fallback = [
        { itemName: 'Tapper Plug', kg: 1200, bags: 24 },
      ]

      const res = selectTopItemsWithFallback(period, fallback)
      expect(res.isFallback).toBe(true)
      expect(res.items).toEqual(fallback)
    })

    it('returns empty when both period and fallback have no data', () => {
      const res = selectTopItemsWithFallback([], [])
      expect(res.isFallback).toBe(false)
      expect(res.items).toHaveLength(0)
    })
  })
})
