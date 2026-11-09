import { Link } from '@tanstack/react-router'
import { Truck, ReceiptText } from 'lucide-react'
import type { EnrichedPurchaseBill, EnrichedSupplierPayment } from '@/data/suppliers'
import { formatFullDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'
import { fmtKg } from './format'

const STATUSES: Record<EnrichedPurchaseBill['status'], string> = {
  nil: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-800',
  open: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

/** Newest five in / newest five out, every row opening its record. */
export function RecentFeeds({
  bills,
  payments,
}: {
  bills: EnrichedPurchaseBill[]
  payments: EnrichedSupplierPayment[]
}) {
  const cardHeader = 'flex items-center justify-between border-b border-border px-4 py-3 bg-secondary/20'
  const rowBtn =
    'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'

  return (
    <section aria-label="Recent activity" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className={cardHeader}>
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
              <Truck size={15} className="text-blue-600" aria-hidden />
              Recent Incoming Bills
            </h2>
            <p className="text-[11px] text-muted-foreground">Latest 5 purchase invoices received</p>
          </div>
          <Link to="/purchase-bills" className="text-xs font-semibold text-blue-700 hover:underline">
            All bills →
          </Link>
        </div>
        <ul className="divide-y divide-border/60">
          {bills.map((bill) => (
            <li key={bill.id}>
              <Link to="/purchase-bills/$billId" params={{ billId: bill.inNo }} className={rowBtn}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {bill.cancelled && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold uppercase text-slate-500">Cancelled</span>}
                    <span className="font-mono text-xs font-bold text-blue-700">{bill.inNo}</span>
                    <span className="text-[11px] text-muted-foreground">{formatFullDate(bill.date)}</span>
                  </div>
                  <span className="mt-0.5 block truncate text-xs font-medium text-foreground">{bill.supplierName}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{fmtKg(bill.totalKg)} kg</span>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block font-mono text-xs font-bold tabular-nums text-foreground">{formatPaiseInr(bill.netPaise)}</span>
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${STATUSES[bill.status]}`}>
                    {bill.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
          {bills.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted-foreground">No purchase bills recorded yet.</li>}
        </ul>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className={cardHeader}>
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
              <ReceiptText size={15} className="text-emerald-600" aria-hidden />
              Recent Outgoing Payments
            </h2>
            <p className="text-[11px] text-muted-foreground">Latest 5 payment settlements</p>
          </div>
          <Link to="/new-supplier-payment" className="text-xs font-semibold text-blue-700 hover:underline">
            New payment →
          </Link>
        </div>
        <ul className="divide-y divide-border/60">
          {payments.map((payment) => (
            <li key={payment.id}>
              <Link to="/purchase-logs" search={{ type: 'payments' }} className={rowBtn} title={payment.cancelled ? 'Cancelled payment' : undefined}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">{payment.supplierName}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-mono font-bold uppercase text-muted-foreground">
                      {payment.mode || 'CASH'}
                    </span>
                  </div>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {formatFullDate(payment.date)} · {payment.kind.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <span className={`block font-mono text-xs font-extrabold tabular-nums ${payment.cancelled ? 'text-muted-foreground line-through' : 'text-emerald-700'}`}>
                    {formatPaiseInr(payment.amountPaise)}
                  </span>
                  {!payment.cancelled && <span className="text-[11px] text-muted-foreground">Settled</span>}
                </div>
              </Link>
            </li>
          ))}
          {payments.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted-foreground">No payments recorded yet.</li>}
        </ul>
      </div>
    </section>
  )
}
