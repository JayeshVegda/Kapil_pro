import { describe, expect, it } from 'vitest'
import {
  buildCollectionFindings,
  buildRateFreshnessFindings,
  buildSanityFindings,
  type SanityInputs,
} from './health-checks'

describe('buildCollectionFindings', () => {
  it('flags empty brass_rates as an error', () => {
    const findings = buildCollectionFindings([{ name: 'brass_rates', ok: true, totalItems: 0 }])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('error')
    expect(findings[0].title).toContain('EMPTY')
  })

  it('keeps gated collections informational, never errors', () => {
    const findings = buildCollectionFindings([{ name: 'casting_sessions', ok: false, totalItems: null, intentionallyGated: true }])
    expect(findings[0].severity).toBe('info')
  })

  it('marks unreadable core collections as errors', () => {
    const findings = buildCollectionFindings([{ name: 'bills', ok: false, totalItems: null }])
    expect(findings[0].severity).toBe('error')
  })

  it('stays quiet when everything is fine', () => {
    const findings = buildCollectionFindings([
      { name: 'bills', ok: true, totalItems: 241 },
      { name: 'brass_rates', ok: true, totalItems: 183 },
    ])
    expect(findings).toHaveLength(0)
  })
})

describe('buildRateFreshnessFindings', () => {
  it('errors when there is no rate at all', () => {
    const findings = buildRateFreshnessFindings(null, '2026-10-25')
    expect(findings[0].severity).toBe('error')
  })

  it('warns when the latest rate is more than a day old', () => {
    const findings = buildRateFreshnessFindings('2026-10-22', '2026-10-25')
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].title).toContain('3 days old')
  })

  it('is ok when the rate is today or yesterday', () => {
    expect(buildRateFreshnessFindings('2026-10-25', '2026-10-25')[0].severity).toBe('ok')
    expect(buildRateFreshnessFindings('2026-10-24', '2026-10-25')[0].severity).toBe('ok')
  })
})

describe('buildSanityFindings', () => {
  const base: SanityInputs = {
    bills: [
      { id: 'b1', bookNo: 201, billNo: 250, customer: 'c1', customerName: 'Adesh Bhai', date: '2026-10-12' },
      { id: 'b2', bookNo: 201, billNo: 249, customer: 'c1', customerName: 'Adesh Bhai', date: '2026-10-10' },
    ],
    items: [
      { id: 'i1', bill: 'b1' },
      { id: 'i2', bill: 'b1' },
      { id: 'i3', bill: 'b2' },
    ],
    drafts: [],
    payments: [{ id: 'p1', customer: 'c1', amount: 5000 }],
    customers: [{ id: 'c1' }],
    todayIso: '2026-10-25',
  }

  it('finds no issues in a clean dataset', () => {
    expect(buildSanityFindings(base)).toHaveLength(0)
  })

  it('detects duplicate book/bill numbers', () => {
    const findings = buildSanityFindings({
      ...base,
      bills: [...base.bills, { id: 'b3', bookNo: 201, billNo: 250, customer: 'c1', customerName: 'Adesh Bhai', date: '2026-10-12' }],
    })
    expect(findings.some((f) => f.severity === 'error' && f.title.includes('duplicate bill number'))).toBe(true)
  })

  it('detects bills without items and orphan items', () => {
    const findings = buildSanityFindings({
      ...base,
      bills: [...base.bills, { id: 'b4', bookNo: 201, billNo: 248, customer: 'c1', customerName: 'Adesh Bhai', date: '2026-10-09' }],
      items: [...base.items, { id: 'i9', bill: 'ghost' }],
    })
    expect(findings.some((f) => f.severity === 'warn' && f.title.includes('no line items'))).toBe(true)
    expect(findings.some((f) => f.severity === 'error' && f.title.includes('orphan'))).toBe(true)
  })

  it('flags payments without a linked party with their total', () => {
    const findings = buildSanityFindings({
      ...base,
      payments: [...base.payments, { id: 'p2', customer: 'missing', amount: 12500 }],
    })
    const paymentFinding = findings.find((f) => f.title.includes('no linked party'))
    expect(paymentFinding?.severity).toBe('warn')
    expect(paymentFinding?.detail).toContain('12,500')
  })

  it('flags stale pending drafts and approved-but-unconverted drafts', () => {
    const findings = buildSanityFindings({
      ...base,
      drafts: [
        { id: 'd1', status: 'pending_review', customerName: 'Old Party', bookNo: 0, billNo: 0, convertedBill: '', created: '2026-10-15 10:00:00.000Z' },
        { id: 'd2', status: 'approved', customerName: 'Never Converted', bookNo: 0, billNo: 0, convertedBill: '', created: '2026-10-24 10:00:00.000Z' },
      ],
    })
    expect(findings.some((f) => f.severity === 'warn' && f.title.includes('pending for more than 3 days'))).toBe(true)
    expect(findings.some((f) => f.severity === 'info' && f.title.includes('never became a bill'))).toBe(true)
  })
})
