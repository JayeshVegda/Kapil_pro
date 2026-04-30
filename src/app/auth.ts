import { pb } from '@/data/pocketbase'

const AUTH_SESSION_KEY = 'kapil_billing_auth_session_v1'
const AUTH_TTL_MS = 90 * 24 * 60 * 60 * 1000

type StoredSession = {
  expiresAt: number
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (!Number.isFinite(parsed.expiresAt)) return null
    return parsed
  } catch {
    return null
  }
}

function writeStoredSession() {
  const payload: StoredSession = { expiresAt: Date.now() + AUTH_TTL_MS }
  window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(payload))
}

function clearStoredSession() {
  window.localStorage.removeItem(AUTH_SESSION_KEY)
}

export function getLoginEmail() {
  const configured = (import.meta.env.VITE_LOGIN_EMAIL ?? '').trim()
  if (!configured) {
    throw new Error('Login email is not configured. Set VITE_LOGIN_EMAIL.')
  }
  return configured
}

export function getLoginPassword() {
  const configured = (import.meta.env.VITE_LOGIN_PASSWORD ?? '').trim()
  if (!configured) {
    throw new Error('Login password is not configured. Set VITE_LOGIN_PASSWORD.')
  }
  return configured
}

export function hasValidAppSession() {
  const session = readStoredSession()
  if (!session || session.expiresAt <= Date.now()) return false
  return pb.authStore.isValid
}

export async function signInWithPassword(password: string) {
  const email = getLoginEmail()
  await pb.collection('users').authWithPassword(email, password)
  writeStoredSession()
}

export async function signInWithConfiguredPassword() {
  const password = getLoginPassword()
  return signInWithPassword(password)
}

export function signOutAndClearSession() {
  pb.authStore.clear()
  clearStoredSession()
}

export function clearIfExpiredSession() {
  const session = readStoredSession()
  if (!session || session.expiresAt > Date.now()) return
  signOutAndClearSession()
}
