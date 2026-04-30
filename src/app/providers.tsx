import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useEffect, useState, type ReactNode } from 'react'
import { clearIfExpiredSession, hasValidAppSession } from '@/app/auth'
import { LoginScreen } from '@/components/auth/login-screen'
import { Toaster } from '@/components/ui/sonner'
import { DASHBOARD_QUERY_KEY, fetchDashboardData } from '@/domain/dashboard'

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

  useEffect(() => {
    if (!isAuthenticated) return
    queryClient.prefetchQuery({
      queryKey: DASHBOARD_QUERY_KEY,
      queryFn: fetchDashboardData,
    })
  }, [isAuthenticated, queryClient])

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={queryClient}>
        {isAuthenticated ? children : <LoginScreen onSuccess={() => setIsAuthenticated(true)} />}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  )
}
