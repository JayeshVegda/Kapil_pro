/**
 * Purchase-module smoke seeder. ONLY touches the 9 supplier/purchase
 * collections — Kapil billing (sales) data is never read-modified beyond a
 * read-only count check printed for proof.
 *
 *   npm run db:seed:purchase              # reset purchase module + seed demo data
 *   npm run db:seed:purchase -- --dry-run # print the plan without writing
 *   npm run db:seed:purchase -- --url http://127.0.0.1:8090
 *
 * Reset = hard-delete every row in the 9 purchase collections (bills cascade
 * their lines/adjustments/bardan; payments cascade allocations), then insert a
 * small deterministic dataset that exercises every settlement feature:
 * openings (both directions), GST + RCM bills, quality cuts, bardan
 * deduct/in_kind/cash_back/advance, manual pins, paid_on_behalf, settle_off,
 * refund_received, and one cancelled bill + one cancelled payment.
 */
import PocketBase from 'pocketbase'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const baseUrl = args.url || 'http://127.0.0.1:8090'
const dryRun = Boolean(args['dry-run'])
const ACTOR = 'seed@smoke.local'

const PURCHASE_COLLECTIONS = [
  'purchase_bills',
  'purchase_bill_lines',
  'purchase_bill_adjustments',
  'purchase_bardan',
  'supplier_payments',
  'supplier_payment_allocations',
  'purchase_audit_log',
  'suppliers',
  'purchase_items',
]
const SALES_PROOF_COLLECTIONS = ['customers', 'bills', 'bill_items', 'payments']

const pb = new PocketBase(baseUrl)
pb.autoCancellation(false)

main().catch((error) => {
  const detail = error?.response?.data ? JSON.stringify(error.response.data) : ''
  const url = error?.url ? ` (${error.url})` : ''
  console.error('[seed-purchase-demo] failed:', error?.message ?? error, detail, url)
  process.exit(1)
})

async function main() {
  console.log(`[seed-purchase-demo] PocketBase: ${baseUrl}${dryRun ? ' (dry run — no writes)' : ''}`)

  const credPath = path.join(repoRoot, 'runtime', 'state', 'pb-admin-credentials.json')
  if (!fs.existsSync(credPath)) {
    throw new Error(`Superuser credentials not found at ${credPath}. Start Kapil once to generate them.`)
  }
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'))
  await pb.collection('_superusers').authWithPassword(cred.email, cred.password)
  console.log('[seed-purchase-demo] authenticated as superuser')

  await printSalesCounts('BEFORE')

  const existing = {}
  for (const name of PURCHASE_COLLECTIONS) {
    existing[name] = (await pb.collection(name).getFullList({ fields: 'id' })).length
  }
  console.log('[seed-purchase-demo] current purchase rows:', formatCounts(existing))

  if (!dryRun) {
    await wipe()
    await seed()
  }

  if (!dryRun) {
    const after = {}
    for (const name of PURCHASE_COLLECTIONS) {
      after[name] = (await pb.collection(name).getList(1, 1)).totalItems
    }
    console.log('[seed-purchase-demo] seeded purchase rows:', formatCounts(after))
    await printSalesCounts('AFTER')
    console.log('[seed-purchase-demo] done. Open /suppliers in the app to review the demo data.')
  }
}

async function printSalesCounts(label) {
  const counts = {}
  for (const name of SALES_PROOF_COLLECTIONS) {
    counts[name] = (await pb.collection(name).getList(1, 1)).totalItems
  }
  console.log(`[seed-purchase-demo] sales tables ${label} (untouched):`, formatCounts(counts))
}

function formatCounts(counts) {
  return Object.entries(counts)
    .map(([name, count]) => `${name}=${count}`)
    .join(', ')
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

async function wipe() {
  // Bills first: cascade removes their lines/adjustments/bardan. Payments next:
  // cascade removes allocations. Leftover sweeps cover any strays, then master
  // data and the audit trail.
  const order = [
    'purchase_bills',
    'supplier_payments',
    'purchase_bill_lines',
    'purchase_bill_adjustments',
    'purchase_bardan',
    'supplier_payment_allocations',
    'purchase_audit_log',
    'suppliers',
    'purchase_items',
  ]
  for (const name of order) {
    const ids = (await pb.collection(name).getFullList({ fields: 'id' })).map((row) => row.id)
    for (const chunk of chunked(ids, 40)) {
      const batch = pb.createBatch()
      for (const id of chunk) batch.collection(name).delete(id)
      await batch.send()
    }
    if (ids.length > 0) console.log(`[seed-purchase-demo] wiped ${name}: ${ids.length} rows`)
  }
}

// ---------------------------------------------------------------------------
// Seed dataset
// ---------------------------------------------------------------------------

function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 15; i++) id += chars.charAt(Math.floor(Math.random() * chars.length))
  return id
}

