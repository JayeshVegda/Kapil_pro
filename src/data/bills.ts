import { recalculateAndPersistBillStatusesForCustomer } from '@/data/bill-statuses'
import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { calculateBillTotals, type BillItemInput } from '@/domain/billing-calculations'
import { BAGS_PER_KG } from '@/shared/constants'

const bagsFromQtyKg = (qtyKg: number) => {
  if (!(qtyKg > 0)) return 0
  return Math.round(qtyKg * BAGS_PER_KG)
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
  lrList: string[]
  items: Array<BillItemInput & { itemName: string }>
}

export async function saveBillWithItems(input: SaveBillInput) {
  await runDataOperation('save-bill', async () => {
    const totals = calculateBillTotals({
      items: input.items,
      transport: input.transport,
      gstRate: input.gstRate,
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
      throw new Error(error instanceof Error ? `Failed to save line items: ${error.message}` : 'Failed to save line items')
    }
    await recalculateAndPersistBillStatusesForCustomer(input.customerId)
  })
}
