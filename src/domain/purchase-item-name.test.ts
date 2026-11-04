import { describe, expect, it } from 'vitest'
import { findItemNameCollision, itemNameKey, normalizeItemName } from './purchase-item-name'

describe('normalizeItemName', () => {
  it('trims and collapses repeated spaces', () => {
    expect(normalizeItemName('   brass   scrap  ')).toBe('Brass Scrap')
    expect(normalizeItemName('a\t b\n c')).toBe('A B C')
  })

  it('title-cases each word', () => {
    expect(normalizeItemName('brass scrap')).toBe('Brass Scrap')
    expect(normalizeItemName('BRaSS sCRAp')).toBe('Brass Scrap')
    expect(normalizeItemName('HONEY brass')).toBe('Honey Brass')
  })

  it('preserves known acronyms', () => {
    expect(normalizeItemName('gst alloy')).toBe('GST Alloy')
    expect(normalizeItemName('RCM sleeving')).toBe('RCM Sleeving')
    expect(normalizeItemName('GST rcm')).toBe('GST RCM')
  })

  it('returns empty string for blank input', () => {
    expect(normalizeItemName('')).toBe('')
    expect(normalizeItemName('   ')).toBe('')
  })

  it('keeps single-word names capitalized', () => {
    expect(normalizeItemName('chol')).toBe('Chol')
    expect(normalizeItemName('COAL')).toBe('Coal')
  })
})

describe('itemNameKey', () => {
  it('is case-insensitive and whitespace-insensitive', () => {
    expect(itemNameKey('Brass Scrap')).toBe(itemNameKey('brass scrap'))
    expect(itemNameKey('BRASS   SCRAP')).toBe(itemNameKey('Brass Scrap'))
  })
})

describe('findItemNameCollision', () => {
  const existing = [{ name: 'Brass Scrap' }, { name: 'Chol' }, { name: 'GST Alloy' }]

  it('detects case-insensitive duplicates', () => {
    expect(findItemNameCollision('brass scrap', existing)?.name).toBe('Brass Scrap')
    expect(findItemNameCollision('BRASS   SCRAP', existing)?.name).toBe('Brass Scrap')
    expect(findItemNameCollision('gst alloy', existing)?.name).toBe('GST Alloy')
  })

  it('returns undefined when no collision exists', () => {
    expect(findItemNameCollision('Honey Brass', existing)).toBeUndefined()
  })
})