/** Mirrors supplier-units lineAmountPaise: roundHalfUp(g * milli / 10000) paise. */
function lineAmountPaise(weightG, rateMilli) {
  return Math.round((weightG * rateMilli) / 10000)
}

/** Mirrors computeBillNet (supplier-purchases.ts) incl. round-off to whole ₹. */
function computeBillNet(lines, adjustments, bardan, taxMode, gstRateBp) {
  const linesTotalPaise = lines.reduce((sum, l) => sum + (l.amountPaise ?? l.amount_paise ?? 0), 0)
  let bardanDeductPaise = 0
  for (const entry of bardan) if (entry.method === 'deduct') bardanDeductPaise += entry.creditPaise ?? 0
  let qualityCutPaise = 0
  let otherAdjustmentsPaise = 0
  for (const adjustment of adjustments) {
    const amount = adjustment.amountPaise ?? adjustment.amount_paise ?? 0
    if (adjustment.type === 'quality_cut') qualityCutPaise += amount
    else otherAdjustmentsPaise += amount
  }
  const taxablePaise = Math.max(0, linesTotalPaise - bardanDeductPaise - qualityCutPaise)
  const taxPaise = taxMode === 'gst' || taxMode === 'rcm' ? Math.round((taxablePaise * gstRateBp) / 10000) : 0
  const beforeRoundPaise = taxablePaise + (taxMode === 'gst' ? taxPaise : 0) + otherAdjustmentsPaise
  const remainder = beforeRoundPaise % 100
  const roundOffPaise = beforeRoundPaise < 0 || remainder === 0 ? 0 : remainder < 50 ? -remainder : 100 - remainder
  return { netPaise: Math.max(0, beforeRoundPaise + roundOffPaise) }
}

const ITEMS = ['brass scrap', 'chol', 'pata', 'marobol', 'sisu', 'coal', 'honey brass', 'gun metal']

const SUPPLIERS = [
  { key: 'shreeji', company_name: 'Shreeji Metal Traders', contact_name: 'Jignesh Patel', phone: '9825011223', city: 'Rajkot', gst_no: '24ABCDE1234F1Z5', notes: 'Main kacha supplier — weekly pickup.', opening_kacha_paise: 2_500_000, opening_gst_paise: 0, opening_balance_date: '2026-04-01', active: true },
  { key: 'maruti', company_name: 'Maruti Brass Industries', contact_name: 'Haresh Bhai', phone: '9879504455', city: 'Jamnagar', gst_no: '24PQRSX9876L1Z2', notes: 'GST-registered factory scrap.', opening_kacha_paise: -800_000, opening_gst_paise: 1_250_000, opening_balance_date: '2026-04-01', active: true },
  { key: 'kaka', company_name: 'Kaka Pital Wala', contact_name: 'Kaka', phone: '9909887766', city: 'Jamnagar', gst_no: '', notes: '', opening_kacha_paise: 0, opening_gst_paise: 0, opening_balance_date: '2026-04-01', active: true },
  { key: 'bhavya', company_name: 'Bhavya Scrap Co.', contact_name: 'Bhavya', phone: '9426001122', city: 'Morbi', gst_no: '', notes: 'Small lots, cash only.', opening_kacha_paise: 500_000, opening_gst_paise: 0, opening_balance_date: '2026-04-01', active: true },
  { key: 'oldpatel', company_name: 'Old Patel Alloys', contact_name: 'Ramesh', phone: '9900011122', city: 'Ahmedabad', gst_no: '', notes: 'Inactive since FY25.', opening_kacha_paise: 0, opening_gst_paise: 0, opening_balance_date: '', active: false },
]

