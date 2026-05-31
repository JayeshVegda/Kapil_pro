import { describe, expect, it } from 'vitest'
import { buildTransactionRows, cleanupExpiredTrash, matchesTransactionSearch, TRASH_TTL_MS, type TrashEntry } from '@/domain/transactions'

describe('transactions domain', () => {
  it('builds unified rows sorted by date desc', () => {
    const rows = buildTransactionRows({
      bills: [
        {
          id: 'b1',
          date: '2026-04-10',
          customerId: 'c1',
          customerName: 'Alpha',
          bookNo: 2,
          billNo: 10,
          mktRate: 0,
          transport: 10,
          gstRate: 0,
          lrNo: '',
        },
      ],
      billItems: [{ billId: 'b1', itemName: 'Spindle', qty: 10, rate: 100, amount: 1000 }],
      payments: [
        {
          id: 'p1',
          date: '2026-04-11',
          customerId: 'c1',
          customerName: 'Alpha',
          amount: 300,
          mode: 'Cash',
          note: '',
        },
      ],
    })

    expect(rows[0]?.kind).toBe('payment')
    expect(rows[1]?.kind).toBe('bill')
    expect(rows[1]?.amount).toBe(1010)
  })

  it('matches search by party, ref, or type', () => {
    const row = buildTransactionRows({
      bills: [
        {
          id: 'b1',
          date: '2026-04-10',
          customerId: 'c1',
          customerName: 'Alpha Traders',
          bookNo: 2,
          billNo: 10,
          mktRate: 0,
          transport: 10,
          gstRate: 0,
          lrNo: '',
        },
      ],
      billItems: [{ billId: 'b1', itemName: 'Spindle', qty: 10, rate: 100, amount: 1000 }],
      payments: [],
    })[0]

    expect(matchesTransactionSearch(row, 'alpha')).toBe(true)
    expect(matchesTransactionSearch(row, '2/10')).toBe(true)
    expect(matchesTransactionSearch(row, 'bill')).toBe(true)
    expect(matchesTransactionSearch(row, 'xyz')).toBe(false)
  })

  it('cleans up expired trash entries', () => {
    const now = 1_000_000
    const entries: TrashEntry[] = [
      {
        key: 'bill:b1',
        deletedAt: now - TRASH_TTL_MS + 10,
        snapshot: buildTransactionRows({
          bills: [
            {
              id: 'b1',
              date: '2026-04-10',
              customerId: 'c1',
              customerName: 'A',
              bookNo: 1,
              billNo: 1,
              mktRate: 0,
              transport: 0,
              gstRate: 0,
              lrNo: '',
            },
          ],
          billItems: [],
          payments: [],
        })[0]!,
      },
      {
        key: 'payment:p1',
        deletedAt: now - TRASH_TTL_MS - 1,
        snapshot: buildTransactionRows({
          bills: [],
          billItems: [],
          payments: [
            {
              id: 'p1',
              date: '2026-04-10',
              customerId: 'c1',
              customerName: 'A',
              amount: 20,
              mode: 'Cash',
              note: '',
            },
          ],
        })[0]!,
      },
    ]
    const kept = cleanupExpiredTrash(entries, now, TRASH_TTL_MS)
    expect(kept).toHaveLength(1)
    expect(kept[0]?.key).toBe('bill:b1')
  })
})
