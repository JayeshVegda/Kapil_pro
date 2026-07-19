import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import PocketBase from 'pocketbase'

import {
  backupObjectPath,
  isPocketBaseArchiveEntries,
  parseResticB2Bucket,
  shouldRejectBackupSize,
  telegramCaption,
} from './lib/pb-backup.mjs'

const CLOUD_URL = requiredUrl('PB_CLOUD_URL', 'https://7ddi60xr8g6ktz3.ba7w.pocketbasecloud.com')
const LOCAL_URL = requiredUrl('PB_LOCAL_URL', 'http://127.0.0.1:8090')
const ADMIN_EMAIL = required('PB_ADMIN_EMAIL')
const ADMIN_PASSWORD = required('PB_ADMIN_PASSWORD')
const STATE_FILE =
  process.env.BACKUP_STATE_FILE ||
  path.resolve(process.cwd(), 'replica_state', 'backup-status.json')
const LOCK_FILE =
  process.env.BACKUP_LOCK_FILE ||
  path.resolve(process.cwd(), 'replica_state', 'backup.lock')
const MAINTENANCE_FILE =
  process.env.REPLICA_MAINTENANCE_FILE ||
  path.resolve(process.cwd(), 'replica_state', 'maintenance')
const CYCLE_FILE =
  process.env.REPLICA_CYCLE_FILE ||
  path.resolve(process.cwd(), 'replica_state', 'cycle')
const SEND_TELEGRAM = process.argv.includes('--telegram')
const SKIP_B2 = process.argv.includes('--skip-b2')
const SKIP_LOCAL_RESTORE = process.argv.includes('--skip-local-restore')

let lockHandle
let temporaryDirectory

async function main() {
  await acquireLock()
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'kapil-pb-backup-'))

  const cloud = await authenticatedPocketBase(CLOUD_URL)
  const createdAt = new Date()
  const name = backupName(createdAt)
  const archivePath = path.join(temporaryDirectory, name)
  const previousStatus = await readJSON(STATE_FILE)

  console.log(JSON.stringify({ event: 'backup_create_started', name }))
  await cloud.backups.create(name)
  await downloadBackup(cloud, name, archivePath)

  const validation = await validateArchive(archivePath)
  if (shouldRejectBackupSize(validation.sizeBytes, Number(previousStatus?.sizeBytes || 0))) {
    throw new Error(
      `Backup size rejected: current=${validation.sizeBytes}, previous=${previousStatus?.sizeBytes || 0}`,
    )
  }

  const recordTotal = await countApplicationRecords(cloud)
  const objectPath = backupObjectPath(name)

  if (!SKIP_B2) {
    await uploadToBackblaze(archivePath, objectPath)
  }

  if (!SKIP_LOCAL_RESTORE) {
    await fs.writeFile(MAINTENANCE_FILE, `${new Date().toISOString()}\n`, { mode: 0o644 })
    try {
      await waitForFileAbsent(CYCLE_FILE, 120_000)
      await restoreLocalStandby(archivePath, name)
    } finally {
      await fs.unlink(MAINTENANCE_FILE).catch(() => undefined)
    }
  }

  if (SEND_TELEGRAM) {
    await sendEncryptedTelegramBackup(archivePath, {
      createdAt: createdAt.toISOString(),
      sizeBytes: validation.sizeBytes,
      sha256: validation.sha256,
      recordTotal,
    })
  }

  await pruneJobBackups(cloud, 2)

  const status = {
    ok: true,
    completedAt: new Date().toISOString(),
    name,
    objectPath: SKIP_B2 ? null : objectPath,
    telegramSent: SEND_TELEGRAM,
    localRestored: !SKIP_LOCAL_RESTORE,
    recordTotal,
    ...validation,
  }
  await writeJSONAtomic(STATE_FILE, status)
  console.log(JSON.stringify({ event: 'backup_complete', ...status }))
}

