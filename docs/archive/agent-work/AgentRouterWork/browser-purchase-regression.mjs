import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

const output = dirname(fileURLToPath(import.meta.url))
const base = process.env.KAPIL_TEST_URL || 'http://127.0.0.1:4174'
const screenshots = join(output, 'screenshots')
await mkdir(screenshots, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable', headless: true })
const results = []
const issues = []

function fixture() {
  const stamp = '2026-11-01 10:00:00.000Z'
  const supplier = (id, name, opening) => ({ id, company_name: name, active: true, opening_kacha_paise: opening, opening_gst_paise: 0, opening_balance_date: '2026-04-01', created: stamp })
  const bill = (id, supplierId, number) => ({ id, supplier: supplierId, in_no: number, date: '2026-11-01', pool: 'kacha', tax_mode: 'none', gst_rate_bp: 0, created: stamp, private_note: '', cancelled: false })
  return {
    suppliers: [supplier('supplier0000001', 'Audit Advance Metals', -5_000_000), supplier('supplier0000002', 'Audit Due Metals', 500_000)],
    purchase_items: [{ id: 'item00000000001', name: 'Brass', active: true, created: stamp }],
    purchase_bills: [bill('bill00000000001', 'supplier0000001', 'IN-TEST-001'), bill('bill00000000002', 'supplier0000002', 'IN-TEST-002')],
    purchase_bill_lines: [
      { id: 'line00000000001', bill: 'bill00000000001', item: 'item00000000001', item_name: 'Brass', weight_g: 100000, rate_milli: 800000, amount_paise: 8_000_000, created: stamp },
      { id: 'line00000000002', bill: 'bill00000000002', item: 'item00000000001', item_name: 'Brass', weight_g: 100000, rate_milli: 800000, amount_paise: 8_000_000, created: stamp },
    ],
    purchase_bill_adjustments: [], purchase_bardan: [], supplier_payments: [], supplier_payment_allocations: [], purchase_audit_log: [],
    brass_rates: [{ id: 'rate00000000001', date: '2026-11-07', vilaity: 860, created: stamp }],
    users: [], customers: [], items: [], bills: [], bill_items: [], payments: [], casting_sessions: [], casting_inputs: [], casting_batches: [], casting_batch_inputs: [],
  }
}

function installMockApi(context, records, tracking) {
  return context.route('**/pb/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    if (url.pathname.endsWith('/batch')) {
      tracking.batches++
      const body = request.postData() || ''
      const marker = /name="@jsonPayload"\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(body)
      assert.ok(marker, 'SDK batch multipart JSON must be present')
      const { requests } = JSON.parse(marker[1])
      const response = []
      for (const op of requests) {
        const path = op.url.match(/collections\/([^/]+)\/records(?:\/([^?]+))?/)
        assert.ok(path, 'Only synthetic record operations are accepted')
        const collection = path[1]
        const id = path[2]
        const payload = op.body || op.json || {}
        const table = records[collection] ||= []
        if (op.method === 'POST') {
          if (collection === 'supplier_payments') assert.ok(['cash', 'upi', 'rtgs', 'neft', 'cheque', 'other'].includes(payload.mode))
          const saved = { ...payload, id: payload.id || `audit${String(++tracking.sequence).padStart(10, '0')}`, created: '2026-11-07 10:00:00.000Z', updated: '2026-11-07 10:00:00.000Z' }
          assert.ok(!table.some((row) => row.id === saved.id), 'Duplicate record id')
          table.push(saved)
          response.push({ status: 200, body: saved })
        } else if (op.method === 'PATCH') {
          const saved = table.find((row) => row.id === id)
          assert.ok(saved, 'Updated row exists')
          Object.assign(saved, payload)
          response.push({ status: 200, body: saved })
        } else if (op.method === 'DELETE') {
          const index = table.findIndex((row) => row.id === id)
          assert.ok(index >= 0)
          table.splice(index, 1)
          response.push({ status: 204, body: {} })
        } else throw new Error(`Unexpected batch method ${op.method}`)
      }
      if (tracking.loseNextResponse) {
        tracking.loseNextResponse = false
        await route.abort('failed')
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
      return
    }
    if (method !== 'GET') {
      tracking.nonBatchWrites++
      throw new Error(`Blocked unmocked business write ${method} ${url.pathname}`)
    }
    const path = url.pathname.match(/collections\/([^/]+)\/records(?:\/([^/?]+))?/)
    if (!path) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 200, message: 'Synthetic API healthy', data: {} }) })
      return
    }
    const collection = path[1]
    if (collection === 'purchase_audit_log') tracking.auditReads++
    let table = [...(records[collection] || [])]
    if (path[2]) {
      const row = table.find((item) => item.id === path[2])
      await route.fulfill({ status: row ? 200 : 404, contentType: 'application/json', body: JSON.stringify(row || { code: 404, message: 'Not found', data: {} }) })
      return
    }
    const filter = url.searchParams.get('filter') || ''
    const eq = /(?:^|\s|\()(bill|in_no|supplier|rate_line)\s*=\s*"([^"]+)"/.exec(filter)
    if (eq) table = table.filter((row) => row[eq[1]] === eq[2])
    const sort = url.searchParams.get('sort')
    if (sort) {
      const fields = sort.split(',')
      table.sort((a, b) => {
        for (const field of fields) {
          const desc = field.startsWith('-')
          const key = desc ? field.slice(1) : field
          const cmp = String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
          if (cmp) return desc ? -cmp : cmp
        }
        return 0
      })
    }
    const totalItems = table.length
    const perPage = Number(url.searchParams.get('perPage') || 500)
    const page = Number(url.searchParams.get('page') || 1)
    const items = table.slice((page - 1) * perPage, page * perPage)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ page, perPage, totalPages: Math.max(1, Math.ceil(totalItems / perPage)), totalItems, items }) })
  })
}

