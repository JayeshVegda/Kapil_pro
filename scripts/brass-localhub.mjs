#!/usr/bin/env node
// Helper: render the brassb2b Telegram channel through a LOCAL RSSHub
// (in-process MTProto user session) and print the feed as RSS XML.
// Kept as a separate process because importing the rsshub package mutates
// global fetch and breaks subsequent PocketBase SDK calls in the importer.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as RSSHub from 'rsshub'

const repoRoot = new URL('..', import.meta.url)
const loadEnvFile = (url) => {
  if (fs.existsSync(url)) {
    for (const line of fs.readFileSync(url, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index < 0) continue
      const key = trimmed.slice(0, index).trim()
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!process.env[key]) process.env[key] = value
    }
  }
}
loadEnvFile(fileURLToPath(new URL('.env', repoRoot)))

const CHANNEL = process.env.BRASS_CHANNEL || 'brassb2b'
await RSSHub.init({
  CACHE_TYPE: 'memory',
  TELEGRAM_API_ID: process.env.TELEGRAM_API_ID,
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH,
  TELEGRAM_SESSION: process.env.TELEGRAM_SESSION,
})

const data = await RSSHub.request(`/telegram/channel/${CHANNEL}?limit=20&showLinkPreview=0`)
const items = data?.item || data?.items || []
if (!Array.isArray(items) || !items.length) {
  console.error('local RSSHub returned no items')
  process.exit(1)
}

const escapeXml = (text) => String(text ?? '').replace(/[<&>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const buildItem = (it) => {
  const description = it.description ? `<![CDATA[${String(it.description).replace(/\]\]>/g, ']]&gt;')}]]>` : ''
  const link = escapeXml(it.link || `https://t.me/${CHANNEL}`)
  const guid = escapeXml(it.guid || it.link || `localhub-${it.pubDate || ''}`)
  const pubDate = it.pubDate ? escapeXml(it.pubDate) : ''
  return `<item><title>${escapeXml(it.title || '')}</title><link>${link}</link><guid>${guid}</guid><pubDate>${pubDate}</pubDate><description>${description}</description></item>`
}
process.stdout.write(
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${CHANNEL} (local RSSHub)</title><link>https://t.me/${CHANNEL}</link>${items.map(buildItem).join('')}</channel></rss>`,
)
process.exit(0)