async function authenticatedPocketBase(baseURL) {
  const pb = new PocketBase(baseURL)
  pb.autoCancellation(false)
  await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
  return pb
}

async function downloadBackup(pb, name, destination) {
  const token = await pb.files.getToken()
  const response = await fetch(pb.backups.getDownloadURL(token, name))
  if (!response.ok) throw new Error(`Backup download failed: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  await fs.writeFile(destination, bytes, { mode: 0o600 })
}

async function validateArchive(archivePath) {
  await runCommand('unzip', ['-tqq', archivePath])
  const listing = await runCommand('unzip', ['-Z1', archivePath], { capture: true })
  const entries = listing.trim().split('\n').filter(Boolean)
  if (!isPocketBaseArchiveEntries(entries)) {
    throw new Error('Backup archive is missing PocketBase database files')
  }

  const bytes = await fs.readFile(archivePath)
  return {
    sizeBytes: bytes.byteLength,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }
}

async function countApplicationRecords(pb) {
  const collections = (await pb.collections.getFullList({ sort: 'name' })).filter(
    (collection) => !collection.system,
  )
  let total = 0
  for (const collection of collections) {
    const page = await pb.collection(collection.name).getList(1, 1, {
      skipTotal: false,
      requestKey: null,
    })
    total += Number(page.totalItems || 0)
  }
  return total
}

async function uploadToBackblaze(archivePath, objectPath) {
  const account = required('B2_ACCOUNT_ID')
  const key = required('B2_ACCOUNT_KEY')
  const bucket = parseResticB2Bucket(required('RESTIC_REPOSITORY'))
  const encryptionPassword =
    process.env.KAPIL_BACKUP_ENCRYPTION_PASSWORD || required('RESTIC_PASSWORD')
  const obscuredPassword = (
    await runCommand('rclone', ['obscure', encryptionPassword], { capture: true })
  ).trim()

  const rcloneEnvironment = {
    ...process.env,
    RCLONE_CONFIG_KAPILB2_TYPE: 'b2',
    RCLONE_CONFIG_KAPILB2_ACCOUNT: account,
    RCLONE_CONFIG_KAPILB2_KEY: key,
    RCLONE_CONFIG_KAPILCRYPT_TYPE: 'crypt',
    RCLONE_CONFIG_KAPILCRYPT_REMOTE: `kapilb2:${bucket}/kapil-pocketbase`,
    RCLONE_CONFIG_KAPILCRYPT_PASSWORD: obscuredPassword,
    RCLONE_CONFIG_KAPILCRYPT_FILENAME_ENCRYPTION: 'standard',
    RCLONE_CONFIG_KAPILCRYPT_DIRECTORY_NAME_ENCRYPTION: 'true',
  }

  await runCommand(
    'rclone',
    ['copyto', '--checksum', '--retries', '3', archivePath, `kapilcrypt:${objectPath}`],
    { env: rcloneEnvironment },
  )
  const listed = await runCommand('rclone', ['lsjson', '--stat', `kapilcrypt:${objectPath}`], {
    capture: true,
    env: rcloneEnvironment,
  })
  const metadata = JSON.parse(listed)
  if (Number(metadata.Size || 0) <= 0) throw new Error('Backblaze verification returned an empty object')
}

async function restoreLocalStandby(archivePath, name) {
  let local = await authenticatedPocketBaseWithRetry(LOCAL_URL, 12, 2_500)
  const bytes = await fs.readFile(archivePath)
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'application/zip' }), name)
  await local.backups.upload(form)
  await local.backups.restore(name)

  local = await authenticatedPocketBaseWithRetry(LOCAL_URL, 30, 2_000)
  const backups = await local.backups.getFullList()
  if (backups.some((backup) => backup.key === name)) {
    await local.backups.delete(name)
  }
}

async function authenticatedPocketBaseWithRetry(baseURL, attempts, delayMs) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await authenticatedPocketBase(baseURL)
    } catch (error) {
      lastError = error
      if (attempt < attempts) await wait(delayMs)
    }
  }
  throw lastError
}

async function sendEncryptedTelegramBackup(archivePath, details) {
  const token = required('KAPIL_BACKUP_TELEGRAM_BOT_TOKEN')
  const chatId = required('KAPIL_BACKUP_TELEGRAM_CHAT_ID')
  const encryptionPassword =
    process.env.KAPIL_BACKUP_ENCRYPTION_PASSWORD || required('RESTIC_PASSWORD')
  const encryptedPath = `${archivePath}.enc`

  await runCommand(
    'openssl',
    [
      'enc',
      '-aes-256-cbc',
      '-salt',
      '-pbkdf2',
      '-iter',
      '200000',
      '-pass',
      'env:KAPIL_TELEGRAM_BACKUP_PASSWORD',
      '-in',
      archivePath,
      '-out',
      encryptedPath,
    ],
    {
      env: {
        ...process.env,
        KAPIL_TELEGRAM_BACKUP_PASSWORD: encryptionPassword,
      },
    },
  )

  const encryptedBytes = await fs.readFile(encryptedPath)
  const form = new FormData()
  form.append('chat_id', chatId)
  form.append('caption', telegramCaption(details))
  form.append(
    'document',
    new Blob([encryptedBytes], { type: 'application/octet-stream' }),
    `${path.basename(archivePath)}.enc`,
  )
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Telegram backup upload failed: HTTP ${response.status} ${body.slice(0, 300)}`)
  }
}

