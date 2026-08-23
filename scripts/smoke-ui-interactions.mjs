import { chromium } from 'playwright'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5199'
const problems = []

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (error) => problems.push({ where: 'pageerror', message: String(error?.stack ?? error).slice(0, 900) }))
page.on('console', (message) => {
  if (message.type() === 'error') {
    const text = message.text()
    if (!text.includes('favicon') && !text.includes('Failed to load resource')) {
      problems.push({ where: 'console', message: text.slice(0, 500) })
    }
  }
})

async function step(name, fn) {
  const before = problems.length
  try { await fn() } catch (error) { problems.push({ where: name, message: String(error).slice(0, 300) }) }
  const found = problems.slice(before)
  console.log(`${found.length === 0 ? 'OK'.padEnd(10) : `ERR(${found.length})`.padEnd(10)} ${name}`)
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })

// 1. Hard reload dashboard to catch load-order crashes
await step('dashboard-reload', () => page.reload({ waitUntil: 'networkidle' }))

// 2. Command palette: open + type a bill command + preview + submit
await step('ctrlk-open-type-bill', async () => {
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await page.keyboard.type('b Sambhu 2 spindle gst', { delay: 40 })
  await page.waitForTimeout(1200)
})
await step('ctrlk-submit-bill', async () => {
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
})

// 3. New bill interactions: pick item, qty
await step('newbill-interact', async () => {
  await page.waitForTimeout(500)
  const selects = page.locator('select')
  const count = await selects.count()
  if (count > 0) {
    const options = selects.nth(0).locator('option')
    const n = await options.count()
    if (n > 1) await selects.nth(0).selectOption({ index: 1 })
  }
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
})

// 4. Calendar: navigate months back/forward and click a day cell
await step('calendar-nav', async () => {
  await page.goto(`${BASE}/monthly-sales-calendar`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  for (let i = 0; i < 3; i += 1) {
    const prev = page.getByRole('button', { name: /prev/i }).first()
    if (await prev.count()) { await prev.click().catch(() => {}); await page.waitForTimeout(350) }
  }
  for (let i = 0; i < 3; i += 1) {
    const next = page.getByRole('button', { name: /next/i }).first()
    if (await next.count()) { await next.click().catch(() => {}); await page.waitForTimeout(350) }
  }
  const cells = page.locator('[class*="cursor-pointer"]')
  const cellCount = await cells.count()
  if (cellCount > 5) await cells.nth(5).click().catch(() => {})
  await page.waitForTimeout(700)
})

// 5. Settings toggles (casting switch, ctrl-k switch)
await step('settings-toggles', async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  const switches = page.locator('[role="switch"]')
  const total = await switches.count()
  for (let i = 0; i < total; i += 1) {
    await switches.nth(i).click().catch(() => {})
    await page.waitForTimeout(200)
  }
  // toggle casting back on if it was turned off
  if (total > 0) await switches.nth(0).click().catch(() => {})
})

// 6. Transactions + ledger + customers quick visits with reloads
for (const route of ['/transactions', '/ledger', '/customers', '/export-reports']) {
  await step(`visit-${route}`, async () => {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
  })
}

await browser.close()

if (problems.length > 0) {
  console.log(`\nINTERACTION SMOKE FAILED: ${problems.length} problem(s)\n`)
  for (const p of problems.slice(0, 12)) console.log(`[${p.where}] ${p.message.split('\n').slice(0, 4).join('\n')}\n`)
  process.exit(1)
}
console.log('\nINTERACTION SMOKE PASSED')
