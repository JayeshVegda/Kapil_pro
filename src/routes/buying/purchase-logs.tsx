import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { loadBuyingCollections } from '@/data/scrap-buying'
import { BoSection } from '@/components/modules/boilerplate-ui'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/buying/purchase-logs')({
  component: PurchaseLogsPage,
})

const BUYING_KEY = ['buying-collections'] as const

function PurchaseLogsPage() {
  const query = useQuery({ queryKey: BUYING_KEY, queryFn: loadBuyingCollections })
  const [tab, setTab] = useState<'all' | 'purchase' | 'payment'>('all')
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const purchaseRows = (query.data?.purchases ?? []).map((row) => ({
      id: `purchase-${row.id}`,
      kind: 'purchase' as const,
      date: row.date,
      createdAt: row.createdAt,
      supplier: row.supplierName,
      mode: row.billMode,
      amount: row.grandTotal,
      narration: `${row.supplierBillNo || row.internalRef || 'Purchase'} · ${row.materialLines.map((line) => line.materialName).join(', ')}`,
    }))
    const paymentRows = (query.data?.payments ?? []).map((row) => ({
      id: `payment-${row.id}`,
      kind: 'payment' as const,
      date: row.date,
      createdAt: row.createdAt,
      supplier: row.supplierName,
      mode: row.billModeScope,
      amount: row.amount,
      narration: `${row.mode} payment${row.note ? ` · ${row.note}` : ''}`,
    }))
    return [...purchaseRows, ...paymentRows]
      .filter((row) => tab === 'all' || row.kind === tab)
      .filter((row) => !q || `${row.supplier} ${row.mode} ${row.narration}`.toLowerCase().includes(q))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''))
  }, [query.data, tab, search])

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500" role="status">
        {query.isLoading ? 'Loading purchase log...' : 'Purchases and supplier payments in one timeline'}
      </p>

      <BoSection>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs">
            {(['all', 'purchase', 'payment'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded px-3 py-1.5 capitalize ${tab === key ? 'bg-slate-900 font-semibold text-white' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                {key === 'all' ? 'All' : key === 'purchase' ? 'Purchases' : 'Payments'}
              </button>
            ))}
          </div>
          <label className="relative flex-1 sm:max-w-sm">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400/30"
              placeholder="Search supplier, material, note..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <Th>Date</Th>
                <Th>Kind</Th>
                <Th>Supplier</Th>
                <Th>Mode</Th>
                <Th>Narration</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.date}</td>
                  <td className="px-3 py-2 capitalize text-slate-700">{row.kind}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{row.supplier}</td>
                  <td className="px-3 py-2 text-xs font-semibold uppercase text-slate-700">{row.mode}</td>
                  <td className="px-3 py-2 text-slate-700">{row.narration}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{formatInrInteger(row.amount)}</td>
                </tr>
              ))}
              {!query.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">No log rows found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </BoSection>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className={`border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>
}
