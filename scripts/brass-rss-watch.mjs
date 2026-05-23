#!/usr/bin/env node
import fs from 'node:fs'
import PocketBase from 'pocketbase'
import {
  formatRateAlertMessage,
  formatRateAnalyticsMessage,
  parseBrassBulletinsFromRss,
  parseBrassBulletinFromRss,
  toPocketBasePayload,
} from './brass-bulletin.mjs'
import { ensureBrassRatesCollection } from './brass-rates-schema.mjs'

loadEnvFile('.env')
loadEnvFile('.env.production')

const RSS_URL = process.env.BRASS_RSS_URL || process.env.VITE_MARKET_RATE_URL_PUBLIC || 'https://rss.zayu.dev/telegram/channel/brassb2b'
const PB_URL_CANDIDATES = [
  process.env.PB_URL,
  process.env.POCKETBASE_URL,
  'https://kapil.zayu.dev/pb',
].filter(Boolean)
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || process.env.PB_SUPERUSER_EMAIL
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.PB_SUPERUSER_PASSWORD
const TELEGRAM_BOT_TOKEN = process.env.BRASS_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.BRASS_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID

const args = new Set(process.argv.slice(2))
const isDryRun = args.has('--dry-run')
const isForce = args.has('--force')
const skipTelegram = args.has('--no-telegram')
const isBackfill = args.has('--backfill')

main().catch((error) => {
  console.error('Brass RSS watcher failed:', error?.message || error)
  process.exit(1)
})

async function main() {
  if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
    throw new Error('Missing PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD or PB_SUPERUSER_EMAIL/PB_SUPERUSER_PASSWORD')
  }

  const rssText = await fetchText(RSS_URL)
  const parsed = parseBrassBulletinFromRss(rssText)
  if (!parsed) {
    console.log('No BrassB2B bulletin found in RSS.')
    return
  }

  const pb = await connectPocketBase()
  await ensureBrassRatesCollection(pb)

  if (isBackfill) {
    const rows = parseBrassBulletinsFromRss(rssText)
    let created = 0
    let updated = 0
    for (const row of rows.reverse()) {
      const payload = toPocketBasePayload(row)
      const existing = await getRateByDate(pb, payload.date)
      if (isDryRun) {
        console.log(`${existing ? 'update' : 'create'} ${payload.date} vilaity=${payload.vilaity}`)
        continue
      }
      if (existing) {
        await pb.collection('brass_rates').update(existing.id, payload)
        updated += 1
      } else {
        await pb.collection('brass_rates').create(payload)
        created += 1
      }
    }
    console.log(`Backfill ${isDryRun ? 'dry-run' : 'complete'}: ${rows.length} rows (${created} created, ${updated} updated).`)
    return
  }

  const previous = await getPreviousRate(pb, parsed.date)
  const existing = await getRateByDate(pb, parsed.date)
  const payload = toPocketBasePayload(parsed)

  const shouldNotify = isForce || !existing || !existing.telegram_sent_at || hasFullBulletinUpgrade(existing, payload)

  if (isDryRun) {
    console.log(JSON.stringify({ parsed: payload, previous, existing: Boolean(existing), shouldNotify }, null, 2))
    console.log('\n--- Telegram message 1 ---\n')
    console.log(formatRateAlertMessage(payload, previous))
    console.log('\n--- Telegram message 2 ---\n')
    console.log(formatRateAnalyticsMessage(payload, await getRecentRates(pb)))
    return
  }

  const saved = existing
    ? await pb.collection('brass_rates').update(existing.id, payload)
    : await pb.collection('brass_rates').create(payload)

  if (shouldNotify && !skipTelegram) {
    await sendTelegram(formatRateAlertMessage(payload, previous))
    await sendTelegram(formatRateAnalyticsMessage(payload, await getRecentRates(pb)))
    await pb.collection('brass_rates').update(saved.id, { telegram_sent_at: new Date().toISOString() })
    console.log(`Stored and notified brass rate for ${payload.date}.`)
    return
  }

  console.log(`Stored brass rate for ${payload.date}; Telegram ${shouldNotify ? 'skipped' : 'already sent'}.`)
}

async function connectPocketBase() {
  let lastError = null
  for (const url of PB_URL_CANDIDATES) {
    const pb = new PocketBase(url)
    pb.autoCancellation(false)
    try {
      await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
      return pb
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('Unable to connect to PocketBase')
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
  })
  if (!res.ok) throw new Error(`RSS fetch failed: HTTP ${res.status}`)
  return res.text()
}

async function getRateByDate(pb, date) {
  const range = dayRange(date)
  return pb.collection('brass_rates')
    .getFirstListItem(`date >= "${range.start}" && date < "${range.end}"`)
    .catch(() => null)
}

async function getPreviousRate(pb, date) {
  const rows = await pb.collection('brass_rates').getList(1, 1, {
    filter: `date < "${String(date).slice(0, 10)}"`,
    sort: '-date',
  }).catch(() => ({ items: [] }))
  return normalizeRateRow(rows.items?.[0] || null)
}

async function getRecentRates(pb) {
  const rows = await pb.collection('brass_rates').getFullList({ sort: 'date' }).catch(() => [])
  return rows.map(normalizeRateRow).filter(Boolean)
}

function normalizeRateRow(row) {
  if (!row) return null
  return {
    id: row.id,
    date: String(row.date || '').slice(0, 10),
    vilaity: Number(row.vilaity || 0),
    honey_gulf: Number(row.honey_gulf || 0),
    honey_europe: Number(row.honey_europe || 0),
  }
}

function hasFullBulletinUpgrade(existing, payload) {
  return (
    Number(existing.honey_gulf || 0) !== Number(payload.honey_gulf || 0) ||
    Number(existing.honey_europe || 0) !== Number(payload.honey_europe || 0) ||
    Number(existing.plant_pass || 0) !== Number(payload.plant_pass || 0) ||
    Number(existing.lme_3m || 0) !== Number(payload.lme_3m || 0)
  )
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram credentials not set; message skipped.')
    return
  }
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Telegram send failed: HTTP ${res.status} ${body}`)
  }
}

function dayRange(date) {
  const day = String(date || '').slice(0, 10)
  const next = new Date(`${day}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return { start: day, end: next.toISOString().slice(0, 10) }
}

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 0) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}
