/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POCKETBASE_URL?: string
  readonly VITE_MARKET_RATE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
