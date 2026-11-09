import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

const searchSchema = z.object({
  filter: z.enum(['all', 'active', 'inactive']).optional(),
  q: z.string().optional(),
})

export const Route = createFileRoute('/purchase-items')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/items',
      search: {
        tab: 'purchase',
        purchaseFilter: search.filter,
        q: search.q,
      },
    })
  },
})
