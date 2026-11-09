import { Link } from '@tanstack/react-router'
import { ArrowRight, Wallet } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import type { SupplierSummary } from '@/data/suppliers'
import { formatPaiseInr, formatInrInteger } from '@/lib/inr-format'

/**
 * Supplier attention: who to pay, sorted by largest outstanding. The whole
 * card opens that supplier's ledger in the suppliers hub; the Pay button
 * jumps straight to the payment voucher.
 */
export function PayNext({ rows }: { rows: SupplierSummary[] }) {
  return (
    <Panel className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground">Pay Next</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Largest supplier balances first — card opens the ledger</p>
        </div>
        <Link
          to="/suppliers"
          className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
        >
          All suppliers <ArrowRight size={12} aria-hidden />
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          All suppliers are fully settled. No pending dues.
        </p>
      ) : (
        <div className="mt-3 grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2">
          {rows.map((row) => {
            const tense = row.oldestDueDays != null && row.oldestDueDays >= 60 ? 'urgent' : row.oldestDueDays != null && row.oldestDueDays >= 30 ? 'warn' : 'calm'
            return (
              <div
                key={row.supplier.id}
                className="group relative overflow-hidden rounded-lg border border-border bg-card transition hover:border-blue-300"
              >
                <Link
                  to="/suppliers"
                  search={{ supplierId: row.supplier.id }}
                  className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`Open ${row.supplier.companyName} ledger`}
                />
                <div className="pointer-events-none relative flex h-full flex-col p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-xs font-bold text-foreground">{row.supplier.companyName}</span>
                    {row.supplier.city && <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{row.supplier.city}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {row.oldestDueDays != null && (
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold ${
                          tense === 'urgent' ? 'bg-rose-50 text-rose-800' : tense === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-secondary text-muted-foreground'
                        }`}
                      >
                        {row.oldestDueDays}d unpaid
                      </span>
                    )}
                    {row.bardanPendingCount > 0 && (
                      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-800">
                        {row.bardanPendingCount} bardan
                      </span>
                    )}
                    {row.advancePaise > 0 && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-700">
                        ₹{formatInrInteger(row.advancePaise / 100)} adv
                      </span>
                    )}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
                    <span className="font-mono text-sm font-extrabold tabular-nums text-foreground">
                      {formatPaiseInr(row.outstandingPaise)}
                    </span>
                    <Link
                      to="/new-supplier-payment"
                      search={{ supplierId: row.supplier.id }}
                      className="pointer-events-auto inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      title={`Record payment to ${row.supplier.companyName}`}
                    >
                      <Wallet size={12} aria-hidden /> Pay
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
