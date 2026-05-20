import { recalculateAndPersistBillStatusesForCustomer } from '@/data/bill-statuses'
import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { calculateBillTotals, type BillItemInput } from '@/domain/billing-calculations'
import { BAGS_PER_KG } from '@/shared/constants'

const bagsFromQtyKg = (qtyKg: number) => {
  if (!(qtyKg > 0)) return 0
  return Math.round(qtyKg * BAGS_PER_KG)
}

export async function assertBillNumberAvailable(bookNo: number, billNo: number) {
  const existing = await pb
    .collection('bills')
    .getFirstListItem(`book_no = ${bookNo} && bill_no = ${billNo}`)
    .catch(() => null)
  if (existing) {
    const nextBillNo = await suggestNextBillNo(bookNo, billNo)
    throw new Error(`Bill ${bookNo}/${billNo} already exists. Next available: ${bookNo}/${nextBillNo}`)
  }
}

export async function suggestNextBillNo(bookNo: number, billNo: number) {
  const records = await pb.collection('bills').getFullList({
    filter: `book_no = ${bookNo}`,
    sort: 'bill_no',
  })
  const used = new Set(records.map((record) => Number(record.bill_no ?? 0)).filter((value) => Number.isFinite(value) && value > 0))
  let next = Math.max(1, billNo)
  while (used.has(next)) next += 1
  return next
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
  items: Array<BillItemInput & { itemId?: string; itemName: string }>
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

    const bill = await pb.collection('bills').create({
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

    const createdItemIds: string[] = []
    try {
      for (const row of input.items) {
        const created = await pb.collection('bill_items').create({
          bill: bill.id,
          item: row.itemId || '',
          item_name: row.itemName,
          qty: row.qty,
          rate: row.rate,
          amount: row.qty * row.rate,
          bags: bagsFromQtyKg(row.qty),
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
