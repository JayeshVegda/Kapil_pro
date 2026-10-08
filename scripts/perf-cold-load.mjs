import { chromium } from 'playwright'
import { loadSmokeEnv } from './smoke-auth.mjs'
import PocketBase from 'pocketbase'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4174'

// Authenticate up front so the measured run is a logged-in cold start.
const env = loadSmokeEnv()
const pb = new PocketBase('http://127.0.0.1:8090')
await pb.collection('users').authWithPassword(env.SMOKE_EMAIL, env.SMOKE_PASSWORD)
const token = pb.authStore.token
const record = JSON.parse(JSON.stringify(pb.authStore.record))
await pb.authStore.clear()

const profileDir = mkdtempSync(join(tmpdir(), 'kapil-perf-'))

async function measure(label) {
  // Persistent profile = same browser, restarted. IndexedDB and HTTP cache
  // survive between runs, exactly like the user reopening their browser.
  const context = await chromium.launchPersistentContext(profileDir, { viewport: { width: 1600, height: 1000 } })
  const page = context.pages()[0] ?? await context.newPage()
  await context.addInitScript(([authToken, authRecord]) => {
    window.localStorage.setItem('pocketbase_auth', JSON.stringify({ token: authToken, record: authRecord }))
    window.localStorage.setItem('kapil_billing_auth_session_v1', JSON.stringify({ expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000 }))
  }, [token, record])
  const start = Date.now()
  await page.goto(`${BASE}/`, { waitUntil: 'commit' })
  const committed = Date.now() - start
  await page.getByText('Sold This Month').first().waitFor({ timeout: 60_000 })
  const dashboardVisible = Date.now() - start
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  const settled = Date.now() - start
  console.log(`${label.padEnd(28)} html:${String(committed).padStart(4)}ms  dashboard-visible:${String(dashboardVisible).padStart(5)}ms  settled:${String(settled).padStart(5)}ms`)
  await context.close()
}

console.log(`Cold-load timings against ${BASE}`)
try {
  await measure('RUN 1 (cold, empty profile)')
  await measure('RUN 2 (browser restart, cache warm)')
  await measure('RUN 3 (restart again)')
} finally {
  rmSync(profileDir, { recursive: true, force: true })
}
