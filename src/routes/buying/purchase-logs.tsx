import { createFileRoute } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { BoSection, EmptyTableHint } from '@/components/modules/boilerplate-ui'

export const Route = createFileRoute('/buying/purchase-logs')({
  component: PurchaseLogsPage,
})

function PurchaseLogsPage() {
  const [tab, setTab] = useState<'all' | 'purchase' | 'payment'>('all')
  const [search, setSearch] = useState('')

  return (
    <div className="w-full space-y-8 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500">
        Combined purchase &amp; supplier payment timeline (like transaction logs).
        {search.trim() ? (
          <span className="ml-1 text-slate-600">
            Filter draft: <span className="font-medium">“{search.trim()}”</span>
          </span>
        ) : null}{' '}
        <span className="text-amber-700">No data wired yet.</span>
      </p>

      <BoSection>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs">
            {(['all', 'purchase', 'payment'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`rounded px-3 py-1.5 capitalize ${tab === k ? 'bg-slate-900 font-semibold text-white' : 'text-slate-600'}`}
              >
                {k === 'all' ? 'All' : k === 'purchase' ? 'Purchases' : 'Payments'}
              </button>
            ))}
          </div>
          <label className="relative flex-1 sm:max-w-sm">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm"
              placeholder="Search supplier, narration…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="border-b px-2 py-2 text-left font-semibold text-slate-700">Date</th>
                <th className="border-b px-2 py-2 text-left font-semibold text-slate-700">Kind</th>
                <th className="border-b px-2 py-2 text-left font-semibold text-slate-700">Supplier</th>
                <th className="border-b px-2 py-2 text-right font-semibold text-slate-700">Debit / Credit</th>
                <th className="border-b px-2 py-2 text-left font-semibold text-slate-700">Narration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} className="p-0">
                  <EmptyTableHint entityLabel="log rows" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </BoSection>
    </div>
  )
}
