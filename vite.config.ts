import path from 'node:path'
import type { Connect } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

const MARKET_RATE_ROUTE = '/api/market-rate'
const MARKET_RATE_CANDIDATES = [
  'https://kapil.cosearch.me/api/market-rate',
  'https://rss.cosearch.me/telegram/channel/brassb2b',
  'http://rss.cosearch.me/telegram/channel/brassb2b',
  'https://r.jina.ai/http://rss.cosearch.me/telegram/channel/brassb2b',
]

async function fetchMarketRateRss() {
  for (const source of MARKET_RATE_CANDIDATES) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      const response = await fetch(source, {
        headers: { Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
        signal: controller.signal,
      })
      clearTimeout(timer)
      const body = await response.text()
      if (!response.ok) continue
      const lower = body.toLowerCase()
      if (lower.includes('<rss') || lower.includes('<feed')) {
        return { ok: true as const, body, source }
      }
    } catch {
      // Try the next upstream candidate.
    }
  }

  return { ok: false as const }
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

export default defineConfig({
  plugins: [marketRateProxyPlugin, tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
