import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(path: string) {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const raw = trimmed.slice(eq + 1).trim()
    if (!key || process.env[key] != null) continue
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2')
  }
}

loadEnvFile(resolve(process.cwd(), '.env'))

function required(name: string, fallbackName?: string) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : '')
  if (!value) throw new Error(`Missing ${name}${fallbackName ? ` or ${fallbackName}` : ''}`)
  return value
}

function optional(name: string, fallback = '') {
  return process.env[name] || fallback
}

const allowedUserIds = new Set(
  optional('KAPIL_BOT_ALLOWED_USER_IDS')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0),
)
const allowAllUsers = optional('KAPIL_BOT_ALLOW_ALL_USERS', 'false').toLowerCase() === 'true'

if (allowedUserIds.size === 0 && !allowAllUsers) {
  throw new Error('Missing KAPIL_BOT_ALLOWED_USER_IDS. Set KAPIL_BOT_ALLOW_ALL_USERS=true only for local testing.')
}

export const env = {
  telegramToken: required('KAPIL_BOT_TOKEN'),
  allowedUserIds,
  allowAllUsers,
  pocketBaseUrl: optional('PB_URL', 'http://127.0.0.1:8090').replace(/\/+$/, ''),
  pocketBaseEmail: required('PB_ADMIN_EMAIL', 'PB_SUPERUSER_EMAIL'),
  pocketBasePassword: required('PB_ADMIN_PASSWORD', 'PB_SUPERUSER_PASSWORD'),
  pollTimeoutSeconds: Number(optional('KAPIL_BOT_POLL_TIMEOUT_SECONDS', '25')),
}
