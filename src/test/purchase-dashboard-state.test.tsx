import type { ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { Route } from '@/routes/purchase-dashboard'
import { renderPage } from './render-page'

vi.mock('@tanstack/react-query', async (importOriginal) => ({ ...await importOriginal<typeof import('@tanstack/react-query')>(), useQuery: vi.fn() }))
vi.mock('@/components/purchase-dashboard/today-strip', () => ({ TodayStrip: () => <div>Today strip</div> }))
vi.mock('@/components/purchase-dashboard/snapshot-tiles', () => ({ SnapshotTiles: () => <div>Money snapshot</div> }))
vi.mock('@/components/purchase-dashboard/material-matrix', () => ({ MaterialMatrix: () => <div>Material audit</div> }))
vi.mock('@/components/purchase-dashboard/pay-next', () => ({ PayNext: () => <div>Pay next</div> }))
vi.mock('@/components/purchase-dashboard/recent-feeds', () => ({ RecentFeeds: () => <div>Recent feeds</div> }))
vi.mock('@/components/purchase-dashboard/spend-trend', () => ({ SpendTrend: () => <div>Spend trend</div> }))

afterEach(() => vi.resetAllMocks())

it('does not render zero-valued financial panels after a dashboard read failure', async () => {
  vi.mocked(useQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('Offline') } as ReturnType<typeof useQuery>)
  const Page = Route.options.component as ComponentType
  const html = await renderPage(<Page />)

  expect(html).toContain('Unable to load purchase dashboard')
  expect(html).toContain('role="alert"')
  expect(html).not.toContain('Money snapshot')
  expect(html).not.toContain('Material audit')
})
