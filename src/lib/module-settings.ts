/**
 * Optional app modules the operator can switch off.
 *
 * Turning a module off hides its pages from navigation, the command bar, and
 * quick search, and removes its figures from the dashboard. Nothing is deleted —
 * the data stays put and reappears when the module is switched back on.
 */

export type ModuleSettings = {
  purchaseEnabled: boolean
  castingEnabled: boolean
}

export const MODULE_SETTINGS_STORAGE_KEY = 'kapil-module-settings-v1'
export const MODULE_SETTINGS_EVENT = 'kapil-module-settings-changed'

export const defaultModuleSettings: ModuleSettings = {
  purchaseEnabled: true,
  castingEnabled: true,
}

export function normalizeModuleSettings(input: unknown): ModuleSettings {
  const raw = input && typeof input === 'object' ? (input as Partial<ModuleSettings>) : {}
  return {
    purchaseEnabled: typeof raw.purchaseEnabled === 'boolean' ? raw.purchaseEnabled : defaultModuleSettings.purchaseEnabled,
    castingEnabled: typeof raw.castingEnabled === 'boolean' ? raw.castingEnabled : defaultModuleSettings.castingEnabled,
  }
}

export function getModuleSettings(): ModuleSettings {
  if (typeof window === 'undefined') return defaultModuleSettings
  try {
    const raw = window.localStorage.getItem(MODULE_SETTINGS_STORAGE_KEY)
    return normalizeModuleSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return defaultModuleSettings
  }
}

export function saveModuleSettings(settings: ModuleSettings) {
  if (typeof window === 'undefined') return
  const normalized = normalizeModuleSettings(settings)
  window.localStorage.setItem(MODULE_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent(MODULE_SETTINGS_EVENT, { detail: normalized }))
}

export function subscribeModuleSettings(listener: (settings: ModuleSettings) => void) {
  if (typeof window === 'undefined') return () => undefined
  const onCustomEvent = (event: Event) => listener(normalizeModuleSettings((event as CustomEvent).detail))
  const onStorage = (event: StorageEvent) => {
    if (event.key === MODULE_SETTINGS_STORAGE_KEY) listener(getModuleSettings())
  }
  window.addEventListener(MODULE_SETTINGS_EVENT, onCustomEvent)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(MODULE_SETTINGS_EVENT, onCustomEvent)
    window.removeEventListener('storage', onStorage)
  }
}

/** True when a path belongs to a module that is currently switched off. */
export function isPathHiddenByModules(path: string, settings: ModuleSettings) {
  if (!settings.purchaseEnabled && (
    path === '/purchase-dashboard' || path === '/purchase-bills' || path.startsWith('/purchase-bills/') ||
    path === '/purchase-logs' || path === '/purchase-items' || path === '/supplier-payments' ||
    path === '/new-purchase-bill' || path === '/new-supplier-payment' ||
    path === '/suppliers' || path.startsWith('/supplier-ledger/') || path === '/reports/purchase'
  )) return true
  if (!settings.castingEnabled && (path === '/casting' || path.startsWith('/casting/'))) return true
  if (!settings.castingEnabled && path === '/reports/casting') return true
  return false
}
