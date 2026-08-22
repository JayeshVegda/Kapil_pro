import { describe, expect, it } from 'vitest'
import { defaultModuleSettings, isPathHiddenByModules, normalizeModuleSettings } from '@/lib/module-settings'

describe('normalizeModuleSettings', () => {
  it('defaults casting to enabled', () => {
    expect(normalizeModuleSettings(null)).toEqual({ castingEnabled: true })
    expect(defaultModuleSettings.castingEnabled).toBe(true)
  })

  it('keeps a stored boolean and ignores junk', () => {
    expect(normalizeModuleSettings({ castingEnabled: false })).toEqual({ castingEnabled: false })
    expect(normalizeModuleSettings({ castingEnabled: 'no' })).toEqual({ castingEnabled: true })
    expect(normalizeModuleSettings('broken')).toEqual({ castingEnabled: true })
  })
})

describe('isPathHiddenByModules', () => {
  it('hides every casting path when casting is off', () => {
    const off = { castingEnabled: false }
    expect(isPathHiddenByModules('/casting', off)).toBe(true)
    expect(isPathHiddenByModules('/casting/log', off)).toBe(true)
    expect(isPathHiddenByModules('/casting/new-session', off)).toBe(true)
  })

  it('leaves selling paths alone', () => {
    const off = { castingEnabled: false }
    expect(isPathHiddenByModules('/', off)).toBe(false)
    expect(isPathHiddenByModules('/new-bill', off)).toBe(false)
    expect(isPathHiddenByModules('/ledger', off)).toBe(false)
  })

  it('does not match paths that merely start with the same letters', () => {
    expect(isPathHiddenByModules('/casting-report', { castingEnabled: false })).toBe(false)
  })

  it('hides nothing when casting is on', () => {
    expect(isPathHiddenByModules('/casting/log', { castingEnabled: true })).toBe(false)
  })
})
