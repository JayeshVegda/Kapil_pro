import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { loadSharedModuleSettings, MODULE_SETTINGS_QUERY_KEY } from '@/data/module-settings'
import { defaultModuleSettings, getModuleSettings, saveModuleSettings, subscribeModuleSettings, type ModuleSettings } from '@/lib/module-settings'

/** Live module settings — updates immediately when toggled, including in another tab. */
export function useModuleSettings(): ModuleSettings {
  const [settings, setSettings] = useState<ModuleSettings>(getModuleSettings)
  useEffect(() => subscribeModuleSettings(setSettings), [])
  const query = useQuery({ queryKey: MODULE_SETTINGS_QUERY_KEY, queryFn: loadSharedModuleSettings, staleTime: 5 * 60_000, retry: 1 })
  useEffect(() => {
    if (!query.data) return
    setSettings(query.data)
    saveModuleSettings(query.data)
  }, [query.data])
  return query.isError ? defaultModuleSettings : settings
}

export function useModules() {
  const settings = useModuleSettings()
  const query = useQuery({ queryKey: MODULE_SETTINGS_QUERY_KEY, queryFn: loadSharedModuleSettings, staleTime: 5 * 60_000, retry: 1 })
  return { ...settings, isLoading: query.isLoading, error: query.error }
}
