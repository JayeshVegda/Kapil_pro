import path from 'node:path'
import type { Connect } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

const MARKET_RATE_ROUTE = '/api/market-rate'
const POCKETBASE_ROUTE = '/pb'
const MARKET_RATE_CANDIDATES = [
  'https://kapil.cosearch.me/api/market-rate',
  'https://rss.cosearch.me/telegram/channel/brassb2b',
  'http://rss.cosearch.me/telegram/channel/brassb2b',
  'https://r.jina.ai/http://rss.cosearch.me/telegram/channel/brassb2b',
]

async function fetchMarketRateRss() {
  const fetchCandidate = async (source: string) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3_000)
    try {
      const response = await fetch(source, {
        headers: { Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
        signal: controller.signal,
      })
      const body = await response.text()
      if (!response.ok) throw new Error(`Market rate upstream returned ${response.status}`)
      const lower = body.toLowerCase()
      if (lower.includes('<rss') || lower.includes('<feed')) {
        return { ok: true as const, body, source }
      }
      throw new Error('Market rate upstream did not return RSS/XML feed data')
    } finally {
      clearTimeout(timer)
    }
  }

  return Promise.any(MARKET_RATE_CANDIDATES.map(fetchCandidate)).catch(() => ({ ok: false as const }))
}

function marketRateProxyMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith(MARKET_RATE_ROUTE)) {
      next()
      return
    }

    const result = await fetchMarketRateRss()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

    if (result.ok) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/xml; charset=utf-8')
      res.setHeader('X-Market-Rate-Source', result.source)
      res.end(result.body)
      return
    }

    res.statusCode = 502
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.end('<rss><channel><item><description>Market rate upstream unavailable</description></item></channel></rss>')
  }
}

const marketRateProxyPlugin = {
  name: 'market-rate-proxy',
  configureServer(server: { middlewares: { use: (mw: Connect.NextHandleFunction) => void } }) {
    server.middlewares.use(marketRateProxyMiddleware())
  },
  configurePreviewServer(server: { middlewares: { use: (mw: Connect.NextHandleFunction) => void } }) {
    server.middlewares.use(marketRateProxyMiddleware())
  },
}

const pocketBaseProxyPlugin = {
  name: 'pocketbase-proxy',
  configureServer(server: { middlewares: { use: (route: string, mw: Connect.NextHandleFunction) => void } }) {
    server.middlewares.use(POCKETBASE_ROUTE, pocketBaseProxyMiddleware())
  },
}

function pocketBaseProxyMiddleware(): Connect.NextHandleFunction {
  return async (req, res) => {
    const targetUrl = new URL(req.url ?? '/', 'http://127.0.0.1:8090')
    const headers = new Headers(req.headers as Record<string, string>)
    headers.set('host', '127.0.0.1:8090')
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    if (!response.body) {
      res.end()
      return
    }
    const body = Buffer.from(await response.arrayBuffer())
    res.end(body)
  }
}

export default defineConfig({
  plugins: [marketRateProxyPlugin, pocketBaseProxyPlugin, tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
