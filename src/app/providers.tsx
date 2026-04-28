import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useEffect, useState, type ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { DASHBOARD_QUERY_KEY, fetchDashboardData } from '@/domain/dashboard'

export function AppProviders({ children }: { children: ReactNode }) {
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
    queryClient.prefetchQuery({
      queryKey: DASHBOARD_QUERY_KEY,
      queryFn: fetchDashboardData,
    })
  }, [queryClient])

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  )
}
