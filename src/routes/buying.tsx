import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, PackageCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { loadBuyingCollections } from '@/data/scrap-buying'
import { buildRawMaterialStock } from '@/domain/scrap-buying'
import { BoMetric, BoSection } from '@/components/modules/boilerplate-ui'
import { formatInQty, formatInrInteger } from '@/lib/inr-format'

export const Route = createFileRoute('/buying')({
  component: BuyingOverviewPage,
})

const BUYING_KEY = ['buying-collections'] as const

function BuyingOverviewPage() {
  const query = useQuery({ queryKey: BUYING_KEY, queryFn: loadBuyingCollections })
  const data = query.data
  const purchases = data?.purchases ?? []
  const payments = data?.payments ?? []
  const suppliers = data?.suppliers ?? []
  const totalPurchases = purchases.reduce((sum, row) => sum + row.grandTotal, 0)
  const totalPayments = payments.reduce((sum, row) => sum + row.amount, 0)
  const kachaPayable = purchases.filter((row) => row.billMode === 'kacha').reduce((sum, row) => sum + row.grandTotal, 0) - payments.filter((row) => row.billModeScope === 'kacha').reduce((sum, row) => sum + row.amount, 0)
  const gstPayable = purchases.filter((row) => row.billMode === 'gst').reduce((sum, row) => sum + row.grandTotal, 0) - payments.filter((row) => row.billModeScope === 'gst').reduce((sum, row) => sum + row.amount, 0)
  const stock = buildRawMaterialStock(purchases).slice(0, 8)
  const recentPurchases = purchases.slice(0, 6)

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500" role="status">
          {query.isLoading ? 'Loading buying data...' : query.isError ? 'Unable to load buying data. Run buying collection setup if this is first deploy.' : 'Supplier purchases and payments'}
        </p>
        <div className="flex flex-wrap gap-2">
          <QuickLink to="/buying/new-purchase" label="New purchase" />
          <QuickLink to="/buying/supplier-payments" label="Pay supplier" />
          <QuickLink to="/buying/suppliers" label="Suppliers" />
        </div>
      </div>

      <BoSection title="Payable summary">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <BoMetric label="Net payable" value={formatInrInteger(totalPurchases - totalPayments)} emphasized />
          <BoMetric label="Kacha payable" value={formatInrInteger(kachaPayable)} />
          <BoMetric label="GST payable" value={formatInrInteger(gstPayable)} />
          <BoMetric label="Suppliers" value={String(suppliers.length)} />
        </div>
      </BoSection>

      <BoSection title="Raw material stock">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <Th>Material</Th>
                <Th align="right">Purchased</Th>
                <Th align="right">Faulty return</Th>
                <Th align="right">Current</Th>
                <Th align="right">Value</Th>
              </tr>
            </thead>
            <tbody>
              {stock.map((row) => (
                <tr key={row.materialName} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{row.materialName}</td>
                  <TdRight>{formatInQty(row.purchasedKg)}</TdRight>
                  <TdRight>{formatInQty(row.faultyReturnKg)}</TdRight>
                  <TdRight>{formatInQty(row.currentKg)}</TdRight>
                  <TdRight>{formatInrInteger(row.purchaseValue - row.returnValue)}</TdRight>
                </tr>
              ))}
              {!query.isLoading && stock.length === 0 && <EmptyRow colSpan={5} label="No raw material stock yet." />}
            </tbody>
          </table>
        </div>
      </BoSection>

      <BoSection title="Recent purchases">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="bg-slate-50">
                <Th>Date</Th>
                <Th>Supplier</Th>
                <Th>Mode</Th>
                <Th>Materials</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {recentPurchases.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.date}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{row.supplierName}</td>
                  <td className="px-3 py-2"><ModePill mode={row.billMode} /></td>
                  <td className="px-3 py-2 text-slate-700">{row.materialLines.map((line) => line.materialName).join(', ') || '-'}</td>
                  <TdRight>{formatInrInteger(row.grandTotal)}</TdRight>
                  <td className="px-3 py-2 capitalize text-slate-700">{row.paidStatus}</td>
                </tr>
              ))}
              {!query.isLoading && recentPurchases.length === 0 && <EmptyRow colSpan={6} label="No purchases yet." />}
            </tbody>
          </table>
        </div>
      </BoSection>
    </div>
  )
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
      <PackageCheck size={15} className="text-slate-500" />
      {label}
      <ArrowRight size={13} className="text-slate-400" />
    </Link>
  )
}

function ModePill({ mode }: { mode: 'kacha' | 'gst' }) {
  return <span className={`rounded px-2 py-1 text-xs font-semibold ${mode === 'gst' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}`}>{mode.toUpperCase()}</span>
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className={`border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>
}

function TdRight({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">{children}</td>
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-slate-500">
        {label}
      </td>
    </tr>
  )
}
