#!/usr/bin/env node
// Helper: render the brassb2b Telegram channel as RSS XML.
// Uses direct fetch of the public Telegram web preview (https://t.me/s/<channel>)
// via curl.exe (robust IPv6/Schannel on Windows) or built-in fetch.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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
const targetUrl = `https://t.me/s/${CHANNEL}`

function fetchChannelHtml() {
  // Strategy 1: curl.exe (handles Windows TLS & IPv6 where Telegram IPv4 is throttled)
  try {
    const stdout = execFileSync('curl.exe', ['-s', '-m', '15', targetUrl], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (stdout && stdout.includes('tgme_widget_message_text')) {
      return stdout
    }
  } catch (err) {
    // curl failed, try fallback
  }

  return null
}

const html = fetchChannelHtml()
if (!html) {
  console.error('local RSSHub: failed to fetch Telegram channel HTML')
  process.exit(1)
}

const escapeXml = (text) => String(text ?? '').replace(/[<&>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const messageRegex = /<div class="tgme_widget_message_wrap[\s\S]*?<div class="tgme_widget_message_text js-message_text[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<a class="tgme_widget_message_date" href="([^"]+)"[\s\S]*?<time datetime="([^"]+)"/gi

const items = []
let match
while ((match = messageRegex.exec(html)) !== null) {
  const rawContent = match[1]
  const link = match[2]
  const pubDate = match[3]
  if (/BrassB2B\s+Rate\s+Bulletin/i.test(rawContent)) {
    const titleMatch = rawContent.match(/Date\s*:\s*([^<\n]+)/i)
    const title = titleMatch ? `BrassB2B Rate Bulletin - ${titleMatch[1].trim()}` : 'BrassB2B Rate Bulletin'
    const descCdata = `<![CDATA[${rawContent.replace(/\]\]>/g, ']]&gt;')}]]>`
    items.push(
      `<item><title>${escapeXml(title)}</title><link>${escapeXml(link)}</link><guid>${escapeXml(link)}</guid><pubDate>${escapeXml(pubDate)}</pubDate><description>${descCdata}</description></item>`
    )
  }
}

if (!items.length) {
  console.error('local RSSHub: no rate bulletins found in channel HTML')
  process.exit(1)
}

const rssXml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(CHANNEL)} (local Telegram)</title><link>${escapeXml(targetUrl)}</link><description>Jamnagar Brass Scrap Reference Rates</description>${items.join('')}</channel></rss>`

process.stdout.write(rssXml)
process.exit(0)
