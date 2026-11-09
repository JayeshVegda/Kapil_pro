import { describe, expect, it } from 'vitest'
import { defaultModuleSettings, isPathHiddenByModules, normalizeModuleSettings } from '@/lib/module-settings'

describe('normalizeModuleSettings', () => {
  it('defaults casting to enabled', () => {
    expect(normalizeModuleSettings(null)).toEqual({ purchaseEnabled: true, castingEnabled: true })
    expect(defaultModuleSettings.castingEnabled).toBe(true)
  })

  it('keeps a stored boolean and ignores junk', () => {
    expect(normalizeModuleSettings({ purchaseEnabled: true, castingEnabled: false })).toEqual({ purchaseEnabled: true, castingEnabled: false })
    expect(normalizeModuleSettings({ castingEnabled: 'no' })).toEqual({ purchaseEnabled: true, castingEnabled: true })
    expect(normalizeModuleSettings('broken')).toEqual({ purchaseEnabled: true, castingEnabled: true })
  })
})

describe('isPathHiddenByModules', () => {
  it('hides every casting path when casting is off', () => {
    const off = { purchaseEnabled: true, castingEnabled: false }
    expect(isPathHiddenByModules('/casting', off)).toBe(true)
    expect(isPathHiddenByModules('/casting/log', off)).toBe(true)
    expect(isPathHiddenByModules('/casting/new-session', off)).toBe(true)
  })

  it('leaves selling paths alone', () => {
    const off = { purchaseEnabled: true, castingEnabled: false }
    expect(isPathHiddenByModules('/', off)).toBe(false)
    expect(isPathHiddenByModules('/new-bill', off)).toBe(false)
    expect(isPathHiddenByModules('/ledger', off)).toBe(false)
  })

  it('does not match paths that merely start with the same letters', () => {
    expect(isPathHiddenByModules('/casting-report', { purchaseEnabled: true, castingEnabled: false })).toBe(false)
  })

  it('hides nothing when casting is on', () => {
    expect(isPathHiddenByModules('/casting/log', { purchaseEnabled: true, castingEnabled: true })).toBe(false)
  })

  it('keeps sales and settings available when both optional modules are off', () => {
    const off = { purchaseEnabled: false, castingEnabled: false }
    for (const path of ['/', '/settings', '/new-bill', '/transactions', '/reports/sales']) {
      expect(isPathHiddenByModules(path, off)).toBe(false)
    }
    for (const path of ['/purchase-dashboard', '/new-purchase-bill', '/purchase-bills/abc', '/suppliers', '/reports/purchase', '/casting/log', '/reports/casting']) {
      expect(isPathHiddenByModules(path, off)).toBe(true)
    }
  })
})
