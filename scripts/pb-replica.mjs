import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import PocketBase from 'pocketbase'

import { runReplicationCycle } from './lib/pb-replication.mjs'

const SOURCE_PB_URL = requiredUrl('SOURCE_PB_URL')
const TARGET_PB_URL = requiredUrl('TARGET_PB_URL')
const PB_ADMIN_EMAIL = required('PB_ADMIN_EMAIL')
const PB_ADMIN_PASSWORD = required('PB_ADMIN_PASSWORD')
const STATE_FILE = process.env.REPLICA_STATE_FILE || '/state/status.json'
const MAINTENANCE_FILE = process.env.REPLICA_MAINTENANCE_FILE || '/state/maintenance'
const CYCLE_FILE = process.env.REPLICA_CYCLE_FILE || '/state/cycle'
const INTERVAL_MS = positiveNumber('REPLICA_INTERVAL_SECONDS', 60) * 1_000
const MAX_DELETES = positiveNumber('REPLICA_MAX_DELETES', 50)
const MAX_DELETE_RATIO = positiveNumber('REPLICA_MAX_DELETE_RATIO_PERCENT', 20) / 100
const RUN_ONCE = process.argv.includes('--once')

let stopping = false
let lastAlertSignature = ''
let lastAlertAt = 0

process.on('SIGTERM', () => {
  stopping = true
})
process.on('SIGINT', () => {
  stopping = true
})

class PocketBaseAdapter {
  constructor(baseURL) {
    this.pb = new PocketBase(baseURL)
    this.pb.autoCancellation(false)
  }

  async authenticate() {
    await this.pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
  }

  async listCollections() {
    return this.pb.collections.getFullList({ sort: 'name' })
  }

  async listRecords(collection) {
    return this.pb.collection(collection).getFullList({ batch: 500, sort: 'id' })
  }

  async createRecord(collection, payload) {
    return this.pb.collection(collection).create(payload)
  }

  async updateRecord(collection, id, payload) {
    return this.pb.collection(collection).update(id, payload)
  }

  async deleteRecord(collection, id) {
    return this.pb.collection(collection).delete(id)
  }
}

async function replicateOnce() {
  const source = new PocketBaseAdapter(SOURCE_PB_URL)
  const target = new PocketBaseAdapter(TARGET_PB_URL)
  await Promise.all([source.authenticate(), target.authenticate()])

  const result = await runReplicationCycle(source, target, {
    maxDeletes: MAX_DELETES,
    maxDeleteRatio: MAX_DELETE_RATIO,
  })
  await writeStatus(result)
  console.log(
    JSON.stringify({
      event: 'replication_complete',
      completedAt: result.completedAt,
      records: result.sourceRecordTotal,
      collections: result.sourceCollections,
      mismatches: result.mismatches,
      ...result.mutations,
    }),
  )
}

async function writeStatus(status) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  const temporary = `${STATE_FILE}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o644 })
  await fs.rename(temporary, STATE_FILE)
}

async function alertFailure(error) {
  const token = process.env.BRASS_TELEGRAM_BOT_TOKEN
  const chatId = process.env.BRASS_TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  const signature = String(error?.message || error)
  const now = Date.now()
  if (signature === lastAlertSignature && now - lastAlertAt < 3_600_000) return

  lastAlertSignature = signature
  lastAlertAt = now
  const text = [
    '🚨 Kapil PocketBase replication failed',
    '',
    `Time: ${new Date().toISOString()}`,
    `Error: ${signature.slice(0, 2500)}`,
  ].join('\n')

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => undefined)
}

async function main() {
  do {
    const cycleStartedAt = Date.now()
    if (await fileExists(MAINTENANCE_FILE)) {
      console.log(JSON.stringify({ event: 'replication_paused_for_snapshot' }))
      if (RUN_ONCE || stopping) break
      await wait(INTERVAL_MS)
      continue
    }
    await fs.writeFile(CYCLE_FILE, `${new Date().toISOString()}\n`, { mode: 0o644 })
    try {
      try {
        await replicateOnce()
      } catch (error) {
        const status = {
          ok: false,
          startedAt: new Date(cycleStartedAt).toISOString(),
          completedAt: new Date().toISOString(),
          mismatches: 1,
          error: String(error?.message || error),
        }
        await writeStatus(status).catch(() => undefined)
        console.error(JSON.stringify({ event: 'replication_failed', ...status }))
        await alertFailure(error)
        if (RUN_ONCE) throw error
      }
    } finally {
      await fs.unlink(CYCLE_FILE).catch(() => undefined)
    }

    if (RUN_ONCE || stopping) break
    const elapsed = Date.now() - cycleStartedAt
    await wait(Math.max(1_000, INTERVAL_MS - elapsed))
  } while (!stopping)
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requiredUrl(name) {
  return required(name).replace(/\/+$/, '')
}

function positiveNumber(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`)
  return value
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function fileExists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

await main()
