import PocketBase from 'pocketbase'

const args = parseArgs(process.argv.slice(2))
const baseUrl = args.url || process.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8091'
const years = clampInt(args.years ?? 3, 2, 5)
const targetBills = clampInt(args.bills ?? 1200, 200, 6000)
const targetPayments = clampInt(args.payments ?? Math.round(targetBills * 1.35), 200, 12000)
const targetCustomers = clampInt(args.customers ?? 120, 20, 800)
const dryRun = Boolean(args['dry-run'])

const pb = new PocketBase(baseUrl)
pb.autoCancellation(false)

const seededTag = '[seed-large-demo]'

const baseCustomerNames = [
  'D.E.',
  'Aleeshbhai',
  'Naveenbhai',
  'Aarav Metals',
  'Vikram Traders',
  'Bharat Industries',
  'Shiv Enterprise',
  'Jamnagar Brass Works',
  'Royal Fittings',
  'Khodiyar Enterprise',
]

const baseItemTemplates = [
  { name: 'Spindle (8.5.Gm)', defaultRate: 820 },
  { name: 'Te (10.50)', defaultRate: 805 },
  { name: 'Tapper Plug (10.50)', defaultRate: 835 },
  { name: 'Brill Spindle (8.5.Gm)', defaultRate: 845 },
  { name: 'Spindle Heavy (9.0.Gm)', defaultRate: 860 },
  { name: 'Spindle Light (8.2.Gm)', defaultRate: 790 },
]

const randomNamePrefixes = ['Shree', 'New', 'Mahadev', 'Kiran', 'Maa', 'Tulsi', 'Om', 'Parth', 'Sai', 'Arihant']
const randomNameSuffixes = ['Trading', 'Industries', 'Metals', 'Enterprise', 'Products', 'Agency', 'Works', 'Impex']
const paymentModes = ['Cash', 'Bank']
const bookNos = [51, 52, 53, 57, 60, 62, 68, 69, 71]

main().catch((error) => {
  console.error('Seeder failed:', error)
  process.exit(1)
})

