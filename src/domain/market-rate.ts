import { useCallback, useEffect, useState } from 'react'
import { getMarketRateUrl } from '@/app/env'
import { pb } from '@/data/pocketbase'
import { formatFullDate, getLocalIsoDate } from '@/lib/date'

const MARKET_RATE_CACHE_KEY = 'billing.marketRate.cache.v1'
const MARKET_RATE_URL = getMarketRateUrl()

export type MarketRateState = {
  rate: number
  rateDate: string
  status: string
  source: string
}

function getTodayLocalIso() {
  return getLocalIsoDate()
}

function normalizeFeedDate(rawDate: string) {
  if (!rawDate) return getTodayLocalIso()
  const m = rawDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return getTodayLocalIso()
  return `${m[3]}-${m[2]}-${m[1]}`
}

function dayRange(dateIso: string) {
  const day = String(dateIso || getTodayLocalIso()).slice(0, 10)
  const next = new Date(`${day}T00:00:00`)
  next.setDate(next.getDate() + 1)
  return {
    start: day,
    end: getLocalIsoDate(next),
  }
}

function parseBrassB2BRate(xmlText: string) {
  const latestItem = (xmlText.match(/<item>[\s\S]*?<\/item>/i) || [xmlText])[0]
  const jamnagarBlock = (latestItem.match(/Jamnagar[\s\S]*?(?:Delhi|Copper|MCX|Disclaimer)/i) || [latestItem])[0]
  const localPatterns = [
    /Brass\s+Vilaity[\s\S]{0,80}?:\s*[^0-9]*(\d{3,4})/i,
    /Brass\s+Vilality[\s\S]{0,80}?:\s*[^0-9]*(\d{3,4})/i,
    /Local[\s\S]{0,40}?:\s*[^0-9]*(\d{3,4})/i,
  ]
  let localRate: number | null = null
  for (const pattern of localPatterns) {
    const m = jamnagarBlock.match(pattern)
    if (m) {
      localRate = Number(m[1])
      break
    }
  }
  const dateMatch = latestItem.match(/Date\s*:\s*(\d{2}\.\d{2}\.\d{4})/i)
  return { localRate, date: dateMatch ? dateMatch[1] : '' }
}

