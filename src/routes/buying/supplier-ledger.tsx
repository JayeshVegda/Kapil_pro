import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { loadBuyingCollections } from '@/data/scrap-buying'
import { buildSupplierLedger } from '@/domain/scrap-buying'
import type { BillMode } from '@/domain/scrap-buying-types'
import { BoField, BoMetric, BoSection, BOILERPLATE_INPUT_CLASS } from '@/components/modules/boilerplate-ui'
import { formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/buying/supplier-ledger')({
  component: SupplierLedgerPage,
})

const BUYING_KEY = ['buying-collections'] as const

function SupplierLedgerPage() {
  const query = useQuery({ queryKey: BUYING_KEY, queryFn: loadBuyingCollections })
  const suppliers = query.data?.suppliers ?? []
  const [supplierId, setSupplierId] = useState('')
  const [modeFilter, setModeFilter] = useState<'all' | BillMode>('all')
  const supplier = suppliers.find((row) => row.id === supplierId)
  const ledger = useMemo(
    () =>
      supplier && query.data
        ? buildSupplierLedger({
            supplier,
            purchases: query.data.purchases,
            payments: query.data.payments,
            modeFilter,
          })
        : [],
    [supplier, query.data, modeFilter],
  )
  const latestBalance = ledger[0]?.balanceAfter ?? 0
  const debitTotal = ledger.reduce((sum, row) => sum + row.debit, 0)
  const creditTotal = ledger.reduce((sum, row) => sum + row.credit, 0)

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <p className="text-xs text-slate-500" role="status">
        {query.isLoading ? 'Loading supplier ledger...' : 'Combined supplier ledger with Kacha/GST filters'}
      </p>

      <BoSection title="Ledger filters">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <BoField label="Supplier">
            <select className={BOILERPLATE_INPUT_CLASS} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select supplier</option>
              {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </BoField>
          <BoField label="Mode">
            <select className={BOILERPLATE_INPUT_CLASS} value={modeFilter} onChange={(e) => setModeFilter(e.target.value as 'all' | BillMode)}>
              <option value="all">All</option>
              <option value="kacha">Kacha</option>
              <option value="gst">GST</option>
            </select>
          </BoField>
          <BoField label="Current payable">
            <input className={BOILERPLATE_INPUT_CLASS} readOnly value={formatInrInteger(latestBalance)} />
          </BoField>
        </div>
      </BoSection>

      <BoSection title="Summary">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <BoMetric label="Purchases / opening" value={formatInrInteger(debitTotal)} />
          <BoMetric label="Payments" value={formatInrInteger(creditTotal)} />
          <BoMetric label="Balance" value={formatInrInteger(latestBalance)} emphasized />
        </div>
      </BoSection>

      <BoSection title="Movements">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <Th>Date</Th>
                <Th>Mode</Th>
                <Th>Narration</Th>
                <Th align="right">Debit</Th>
                <Th align="right">Credit</Th>
                <Th align="right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.date === '0000-00-00' ? '-' : row.date}</td>
                  <td className="px-3 py-2 text-xs font-semibold uppercase text-slate-700">{row.billMode ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-800">{row.narration}</td>
                  <TdRight>{row.debit ? formatInrInteger(row.debit) : '-'}</TdRight>
                  <TdRight>{row.credit ? formatInrInteger(row.credit) : '-'}</TdRight>
                  <TdRight>{formatInrInteger(row.balanceAfter)}</TdRight>
                </tr>
              ))}
              {!query.isLoading && ledger.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">Select a supplier to view ledger.</td>
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

function TdRight({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">{children}</td>
}