async function pruneJobBackups(pb, keep) {
  const backups = (await pb.backups.getFullList())
    .filter((backup) => backup.key.startsWith('dr_kapil_'))
    .sort((left, right) => String(right.modified).localeCompare(String(left.modified)))
  for (const backup of backups.slice(keep)) {
    await pb.backups.delete(backup.key)
  }
}

async function alertFailure(error) {
  const token = process.env.KAPIL_BACKUP_TELEGRAM_BOT_TOKEN
  const chatId = process.env.KAPIL_BACKUP_TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  const text = [
    '🚨 Kapil PocketBase backup failed',
    '',
    `Time: ${new Date().toISOString()}`,
    `Error: ${String(error?.message || error).slice(0, 2500)}`,
  ].join('\n')
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => undefined)
}

async function acquireLock() {
  await fs.mkdir(path.dirname(LOCK_FILE), { recursive: true })
  try {
    lockHandle = await fs.open(LOCK_FILE, 'wx', 0o600)
    await lockHandle.writeFile(`${process.pid}\n`)
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Backup already running: ${LOCK_FILE}`)
    throw error
  }
}

async function releaseResources() {
  await lockHandle?.close().catch(() => undefined)
  if (lockHandle) await fs.unlink(LOCK_FILE).catch(() => undefined)
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function writeJSONAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 })
  await fs.rename(temporary, file)
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env || process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} failed with exit ${code}: ${stderr.trim()}`))
    })
  })
}

function backupName(date) {
  return `dr_kapil_${date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'z')
    .replace('T', 't')}.zip`
}

function required(name, fallback) {
  const value = process.env[name]?.trim() || fallback
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requiredUrl(name, fallback) {
  return required(name, fallback).replace(/\/+$/, '')
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForFileAbsent(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fs.access(file)
      await wait(1_000)
    } catch {
      return
    }
  }
  throw new Error(`Timed out waiting for replication cycle to finish: ${file}`)
}

try {
  await main()
} catch (error) {
  const status = {
    ok: false,
    completedAt: new Date().toISOString(),
    error: String(error?.message || error),
  }
  await writeJSONAtomic(STATE_FILE, status).catch(() => undefined)
  await alertFailure(error)
  console.error(JSON.stringify({ event: 'backup_failed', ...status }))
  process.exitCode = 1
} finally {
  await releaseResources()
}
