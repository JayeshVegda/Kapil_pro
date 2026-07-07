import type { CommandKind } from '@/lib/commands'

export type AdminControlSettings = {
  controlKEnabled: boolean
  accessPhrase: string
  defaultBillItemName: string
  commandAliases: Record<CommandKind, string[]>
  pinnedRoutes: Array<{ label: string; path: string }>
}

export const ADMIN_CONTROL_STORAGE_KEY = 'kapil-admin-control-settings-v1'
export const ADMIN_CONTROL_UNLOCK_KEY = 'kapil-admin-control-unlocked-v1'
export const ADMIN_CONTROL_SETTINGS_EVENT = 'kapil-admin-control-settings-changed'

export const defaultAdminControlSettings: AdminControlSettings = {
  controlKEnabled: true,
  accessPhrase: 'kapil-admin',
  defaultBillItemName: 'Spindle (8.5GM)',
  commandAliases: {
    bill: ['b', 'bill', 'sale'],
    payment: ['p', 'pay', 'payment'],
    print: ['pr', 'print'],
  },
  pinnedRoutes: [
    { label: 'New Bill', path: '/new-bill' },
    { label: 'Casting', path: '/casting/new-session' },
    { label: 'Data Health', path: '/data-health' },
    { label: 'Backup', path: '/backup' },
  ],
}

function cleanAliases(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  const aliases = value.map((entry) => String(entry ?? '').trim().toLowerCase()).filter(Boolean)
  return aliases.length ? Array.from(new Set(aliases)) : fallback
}

function cleanPinnedRoutes(value: unknown) {
  if (!Array.isArray(value)) return defaultAdminControlSettings.pinnedRoutes
  const routes = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const row = entry as Record<string, unknown>
      const label = String(row.label ?? '').trim()
      const path = String(row.path ?? '').trim()
      if (!label || !path.startsWith('/')) return null
      return { label, path }
    })
    .filter((entry): entry is { label: string; path: string } => entry !== null)
  return routes.length ? routes : defaultAdminControlSettings.pinnedRoutes
}

export function normalizeAdminControlSettings(input: unknown): AdminControlSettings {
  const raw = input && typeof input === 'object' ? (input as Partial<AdminControlSettings>) : {}
  return {
    controlKEnabled: typeof raw.controlKEnabled === 'boolean' ? raw.controlKEnabled : defaultAdminControlSettings.controlKEnabled,
    accessPhrase: String(raw.accessPhrase ?? defaultAdminControlSettings.accessPhrase).trim() || defaultAdminControlSettings.accessPhrase,
    defaultBillItemName: String(raw.defaultBillItemName ?? defaultAdminControlSettings.defaultBillItemName).trim() || defaultAdminControlSettings.defaultBillItemName,
    commandAliases: {
      bill: cleanAliases(raw.commandAliases?.bill, defaultAdminControlSettings.commandAliases.bill),
      payment: cleanAliases(raw.commandAliases?.payment, defaultAdminControlSettings.commandAliases.payment),
      print: cleanAliases(raw.commandAliases?.print, defaultAdminControlSettings.commandAliases.print),
    },
    pinnedRoutes: cleanPinnedRoutes(raw.pinnedRoutes),
  }
}

export function getAdminControlSettings(): AdminControlSettings {
  if (typeof window === 'undefined') return defaultAdminControlSettings
  try {
    const raw = window.localStorage.getItem(ADMIN_CONTROL_STORAGE_KEY)
    return normalizeAdminControlSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return defaultAdminControlSettings
  }
}

export function saveAdminControlSettings(settings: AdminControlSettings) {
  if (typeof window === 'undefined') return
  const normalized = normalizeAdminControlSettings(settings)
  window.localStorage.setItem(ADMIN_CONTROL_STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent(ADMIN_CONTROL_SETTINGS_EVENT, { detail: normalized }))
}

export function resetAdminControlSettings() {
  saveAdminControlSettings(defaultAdminControlSettings)
}

export function subscribeAdminControlSettings(listener: (settings: AdminControlSettings) => void) {
  if (typeof window === 'undefined') return () => undefined
  const onCustomEvent = (event: Event) => {
    listener(normalizeAdminControlSettings((event as CustomEvent).detail))
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === ADMIN_CONTROL_STORAGE_KEY) listener(getAdminControlSettings())
  }
  window.addEventListener(ADMIN_CONTROL_SETTINGS_EVENT, onCustomEvent)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(ADMIN_CONTROL_SETTINGS_EVENT, onCustomEvent)
    window.removeEventListener('storage', onStorage)
  }
}

export function isAdminControlUnlocked() {
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(ADMIN_CONTROL_UNLOCK_KEY) === 'true'
}

export function unlockAdminControl() {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(ADMIN_CONTROL_UNLOCK_KEY, 'true')
}

export function lockAdminControl() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(ADMIN_CONTROL_UNLOCK_KEY)
}
