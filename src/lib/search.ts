type RankTier = 0 | 1 | 2 | 3 | 4 | 5

type RankedRecord<T> = {
  record: T
  rank: RankTier
  name: string
  normalizedName: string
}

const NON_ALNUM = /[^a-z0-9]+/g
const DOTS = /\./g

export function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(DOTS, '')
    .replace(NON_ALNUM, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, '')
}

export function getInitials(value: string) {
  const normalized = normalizeSearchText(value)
  if (!normalized) return ''
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0] ?? '')
    .join('')
}

function hasWordStartMatch(normalizedName: string, normalizedQuery: string) {
  if (!normalizedName || !normalizedQuery) return false
  const words = normalizedName.split(' ').filter(Boolean)
  return words.some((word) => word.startsWith(normalizedQuery))
}

function levenshteinDistance(a: string, b: string) {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j]
  }
  return prev[b.length]
}

function hasSafeSmallTypo(normalizedName: string, normalizedQuery: string) {
  const compactName = normalizedName.replace(/\s+/g, '')
  const compactQuery = normalizedQuery.replace(/\s+/g, '')
  if (!compactName || !compactQuery) return false
  const minLen = Math.min(compactName.length, compactQuery.length)
  const maxLen = Math.max(compactName.length, compactQuery.length)
  if (minLen < 5 || maxLen - minLen > 1) return false
  return levenshteinDistance(compactName, compactQuery) <= 1
}

export function rankNameMatch(name: string, query: string): number | null {
  const normalizedName = normalizeSearchText(name)
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedName || !normalizedQuery) return null
  if (normalizedName === normalizedQuery) return 0
  if (normalizedName.startsWith(normalizedQuery)) return 1
  if (hasWordStartMatch(normalizedName, normalizedQuery)) return 2
  const initials = getInitials(normalizedName)
  const compactQuery = compactSearchText(normalizedQuery)
  if (initials && compactQuery && initials.startsWith(compactQuery)) return 3
  if (normalizedName.includes(normalizedQuery)) return 4
  if (hasSafeSmallTypo(normalizedName, normalizedQuery)) return 5
  return null
}

export function matchesRankedQuery(text: string, query: string) {
  return rankNameMatch(text, query) !== null
}

export function matchesAnyRankedQuery(texts: string[], query: string) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return true
  return texts.some((text) => matchesRankedQuery(String(text ?? ''), normalizedQuery))
}

function byRankThenName<T>(a: RankedRecord<T>, b: RankedRecord<T>) {
  if (a.rank !== b.rank) return a.rank - b.rank
  if (a.normalizedName.length !== b.normalizedName.length) return a.normalizedName.length - b.normalizedName.length
  return a.normalizedName.localeCompare(b.normalizedName)
}

export function findBestNameMatch<T>(records: T[], query: string, getName: (record: T) => string): T | undefined {
  const ranked = filterRankedRecords(records, query, getName)
  return ranked[0]?.record
}

function filterRankedRecords<T>(records: T[], query: string, getName: (record: T) => string): RankedRecord<T>[] {
  return records
    .map((record) => {
      const name = String(getName(record) ?? '')
      const normalizedName = normalizeSearchText(name)
      const rank = rankNameMatch(name, query)
      if (rank === null) return null
      return { record, rank: rank as RankTier, name, normalizedName }
    })
    .filter((entry): entry is RankedRecord<T> => entry !== null)
    .sort(byRankThenName)
}

export function filterRankedNameMatches<T>(records: T[], query: string, getName: (record: T) => string): T[] {
  if (!normalizeSearchText(query)) {
    return [...records].sort((a, b) => {
      const nameA = normalizeSearchText(getName(a))
      const nameB = normalizeSearchText(getName(b))
      if (nameA.length !== nameB.length) return nameA.length - nameB.length
      return nameA.localeCompare(nameB)
    })
  }
  return filterRankedRecords(records, query, getName).map((entry) => entry.record)
}
