import type { ComponentType } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { Route } from '@/routes/new-supplier-payment'
import { renderPage } from './render-page'
import { supplierFixture } from './purchase-fixtures'

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: vi.fn(), useQueryClient: vi.fn(), useMutation: vi.fn(),
}))

afterEach(() => vi.restoreAllMocks())

it.each([
  { data: undefined, isLoading: true, isError: false, message: 'Loading supplier ledger' },
  { data: undefined, isLoading: false, isError: true, message: 'Unable to load supplier ledger' },
  { data: null, isLoading: false, isError: false, message: 'Supplier not found' },
])('shows $message instead of a success-shaped zero-balance preview', async ({ message, ...result }) => {
  vi.spyOn(Route, 'useSearch').mockReturnValue({ supplierId: 'supplier1' })
  vi.mocked(useQuery).mockImplementation((options) => (
    options.queryKey[0] === 'suppliers-list'
      ? { data: [supplierFixture()], isLoading: false, isError: false }
      : result
  ) as ReturnType<typeof useQuery>)
  vi.mocked(useMutation).mockReturnValue({ isPending: false } as ReturnType<typeof useMutation>)
  const Page = Route.options.component as ComponentType
  const html = await renderPage(<Page />)

  expect(html).toContain(message)
  expect(html).not.toContain('All outstanding dues')
  expect(html).not.toContain('No open bills in this pool')
  expect(html).not.toContain('No payment history recorded')
  expect(html).toMatch(/<button[^>]+disabled=""[^>]*>[^<]*<svg[^]*?Save Payment/)
})
