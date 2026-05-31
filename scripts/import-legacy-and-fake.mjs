import fs from 'node:fs/promises'
import path from 'node:path'
import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD
const EXTRA_BILLS = clampInt(process.env.EXTRA_BILLS || '220', 50, 1200)
const EXTRA_PAYMENTS = clampInt(process.env.EXTRA_PAYMENTS || '320', 80, 1800)

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
  console.error('Missing PocketBase admin credentials. Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD.')
  process.exit(1)
}

const CSV_DIR = '/home/ubuntu/Kapil_pro/docs/data/legacy-billing-system/csv'

const FILES = {
  customers: 'Billing System - Customers.csv',
  items: 'Billing System - Items.csv',
  billItems: 'Billing System - Bill_Items.csv',
  payments: 'Billing System - Payments.csv',
  misc: 'Billing System - Misc_Expenses.csv',
}

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

main().catch((error) => {
  console.error('Import failed:', error)
  process.exit(1)
})

async function main() {
  console.log(`Connecting to PocketBase: ${PB_URL}`)
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
  console.log(`Authenticated as ${PB_ADMIN_EMAIL}`)

  const [customersCsv, itemsCsv, billRowsCsv, paymentsCsv, miscCsv] = await Promise.all([
    readCsv(path.join(CSV_DIR, FILES.customers)),
    readCsv(path.join(CSV_DIR, FILES.items)),
    readCsv(path.join(CSV_DIR, FILES.billItems)),
    readCsv(path.join(CSV_DIR, FILES.payments)),
    readCsv(path.join(CSV_DIR, FILES.misc)),
  ])

  const customerMap = await upsertCustomers(customersCsv)
  const itemMap = await upsertItems(itemsCsv)
  const billMap = await upsertBillsAndBillItems(billRowsCsv, customerMap, itemMap)
  await importPayments(paymentsCsv, customerMap)
  await importMiscExpenses(miscCsv)
  await generateExtraFakeData(customerMap, itemMap, billMap)

  const counts = await getCounts()
  console.log('Final collection counts:', counts)
}

async function readCsv(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    const row = {}
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = (values[i] ?? '').trim()
    }
    return row
  })
}

function parseCsvLine(line) {
  const values = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      const next = line[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }
    current += char
  }
  values.push(current)
  return values
}

async function upsertCustomers(rows) {
  const existing = await pb.collection('customers').getFullList({ sort: 'name' })
  const byName = new Map(existing.map((r) => [normalizeName(r.name), r]))

  for (const row of rows) {
    const name = String(row.Name || '').trim()
    if (!name) continue
    const key = normalizeName(name)
    const payload = {
      name,
      active: true,
      opening_balance: toNumber(row['Opening Balance']),
    }
    const already = byName.get(key)
    if (already) {
      await pb.collection('customers').update(already.id, payload)
      byName.set(key, { ...already, ...payload })
    } else {
      const created = await pb.collection('customers').create(payload)
      byName.set(key, created)
    }
  }
  console.log(`Customers ready: ${byName.size}`)
  return byName
}

async function upsertItems(rows) {
  const existing = await pb.collection('items').getFullList({ sort: 'name' })
  const byName = new Map(existing.map((r) => [normalizeName(r.name), r]))

  for (const row of rows) {
    const name = String(row['Item Name'] || '').trim()
    if (!name) continue
    const key = normalizeName(name)
    const payload = {
      name,
      default_rate: toNumber(row['Default Rate']),
    }
    const already = byName.get(key)
    if (already) {
      await pb.collection('items').update(already.id, payload)
      byName.set(key, { ...already, ...payload })
    } else {
      const created = await pb.collection('items').create(payload)
      byName.set(key, created)
    }
  }
  console.log(`Items ready: ${byName.size}`)
  return byName
}