async function seed() {
  const ids = { items: {}, suppliers: {} }

  // ---- purchase items ----
  for (const name of ITEMS) {
    const id = generateId()
    ids.items[name] = id
    await create('purchase_items', { id, name, active: true })
  }

  // ---- suppliers ----
  for (const supplier of SUPPLIERS) {
    const { key, ...payload } = supplier
    const id = generateId()
    ids.suppliers[key] = id
    await create('suppliers', { id, ...payload })
  }

  const line = (itemName, weightG, rateMilli) => ({
    id: generateId(),
    item: ids.items[itemName] ?? '',
    item_name: itemName,
    weight_g: weightG,
    rate_milli: rateMilli,
    amount_paise: lineAmountPaise(weightG, rateMilli),
  })

  let inSeq = 0
  const nextInNo = () => `IN-2627-${String(++inSeq).padStart(4, '0')}`
  const billIds = {}
  const paymentIds = {}

  // Bills are seeded in business-date order; each helper call stores one bill
  // with its children and mirrors the app's create/update audit trail.
  async function seedBill(def) {
    const inNo = def.inNo ?? nextInNo()
    const billId = generateId()
    billIds[def.key] = billId
    const billPayload = {
      id: billId,
      supplier: ids.suppliers[def.supplier],
      in_no: inNo,
      supplier_bill_no: def.supplierBillNo ?? '',
      date: def.date,
      pool: def.pool,
      tax_mode: def.taxMode,
      gst_rate_bp: def.taxMode === 'gst' || def.taxMode === 'rcm' ? def.gstRateBp ?? 0 : 0,
      vehicle_no: def.vehicleNo ?? '',
      private_note: def.privateNote ?? '',
      group_id: '',
      cancelled: def.cancelled ?? false,
      cancel_reason: def.cancelled ? def.cancelReason ?? '' : '',
    }
    const lineIds = []
    await create('purchase_bills', billPayload)
    for (const l of def.lines) {
      lineIds.push(l.id)
      await create('purchase_bill_lines', { ...l, bill: billId })
    }
    for (const adjustment of def.adjustments ?? []) {
      await create('purchase_bill_adjustments', { id: generateId(), bill: billId, ...adjustment })
    }
    for (const entry of def.bardan ?? []) {
      const bardanPayload = {
        id: generateId(),
        bill: billId,
        bardan_g: entry.bardanG,
        rate_line: entry.lineIndex != null ? lineIds[entry.lineIndex] ?? '' : '',
        rate_milli: entry.rateMilli,
        method: entry.method,
        credit_paise: entry.creditPaise ?? 0,
        cash_amount_paise: entry.cashAmountPaise ?? 0,
        date: entry.date ?? def.date,
        note: entry.note ?? '',
      }
      await create('purchase_bardan', bardanPayload)
      if (entry.method === 'advance' && (entry.creditPaise ?? 0) > 0) {
        await seedPayment({
          key: entry.paymentKey,
          supplier: def.supplier,
          date: bardanPayload.date,
          pool: def.pool,
          kind: 'bardan_advance',
          amountPaise: entry.creditPaise,
          mode: 'other',
          reference: `Bardan Advance (Bill ${inNo})`,
          privateNote: entry.note ?? '',
        })
      }
    }
    return { inNo, net: computeBillNet(def.lines, def.adjustments ?? [], def.bardan ?? [], def.taxMode, def.gstRateBp ?? 0).netPaise }
  }

  const results = []

  results.push(await seedBill({
    key: 'b1', supplier: 'shreeji', date: '2026-08-12', pool: 'kacha', taxMode: 'none',
    vehicleNo: 'GJ-03-AB-1234', privateNote: '[bags_at_receipt:28.500]\nWeighbridge slip attached',
    lines: [line('brass scrap', 850_500, 712_000), line('chol', 120_000, 385_000)],
    adjustments: [
      { type: 'labour', amount_paise: 50_000, note: 'Loading labour' },
      { type: 'quality_cut', amount_paise: 100_000, note: 'Mix contamination' },
    ],
    bardan: [{ method: 'deduct', bardanG: 24_000, rateMilli: 712_000, creditPaise: lineAmountPaise(24_000, 712_000), lineIndex: 0, note: '24 empty bags returned' }],
  }))

  results.push(await seedBill({
    key: 'b2', supplier: 'shreeji', date: '2026-09-03', pool: 'gst', taxMode: 'gst', gstRateBp: 1800,
    supplierBillNo: 'SMT-2214', vehicleNo: 'GJ-10-KA-9090',
    lines: [line('gun metal', 45_000, 980_000)],
  }))

  results.push(await seedBill({
    key: 'b3', supplier: 'maruti', date: '2026-09-18', pool: 'kacha', taxMode: 'none',
    lines: [line('brass scrap', 300_000, 705_000)],
    bardan: [{ method: 'advance', bardanG: 80_000, rateMilli: 705_000, creditPaise: lineAmountPaise(80_000, 705_000), lineIndex: 0, paymentKey: 'p3', note: '80 bags kept — advance adjusted' }],
  }))

  results.push(await seedBill({
    key: 'b4', supplier: 'kaka', date: '2026-09-25', pool: 'kacha', taxMode: 'none',
    vehicleNo: 'GJ-01-DD-4444', privateNote: '[bags_at_receipt:52.000]',
    lines: [line('marobol', 500_000, 690_000), line('sisu', 150_000, 250_000)],
    adjustments: [
      { type: 'transport', amount_paise: 80_000, note: 'Tempo freight' },
      { type: 'quality_cut', amount_paise: 120_000, note: 'Burnt pieces' },
    ],
    bardan: [{ method: 'in_kind', bardanG: 50_000, rateMilli: 690_000, creditPaise: 0, lineIndex: 0, note: '50 bags returned in kind — settled' }],
  }))

  results.push(await seedBill({
    key: 'b5', supplier: 'maruti', date: '2026-10-05', pool: 'gst', taxMode: 'rcm', gstRateBp: 1800,
    supplierBillNo: 'MBI-889',
    lines: [line('pata', 60_000, 420_000)],
  }))

  results.push(await seedBill({
    key: 'b6', supplier: 'bhavya', date: '2026-10-02', pool: 'kacha', taxMode: 'none',
    cancelled: true, cancelReason: 'Duplicate entry — supplier sent revised slip',
    lines: [line('brass scrap', 100_000, 700_000)],
  }))

  results.push(await seedBill({
    key: 'b7', supplier: 'shreeji', date: '2026-10-20', pool: 'kacha', taxMode: 'none',
    lines: [line('brass scrap', 200_000, 720_000)],
    bardan: [{ method: 'cash_back', bardanG: 30_000, rateMilli: 720_000, creditPaise: 0, cashAmountPaise: 150_000, note: '₹1,500 cash returned with 30 bags' }],
  }))

  results.push(await seedBill({
    key: 'b8', supplier: 'maruti', date: '2026-10-25', pool: 'kacha', taxMode: 'none',
    lines: [line('chol', 90_000, 395_000)],
  }))

  // ---- payments ----
  async function seedPayment(def) {
    const paymentId = generateId()
    paymentIds[def.key] = paymentId
    const payload = {
      id: paymentId,
      supplier: ids.suppliers[def.supplier],
      date: def.date,
      pool: def.pool,
      kind: def.kind,
      amount_paise: def.amountPaise,
      mode: def.mode ?? '',
      reference: def.reference ?? '',
      payee_name: def.payeeName ?? '',
      private_note: def.privateNote ?? '',
      cancelled: def.cancelled ?? false,
      cancel_reason: def.cancelled ? def.cancelReason ?? '' : '',
    }
    await create('supplier_payments', payload)
    for (const pin of def.pins ?? []) {
      await create('supplier_payment_allocations', {
        id: generateId(),
        payment: paymentId,
        bill: billIds[pin.billKey],
        amount_paise: pin.amountPaise,
      })
    }
    return paymentId
  }

  await seedPayment({ key: 'p1', supplier: 'shreeji', date: '2026-08-20', pool: 'kacha', kind: 'payment', amountPaise: 40_000_000, mode: 'rtgs', reference: 'RTGS-88213' })
  await seedPayment({ key: 'p2', supplier: 'shreeji', date: '2026-09-15', pool: 'kacha', kind: 'payment', amountPaise: 20_000_000, mode: 'cash' })
  await seedPayment({ key: 'p4', supplier: 'maruti', date: '2026-10-10', pool: 'gst', kind: 'payment', amountPaise: 15_000_000, mode: 'neft', reference: 'NEFT-551020' })
  await seedPayment({ key: 'p5', supplier: 'kaka', date: '2026-10-01', pool: 'kacha', kind: 'payment', amountPaise: 7_500_000, mode: 'upi', reference: 'UPI-778812', pins: [{ billKey: 'b4', amountPaise: 3_000_000 }] })
  await seedPayment({ key: 'p6', supplier: 'kaka', date: '2026-10-08', pool: 'kacha', kind: 'paid_on_behalf', amountPaise: 250_000, mode: 'cash', payeeName: 'Mahesh Transport', reference: 'Tempo freight paid' })
  await seedPayment({ key: 'p7', supplier: 'bhavya', date: '2026-09-28', pool: 'kacha', kind: 'payment', amountPaise: 2_000_000, mode: 'cheque', reference: 'CHQ-004412', cancelled: true, cancelReason: 'Cheque bounced — reissue pending' })
  await seedPayment({ key: 'p8', supplier: 'maruti', date: '2026-10-12', pool: 'kacha', kind: 'refund_received', amountPaise: 300_000, mode: 'cash', reference: 'Cash returned' })
  await seedPayment({ key: 'p9', supplier: 'kaka', date: '2026-10-15', pool: 'kacha', kind: 'settle_off', amountPaise: 5_000, mode: 'other', reference: 'Small diff written off' })

  console.log('[seed-purchase-demo] seeded bills (IN no -> net ₹):')
  for (const result of results) {
    console.log(`  ${result.inNo} -> ₹${(result.net / 100).toLocaleString('en-IN')}`)
  }
}

/** Creates a record + its purchase_audit_log row, mirroring the data layer. */
async function create(collection, payload) {
  await pb.collection(collection).create(payload)
  await pb.collection('purchase_audit_log').create({
    collection,
    record_id: payload.id,
    action: 'create',
    before_json: '',
    after_json: JSON.stringify(payload),
    actor: ACTOR,
  })
}

function chunked(list, size) {
  const chunks = []
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size))
  return chunks
}

function parseArgs(argv) {
  const args = {}
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=')
      args[key] = value ?? true
    }
  }
  return args
}
