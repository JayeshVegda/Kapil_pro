/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POCKETBASE_URL?: string
  readonly VITE_MARKET_RATE_URL?: string
  readonly VITE_LOGIN_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
