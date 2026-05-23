#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import PocketBase from 'pocketbase'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'

loadEnvFile('.env')
loadEnvFile('.env.production')

const PB_URL_CANDIDATES = [process.env.PB_URL, process.env.POCKETBASE_URL, 'https://kapil.zayu.dev/pb'].filter(Boolean)
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || process.env.PB_SUPERUSER_EMAIL
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.PB_SUPERUSER_PASSWORD
const TELEGRAM_BOT_TOKEN = process.env.BRASS_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.BRASS_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID
const isDryRun = process.argv.includes('--dry-run')

main().catch((error) => {
  console.error('Brass weekly report failed:', error?.message || error)
  process.exit(1)
})

async function main() {
  const pb = await connectPocketBase()
  const rows = await pb.collection('brass_rates').getFullList({ sort: '-date', perPage: 400 })
  const recent = rows
    .filter((row) => Number(row.vilaity || 0) > 0)
    .slice(0, 14)
    .reverse()
  if (recent.length === 0) throw new Error('No brass_rates rows available for weekly report')

  const pdfPath = buildPdf(recent)
  if (isDryRun) {
    console.log(pdfPath)
    return
  }
  await sendTelegramDocument(pdfPath, `Weekly Brass Market Report (${formatDate(recent[0].date)} to ${formatDate(recent.at(-1)?.date)})`)
  console.log(`Sent weekly brass report: ${pdfPath}`)
}

function buildPdf(rows) {
  const latest = rows.at(-1)
  const first = rows[0]
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Weekly Brass Market Report', 40, 42)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`${formatDate(first.date)} to ${formatDate(latest.date)}`, 40, 60)

  const summary = [
    ['Vilaity', numberText(first.vilaity), numberText(latest.vilaity), deltaText(latest.vilaity, first.vilaity)],
    ['Honey Gulf', numberText(first.honey_gulf), numberText(latest.honey_gulf), deltaText(latest.honey_gulf, first.honey_gulf)],
    ['Honey Europe', numberText(first.honey_europe), numberText(latest.honey_europe), deltaText(latest.honey_europe, first.honey_europe)],
    ['LME 3M', numberText(first.lme_3m), numberText(latest.lme_3m), deltaText(latest.lme_3m, first.lme_3m)],
    ['USD/INR', numberText(first.usd_inr), numberText(latest.usd_inr), deltaText(latest.usd_inr, first.usd_inr)],
  ]
  autoTable(doc, {
    startY: 82,
    head: [['Metric', 'Start', 'Latest', 'Change']],
    body: summary,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [15, 23, 42] },
  })

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 18,
    head: [['Date', 'Vilaity', 'Honey Gulf', 'Honey Europe', 'Plant', 'Zn 99.95', 'Delhi H', 'Delhi L', 'MCX Cu', 'MCX Zn', 'LME 3M', 'USD/INR']],
    body: rows.map((row) => [
      formatDate(row.date),
      numberText(row.vilaity),
      numberText(row.honey_gulf),
      numberText(row.honey_europe),
      numberText(row.plant_pass),
      numberText(row.zinc_9995),
      numberText(row.delhi_honey),
      numberText(row.delhi_local),
      numberText(row.mcx_copper),
      numberText(row.mcx_zinc),
      numberText(row.lme_3m),
      numberText(row.usd_inr),
    ]),
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [4, 120, 87] },
  })

  const out = path.join(os.tmpdir(), `brass-weekly-report-${new Date().toISOString().slice(0, 10)}.pdf`)
  fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')))
  return out
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

async function sendTelegramDocument(filePath, caption) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) throw new Error('Telegram credentials are missing')
  const form = new FormData()
  form.set('chat_id', TELEGRAM_CHAT_ID)
  form.set('caption', caption)
  form.set('document', new Blob([fs.readFileSync(filePath)], { type: 'application/pdf' }), path.basename(filePath))
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`Telegram document send failed: HTTP ${res.status}`)
}

function formatDate(value) {
  return String(value || '').slice(0, 10)
}

function numberText(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n === 0) return '-'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function deltaText(current, previous) {
  const cur = Number(current || 0)
  const prev = Number(previous || 0)
  if (!cur || !prev) return '-'
  const diff = cur - prev
  return `${diff >= 0 ? '+' : ''}${Number.isInteger(diff) ? diff : diff.toFixed(2)}`
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, 'utf8')
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
