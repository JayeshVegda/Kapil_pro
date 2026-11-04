/**
 * Purchase item name normalisation.
 *
 * Rules (Phase 5, B4):
 * - Trim and collapse repeated whitespace.
 * - Title Case each word ("brass scrap" -> "Brass Scrap").
 * - Known acronyms keep their upper-case form (GST, RCM).
 * - Uniqueness is case-insensitive (see itemNameKey / the data-layer checks).
 */

const ACRONYMS = new Set(['GST', 'RCM'])

export function normalizeItemName(raw: string): string {
  const collapsed = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!collapsed) return ''
  return collapsed
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word
      const upper = word.toUpperCase()
      if (ACRONYMS.has(upper)) return upper
      return upper.charAt(0) + upper.slice(1).toLowerCase()
    })
    .join(' ')
}

/** Case-insensitive identity key used for duplicate checks. */
export function itemNameKey(name: string): string {
  return normalizeItemName(name).toLowerCase()
}

/** Returns the first existing item whose key matches the candidate, or undefined. */
export function findItemNameCollision<T extends { name: string }>(candidate: string, existing: readonly T[]): T | undefined {
  const key = itemNameKey(candidate)
  if (!key) return undefined
  return existing.find((item) => itemNameKey(item.name) === key)
}
