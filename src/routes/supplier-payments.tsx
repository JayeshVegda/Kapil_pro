import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

const searchSchema = z.object({
  q: z.string().optional(),
  supplier: z.string().optional(),
  pool: z.enum(['all', 'kacha', 'gst']).optional(),
  mode: z.enum(['all', 'cash', 'upi', 'rtgs', 'neft', 'cheque', 'other']).optional(),
  status: z.enum(['all', 'active', 'cancelled']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export const Route = createFileRoute('/supplier-payments')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/purchase-bills',
      search: {
        view: 'payments',
        supplier: search.supplier && search.supplier !== 'all' ? search.supplier : undefined,
        pool: search.pool === 'kacha' || search.pool === 'gst' ? search.pool : undefined,
        from: search.from,
        to: search.to,
      },
    })
  },
})
