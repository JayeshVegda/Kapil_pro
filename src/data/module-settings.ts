import { pb } from './pocketbase'
import { normalizeModuleSettings, type ModuleSettings } from '@/lib/module-settings'

export const MODULE_SETTINGS_QUERY_KEY = ['app-module-settings'] as const
export const MODULE_SETTINGS_RECORD_ID = 'globalsettings1'
let cached: { value: ModuleSettings; expires: number } | undefined

export async function loadSharedModuleSettings(): Promise<ModuleSettings> {
  const row = await pb.collection('app_settings').getOne(MODULE_SETTINGS_RECORD_ID)
  const value = normalizeModuleSettings({ purchaseEnabled: row.purchase_enabled, castingEnabled: row.casting_enabled })
  cached = { value, expires: Date.now() + 5 * 60_000 }
  return value
}

/** Shared route guard cache. A failed read allows access and leaves an error for the UI to show. */
export async function loadModuleSettingsForGuard(): Promise<ModuleSettings> {
  if (cached && cached.expires > Date.now()) return cached.value
  return loadSharedModuleSettings()
}

export async function updateSharedModuleSettings(settings: ModuleSettings): Promise<ModuleSettings> {
  const row = await pb.collection('app_settings').update(MODULE_SETTINGS_RECORD_ID, {
    purchase_enabled: settings.purchaseEnabled,
    casting_enabled: settings.castingEnabled,
  })
  const value = normalizeModuleSettings({ purchaseEnabled: row.purchase_enabled, castingEnabled: row.casting_enabled })
  cached = { value, expires: Date.now() + 5 * 60_000 }
  return value
}
