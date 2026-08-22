import { pb } from '@/data/pocketbase'
import { recalculateAndPersistBillStatusesForCustomer } from '@/data/bill-statuses'
import { runDataOperation } from '@/data/reliability'
import type { BillSnapshot, PaymentSnapshot } from '@/domain/transactions'
import { formatCustomerDisplayName } from '@/lib/customer-display'
import { calculateBillingLineAmount, calculateBillingLineBags, type BillingItemMeta } from '@/domain/billing-modes'
import { getBookRange, isBillNoInBook } from '@/domain/bill-books'

type PBRecord = Record<string, unknown> & { id: string }

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const key = (value: unknown) => String(value ?? '').trim().toLowerCase()

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)
const dateTimeText = (value: unknown) => String(value ?? '')

async function recalculateBillStatusesForCustomers(customerIds: string[]) {
  const uniqueIds = [...new Set(customerIds.filter(Boolean))]
  await Promise.all(uniqueIds.map((customerId) => recalculateAndPersistBillStatusesForCustomer(customerId)))
}

async function assertBillNumberAvailable(bookNo: number, billNo: number, currentBillId?: string) {
  if (!isBillNoInBook(bookNo, billNo)) {
    const range = getBookRange(bookNo)
    throw new Error(`Bill ${billNo} does not belong to book ${bookNo}. Book ${bookNo} holds bills ${range.firstBillNo}-${range.lastBillNo}.`)
  }
  const existing = await pb
    .collection('bills')
    .getFirstListItem(`book_no = ${bookNo} && bill_no = ${billNo}`)
    .catch(() => null)
  if (existing && existing.id !== currentBillId) {
    throw new Error(`Bill ${bookNo}/${billNo} already exists.`)
  }
}

export type TransactionsContext = {
  customers: Array<{ id: string; name: string; openingBalance: number }>
  items: Array<{ id: string; name: string; defaultRate: number; type: string; unit: string; bagWeight: number }>
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
    gstAmount: number
    lrNo: string
  }>
  billItems: Array<{
    billId: string
    itemId: string
    itemName: string
    qty: number
    rate: number
    defaultRate?: number
    amount: number
    type?: string
    unit?: string
    bagWeight?: number
  }>
  payments: PaymentSnapshot[]
}

