import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
  console.error('Missing PocketBase admin credentials. Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD.')
  process.exit(1)
}

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

const rows = [
  { party: 'A.S Patel', openingBalanceDate: '', openingBalance: null, paymentAmount: null, paymentDate: '', paymentType: '' },
  { party: 'Sambhu', openingBalanceDate: '23-4-26', openingBalance: 556050, paymentAmount: null, paymentDate: '', paymentType: '' },
  { party: 'S.K Enterprice', openingBalanceDate: '22-4-26', openingBalance: 470912, paymentAmount: null, paymentDate: '', paymentType: '' },
  { party: 'D.E', openingBalanceDate: '20-4-26', openingBalance: 780227, paymentAmount: 100000, paymentDate: '23-4-26', paymentType: 'bank' },
  { party: 'Adesh Bhai', openingBalanceDate: '22-4-26', openingBalance: 706050, paymentAmount: null, paymentDate: '', paymentType: '' },
  { party: 'Naveen Bhai', openingBalanceDate: '20-4-26', openingBalance: 610450, paymentAmount: null, paymentDate: '', paymentType: '' },
  { party: 'Ramesh Bhai', openingBalanceDate: '19-4-26', openingBalance: 222500, paymentAmount: null, paymentDate: '', paymentType: '' },
  { party: 'Pratap Bhai', openingBalanceDate: '9-4-26', openingBalance: 852600, paymentAmount: 500000, paymentDate: '16-4-26', paymentType: 'bank' },
  { party: 'Praveen Bhai', openingBalanceDate: '16-4-26', openingBalance: 154203, paymentAmount: null, paymentDate: '', paymentType: '' },
]

main().catch((error) => {
  console.error('Import failed:', error)
  process.exit(1)
})

async function main() {
  console.log(`Connecting to PocketBase: ${PB_URL}`)
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
  console.log(`Authenticated as ${PB_ADMIN_EMAIL}`)

  await ensureCustomerOpeningBalanceDateField()

  const existingCustomers = await pb.collection('customers').getFullList({ sort: 'name' })
  const customerByName = new Map(existingCustomers.map((c) => [normalizeName(c.name), c]))

  let createdCustomers = 0
  let updatedCustomers = 0
  let createdPayments = 0

  for (const row of rows) {
    const name = String(row.party ?? '').trim()
    if (!name) continue

    const openingBalance = numberOrZero(row.openingBalance)
    const openingBalanceDateIso = parseDdMmYyToIso(row.openingBalanceDate)
    const customerPayload = {
      name,
      active: true,
      opening_balance: openingBalance,
      opening_balance_date: openingBalanceDateIso,
    }

    const key = normalizeName(name)
    const existing = customerByName.get(key)
    if (existing) {
      await pb.collection('customers').update(existing.id, customerPayload)
      updatedCustomers += 1
      customerByName.set(key, { ...existing, ...customerPayload })
    } else {
      const created = await pb.collection('customers').create(customerPayload)
      createdCustomers += 1
      customerByName.set(key, created)
    }

    const paymentAmount = row.paymentAmount == null ? 0 : Number(row.paymentAmount)
    if (paymentAmount > 0) {
      const customer = customerByName.get(key)
      if (!customer) continue
      const paymentDateIso = parseDdMmYyToIso(row.paymentDate) || openingBalanceDateIso || ''
      const mode = String(row.paymentType ?? '').toLowerCase() === 'cash' ? 'Cash' : 'Bank'
      await pb.collection('payments').create({
        customer: customer.id,
        customer_name: customer.name,
        date: paymentDateIso,
        amount: paymentAmount,
        mode,
        note: '',
      })
      createdPayments += 1
    }
  }

  console.log(`Customers created: ${createdCustomers}, updated: ${updatedCustomers}`)
  console.log(`Payments created: ${createdPayments}`)
}

async function ensureCustomerOpeningBalanceDateField() {
  const collection = await pb.collections.getOne('customers')
  const hasField = (collection.fields ?? []).some((f) => f?.name === 'opening_balance_date')
  if (hasField) return

  const nextFields = [
    ...(collection.fields ?? []),
    {
      name: 'opening_balance_date',
      type: 'date',
      required: false,
      unique: false,
      options: {
        min: '',
        max: '',
      },
    },
  ]

  await pb.collections.update(collection.id, {
    ...collection,
    fields: nextFields,
  })
  console.log('Added customers.opening_balance_date field')
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function numberOrZero(value) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseDdMmYyToIso(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/)
  if (!m) return ''
  const dd = Number(m[1])
  const mm = Number(m[2])
  const yy = Number(m[3])
  if (!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12)) return ''
  const yyyy = 2000 + yy
  const d2 = String(dd).padStart(2, '0')
  const m2 = String(mm).padStart(2, '0')
  return `${yyyy}-${m2}-${d2}`
}
