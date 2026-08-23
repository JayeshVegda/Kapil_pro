import { chromium } from 'playwright'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5199'
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
const page = await browser.newPage()
const problems = []

page.on('pageerror', (error) => {
  problems.push({ type: 'pageerror', message: String(error?.message ?? error).slice(0, 600) })
})
page.on('console', (message) => {
  if (message.type() === 'error') {
    const text = message.text().slice(0, 400)
    if (!text.includes('favicon') && !text.includes('Failed to load resource')) {
      problems.push({ type: 'console.error', message: text })
    }
  }
})

for (const route of ROUTES) {
  const before = problems.length
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(700)
  } catch (error) {
    problems.push({ type: 'navigation', route, message: String(error).slice(0, 300) })
    continue
  }
  const routeErrors = problems.slice(before)
  const status = routeErrors.length === 0 ? 'OK' : `ERRORS(${routeErrors.length})`
  console.log(`${status.padEnd(14)} ${route}`)
  for (const entry of routeErrors) console.log(`   -> [${entry.type}] ${entry.message.split('\n')[0]}`)
}

await browser.close()

if (problems.length > 0) {
  console.log(`\nSMOKE FAILED: ${problems.length} problem(s)`)
  process.exit(1)
}
console.log('\nSMOKE PASSED: all routes clean')
