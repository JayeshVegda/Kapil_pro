import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/casting/materials')({
  beforeLoad: () => { throw redirect({ to: '/items', search: { tab: 'casting' } }) },
})
