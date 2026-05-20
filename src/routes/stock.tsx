import { createFileRoute } from '@tanstack/react-router'
import { StockPage } from '@/routes/stock-in'

export const Route = createFileRoute('/stock')({
  component: StockPage,
})