export async function loadTransactionsContext(): Promise<TransactionsContext> {
  const [customersRaw, itemsRaw, billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
    pb.collection('customers').getFullList({ sort: 'company_name,name' }),
    pb.collection('items').getFullList({ sort: 'name' }),
    pb.collection('bills').getFullList({ sort: '-date,-bill_no' }),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList({ sort: '-date' }),
  ])

  const customerDisplayById = new Map(
    (customersRaw as PBRecord[]).map((row) => [row.id, formatCustomerDisplayName(row.company_name, row.name)]),
  )

  return {
    customers: (customersRaw as PBRecord[]).map((row) => ({
      id: row.id,
      name: formatCustomerDisplayName(row.company_name, row.name),
      openingBalance: num(row.opening_balance),
    })),
    items: (itemsRaw as PBRecord[]).map((row) => ({
      id: row.id,
      name: String(row.name ?? ''),
      defaultRate: num(row.default_rate),
      type: String(row.type ?? ''),
      unit: String(row.unit ?? ''),
      bagWeight: num(row.bag_weight) || 50,
    })),
    bills: (billsRaw as PBRecord[]).map((row) => ({
      id: row.id,
      date: dateTimeText(row.date),
      businessDate: datePart(row.date),
      createdAt: String(row.created),
      customerId: String(row.customer ?? ''),
      customerName: customerDisplayById.get(String(row.customer ?? '')) ?? String(row.customer_name ?? ''),
      bookNo: num(row.book_no),
      billNo: num(row.bill_no),
      mktRate: num(row.mkt),
      transport: num(row.transport),
      gstRate: num(row.gst_rate),
      gstAmount: num(row.gst_amount),
      lrNo: String(row.lr_no ?? ''),
      total: 0,
    })),
    billItems: (billItemsRaw as PBRecord[]).map((row) => {
      const itemId = String(row.item ?? '')
      const master = (itemsRaw as PBRecord[]).find((item) => item.id === itemId || key(item.name) === key(row.item_name))
      return {
        billId: String(row.bill ?? ''),
        itemId,
        itemName: String(row.item_name ?? ''),
        qty: num(row.qty),
        rate: num(row.rate),
        defaultRate: num(master?.default_rate),
        amount: num(row.amount),
        type: String(master?.type ?? ''),
        unit: String(master?.unit ?? ''),
        bagWeight: num(master?.bag_weight) || 50,
      }
    }),
    payments: (paymentsRaw as PBRecord[]).map((row) => ({
      id: row.id,
      businessDate: datePart(row.date),
      createdAt: String(row.created),
      customerId: String(row.customer ?? ''),
      customerName: customerDisplayById.get(String(row.customer ?? '')) ?? String(row.customer_name ?? ''),
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
    const existingBill = (await pb.collection('bills').getOne(billId)) as PBRecord
    const oldCustomerId = String(existingBill.customer ?? '')
    await assertBillNumberAvailable(input.bookNo, input.billNo, billId)

    const customerRecord = await pb.collection('customers').getOne(input.customerId)
    const customerName = input.customerName ?? formatCustomerDisplayName((customerRecord as PBRecord).company_name, (customerRecord as PBRecord).name)
    const nextBillPayload = {
      book_no: input.bookNo,
      bill_no: input.billNo,
      bill_ref: `${input.bookNo}/${input.billNo}`,
      date: input.date,
      customer: input.customerId,
      customer_name: String(customerName),
      mkt: input.mktRate,
      transport: input.transport,
      gst_rate: input.gstRate,
      gst_amount: input.gstAmount ?? 0,
      lr_no: input.lrNo,
    }

    const existingItems = await pb.collection('bill_items').getFullList({
      filter: `bill = "${billId}"`,
    })
    const masterItems = await pb.collection('items').getFullList({ sort: 'name' })
    const itemByName = new Map((masterItems as PBRecord[]).map((item) => [key(item.name), item]))
    const batch = pb.createBatch()
    batch.collection('bills').update(billId, nextBillPayload)
    for (const item of input.items) {
      const masterItem = item.itemId
        ? (masterItems as PBRecord[]).find((row) => row.id === item.itemId)
        : itemByName.get(key(item.itemName))
      const itemId = item.itemId || masterItem?.id || ''
      const itemMeta: BillingItemMeta = {
        type: String((item as BillingItemMeta).type ?? masterItem?.type ?? ''),
        unit: String((item as BillingItemMeta).unit ?? masterItem?.unit ?? ''),
        bagWeight: num((item as BillingItemMeta).bagWeight ?? masterItem?.bag_weight) || 50,
      }
      batch.collection('bill_items').create({
        bill: billId,
        item: itemId,
        item_name: item.itemName,
        qty: item.qty,
        rate: item.rate,
        amount: calculateBillingLineAmount(item),
        bags: calculateBillingLineBags({ qty: item.qty, item: itemMeta }),
      })
    }
    for (const row of existingItems) batch.collection('bill_items').delete(row.id)
    await batch.send()
    await recalculateBillStatusesForCustomers([oldCustomerId, input.customerId])
  })
}

export async function deleteBillWithItems(billId: string) {
  await runDataOperation('delete-bill', async () => {
    const existingBill = await pb.collection('bills').getOne(billId)
    const customerId = String((existingBill as PBRecord).customer ?? '')
    const existingItems = await pb.collection('bill_items').getFullList({
      filter: `bill = "${billId}"`,
    })
    const batch = pb.createBatch()
    for (const row of existingItems) batch.collection('bill_items').delete(row.id)
    batch.collection('bills').delete(billId)
    await batch.send()
    if (customerId) {
      await recalculateAndPersistBillStatusesForCustomer(customerId)
    }
  })
}

export async function restoreBillFromSnapshot(snapshot: BillSnapshot) {
  await runDataOperation('restore-bill', async () => {
    await assertBillNumberAvailable(snapshot.bookNo, snapshot.billNo)
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
      gst_amount: snapshot.gstAmount ?? 0,
      lr_no: snapshot.lrNo,
    })
    const masterItems = await pb.collection('items').getFullList({ sort: 'name' })
    const itemByName = new Map((masterItems as PBRecord[]).map((item) => [key(item.name), item]))
    for (const item of snapshot.items) {
      const masterItem = item.itemId
        ? (masterItems as PBRecord[]).find((row) => row.id === item.itemId)
        : itemByName.get(key(item.itemName))
      const itemId = item.itemId || masterItem?.id || ''
      const itemMeta: BillingItemMeta = {
        type: String((item as BillingItemMeta).type ?? masterItem?.type ?? ''),
        unit: String((item as BillingItemMeta).unit ?? masterItem?.unit ?? ''),
        bagWeight: num((item as BillingItemMeta).bagWeight ?? masterItem?.bag_weight) || 50,
      }
      await pb.collection('bill_items').create({
        bill: bill.id,
        item: itemId,
        item_name: item.itemName,
        qty: item.qty,
        rate: item.rate,
        amount: calculateBillingLineAmount(item),
        bags: calculateBillingLineBags({ qty: item.qty, item: itemMeta }),
      })
    }
    await recalculateAndPersistBillStatusesForCustomer(snapshot.customerId)
  })
}

export async function updatePayment(
  paymentId: string,
  input: Omit<PaymentSnapshot, 'id' | 'customerName'> & { customerName?: string },
) {
  await runDataOperation('update-payment', async () => {
    const existingPayment = (await pb.collection('payments').getOne(paymentId)) as PBRecord
    const oldCustomerId = String(existingPayment.customer ?? '')
    const customerRecord = await pb.collection('customers').getOne(input.customerId)
    const customerName = input.customerName ?? formatCustomerDisplayName((customerRecord as PBRecord).company_name, (customerRecord as PBRecord).name)
    await pb.collection('payments').update(paymentId, {
      customer: input.customerId,
      customer_name: String(customerName),
      date: input.date,
      amount: input.amount,
      mode: input.mode,
      note: input.note,
    })
    await recalculateBillStatusesForCustomers([oldCustomerId, input.customerId])
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
    await recalculateAndPersistBillStatusesForCustomer(snapshot.customerId)
  })
}
