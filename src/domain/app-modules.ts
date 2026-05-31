/** Top-level ERP-style modules (Selling / Scrap buying / Casting). */

export type AppModuleId = 'selling' | 'buying' | 'casting'

export const APP_MODULE_STORAGE_KEY = 'kapil-app-module'

export function appModuleFromPathname(pathname: string): AppModuleId {
  if (pathname.startsWith('/buying')) return 'buying'
  if (pathname.startsWith('/casting')) return 'casting'
  return 'selling'
}

export function persistAppModule(id: AppModuleId) {
  try {
    localStorage.setItem(APP_MODULE_STORAGE_KEY, id)
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function readStoredAppModule(): AppModuleId | null {
  try {
    const v = localStorage.getItem(APP_MODULE_STORAGE_KEY)
    if (v === 'selling' || v === 'buying' || v === 'casting') return v
  } catch {
    /* ignore */
  }
  return null
}
