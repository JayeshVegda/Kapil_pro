/**
 * Physical bill-book numbering.
 *
 * A book is a printed pad of 50 bills whose book number is also the first bill
 * number inside it: book 1 holds bills 1-50, book 51 holds 51-100, and so on.
 * Bill numbers therefore run continuously across books and never repeat.
 */

export const BILL_BOOK_SIZE = 50

export type BillNumberRecord = {
  id: string
  bookNo: number
  billNo: number
  businessDate?: string
  customerName?: string
}

export type MisfiledBill = {
  id: string
  billNo: number
  recordedBookNo: number
  expectedBookNo: number
  businessDate?: string
  customerName?: string
}

export type BookRegisterEntry = {
  bookNo: number
  firstBillNo: number
  lastBillNo: number
  usedBillNos: number[]
  usedCount: number
  /** Unused numbers between the first and last bill entered — likely written on paper but never entered. */
  skippedBillNos: number[]
  /** Numbers after the last entered bill that the book has not reached yet. */
  remainingCount: number
  firstUsedBillNo: number | null
  lastUsedBillNo: number | null
  /** Lowest free number in the book, reusing skipped numbers first. */
  nextBillNo: number | null
  /** Bills recorded under this book whose number belongs to a different book. */
  misfiledBillNos: number[]
  isComplete: boolean
}

const isPositiveInt = (value: number) => Number.isFinite(value) && value > 0

export function getBookRange(bookNo: number) {
  return { firstBillNo: bookNo, lastBillNo: bookNo + BILL_BOOK_SIZE - 1 }
}

/** The book a bill number belongs to, assuming books start at 1, 51, 101, ... */
export function bookNoForBillNo(billNo: number) {
  if (!isPositiveInt(billNo)) return 0
  return Math.floor((billNo - 1) / BILL_BOOK_SIZE) * BILL_BOOK_SIZE + 1
}

export function isBillNoInBook(bookNo: number, billNo: number) {
  const { firstBillNo, lastBillNo } = getBookRange(bookNo)
  return billNo >= firstBillNo && billNo <= lastBillNo
}

/**
 * Next number to write in the book: one past the highest used, or the book's
 * first number when empty. Returns null when the book is finished.
 *
 * Skipped numbers are deliberately NOT reoffered — a gap means the physical
 * page was torn or cancelled, so that number is gone for good.
 */
export function nextBillNoForBook(bookNo: number, usedBillNos: number[]) {
  const { firstBillNo, lastBillNo } = getBookRange(bookNo)
  const inBook = usedBillNos.filter((billNo) => isBillNoInBook(bookNo, billNo))
  if (inBook.length === 0) return firstBillNo
  const highest = Math.max(...inBook)
  return highest >= lastBillNo ? null : highest + 1
}

export function findMisfiledBills(records: BillNumberRecord[]): MisfiledBill[] {
  return records
    .filter((record) => isPositiveInt(record.bookNo) && isPositiveInt(record.billNo))
    .filter((record) => !isBillNoInBook(record.bookNo, record.billNo))
    .map((record) => ({
      id: record.id,
      billNo: record.billNo,
      recordedBookNo: record.bookNo,
      expectedBookNo: bookNoForBillNo(record.billNo),
      businessDate: record.businessDate,
      customerName: record.customerName,
    }))
    .sort((a, b) => a.billNo - b.billNo)
}

export function buildBookRegister(records: BillNumberRecord[]): BookRegisterEntry[] {
  const billNosByBook = new Map<number, number[]>()
  for (const record of records) {
    if (!isPositiveInt(record.bookNo) || !isPositiveInt(record.billNo)) continue
    const existing = billNosByBook.get(record.bookNo) ?? []
    existing.push(record.billNo)
    billNosByBook.set(record.bookNo, existing)
  }

  return [...billNosByBook.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bookNo, billNos]) => {
      const { firstBillNo, lastBillNo } = getBookRange(bookNo)
      const usedBillNos = [...new Set(billNos)].sort((a, b) => a - b)
      const used = new Set(usedBillNos)
      const firstUsedBillNo = usedBillNos[0] ?? null
      const lastUsedBillNo = usedBillNos[usedBillNos.length - 1] ?? null

      const skippedBillNos: number[] = []
      if (firstUsedBillNo != null && lastUsedBillNo != null) {
        for (let billNo = firstUsedBillNo + 1; billNo < lastUsedBillNo; billNo += 1) {
          if (!used.has(billNo)) skippedBillNos.push(billNo)
        }
      }

      const remainingCount = lastUsedBillNo == null ? BILL_BOOK_SIZE : Math.max(0, lastBillNo - lastUsedBillNo)
      const nextBillNo = nextBillNoForBook(bookNo, usedBillNos)

      return {
        bookNo,
        firstBillNo,
        lastBillNo,
        usedBillNos,
        usedCount: usedBillNos.length,
        skippedBillNos,
        remainingCount,
        firstUsedBillNo,
        lastUsedBillNo,
        nextBillNo,
        misfiledBillNos: usedBillNos.filter((billNo) => !isBillNoInBook(bookNo, billNo)),
        isComplete: nextBillNo === null,
      }
    })
}