async function fetchMarketRateViaProxy() {
  const url = MARKET_RATE_URL
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/rss+xml,application/xml,text/xml,*/*',
      },
      signal: controller.signal,
    })
    const txt = await res.text()
    if (!res.ok) {
      return { text: '', source: url, error: `Proxy returned ${res.status}` }
    }
    if (!txt || txt.length < 50) {
      return { text: '', source: url, error: 'Proxy returned empty/short body' }
    }
    const lower = txt.toLowerCase()
    if (!lower.includes('<rss') && !lower.includes('<feed')) {
      return { text: '', source: url, error: 'Proxy did not return RSS/XML response' }
    }
    return { text: txt, source: url, error: '' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown fetch error'
    return { text: '', source: url, error: msg }
  } finally {
    clearTimeout(timeout)
  }
}

async function saveMarketRateDayRecord(rate: number, rateDate: string) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(rateDate)
    ? rateDate
    : getLocalIsoDate()
  const payload = {
    date: day,
    vilaity: rate,
    source: 'rss_auto',
    note: 'Jamnagar local rate',
  }
  const range = dayRange(day)
  const existing = await pb.collection('brass_rates').getFirstListItem(`date >= "${range.start}" && date < "${range.end}"`).catch(() => null)
  if (existing) {
    await pb.collection('brass_rates').update(existing.id, payload)
    return
  }
  await pb.collection('brass_rates').create({
    ...payload,
    honey_gulf: 0,
    honey_europe: 0,
  })
}

async function loadMarketRateDayRecord(dateIso: string) {
  try {
    const range = dayRange(dateIso)
    const record = await pb.collection('brass_rates').getFirstListItem(`date >= "${range.start}" && date < "${range.end}"`)
    const amount = Number(record.vilaity ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) return null
    return {
      rate: amount,
      rateDate: String(record.date || dateIso),
    }
  } catch {
    return null
  }
}

async function loadNearestMarketRateRecord(dateIso: string) {
  try {
    const range = dayRange(dateIso)
    const page = await pb.collection('brass_rates').getList(1, 1, {
      filter: `date < "${range.end}"`,
      sort: '-date,-updated',
    })
    const record = page.items[0]
    if (!record) return null
    const amount = Number(record.vilaity ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) return null
    return {
      rate: amount,
      rateDate: String(record.date || ''),
    }
  } catch {
    return null
  }
}

function loadCachedMarketRate(setState: (v: MarketRateState) => void) {
  try {
    const raw = localStorage.getItem(MARKET_RATE_CACHE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (!Number.isFinite(Number(parsed.localRate))) return false
    setState({
      rate: Number(parsed.localRate),
      rateDate: String(parsed.rateDate || ''),
      status: String(parsed.status || 'Using cached market rate'),
      source: String(parsed.source || 'cache'),
    })
    return true
  } catch {
    return false
  }
}

function saveCachedMarketRate(next: MarketRateState) {
  try {
    localStorage.setItem(
      MARKET_RATE_CACHE_KEY,
      JSON.stringify({
        localRate: next.rate,
        rateDate: next.rateDate,
        status: next.status,
        source: next.source,
        savedAt: new Date().toISOString(),
      }),
    )
  } catch {
    // ignore storage errors
  }
}

export function useMarketRate(targetDate = getTodayLocalIso()) {
  const [state, setState] = useState<MarketRateState>({
    rate: 0,
    rateDate: 'Not refreshed yet',
    status: 'Market rate not fetched yet.',
    source: '',
  })
  const refresh = useCallback(async (options?: { isAuto?: boolean; targetDate?: string }) => {
    const isAuto = Boolean(options?.isAuto)
    const requestedDate = options?.targetDate || targetDate || getTodayLocalIso()
    setState((prev) => ({ ...prev, status: isAuto ? 'Auto update in progress...' : 'Refreshing...' }))
    const fetched = await fetchMarketRateViaProxy()
    if (!fetched.text) {
      const nearest = await loadNearestMarketRateRecord(requestedDate)
      if (nearest) {
        const fallback: MarketRateState = {
          rate: nearest.rate,
          rateDate: nearest.rateDate,
          status: `Using saved rate for ${formatFullDate(nearest.rateDate)}`,
          source: 'db-fallback',
        }
        setState(fallback)
        saveCachedMarketRate(fallback)
        return false
      }
      setState((prev) => ({ ...prev, status: `Fetch failed: ${fetched.error || 'unknown error'}` }))
      return false
    }
    const parsed = parseBrassB2BRate(fetched.text)
    if (!parsed.localRate) {
      setState((prev) => ({ ...prev, status: 'Feed fetched but local rate could not be parsed.' }))
      return false
    }
    const normalizedDate = normalizeFeedDate(parsed.date)
    const next: MarketRateState = {
      rate: parsed.localRate,
      rateDate: parsed.date || formatFullDate(normalizedDate),
      status: isAuto ? 'Daily rate loaded' : 'Rate refreshed',
      source: fetched.source,
    }
    setState(next)
    saveCachedMarketRate(next)
    void saveMarketRateDayRecord(parsed.localRate, normalizedDate).catch(() => {
      // Saving is non-blocking for bill creation UX.
    })
    return true
  }, [targetDate])

  useEffect(() => {
    const requestedDate = targetDate || getTodayLocalIso()
    if (requestedDate === getTodayLocalIso()) {
      loadCachedMarketRate(setState)
    }
    void (async () => {
      const exactDay = await loadMarketRateDayRecord(requestedDate)
      if (exactDay) {
        const next: MarketRateState = {
          rate: exactDay.rate,
          rateDate: exactDay.rateDate,
          status: `Loaded for ${formatFullDate(requestedDate)}`,
          source: 'db',
        }
        setState(next)
        if (requestedDate === getTodayLocalIso()) saveCachedMarketRate(next)
        return
      }
      const nearest = await loadNearestMarketRateRecord(requestedDate)
      if (nearest) {
        const next: MarketRateState = {
          rate: nearest.rate,
          rateDate: nearest.rateDate,
          status: `Loaded nearest saved rate (${formatFullDate(nearest.rateDate)})`,
          source: 'db',
        }
        setState(next)
        if (requestedDate === getTodayLocalIso()) saveCachedMarketRate(next)
        return
      }
      if (requestedDate === getTodayLocalIso()) {
        void refresh({ isAuto: true, targetDate: requestedDate })
        return
      }
      setState({
        rate: 0,
        rateDate: requestedDate,
        status: `No saved market rate found for ${formatFullDate(requestedDate)}`,
        source: 'db',
      })
    })()
  }, [refresh, targetDate])

  return { marketRate: state, refreshMarketRate: refresh }
}
