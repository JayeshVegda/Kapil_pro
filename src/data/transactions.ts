import { pb } from '@/data/pocketbase'
import { recalculateAndPersistBillStatusesForCustomer } from '@/data/bill-statuses'
import { runDataOperation } from '@/data/reliability'
import type { BillSnapshot, PaymentSnapshot } from '@/domain/transactions'
import { BAGS_PER_KG } from '@/shared/constants'

type PBRecord = Record<string, unknown> & { id: string }

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const bagsFromQtyKg = (qtyKg: number) => {
  if (!(qtyKg > 0)) return 0
  return Math.round(qtyKg * BAGS_PER_KG)
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)
const dateTimeText = (value: unknown) => String(value ?? '')

export type TransactionsContext = {
  customers: Array<{ id: string; name: string }>
  items: Array<{ id: string; name: string; defaultRate: number }>
  bills: Array<{
    id: string
    date: string
    businessDate: string
    createdAt: string
    customerId: string
    customerName: string
    bookNo: number
    billNo: number
    mktRate: number
    transport: number
    gstRate: number
    lrNo: string
  }>
  billItems: Array<{
    billId: string
    itemName: string
    qty: number
    rate: number
    amount: number
  }>
  payments: PaymentSnapshot[]
}

export async function loadTransactionsContext(): Promise<TransactionsContext> {
  const [customersRaw, itemsRaw, billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
    pb.collection('customers').getFullList({ sort: 'name' }),
    pb.collection('items').getFullList({ sort: 'name' }),
    pb.collection('bills').getFullList({ sort: '-date,-bill_no' }),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList({ sort: '-date' }),
  ])

  return {
    customers: (customersRaw as PBRecord[]).map((row) => ({ id: row.id, name: String(row.name ?? '') })),
    items: (itemsRaw as PBRecord[]).map((row) => ({ id: row.id, name: String(row.name ?? ''), defaultRate: num(row.default_rate) })),
    bills: (billsRaw as PBRecord[]).map((row) => ({
      id: row.id,
      date: dateTimeText(row.date),
      businessDate: datePart(row.date),
      createdAt: String(row.created),
      customerId: String(row.customer ?? ''),
      customerName: String(row.customer_name ?? ''),
      bookNo: num(row.book_no),
      billNo: num(row.bill_no),
      mktRate: num(row.mkt),
      transport: num(row.transport),
      gstRate: num(row.gst_rate),
      lrNo: String(row.lr_no ?? ''),
      total: 0,
    })),
    billItems: (billItemsRaw as PBRecord[]).map((row) => ({
      billId: String(row.bill ?? ''),
      itemName: String(row.item_name ?? ''),
      qty: num(row.qty),
      rate: num(row.rate),
      amount: num(row.amount),
    })),
    payments: (paymentsRaw as PBRecord[]).map((row) => ({
      id: row.id,
      businessDate: datePart(row.date),
      createdAt: String(row.created),
      customerId: String(row.customer ?? ''),
      customerName: String(row.customer_name ?? ''),
      amount: num(row.amount),
      mode: String(row.mode ?? 'Cash') === 'Bank' ? 'Bank' : 'Cash',
      note: String(row.note ?? ''),
      date: dateTimeText(row.date),
    })),
  }
}

export async function updateBillWithItems(
  billId: string,
  input: Omit<BillSnapshot, 'id' | 'customerName'> & { customerName?: string },
) {
  await runDataOperation('update-bill', async () => {
    const customerName = input.customerName ?? (await pb.collection('customers').getOne(input.customerId)).name ?? ''
    await pb.collection('bills').update(billId, {
      book_no: input.bookNo,
      bill_no: input.billNo,
      bill_ref: `${input.bookNo}/${input.billNo}`,
      date: input.date,
      customer: input.customerId,
      customer_name: String(customerName),
      mkt: input.mktRate,
      transport: input.transport,
      gst_rate: input.gstRate,
      lr_no: input.lrNo,
    })

    const existingItems = await pb.collection('bill_items').getFullList({
      filter: `bill = "${billId}"`,
    })
    await Promise.all(existingItems.map((row) => pb.collection('bill_items').delete(row.id)))
    for (const item of input.items) {
      await pb.collection('bill_items').create({
        bill: billId,
        item_name: item.itemName,
        qty: item.qty,
        rate: item.rate,
        amount: item.qty * item.rate,
        bags: bagsFromQtyKg(item.qty),
      })
    }
    await recalculateAndPersistBillStatusesForCustomer(input.customerId)
  })
}

export async function deleteBillWithItems(billId: string) {
  await runDataOperation('delete-bill', async () => {
    const existingBill = await pb.collection('bills').getOne(billId)
    const customerId = String((existingBill as PBRecord).customer ?? '')
    const existingItems = await pb.collection('bill_items').getFullList({
      filter: `bill = "${billId}"`,
    })
    await Promise.all(existingItems.map((row) => pb.collection('bill_items').delete(row.id)))
    await pb.collection('bills').delete(billId)
    if (customerId) {
      await recalculateAndPersistBillStatusesForCustomer(customerId)
    }
  })
}

export async function restoreBillFromSnapshot(snapshot: BillSnapshot) {
  await runDataOperation('restore-bill', async () => {
    const bill = await pb.collection('bills').create({
      book_no: snapshot.bookNo,
      bill_no: snapshot.billNo,
      bill_ref: `${snapshot.bookNo}/${snapshot.billNo}`,
      date: snapshot.date,
      customer: snapshot.customerId,
      customer_name: snapshot.customerName,
      mkt: snapshot.mktRate,
      transport: snapshot.transport,
      gst_rate: snapshot.gstRate,
      lr_no: snapshot.lrNo,
    })
    for (const item of snapshot.items) {
      await pb.collection('bill_items').create({
        bill: bill.id,
        item_name: item.itemName,
        qty: item.qty,
        rate: item.rate,
        amount: item.qty * item.rate,
        bags: bagsFromQtyKg(item.qty),
      })
    }
  })
}

export async function updatePayment(
  paymentId: string,
  input: Omit<PaymentSnapshot, 'id' | 'customerName'> & { customerName?: string },
) {
  await runDataOperation('update-payment', async () => {
    const customerName = input.customerName ?? (await pb.collection('customers').getOne(input.customerId)).name ?? ''
    await pb.collection('payments').update(paymentId, {
      customer: input.customerId,
      customer_name: String(customerName),
      date: input.date,
      amount: input.amount,
      mode: input.mode,
      note: input.note,
    })
    await recalculateAndPersistBillStatusesForCustomer(input.customerId)
  })
}

export async function deletePayment(paymentId: string) {
  await runDataOperation('delete-payment', async () => {
    const existing = await pb.collection('payments').getOne(paymentId)
    const customerId = String((existing as PBRecord).customer ?? '')
    await pb.collection('payments').delete(paymentId)
    if (customerId) {
      await recalculateAndPersistBillStatusesForCustomer(customerId)
    }
  })
}

export async function restorePaymentFromSnapshot(snapshot: PaymentSnapshot) {
  await runDataOperation('restore-payment', async () => {
    await pb.collection('payments').create({
      customer: snapshot.customerId,
      customer_name: snapshot.customerName,
      date: snapshot.date,
      amount: snapshot.amount,
      mode: snapshot.mode,
      note: snapshot.note,
    })
  })
}
