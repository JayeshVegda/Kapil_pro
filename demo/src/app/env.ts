const DEFAULTS = {
  pocketBaseUrl: 'http://127.0.0.1:8090',
  marketRateUrl: '/api/market-rate',
} as const

function normalizeUrl(value: string, fallback: string) {
  const trimmed = value.trim()
  if (trimmed.length === 0) return fallback
  return trimmed.replace(/\/+$/, '')
}

export function getPocketBaseUrl() {
  return normalizeUrl(import.meta.env.VITE_POCKETBASE_URL ?? '', DEFAULTS.pocketBaseUrl)
}

export function getMarketRateUrl() {
  const raw = import.meta.env.VITE_MARKET_RATE_URL ?? ''
  if (raw.startsWith('/')) return raw
  return normalizeUrl(raw, DEFAULTS.marketRateUrl)
}
