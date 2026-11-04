import { useState } from 'react'
import { RowMenu } from '@/components/ui/row-menu'
import { formatFullDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'
import type { EnrichedSupplierPayment } from '@/data/suppliers'

const KIND_LABEL: Record<string, string> = {
  payment: 'Payment',
  paid_on_behalf: 'Paid for them',
  settle_off: 'Settle-off',
  refund_received: 'Refund',
  bardan_advance: 'Bardan Adv',
}

function PoolChip({ pool }: { pool: string }) {
  return (
    <span
      className={`inline-flex h-4 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold uppercase ${
        pool === 'gst' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
      }`}
    >
      {pool === 'gst' ? 'G' : 'K'}
    </span>
  )
}

export type PaymentsTableRow = EnrichedSupplierPayment

export function SupplierPaymentsTable({
  rows,
  showSupplier = true,
  onOpenDetails,
  onCancel,
  emptyMessage,
}: {
  rows: PaymentsTableRow[]
  showSupplier?: boolean
  onOpenDetails?: (row: PaymentsTableRow) => void
  onCancel?: (row: PaymentsTableRow) => void
  emptyMessage?: string
}) {
  const [sortDesc, setSortDesc] = useState(true)

  const sorted = [...rows].sort((a, b) => (sortDesc ? b.date.localeCompare(a.date) || b.created.localeCompare(a.created) : a.date.localeCompare(b.date) || a.created.localeCompare(b.created)))

  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[880px] border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-slate-50">
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5">
              <button type="button" onClick={() => setSortDesc((v) => !v)} className="inline-flex items-center gap-1 hover:text-slate-800">
                Date {sortDesc ? '↓' : '↑'}
              </button>
            </th>
            {showSupplier && <th className="px-2 py-1.5">Supplier</th>}
            <th className="px-2 py-1.5">Pool</th>
            <th className="px-2 py-1.5">Kind</th>
            <th className="px-2 py-1.5">Mode / Ref</th>
            <th className="px-2 py-1.5">Payee</th>
            <th className="px-2 py-1.5 text-right">Amount</th>
            <th className="px-2 py-1.5 text-right">Allocated</th>
            <th className="px-2 py-1.5 text-right">Advance</th>
            <th className="px-2 py-1.5">Status</th>
            <th className="w-8 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((p) => (
            <tr
              key={p.id}
              onClick={() => onOpenDetails?.(p)}
              className={`h-[34px] cursor-pointer transition hover:bg-slate-50 ${p.cancelled ? 'opacity-60' : ''}`}
            >
              <td className="sticky left-0 z-10 bg-white px-2 py-0 whitespace-nowrap text-slate-600 shadow-[1px_0_0_0_#e2e8f0]">{formatFullDate(p.date)}</td>
              {showSupplier && <td className="px-2 py-0 font-medium text-slate-800"><span className="block max-w-[150px] truncate">{p.supplierName}</span></td>}
              <td className="px-2 py-0"><PoolChip pool={p.pool} /></td>
              <td className="px-2 py-0 text-slate-700">{KIND_LABEL[p.kind] ?? p.kind}</td>
              <td className="px-2 py-0 text-slate-600">
                <span className="uppercase">{p.mode || '—'}</span>
                {p.reference ? <span className="text-slate-400"> · {p.reference}</span> : null}
              </td>
              <td className="px-2 py-0 text-slate-600">{p.payeeName || '—'}</td>
              <td className="px-2 py-0 text-right font-mono tabular-nums text-slate-800">{formatPaiseInr(p.amountPaise)}</td>
              <td className="px-2 py-0 text-right font-mono tabular-nums text-slate-600">{p.appliedPaise > 0 ? formatPaiseInr(p.appliedPaise) : '—'}</td>
              <td className="px-2 py-0 text-right font-mono tabular-nums text-emerald-700">{p.advancePaise > 0 ? formatPaiseInr(p.advancePaise) : '—'}</td>
              <td className="px-2 py-0">
                {p.cancelled ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500 line-through">Cancelled</span>
                ) : (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">Active</span>
                )}
              </td>
              <td className="px-2 py-0 text-right" onClick={(e) => e.stopPropagation()}>
                {!p.cancelled && onCancel && (
                  <RowMenu label="Payment actions" items={[{ label: 'Cancel Payment', danger: true, onSelect: () => onCancel(p) }]} />
                )}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={showSupplier ? 11 : 10} className="px-3 py-6 text-center text-xs italic text-slate-400">
                {emptyMessage ?? 'No supplier payments match.'}
              </td>
            </tr>
          )}
        </tbody>
        {sorted.length > 0 && (
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50/80 font-semibold text-slate-700">
              <td colSpan={showSupplier ? 6 : 5} className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                Totals ({sorted.length})
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(sorted.filter((p) => !p.cancelled).reduce((s, p) => s + p.amountPaise, 0))}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(sorted.filter((p) => !p.cancelled).reduce((s, p) => s + p.appliedPaise, 0))}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(sorted.filter((p) => !p.cancelled).reduce((s, p) => s + p.advancePaise, 0))}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
