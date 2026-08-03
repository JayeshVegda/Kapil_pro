import { describe, expect, it } from 'vitest'
import {
  BILL_BOOK_SIZE,
  bookNoForBillNo,
  buildBookRegister,
  findMisfiledBills,
  getBookRange,
  isBillNoInBook,
  nextBillNoForBook,
  type BillNumberRecord,
} from '@/domain/bill-books'

const bill = (bookNo: number, billNo: number, extra: Partial<BillNumberRecord> = {}): BillNumberRecord => ({
  id: `bill-${bookNo}-${billNo}`,
  bookNo,
  billNo,
  businessDate: '2026-06-01',
  customerName: 'Test Party',
  ...extra,
})

describe('getBookRange', () => {
  it('covers a block of 50 starting at the book number', () => {
    expect(getBookRange(1)).toEqual({ firstBillNo: 1, lastBillNo: 50 })
    expect(getBookRange(51)).toEqual({ firstBillNo: 51, lastBillNo: 100 })
    expect(getBookRange(151)).toEqual({ firstBillNo: 151, lastBillNo: 200 })
  })

  it('uses the shared book size constant', () => {
    const range = getBookRange(101)
    expect(range.lastBillNo - range.firstBillNo + 1).toBe(BILL_BOOK_SIZE)
  })
})

describe('bookNoForBillNo', () => {
  it('maps a bill number back to the book that should hold it', () => {
    expect(bookNoForBillNo(1)).toBe(1)
    expect(bookNoForBillNo(50)).toBe(1)
    expect(bookNoForBillNo(51)).toBe(51)
    expect(bookNoForBillNo(100)).toBe(51)
    expect(bookNoForBillNo(101)).toBe(101)
    expect(bookNoForBillNo(182)).toBe(151)
  })

  it('returns 0 for numbers that are not valid bill numbers', () => {
    expect(bookNoForBillNo(0)).toBe(0)
    expect(bookNoForBillNo(-5)).toBe(0)
    expect(bookNoForBillNo(Number.NaN)).toBe(0)
  })
})

describe('isBillNoInBook', () => {
  it('accepts numbers inside the book block', () => {
    expect(isBillNoInBook(51, 51)).toBe(true)
    expect(isBillNoInBook(51, 100)).toBe(true)
  })

  it('rejects numbers outside the book block', () => {
    expect(isBillNoInBook(51, 101)).toBe(false)
    expect(isBillNoInBook(51, 50)).toBe(false)
  })
})

describe('nextBillNoForBook', () => {
  it('returns the first number of an empty book', () => {
    expect(nextBillNoForBook(151, [])).toBe(151)
  })

  it('never reoffers a skipped number — a gap means the page was torn', () => {
    // 151 and 153 used -> 152 was destroyed, so 154 comes next.
    expect(nextBillNoForBook(151, [151, 153])).toBe(154)
  })

  it('continues after the highest used number', () => {
    expect(nextBillNoForBook(151, [151, 152, 153])).toBe(154)
  })

  it('ignores numbers that do not belong to the book', () => {
    expect(nextBillNoForBook(151, [1, 51, 101, 151])).toBe(152)
  })

  it('returns null once the last number of the book is used', () => {
    expect(nextBillNoForBook(151, [151, 200])).toBeNull()
    const full = Array.from({ length: BILL_BOOK_SIZE }, (_, index) => 151 + index)
    expect(nextBillNoForBook(151, full)).toBeNull()
  })
})

describe('findMisfiledBills', () => {
  it('flags a bill recorded under the wrong book', () => {
    const records = [bill(51, 100), bill(51, 101), bill(101, 102)]
    const misfiled = findMisfiledBills(records)
    expect(misfiled).toHaveLength(1)
    expect(misfiled[0]).toMatchObject({ billNo: 101, recordedBookNo: 51, expectedBookNo: 101 })
  })

  it('returns nothing when every bill sits in its own book', () => {
    expect(findMisfiledBills([bill(1, 8), bill(51, 60), bill(151, 151)])).toEqual([])
  })
})

describe('buildBookRegister', () => {
  it('summarises used, skipped and remaining numbers per book', () => {
    const records = [bill(151, 151), bill(151, 152), bill(151, 155)]
    const [entry] = buildBookRegister(records)

    expect(entry.bookNo).toBe(151)
    expect(entry.usedCount).toBe(3)
    // 153 and 154 sit between the first and last entered bill -> likely missing entries.
    expect(entry.skippedBillNos).toEqual([153, 154])
    // 156..200 has not been reached yet, so it is capacity rather than a gap.
    expect(entry.remainingCount).toBe(45)
    expect(entry.lastUsedBillNo).toBe(155)
    // Skipped numbers are torn pages — the register moves forward, not back.
    expect(entry.nextBillNo).toBe(156)
  })

  it('orders books by book number and keeps empty books out', () => {
    const register = buildBookRegister([bill(151, 151), bill(1, 8), bill(51, 60)])
    expect(register.map((entry) => entry.bookNo)).toEqual([1, 51, 151])
  })

  it('reports a full book as complete with no remaining capacity', () => {
    const records = Array.from({ length: BILL_BOOK_SIZE }, (_, index) => bill(1, index + 1))
    const [entry] = buildBookRegister(records)
    expect(entry.remainingCount).toBe(0)
    expect(entry.skippedBillNos).toEqual([])
    expect(entry.nextBillNo).toBeNull()
    expect(entry.isComplete).toBe(true)
  })

  it('counts a misfiled bill against the book it was recorded in', () => {
    const register = buildBookRegister([bill(51, 100), bill(51, 101)])
    const book51 = register.find((entry) => entry.bookNo === 51)
    expect(book51?.usedCount).toBe(2)
    expect(book51?.misfiledBillNos).toEqual([101])
  })
})
