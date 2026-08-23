import { readFileSync } from 'node:fs'
import PocketBase from 'pocketbase'

/** Shared setup for smoke scripts: parse .env.smoke, authenticate, and seed browser storage. */
export function loadSmokeEnv() {
  const raw = readFileSync(new URL('../.env.smoke', import.meta.url), 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) env[match[1]] = match[2]
  }
  if (!env.SMOKE_EMAIL || !env.SMOKE_PASSWORD) throw new Error('.env.smoke must define SMOKE_EMAIL and SMOKE_PASSWORD')
  return env
}

export async function createAuthenticatedPage(browser, base) {
  const env = loadSmokeEnv()
  // Authenticate straight against the local PocketBase instance.
  const pb = new PocketBase('http://127.0.0.1:8090')
  await pb.collection('users').authWithPassword(env.SMOKE_EMAIL, env.SMOKE_PASSWORD)
  const token = pb.authStore.token
  const record = pb.authStore.record
  await pb.authStore.clear()

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  await context.addInitScript(([authToken, authRecord]) => {
    window.localStorage.setItem('pocketbase_auth', JSON.stringify({ token: authToken, record: authRecord }))
    window.localStorage.setItem('kapil_billing_auth_session_v1', JSON.stringify({ expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000 }))
  }, [token, JSON.parse(JSON.stringify(record))])

  const page = await context.newPage()
  return { page, context }
}

export function attachErrorCollectors(page, problems) {
  page.on('pageerror', (error) => {
    problems.push({ type: 'pageerror', message: String(error?.stack ?? error).slice(0, 900) })
  })
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text()
      if (!text.includes('favicon') && !text.includes('Failed to load resource')) {
        problems.push({ type: 'console.error', message: text.slice(0, 400) })
      }
    }
  })
}

export async function ensureLoggedIn(page) {
  await page.waitForTimeout(800)
  const gate = page.getByText('Enter password to continue')
  if (await gate.count()) throw new Error('Login gate visible — smoke authentication failed')
}
