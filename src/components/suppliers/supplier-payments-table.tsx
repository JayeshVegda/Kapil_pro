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
      className={`inline-flex h-4 min-w-5 items-center justify-center rounded px-1 text-[11px] font-bold uppercase ${
        pool === 'gst' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
      }`}
    >
      {pool === 'gst' ? 'GST' : 'Kacha'}
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

  const sorted = [...rows].sort((a, b) =>
    sortDesc
      ? b.date.localeCompare(a.date) || b.created.localeCompare(a.created)
      : a.date.localeCompare(b.date) || a.created.localeCompare(b.created),
  )

  const activeRows = sorted.filter((p) => !p.cancelled)
  const totalAmount = activeRows.reduce((s, p) => s + p.amountPaise, 0)
  const totalApplied = activeRows.reduce((s, p) => s + p.appliedPaise, 0)
  const totalAdvance = activeRows.reduce((s, p) => s + p.advancePaise, 0)

  return (
    <div className="min-w-0">
      {/* Desktop Table View (>= 768px) */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
        <table className="w-full min-w-[880px] border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-secondary/80 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr className="text-left">
              <th className="px-3.5 py-2.5">
                <button
                  type="button"
                  onClick={() => setSortDesc((v) => !v)}
                  className="inline-flex items-center gap-1 hover:text-foreground transition"
                >
                  Date {sortDesc ? '↓' : '↑'}
                </button>
              </th>
              {showSupplier && <th className="px-3.5 py-2.5">Supplier</th>}
              <th className="px-3.5 py-2.5">Pool</th>
              <th className="px-3.5 py-2.5">Kind</th>
              <th className="px-3.5 py-2.5">Mode / Ref</th>
              <th className="px-3.5 py-2.5">Payee</th>
              <th className="px-3.5 py-2.5 text-right">Amount</th>
              <th className="px-3.5 py-2.5 text-right">Allocated</th>
              <th className="px-3.5 py-2.5 text-right">Advance Left</th>
              <th className="px-3.5 py-2.5">Status</th>
              <th className="w-8 px-2 py-2.5 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {sorted.map((p) => (
              <tr
                key={p.id}
                onClick={() => onOpenDetails?.(p)}
                className={`h-9 cursor-pointer transition hover:bg-secondary/40 ${
                  p.cancelled ? 'opacity-60 bg-secondary/10' : ''
                }`}
              >
                <td className="px-3.5 py-1.5 whitespace-nowrap font-mono text-muted-foreground">
                  {formatFullDate(p.date)}
                </td>
                {showSupplier && (
                  <td className="px-3.5 py-1.5 font-bold text-foreground">
                    <span className="block max-w-[160px] truncate">{p.supplierName}</span>
                  </td>
                )}
                <td className="px-3.5 py-1.5"><PoolChip pool={p.pool} /></td>
                <td className="px-3.5 py-1.5 text-foreground font-medium">{KIND_LABEL[p.kind] ?? p.kind}</td>
                <td className="px-3.5 py-1.5 text-muted-foreground font-mono">
                  <span className="uppercase font-semibold text-foreground">{p.mode || '—'}</span>
                  {p.reference ? <span className="text-muted-foreground/80"> · {p.reference}</span> : null}
                </td>
                <td className="px-3.5 py-1.5 text-muted-foreground truncate max-w-[140px]">{p.payeeName || '—'}</td>
                <td className="px-3.5 py-1.5 text-right font-mono font-bold tabular-nums text-foreground">
                  {formatPaiseInr(p.amountPaise)}
                </td>
                <td className="px-3.5 py-1.5 text-right font-mono font-medium tabular-nums text-muted-foreground">
                  {p.appliedPaise > 0 ? formatPaiseInr(p.appliedPaise) : <span className="text-muted-foreground/40">—</span>}
                </td>
                <td className="px-3.5 py-1.5 text-right font-mono font-semibold tabular-nums text-emerald-700">
                  {p.advancePaise > 0 ? formatPaiseInr(p.advancePaise) : <span className="text-muted-foreground/40">—</span>}
                </td>
                <td className="px-3.5 py-1.5">
                  {p.cancelled ? (
                    <span className="rounded bg-secondary px-1.5 py-0.2 text-[11px] font-bold uppercase text-muted-foreground line-through">
                      Cancelled
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 text-[11px] font-bold uppercase text-emerald-700">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                  {!p.cancelled && onCancel && (
                    <RowMenu
                      label="Payment actions"
                      items={[{ label: 'Cancel Payment', danger: true, onSelect: () => onCancel(p) }]}
                    />
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={showSupplier ? 11 : 10}
                  className="px-4 py-8 text-center text-xs italic text-muted-foreground"
                >
                  {emptyMessage ?? 'No supplier payments match.'}
                </td>
              </tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-secondary/80 font-bold text-foreground">
                <td colSpan={showSupplier ? 6 : 5} className="px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Totals ({activeRows.length} active of {sorted.length})
                </td>
                <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-foreground">
                  {formatPaiseInr(totalAmount)}
                </td>
                <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                  {formatPaiseInr(totalApplied)}
                </td>
                <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-emerald-700">
                  {formatPaiseInr(totalAdvance)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Mobile Card View (< 768px) */}
      <div className="block md:hidden divide-y divide-border/60 rounded-xl border border-border bg-card overflow-hidden shadow-xs">
        {sorted.map((p) => (
          <div
            key={p.id}
            data-testid="mobile-payment-card"
            onClick={() => onOpenDetails?.(p)}
            className={`p-3.5 space-y-2 transition active:bg-secondary/40 cursor-pointer ${
              p.cancelled ? 'opacity-60 bg-secondary/20' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <PoolChip pool={p.pool} />
                  <span className="font-bold text-foreground text-xs truncate">
                    {showSupplier ? p.supplierName : KIND_LABEL[p.kind] ?? p.kind}
                  </span>
                  {p.cancelled && (
                    <span className="rounded bg-secondary px-1 py-0.2 text-[11px] font-bold uppercase text-muted-foreground line-through">
                      Cancelled
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  <span>{formatFullDate(p.date)}</span>
                  <span className="uppercase font-mono"> · {p.mode || '—'}</span>
                  {p.reference && <span className="font-mono"> · {p.reference}</span>}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="font-mono text-sm font-bold tabular-nums text-foreground">
                  {formatPaiseInr(p.amountPaise)}
                </p>
                {p.advancePaise > 0 && (
                  <p className="text-[11px] font-semibold text-emerald-700">
                    +{formatPaiseInr(p.advancePaise)} adv
                  </p>
                )}
              </div>
            </div>

            {p.payeeName && (
              <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-1">
                Payee: <strong className="text-foreground">{p.payeeName}</strong>
              </p>
            )}
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="px-4 py-8 text-center text-xs italic text-muted-foreground">
            {emptyMessage ?? 'No supplier payments match.'}
          </p>
        )}
      </div>
    </div>
  )
}
