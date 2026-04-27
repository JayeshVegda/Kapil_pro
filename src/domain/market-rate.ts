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
  const filter = `type = "market_rate" && date ~ "${day}"`
  const payload = {
    date: day,
    type: 'market_rate',
    note: 'Jamnagar local rate',
    amount: rate,
    book_no: 0,
    bill_no: 0,
  }
  const existing = await pb.collection('misc_expenses').getFirstListItem(filter).catch(() => null)
  if (existing) {
    await pb.collection('misc_expenses').update(existing.id, payload)
    return
  }
  await pb.collection('misc_expenses').create(payload)
}

async function loadMarketRateDayRecord(dateIso: string) {
  const filter = `type = "market_rate" && date = "${dateIso}"`
  try {
    const record = await pb.collection('misc_expenses').getFirstListItem(filter)
    const amount = Number(record.amount ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) return null
    return {
      rate: amount,
      rateDate: String(record.date || dateIso),
    }
  } catch {
    return null
  }
}

async function loadLatestMarketRateRecord() {
  try {
    const page = await pb.collection('misc_expenses').getList(1, 1, {
      filter: 'type = "market_rate"',
      sort: '-date,-updated',
    })
    const record = page.items[0]
    if (!record) return null
    const amount = Number(record.amount ?? 0)
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

export function useMarketRate() {
  const [state, setState] = useState<MarketRateState>({
    rate: 0,
    rateDate: 'Not refreshed yet',
    status: 'Market rate not fetched yet.',
    source: '',
  })
  const refresh = useCallback(async (options?: { isAuto?: boolean }) => {
    const isAuto = Boolean(options?.isAuto)
    setState((prev) => ({ ...prev, status: isAuto ? 'Auto update in progress...' : 'Refreshing...' }))
    const fetched = await fetchMarketRateViaProxy()
    if (!fetched.text) {
      const latest = await loadLatestMarketRateRecord()
      if (latest) {
        const fallback: MarketRateState = {
          rate: latest.rate,
          rateDate: latest.rateDate,
          status: `Using last saved rate (${latest.rateDate})`,
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
  }, [])

  useEffect(() => {
    const today = getTodayLocalIso()
    loadCachedMarketRate(setState)
    void (async () => {
      const dbToday = await loadMarketRateDayRecord(today)
      if (dbToday) {
        const next: MarketRateState = {
          rate: dbToday.rate,
          rateDate: dbToday.rateDate,
          status: 'Loaded from today record',
          source: 'db',
        }
        setState(next)
        saveCachedMarketRate(next)
        return
      }
      const latest = await loadLatestMarketRateRecord()
      if (latest) {
        const next: MarketRateState = {
          rate: latest.rate,
          rateDate: latest.rateDate,
          status: `Loaded from last saved record (${latest.rateDate})`,
          source: 'db',
        }
        setState(next)
        saveCachedMarketRate(next)
      }
      void refresh({ isAuto: true })
    })()
  }, [refresh])

  return { marketRate: state, refreshMarketRate: refresh }
}