async function open(page, path) {
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.innerText.includes('Kapil'))
}

async function checkWidth(page, label, width) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
  assert.ok(dimensions.document <= dimensions.viewport + 1, `${label} overflow: ${JSON.stringify(dimensions)}`)
  results.push({ check: label, width, ...dimensions, passed: true })
}

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const records = fixture()
    const tracking = { batches: 0, sequence: 0, loseNextResponse: false, nonBatchWrites: 0, auditReads: 0 }
    await installMockApi(context, records, tracking)
    await context.addInitScript(() => {
      const encode = (value) => btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')
      const token = `${encode({ alg: 'HS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.test`
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token, model: { id: 'synthetic-user', email: 'audit@example.invalid', collectionName: 'users' } }))
      localStorage.setItem('kapil_billing_auth_session_v1', JSON.stringify({ expiresAt: Date.now() + 3600000 }))
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => issues.push({ width, type: 'pageerror', message: error.message }))

    await open(page, '/new-purchase-bill')
    await page.locator('#bill-supplier').fill('Audit Due')
    await page.getByRole('option', { name: 'Audit Due Metals', exact: true }).click()
    await page.getByRole('button', { name: '+ Brass', exact: true }).click()
    const mobile = width < 768
    await page.locator(mobile ? '[id^="bardan-mob-"]' : '[id^="bardan-"]:not([id^="bardan-mob-"])').first().fill('12')
    await page.locator(mobile ? '[id^="weight-mob-"]' : '[id^="weight-"]:not([id^="weight-mob-"])').first().fill('100')
    await page.locator(mobile ? '[id^="rate-mob-"]' : '[id^="rate-"]:not([id^="rate-mob-"])').first().fill('800')
    await page.getByLabel('Amount paid (₹)').fill('20000')
    const preview = page.getByRole('complementary', { name: 'Live bill preview' })
    await preview.getByText('₹60,000.00', { exact: true }).first().waitFor()
    await checkWidth(page, 'new bill filled preview', width)
    await page.screenshot({ path: join(screenshots, `new-bill-${width}.png`), fullPage: true })
    const billCount = records.purchase_bills.length
    await page.getByRole('button', { name: /Save Bill/ }).click()
    await page.waitForURL('**/purchase-bills/IN-*')
    await page.getByText('12 bags', { exact: true }).waitFor()
    assert.equal(records.purchase_bills.length, billCount + 1)
    assert.equal(records.supplier_payments.length, 1)
    const newBill = records.purchase_bills.at(-1)
    assert.ok(newBill.private_note.includes('purchase_line_memos_v1'))
    await checkWidth(page, 'saved chitty', width)
    results.push({ check: 'saved bill/payment/memo round trip', width, passed: true })

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.locator(mobile ? '[id^="bardan-mob-"]' : '[id^="bardan-"]:not([id^="bardan-mob-"])').first().waitFor()
    assert.equal(await page.locator(mobile ? '[id^="bardan-mob-"]' : '[id^="bardan-"]:not([id^="bardan-mob-"])').first().inputValue(), '12')
    await page.locator(mobile ? '[id^="bardan-mob-"]' : '[id^="bardan-"]:not([id^="bardan-mob-"])').first().fill('14')
    await page.getByRole('button', { name: /Update Bill/ }).click()
    await page.waitForURL('**/purchase-bills/IN-*')
    await page.getByText('14 bags', { exact: true }).waitFor()
    results.push({ check: 'edited receipt memo persisted', width, passed: true })

    await open(page, '/new-supplier-payment?supplierId=supplier0000002')
    await page.getByPlaceholder('350, 3.5l, 50k').fill('1000')
    assert.equal(await page.getByRole('button', { name: 'BANK', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'other', exact: true }).waitFor()
    const paymentCount = records.supplier_payments.length
    const batchesBefore = tracking.batches
    tracking.loseNextResponse = true
    await page.getByRole('button', { name: /Save Payment/ }).click()
    await page.getByText('Latest payment confirmed & recorded', { exact: true }).waitFor()
    assert.equal(records.supplier_payments.length, paymentCount + 1)
    assert.equal(tracking.batches, batchesBefore + 1)
    await checkWidth(page, 'payment lost-response confirmation', width)
    results.push({ check: 'lost batch response reconciled without duplicate', width, passed: true })
    await page.screenshot({ path: join(screenshots, `payment-${width}.png`), fullPage: true })

    for (const path of ['/purchase-bills', '/suppliers', '/supplier-ledger/supplier0000002', '/purchase-logs', '/print-purchase-bills', '/purchase-dashboard', '/new-bill']) {
      await open(page, path)
      await page.waitForFunction(() => !document.body.innerText.includes('Loading chitty…'))
      await checkWidth(page, path, width)
    }
    assert.equal(tracking.nonBatchWrites, 0)
    results.push({ check: 'all writes intercepted by synthetic API', width, liveWrites: 0, passed: true })
    await context.close()
  }
  assert.deepEqual(issues, [])
} finally {
  await browser.close()
  const report = { target: base, date: new Date().toISOString(), results, issues, liveDatabaseWrites: 0 }
  await writeFile(join(output, 'browser-verification-2026-11-07.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
