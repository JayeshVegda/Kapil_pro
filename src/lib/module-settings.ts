/**
 * Optional app modules the operator can switch off.
 *
 * Turning a module off hides its pages from navigation, the command bar, and
 * quick search, and removes its figures from the dashboard. Nothing is deleted —
 * the data stays put and reappears when the module is switched back on.
 */

export type ModuleSettings = {
  castingEnabled: boolean
}

export const MODULE_SETTINGS_STORAGE_KEY = 'kapil-module-settings-v1'
export const MODULE_SETTINGS_EVENT = 'kapil-module-settings-changed'

export const defaultModuleSettings: ModuleSettings = {
  castingEnabled: true,
}

export function normalizeModuleSettings(input: unknown): ModuleSettings {
  const raw = input && typeof input === 'object' ? (input as Partial<ModuleSettings>) : {}
  return {
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
  if (!settings.castingEnabled && (path === '/casting' || path.startsWith('/casting/'))) return true
  return false
}