async function upsertBillsAndBillItems(rows, customerMap, itemMap) {
  const existingBills = await pb.collection('bills').getFullList({ sort: 'date,bill_no' })
  const existingBillItems = await pb.collection('bill_items').getFullList()

  const billByRef = new Map(existingBills.map((b) => [String(b.bill_ref), b]))
  const itemKeySet = new Set(
    existingBillItems.map(
      (i) => `${String(i.bill)}|${String(i.item_name)}|${num(i.qty)}|${num(i.rate)}|${num(i.amount)}`,
    ),
  )

  for (const row of rows) {
    const bookNo = toNumber(row['Book No'])
    const billNo = toNumber(row['Bill No'])
    const billRef = `${bookNo}/${billNo}`
    const customerName = String(row.Customer || '').trim()
    const customer = customerMap.get(normalizeName(customerName))
    if (!customer) continue

    let bill = billByRef.get(billRef)
    const billPayload = {
      book_no: bookNo,
      bill_no: billNo,
      bill_ref: billRef,
      date: String(row.Date || ''),
      customer: customer.id,
      customer_name: customer.name,
      mkt: toNumber(row.MKT),
      transport: toNumber(row.Transport),
      gst_rate: toNumber(row['GST Rate']),
      gst_amount: toNumber(row['GST Amount']),
      lr_no: String(row['LR No'] || ''),
    }
    if (!bill) {
      bill = await pb.collection('bills').create(billPayload)
      billByRef.set(billRef, bill)
    }

    const itemName = String(row['Item Name'] || '').trim()
    const item = itemMap.get(normalizeName(itemName))
    const qty = toNumber(row.Qty)
    const rate = toNumber(row.Rate)
    const amount = toNumber(row.Amount)
    const bags = toNumber(row.Bags)
    const uniqueKey = `${bill.id}|${item?.name || itemName}|${qty}|${rate}|${amount}`
    if (itemKeySet.has(uniqueKey)) continue

    await pb.collection('bill_items').create({
      bill: bill.id,
      item: item?.id || '',
      item_name: item?.name || itemName,
      qty,
      rate,
      amount,
      bags,
    })
    itemKeySet.add(uniqueKey)
  }
  console.log(`Bills ready: ${billByRef.size}`)
  return billByRef
}

async function importPayments(rows, customerMap) {
  const existing = await pb.collection('payments').getFullList({ sort: 'date' })
  const keys = new Set(existing.map((p) => `${p.date}|${p.customer}|${num(p.amount)}|${String(p.mode || '')}`))

  for (const row of rows) {
    const customerName = String(row.Customer || '').trim()
    const customer = customerMap.get(normalizeName(customerName))
    if (!customer) continue
    const key = `${row.Date}|${customer.id}|${toNumber(row.Amount)}|${String(row.Mode || '')}`
    if (keys.has(key)) continue
    await pb.collection('payments').create({
      date: String(row.Date || ''),
      customer: customer.id,
      customer_name: customer.name,
      amount: toNumber(row.Amount),
      mode: String(row.Mode || 'Cash') || 'Cash',
      note: String(row.Note || ''),
    })
    keys.add(key)
  }
  console.log(`Payments imported: ${keys.size}`)
}

async function importMiscExpenses(rows) {
  const existing = await pb.collection('misc_expenses').getFullList({ sort: 'date' })
  const keys = new Set(existing.map((r) => `${r.date}|${r.type}|${num(r.amount)}|${num(r.book_no)}|${num(r.bill_no)}`))

  for (const row of rows) {
    const key = `${row.Date}|${String(row.Type || '')}|${toNumber(row.Amount)}|${toNumber(row['Book No (optional)'])}|${toNumber(row['Bill No (optional)'])}`
    if (keys.has(key)) continue
    await pb.collection('misc_expenses').create({
      date: String(row.Date || ''),
      type: String(row.Type || 'Misc'),
      amount: toNumber(row.Amount),
      book_no: toNumber(row['Book No (optional)']),
      bill_no: toNumber(row['Bill No (optional)']),
      note: String(row.Note || ''),
    })
    keys.add(key)
  }
  console.log(`Misc expenses imported: ${keys.size}`)
}

