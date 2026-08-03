import { recalculateAndPersistBillStatusesForCustomer } from '@/data/bill-statuses'
import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { calculateBillTotals, type BillItemInput } from '@/domain/billing-calculations'
import { calculateBillingLineAmount, calculateBillingLineBags, type BillingItemMeta } from '@/domain/billing-modes'
import {
  buildBookRegister,
  findMisfiledBills,
  getBookRange,
  isBillNoInBook,
  nextBillNoForBook,
  resolveCustomerBookSelection,
  type BillNumberRecord,
} from '@/domain/bill-books'

function isUniqueBillNumberError(error: unknown) {
  const response = (error as { response?: { data?: Record<string, { code?: string }> } })?.response
  const fields = response?.data ?? {}
  return ['book_no', 'bill_no'].some((field) => String(fields[field]?.code ?? '').includes('validation_not_unique'))
}

/** Bill numbers only — keeps book lookups light as the bill count grows. */
async function loadBillNumberRecords(bookNo?: number): Promise<BillNumberRecord[]> {
  const records = await pb.collection('bills').getFullList({
    ...(bookNo == null ? {} : { filter: pb.filter('book_no = {:bookNo}', { bookNo }) }),
    fields: 'id,book_no,bill_no,date,customer_name',
    sort: 'bill_no',
  })
  return records.map((record) => ({
    id: record.id,
    bookNo: Number(record.book_no ?? 0),
    billNo: Number(record.bill_no ?? 0),
    businessDate: String(record.date ?? '').slice(0, 10),
    customerName: String(record.customer_name ?? ''),
  }))
}

async function loadUsedBillNos(bookNo: number) {
  const records = await loadBillNumberRecords(bookNo)
  return records.map((record) => record.billNo).filter((billNo) => billNo > 0)
}

export async function assertBillNumberAvailable(bookNo: number, billNo: number) {
  if (!isBillNoInBook(bookNo, billNo)) {
    const { firstBillNo, lastBillNo } = getBookRange(bookNo)
    throw new Error(`Bill ${billNo} does not belong to book ${bookNo}. Book ${bookNo} holds bills ${firstBillNo}-${lastBillNo}.`)
  }
  const existing = await pb
    .collection('bills')
    .getFirstListItem(pb.filter('book_no = {:bookNo} && bill_no = {:billNo}', { bookNo, billNo }))
    .catch(() => null)
  if (existing) {
    const nextBillNo = await suggestNextBillNo(bookNo, billNo)
    const suggestion = nextBillNo == null ? 'book is full' : `Next available: ${bookNo}/${nextBillNo}`
    throw new Error(`Bill ${bookNo}/${billNo} already exists. ${suggestion}`)
  }
}

/** On a collision, suggest continuing the book — skipped numbers are torn pages and stay skipped. */
export async function suggestNextBillNo(bookNo: number, _billNo: number) {
  return nextBillNoForBook(bookNo, await loadUsedBillNos(bookNo))
}

/** Next number to write in the book (one past the highest used). */
export async function getNextBillNoForBook(bookNo: number) {
  return nextBillNoForBook(bookNo, await loadUsedBillNos(bookNo))
}

export async function getCustomerBookSelection(customerId: string, temporaryBookNo = 69) {
  if (!customerId) return null
  const latest = await pb.collection('bills').getList(1, 1, {
    filter: pb.filter('customer = {:customerId}', { customerId }),
    fields: 'id,book_no,date,created',
    sort: '-date,-created,-id',
  })
  const preferredBookNo = Number(latest.items[0]?.book_no ?? 0)
  if (!(preferredBookNo > 0)) return null
  const preferredNextBillNo = await getNextBillNoForBook(preferredBookNo)
  const temporaryNextBillNo = preferredBookNo === temporaryBookNo
    ? preferredNextBillNo
    : await getNextBillNoForBook(temporaryBookNo)
  return resolveCustomerBookSelection({ preferredBookNo, preferredNextBillNo, temporaryBookNo, temporaryNextBillNo })
}

export async function loadBookRegister() {
  const records = await loadBillNumberRecords()
  return {
    books: buildBookRegister(records),
    misfiled: findMisfiledBills(records),
  }
}

type SaveBillInput = {
  bookNo: number
  billNo: number
  date: string
  customerId: string
  customerName: string
  mktRate: number
  transport: number
  gstRate: number
  gstAmount: number
  lrList: string[]
  items: Array<BillItemInput & { itemId?: string; itemName: string } & BillingItemMeta>
}

export async function saveBillWithItems(input: SaveBillInput) {
  await runDataOperation('save-bill', async () => {
    await assertBillNumberAvailable(input.bookNo, input.billNo)

    const totals = calculateBillTotals({
      items: input.items,
      transport: input.transport,
      gstRate: input.gstRate,
      gstAmountOverride: input.gstAmount,
    })

    const bill = await pb
      .collection('bills')
      .create({
        book_no: input.bookNo,
        bill_no: input.billNo,
        bill_ref: `${input.bookNo}/${input.billNo}`,
        date: input.date,
        customer: input.customerId,
        customer_name: input.customerName,
        mkt: input.mktRate,
        transport: input.transport,
        gst_rate: input.gstRate,
        gst_amount: totals.gstAmount,
        lr_no: input.lrList.join(', '),
        status: 'pending',
      })
      .catch((error: unknown) => {
        // The unique (book_no, bill_no) index is the last line of defence when two
        // saves race past assertBillNumberAvailable.
        if (isUniqueBillNumberError(error)) {
          throw new Error(`Bill ${input.bookNo}/${input.billNo} was just taken by another save. Pick the next free number and try again.`, { cause: error })
        }
        throw error
      })

    const createdItemIds: string[] = []
    try {
      for (const row of input.items) {
        const created = await pb.collection('bill_items').create({
          bill: bill.id,
          item: row.itemId || '',
          item_name: row.itemName,
          qty: row.qty,
          rate: row.rate,
          amount: calculateBillingLineAmount(row),
          bags: calculateBillingLineBags({ qty: row.qty, item: row }),
        })
        createdItemIds.push(created.id)
      }
    } catch (error) {
      // Best-effort rollback prevents partially-created bills and line items.
      await Promise.allSettled(createdItemIds.map((id) => pb.collection('bill_items').delete(id)))
      await pb.collection('bills').delete(bill.id).catch(() => undefined)
      throw new Error(error instanceof Error ? `Failed to save line items: ${error.message}` : 'Failed to save line items', {
        cause: error,
      })
    }
    await recalculateAndPersistBillStatusesForCustomer(input.customerId)
  })
}
