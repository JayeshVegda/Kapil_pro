import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { loadBuyingCollections } from '@/data/scrap-buying'

export const Route = createFileRoute('/buying')({
  component: BuyingLayout,
})

const BUYING_KEY = ['buying-collections'] as const

function BuyingLayout() {
  useQuery({
    queryKey: BUYING_KEY,
    queryFn: loadBuyingCollections,
    staleTime: 30_000,
  })
  return <Outlet />
}