async function generateExtraFakeData(customerMap, itemMap, billMap) {
  const customers = [...customerMap.values()]
  const items = [...itemMap.values()]
  if (customers.length === 0 || items.length === 0) return

  const existingPayments = await pb.collection('payments').getFullList({ sort: 'date' })
  const existingPayKeys = new Set(existingPayments.map((p) => `${p.date}|${p.customer}|${num(p.amount)}|${String(p.mode || '')}`))
  const payMode = ['Cash', 'Bank']

  const billSeqByBook = new Map()
  for (const bill of billMap.values()) {
    const bookNo = num(bill.book_no)
    billSeqByBook.set(bookNo, Math.max(billSeqByBook.get(bookNo) ?? 0, num(bill.bill_no)))
  }
  if (!billSeqByBook.size) billSeqByBook.set(51, 0)
  const books = [...billSeqByBook.keys()]

  let fakeBillCount = 0
  for (let i = 0; i < EXTRA_BILLS; i += 1) {
    const customer = randomChoice(customers)
    const bookNo = randomChoice(books)
    const billNo = (billSeqByBook.get(bookNo) ?? 0) + 1
    billSeqByBook.set(bookNo, billNo)
    const billDate = randomDate('2025-01-01', '2026-04-27')
    const lineCount = randomInt(1, 3)
    const transport = randomChoice([0, 0, 0, 1000, 1500, 2000, 2500])
    const gstRate = randomChoice([0, 0, 0, 18])

    const bill = await pb.collection('bills').create({
      book_no: bookNo,
      bill_no: billNo,
      bill_ref: `${bookNo}/${billNo}`,
      date: billDate,
      customer: customer.id,
      customer_name: customer.name,
      mkt: randomInt(680, 880),
      transport,
      gst_rate: gstRate,
      gst_amount: 0,
      lr_no: `FAKE-${randomInt(1000, 9999)}`,
    })
    let base = 0
    for (let j = 0; j < lineCount; j += 1) {
      const item = randomChoice(items)
      const qty = randomChoice([40, 60, 75, 90, 100, 120, 150, 180, 220, 260])
      const rate = Math.max(60, randomInt(num(item.default_rate) - 20, num(item.default_rate) + 35))
      const amount = qty * rate
      base += amount
      await pb.collection('bill_items').create({
        bill: bill.id,
        item: item.id,
        item_name: item.name,
        qty,
        rate,
        amount,
        bags: Math.max(1, Math.round(qty / 50)),
      })
    }
    const gstAmount = Math.round((base * gstRate) / 100)
    await pb.collection('bills').update(bill.id, { gst_amount: gstAmount })
    fakeBillCount += 1
  }

  let fakePayCount = 0
  for (let i = 0; i < EXTRA_PAYMENTS; i += 1) {
    const customer = randomChoice(customers)
    const date = randomDate('2025-01-01', '2026-04-27')
    const amount = randomInt(2000, 120000)
    const mode = randomChoice(payMode)
    const key = `${date}|${customer.id}|${amount}|${mode}`
    if (existingPayKeys.has(key)) continue
    await pb.collection('payments').create({
      date,
      customer: customer.id,
      customer_name: customer.name,
      amount,
      mode,
      note: '[synthetic] generated for dataset expansion',
    })
    existingPayKeys.add(key)
    fakePayCount += 1
  }
  console.log(`Fake data created: ${fakeBillCount} bills, ${fakePayCount} payments`)
}

async function getCounts() {
  const names = ['customers', 'items', 'bills', 'bill_items', 'payments', 'misc_expenses']
  const out = {}
  for (const name of names) {
    const list = await pb.collection(name).getList(1, 1)
    out[name] = list.totalItems
  }
  return out
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function toNumber(value) {
  const parsed = Number(String(value || '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function num(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomDate(minIso, maxIso) {
  const min = new Date(`${minIso}T00:00:00Z`).getTime()
  const max = new Date(`${maxIso}T00:00:00Z`).getTime()
  const ts = randomInt(min, max)
  return new Date(ts).toISOString().slice(0, 10)
}

function clampInt(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}