async function main() {
  console.log(`Connecting to PocketBase at ${baseUrl}`)
  console.log(`Plan: ${years} years, ${targetCustomers} customers, ${targetBills} bills, ${targetPayments} payments`)
  if (dryRun) console.log('Dry run enabled. No records will be created.')

  const [customers, items, bills] = await Promise.all([
    pb.collection('customers').getFullList({ sort: 'name' }),
    pb.collection('items').getFullList({ sort: 'name' }),
    pb.collection('bills').getFullList({ sort: 'date,bill_no' }),
  ])

  const customerByName = new Map(customers.map((row) => [String(row.name ?? '').trim().toLowerCase(), row]))
  const itemByName = new Map(items.map((row) => [String(row.name ?? '').trim().toLowerCase(), row]))
  const customerRows = [...customers]
  const itemRows = [...items]

  // Ensure fixed style customers from provided physical bills are present.
  for (const name of baseCustomerNames) {
    if (customerByName.has(name.toLowerCase())) continue
    const row = {
      name,
      active: true,
      opening_balance: randomChoice([1, 1, 5000, 10000, 20000, 50000, 75000]),
    }
    if (!dryRun) {
      const created = await pb.collection('customers').create(row)
      customerRows.push(created)
      customerByName.set(name.toLowerCase(), created)
    } else {
      customerByName.set(name.toLowerCase(), { id: `dry-${name}`, ...row })
    }
  }

  // Add many additional customers for large dataset behavior.
  while (customerByName.size < targetCustomers) {
    const candidate = `${randomChoice(randomNamePrefixes)} ${randInt(1, 999)} ${randomChoice(randomNameSuffixes)}`
    const key = candidate.toLowerCase()
    if (customerByName.has(key)) continue
    const row = {
      name: candidate,
      active: Math.random() > 0.08,
      opening_balance: randomChoice([1, randInt(5000, 120000)]),
    }
    if (!dryRun) {
      const created = await pb.collection('customers').create(row)
      customerRows.push(created)
      customerByName.set(key, created)
    } else {
      customerByName.set(key, { id: `dry-${candidate}`, ...row })
    }
  }

  for (const template of baseItemTemplates) {
    const key = template.name.toLowerCase()
    if (itemByName.has(key)) continue
    if (!dryRun) {
      const created = await pb.collection('items').create({ name: template.name, default_rate: template.defaultRate })
      itemRows.push(created)
      itemByName.set(key, created)
    } else {
      itemByName.set(key, { id: `dry-${template.name}`, name: template.name, default_rate: template.defaultRate })
    }
  }

  // Add additional items for realistic variety.
  while (itemByName.size < 35) {
    const grams = randomChoice(['8.3.Gm', '8.5.Gm', '8.7.Gm', '9.2.Gm', '10.50'])
    const label = `${randomChoice(['Spindle', 'Plug', 'Te', 'Nozzle', 'Pin'])} ${randInt(1, 40)} (${grams})`
    const key = label.toLowerCase()
    if (itemByName.has(key)) continue
    const defaultRate = randInt(760, 930)
    if (!dryRun) {
      const created = await pb.collection('items').create({ name: label, default_rate: defaultRate })
      itemRows.push(created)
      itemByName.set(key, created)
    } else {
      itemByName.set(key, { id: `dry-${label}`, name: label, default_rate: defaultRate })
    }
  }

  const customerList = [...customerByName.values()]
  const itemList = [...itemByName.values()]

  const billNoByBook = new Map()
  for (const bill of bills) {
    const bookNo = Number(bill.book_no ?? 0)
    const billNo = Number(bill.bill_no ?? 0)
    billNoByBook.set(bookNo, Math.max(billNoByBook.get(bookNo) ?? 0, billNo))
  }

  const today = new Date()
  const startDate = new Date(today)
  startDate.setFullYear(today.getFullYear() - years)

  const generatedBills = []
  console.log(`Generating ${targetBills} bills...`)

  for (let i = 0; i < targetBills; i += 1) {
    const customer = weightedCustomer(customerList)
    const date = randomDate(startDate, today)
    const dateIso = toIso(date)
    const bookNo = randomChoice(bookNos)
    const nextBillNo = (billNoByBook.get(bookNo) ?? 0) + 1
    billNoByBook.set(bookNo, nextBillNo)
    const billRef = `${bookNo}/${nextBillNo}`
    const mkt = randInt(680, 920)
    const transport = randomChoice([0, 0, 0, 1500, 2000, 2500, 3500, 5000])
    const gstRate = randomChoice([0, 0, 0, 5, 12])
    const lineCount = randomChoice([1, 1, 2, 2, 3])
    const lrNos = Array.from({ length: randomChoice([1, 1, 2]) }, () => `JAM ${randInt(75000, 76999)}`)

    const lineItems = []
    for (let line = 0; line < lineCount; line += 1) {
      const item = randomChoice(itemList)
      const qty = randomChoice([50, 75, 100, 120, 150, 200, 250, 300, 350, 500])
      const rate = Math.max(50, Math.round(Number(item.default_rate ?? 0) + randInt(-20, 35) + (mkt - 760) * 0.3))
      const amount = qty * rate
      const bags = Math.max(1, Math.round(qty / randomChoice([40, 50, 60])))
      lineItems.push({
        item: item.id,
        item_name: String(item.name ?? ''),
        qty,
        rate,
        amount,
        bags,
      })
    }

    generatedBills.push({
      header: {
        book_no: bookNo,
        bill_no: nextBillNo,
        bill_ref: billRef,
        date: dateIso,
        customer: customer.id,
        customer_name: String(customer.name ?? ''),
        mkt,
        transport,
        gst_rate: gstRate,
        gst_amount: 0,
        lr_no: lrNos.join(', '),
      },
      lineItems,
    })
  }

  generatedBills.sort((a, b) => a.header.date.localeCompare(b.header.date) || a.header.bill_no - b.header.bill_no)

  let createdBills = 0
  let createdBillItems = 0
  if (!dryRun) {
    for (const bill of generatedBills) {
      const createdBill = await pb.collection('bills').create(bill.header)
      createdBills += 1
      for (const line of bill.lineItems) {
        await pb.collection('bill_items').create({ bill: createdBill.id, ...line })
        createdBillItems += 1
      }
    }
  } else {
    createdBills = generatedBills.length
    createdBillItems = generatedBills.reduce((sum, bill) => sum + bill.lineItems.length, 0)
  }

  // Build payment schedule from generated bills with edge cases:
  // partials, overpayments, same-day multiple entries, long overdue.
  const billTotalsByCustomer = new Map()
  for (const bill of generatedBills) {
    const base = bill.lineItems.reduce((sum, row) => sum + row.amount, 0)
    const gstAmount = (base * bill.header.gst_rate) / 100
    const total = base + bill.header.transport + gstAmount
    const row = billTotalsByCustomer.get(bill.header.customer) ?? []
    row.push({ date: bill.header.date, total, customerName: bill.header.customer_name })
    billTotalsByCustomer.set(bill.header.customer, row)
  }

  const paymentRows = []
  const customerIds = [...billTotalsByCustomer.keys()]
  while (paymentRows.length < targetPayments && customerIds.length > 0) {
    const customerId = weightedChoice(customerIds, (id) => (billTotalsByCustomer.get(id)?.length ?? 1) + 1)
    const billsForCustomer = billTotalsByCustomer.get(customerId) ?? []
    if (billsForCustomer.length === 0) continue
    const anchorBill = randomChoice(billsForCustomer)
    const paymentDate = addDays(new Date(`${anchorBill.date}T00:00:00`), randInt(0, 120))
    if (paymentDate > today) continue
    const style = randomChoice(['partial', 'normal', 'overpay', 'lump'])
    let amount = 0
    if (style === 'partial') amount = Math.round(anchorBill.total * randomBetween(0.2, 0.7))
    else if (style === 'normal') amount = Math.round(anchorBill.total * randomBetween(0.8, 1.1))
    else if (style === 'overpay') amount = Math.round(anchorBill.total * randomBetween(1.2, 2.2))
    else amount = randInt(25000, 250000)
    amount = Math.max(500, amount)

    paymentRows.push({
      date: toIso(paymentDate),
      customer: customerId,
      customer_name: anchorBill.customerName,
      amount,
      mode: randomChoice(paymentModes),
      note: `${seededTag} ${style} payment`,
    })

    if (Math.random() < 0.12) {
      paymentRows.push({
        date: toIso(paymentDate),
        customer: customerId,
        customer_name: anchorBill.customerName,
        amount: Math.max(300, Math.round(amount * randomBetween(0.1, 0.35))),
        mode: randomChoice(paymentModes),
        note: `${seededTag} same-day split payment`,
      })
    }
  }

  let createdPayments = 0
  if (!dryRun) {
    for (const row of paymentRows.slice(0, targetPayments)) {
      await pb.collection('payments').create(row)
      createdPayments += 1
    }
  } else {
    createdPayments = Math.min(paymentRows.length, targetPayments)
  }

  // Seed misc expenses monthly for reporting realism.
  const miscRows = []
  for (let d = new Date(startDate); d <= today; d = addDays(d, randInt(12, 28))) {
    miscRows.push({
      date: toIso(d),
      type: randomChoice(['Fuel', 'Loading', 'Courier', 'Packing', 'Misc']),
      amount: randInt(500, 18000),
      book_no: randomChoice(bookNos),
      bill_no: randInt(1, 9999),
      note: `${seededTag} auto expense`,
    })
  }

  let createdMisc = 0
  if (!dryRun) {
    for (const row of miscRows) {
      await pb.collection('misc_expenses').create(row)
      createdMisc += 1
    }
  } else {
    createdMisc = miscRows.length
  }

  console.log('Seed complete.')
  console.log(`Customers total: ${customerByName.size}`)
  console.log(`Items total: ${itemByName.size}`)
  console.log(`Bills created: ${createdBills}`)
  console.log(`Bill items created: ${createdBillItems}`)
  console.log(`Payments created: ${createdPayments}`)
  console.log(`Misc expenses created: ${createdMisc}`)
  console.log(`Mode: ${dryRun ? 'dry-run' : 'write'}`)
}

function parseArgs(argv) {
  const parsed = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const [key, value] = arg.slice(2).split('=')
    parsed[key] = value === undefined ? true : value
  }
  return parsed
}

function clampInt(value, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return min
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min
}

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function weightedChoice(list, weightFn) {
  const weighted = list.map((item) => ({ item, w: Math.max(0.0001, weightFn(item)) }))
  const total = weighted.reduce((sum, row) => sum + row.w, 0)
  let r = Math.random() * total
  for (const row of weighted) {
    r -= row.w
    if (r <= 0) return row.item
  }
  return weighted[weighted.length - 1]?.item ?? list[0]
}

function weightedCustomer(customers) {
  return weightedChoice(customers, (customer) => {
    const opening = Number(customer.opening_balance ?? 0)
    if (opening > 0) return 2.1
    if (opening < 0) return 1.4
    return 1
  })
}

function randomDate(start, end) {
  const startMs = start.getTime()
  const endMs = end.getTime()
  const ms = randInt(startMs, endMs)
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  d.setHours(0, 0, 0, 0)
  return d
}

function toIso(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
