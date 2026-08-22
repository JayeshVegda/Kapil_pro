import { useEffect, useState } from 'react'
import { getModuleSettings, subscribeModuleSettings, type ModuleSettings } from '@/lib/module-settings'

/** Live module settings — updates immediately when toggled, including in another tab. */
export function useModuleSettings(): ModuleSettings {
  const [settings, setSettings] = useState<ModuleSettings>(getModuleSettings)
  useEffect(() => subscribeModuleSettings(setSettings), [])
  return settings
}
