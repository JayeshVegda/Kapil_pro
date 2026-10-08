import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { get, set, del } from 'idb-keyval'
import { ThemeProvider } from 'next-themes'
import { useEffect, useState, type ReactNode } from 'react'
import { clearIfExpiredSession, hasValidAppSession } from '@/app/auth'
import { LoginScreen } from '@/components/auth/login-screen'
import { Toaster } from '@/components/ui/sonner'
import { DASHBOARD_QUERY_KEY, fetchDashboardData } from '@/domain/dashboard'

/**
 * Bump when persisted query shapes change so old caches are dropped.
 */
const QUERY_CACHE_BUSTER = 'v1'

/**
 * Queries worth keeping across browser restarts. Everything else refetches
 * fresh — this keeps the IndexedDB payload small and always correct.
 */
const PERSISTED_QUERY_KEYS: Array<readonly unknown[]> = [
  DASHBOARD_QUERY_KEY,
  ['customers-options'],
  ['items-options'],
]

function isPersistedQueryKey(queryKey: unknown) {
  const first = Array.isArray(queryKey) ? queryKey[0] : undefined
  return PERSISTED_QUERY_KEYS.some((key) => key[0] === first)
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    clearIfExpiredSession()
    return hasValidAppSession()
  })
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            // If data is stale/invalidated, refresh when user opens that page.
            refetchOnMount: true,
            retry: 1,
          },
        },
      }),
  )
  const [persister] = useState(() =>
    createAsyncStoragePersister({
      storage: {
        getItem: (value) => get(value),
        setItem: (key, value) => set(key, value),
        removeItem: (key) => del(key),
      },
      key: 'kapil-query-cache',
      throttleTime: 1_000,
    }),
  )

  useEffect(() => {
    if (!isAuthenticated) return
    // Warm the dashboard AFTER first paint so the startup prefetch does not
    // compete with the route's own render queries.
    const warm = () => {
      void queryClient.prefetchQuery({
        queryKey: DASHBOARD_QUERY_KEY,
        queryFn: fetchDashboardData,
      })
    }
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
    if (idle) {
      idle(warm, { timeout: 2_000 })
    } else {
      const timer = window.setTimeout(warm, 300)
      return () => window.clearTimeout(timer)
    }
  }, [isAuthenticated, queryClient])

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          buster: QUERY_CACHE_BUSTER,
          maxAge: 7 * 24 * 60 * 60 * 1000,
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => query.queryKey.length > 0 && isPersistedQueryKey(query.queryKey),
          },
        }}
      >
        {isAuthenticated ? children : <LoginScreen onSuccess={() => setIsAuthenticated(true)} />}
        <Toaster />
      </PersistQueryClientProvider>
    </ThemeProvider>
  )
}
