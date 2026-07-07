import { describe, expect, it } from 'vitest'
import { buildReceivableRiskRows } from '@/domain/dashboard'

describe('dashboard receivable risk', () => {
  it('sorts pending parties by oldest bill first and assigns risk levels', () => {
    const rows = buildReceivableRiskRows({
      asOfDate: '2026-07-07',
      latestBillDateByCustomer: new Map([
        ['newer-big', '2026-06-25'],
        ['older-small', '2026-05-01'],
        ['due-mid', '2026-06-10'],
      ]),
      pendingRows: [
        { customerId: 'newer-big', customerName: 'Newer Big', amount: 900000 },
        { customerId: 'older-small', customerName: 'Older Small', amount: 100000 },
        { customerId: 'due-mid', customerName: 'Due Mid', amount: 200000 },
      ],
    })

    expect(rows.map((row) => row.customerId)).toEqual(['older-small', 'due-mid', 'newer-big'])
    expect(rows.map((row) => row.level)).toEqual(['overdue', 'due', 'watch'])
    expect(rows[0]?.dueDays).toBe(67)
  })
})
