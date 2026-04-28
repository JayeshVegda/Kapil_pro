import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'
import { buildCustomerLedgerSummaries, type BillItemRecord, type BillRecord, type CustomerRecord, type PaymentRecord } from '@/domain/customers'

type PBRecord = Record<string, unknown> & { id: string }

const num = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const datePart = (value: unknown) => String(value ?? '').slice(0, 10)

const optionalKeys = ['opening_balance_date', 'phone', 'gstin', 'address', 'credit_limit', 'note'] as const

function extractCustomerRecord(record: PBRecord): CustomerRecord {
  return {
    id: record.id,
    name: String(record.name ?? ''),
    active: Boolean(record.active),
    openingBalance: num(record.opening_balance),
    openingBalanceDate: String(record.opening_balance_date ?? '').slice(0, 10),
    phone: String(record.phone ?? ''),
    gstin: String(record.gstin ?? ''),
    address: String(record.address ?? ''),
    creditLimit: num(record.credit_limit),
    note: String(record.note ?? ''),
  }
}

function buildCustomerWritePayload(input: {
  name: string
  active: boolean
  openingBalance: number
  openingBalanceDate?: string
  phone?: string
  gstin?: string
  address?: string
  creditLimit?: number
  note?: string
}) {
  return {
    name: input.name,
    active: input.active,
    opening_balance: input.openingBalance,
    opening_balance_date: input.openingBalanceDate ?? '',
    phone: input.phone ?? '',
    gstin: input.gstin ?? '',
    address: input.address ?? '',
    credit_limit: input.creditLimit ?? 0,
    note: input.note ?? '',
  }
}

async function writeCustomerWithSchemaFallback(
  mode: 'create' | 'update',
  payload: Record<string, unknown>,
  customerId?: string,
) {
  try {
    if (mode === 'create') {
      return await pb.collection('customers').create(payload)
    }
    return await pb.collection('customers').update(customerId ?? '', payload)
  } catch (error) {
    if (!isOptionalFieldSchemaError(error)) {
      throw error
    }
    // Some installs may still run older customer schema without optional fields.
    const minimalPayload = { ...payload }
    for (const key of optionalKeys) {
      delete minimalPayload[key]
    }
    if (mode === 'create') {
      return await pb.collection('customers').create(minimalPayload)
    }
    return await pb.collection('customers').update(customerId ?? '', minimalPayload)
  }
}

function isOptionalFieldSchemaError(error: unknown) {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  if (optionalKeys.some((key) => message.includes(key))) return true
  if (message.includes('validation') || message.includes('unknown') || message.includes('invalid')) return true
  return false
}

export async function loadCustomersWithLedgerContext() {
  const [customersRaw, billsRaw, billItemsRaw, paymentsRaw] = await Promise.all([
    pb.collection('customers').getFullList({ sort: 'name' }),
    pb.collection('bills').getFullList({ sort: '-date,-bill_no' }),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList({ sort: '-date' }),
  ])

  const customers = (customersRaw as PBRecord[]).map(extractCustomerRecord)
  const bills = (billsRaw as PBRecord[]).map(
    (row): BillRecord => ({
      id: row.id,
      customerId: String(row.customer ?? ''),
      customerName: String(row.customer_name ?? ''),
      date: datePart(row.date),
      bookNo: num(row.book_no),
      billNo: num(row.bill_no),
      transport: num(row.transport),
      gstRate: num(row.gst_rate),
    }),
  )
  const billItems = (billItemsRaw as PBRecord[]).map(
    (row): BillItemRecord => ({
      billId: String(row.bill ?? ''),
      amount: num(row.amount),
    }),
  )
  const payments = (paymentsRaw as PBRecord[]).map(
    (row): PaymentRecord => ({
      id: row.id,
      customerId: String(row.customer ?? ''),
      customerName: String(row.customer_name ?? ''),
      date: datePart(row.date),
      amount: num(row.amount),
    }),
  )

  return buildCustomerLedgerSummaries({ customers, bills, billItems, payments })
}

export async function createCustomer(input: {
  name: string
  active: boolean
  openingBalance: number
  openingBalanceDate?: string
  phone?: string
  gstin?: string
  address?: string
  creditLimit?: number
  note?: string
}) {
  const payload = buildCustomerWritePayload(input)
  await runDataOperation('create-customer', async () => {
    await writeCustomerWithSchemaFallback('create', payload)
  })
}

export async function updateCustomer(
  id: string,
  input: {
    name: string
    active: boolean
    openingBalance: number
    openingBalanceDate?: string
    phone?: string
    gstin?: string
    address?: string
    creditLimit?: number
    note?: string
  },
) {
  const payload = buildCustomerWritePayload(input)
  await runDataOperation('update-customer', async () => {
    await writeCustomerWithSchemaFallback('update', payload, id)
  })
}

export async function toggleCustomerActive(id: string, nextActive: boolean) {
  await runDataOperation('toggle-customer-active', async () => {
    await pb.collection('customers').update(id, { active: nextActive })
  })
}

