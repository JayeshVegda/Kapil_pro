import { chromium } from 'playwright'
import { attachErrorCollectors, createAuthenticatedPage, ensureLoggedIn } from './smoke-auth.mjs'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5199'
const ROUTES = [
  '/',
  '/new-bill',
  '/new-payment',
  '/transactions',
  '/customers',
  '/items',
  '/ledger',
  '/monthly-sales-calendar',
  '/monthly-report',
  '/company-report',
  '/export-reports',
  '/backup',
  '/data-health',
  '/settings',
  '/control-room',
]

const browser = await chromium.launch()
const { page, context } = await createAuthenticatedPage(browser, BASE)
const problems = []
attachErrorCollectors(page, problems)

for (const route of ROUTES) {
  const before = problems.length
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30_000 })
    await ensureLoggedIn(page)
    await page.waitForTimeout(500)
    const body = (await page.locator('body').innerText()).slice(0, 4000)
    if (body.trim().length < 40) throw new Error('page rendered almost no content')
  } catch (error) {
    problems.push({ type: 'navigation', route, message: String(error).slice(0, 300) })
    continue
  }
  const routeErrors = problems.slice(before)
  const status = routeErrors.length === 0 ? 'OK' : `ERRORS(${routeErrors.length})`
  console.log(`${status.padEnd(14)} ${route}`)
  for (const entry of routeErrors) console.log(`   -> [${entry.type}] ${entry.message.split('\n')[0]}`)
}

await context.close()
await browser.close()

if (problems.length > 0) {
  console.log(`\nSMOKE FAILED: ${problems.length} problem(s)`)
  process.exit(1)
}
console.log('\nSMOKE PASSED: all routes clean')
