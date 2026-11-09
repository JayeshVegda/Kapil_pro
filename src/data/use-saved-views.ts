import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  renameSavedView,
  type PurchaseBillsFilterConfig,
  type SavedViewScope,
} from '@/data/saved-views'

/**
 * Saved views for list pages (operational redesign Phase 2). Query options,
 * plus create/rename/delete mutations that invalidate the scope after write.
 */

const SAVED_VIEWS_QUERY_KEY = 'saved-views'

export function savedViewsQueryOptions(scope: SavedViewScope) {
  return queryOptions({
    queryKey: [SAVED_VIEWS_QUERY_KEY, scope] as const,
    queryFn: () => listSavedViews(scope),
    staleTime: 0,
  })
}

export function useSavedViews(scope: SavedViewScope) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [SAVED_VIEWS_QUERY_KEY, scope] })

  const viewsQuery = useQuery(savedViewsQueryOptions(scope))

  const createMutation = useMutation({
    mutationFn: ({ name, config }: { name: string; config: PurchaseBillsFilterConfig }) =>
      createSavedView(scope, name, config),
    onSuccess: () => {
      void invalidate()
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameSavedView(scope, id, name),
    onSuccess: () => {
      void invalidate()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSavedView(scope, id),
    onSuccess: () => {
      void invalidate()
    },
  })

  return { viewsQuery, createMutation, renameMutation, deleteMutation }
}
