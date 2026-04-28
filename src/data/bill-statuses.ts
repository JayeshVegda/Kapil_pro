import { pb } from '@/data/pocketbase'
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'
import { computeBillStatuses } from '@/domain/bills'

type PBRecord = Record<string, unknown> & { id: string }

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)

export async function recalculateAndPersistBillStatusesForCustomer(customerId: string) {
  const [customerRaw, billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
    pb.collection('customers').getOne(customerId),
    pb.collection('bills').getFullList({ filter: `customer = "${customerId}"`, sort: 'date,bill_no' }),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList({ filter: `customer = "${customerId}"`, sort: 'date' }),
  ])

  const billsTyped = billsRaw as PBRecord[]
  if (billsTyped.length === 0) return

  const billIdSet = new Set(billsTyped.map((bill) => bill.id))
  const itemSumByBill = new Map<string, number>()
  for (const row of billItemsRaw as PBRecord[]) {
    const billId = String(row.bill ?? '')
    if (!billIdSet.has(billId)) continue
    itemSumByBill.set(billId, (itemSumByBill.get(billId) ?? 0) + num(row.amount))
  }

  const statuses = computeBillStatuses({
    openingBalance: num((customerRaw as PBRecord).opening_balance),
    bills: billsTyped.map((bill) => ({
      id: bill.id,
      businessDate: datePart(bill.date),
      createdAt: String(bill.created),
      amount: calculateBillTotalFromBase(itemSumByBill.get(bill.id) ?? 0, num(bill.transport), num(bill.gst_rate)),
    })),
    payments: (paymentsRaw as PBRecord[]).map((payment) => ({
      id: payment.id,
      businessDate: datePart(payment.date),
      createdAt: String(payment.created),
      amount: num(payment.amount),
    })),
  })

  await Promise.all(
    billsTyped.map((bill) =>
      pb.collection('bills').update(bill.id, {
        status: statuses.get(bill.id) ?? 'pending',
      }),
    ),
  )
}
