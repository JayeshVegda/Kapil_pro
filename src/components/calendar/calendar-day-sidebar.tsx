import { CalendarDays, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { formatBagCount, formatStockQty } from '@/components/stock/stock-inventory-strip'

type StockLike = { type?: string; unit?: string; bagWeight?: number }

export type CalendarSidebarBill = {
  id: string
  customerId: string
  customerName: string
  billRefDisplay: string
  total: number
  itemLines: Array<{ itemName: string; qty: number; bags: number }>
}

export type CalendarSidebarPayment = {
  id: string
  customerId: string
  customerName: string
  amount: number
  mode: string
  note: string
}

export type CalendarSidebarStockMovement = {
  key: string
  action: 'Received' | 'Adjusted' | 'Sold'
  itemName: string
  customerName: string
  qty: number
  count: number
  notes: string[]
  sample?: StockLike
}

export type CalendarDaySidebarData = {
  date: string
  rate?: number
  sales: number
  collections: number
  stockNet: number
  stockMovements: CalendarSidebarStockMovement[]
  bills: CalendarSidebarBill[]
  payments: CalendarSidebarPayment[]
  stockSample?: StockLike
}

export function CalendarDaySidebar({ data }: { data: CalendarDaySidebarData }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 pb-2">
          <p className="inline-flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <CalendarDays size={12} />
            </span>
            <span className="truncate">Selected day</span>
          </p>
          <h2 className="shrink-0 font-mono text-sm font-bold leading-tight text-slate-950">{formatFullDate(data.date)}</h2>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <DayMetric label="Market" value={data.rate ? formatInrInteger(data.rate) : '-'} tone="text-blue-700" surface="bg-blue-50/70 border-blue-100" />
          <DayMetric label="Collections" value={formatInrInteger(data.collections)} tone="text-emerald-700" surface="bg-emerald-50/70 border-emerald-100" />
          <DayMetric label="Sales" value={`${formatInrInteger(data.sales)} (${data.bills.length})`} tone="text-slate-950" surface="bg-slate-50 border-slate-100" />
          <DayMetric
            label="Stock"
            value={data.stockNet === 0 ? 'No changes' : `${data.stockNet > 0 ? '+' : '-'}${formatBagCount(Math.abs(data.stockNet), data.stockSample)}`}
            tone={data.stockNet >= 0 ? 'text-emerald-700' : 'text-red-700'}
            surface={data.stockNet >= 0 ? 'bg-emerald-50/70 border-emerald-100' : 'bg-red-50/70 border-red-100'}
          />
        </div>
      </div>

      <Collapsible title={`Bills (${data.bills.length})`} defaultOpen>
        {data.bills.length === 0 ? <EmptyState>No bills on this date.</EmptyState> : null}
        <div className="space-y-1.5">
          {data.bills.map((bill) => (
            <div key={bill.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
                  {bill.customerName}
                  <span className="ml-1.5 font-mono text-[11px] font-semibold text-slate-500">Bill {bill.billRefDisplay}</span>
                </p>
                <p className="shrink-0 font-mono text-sm font-bold text-slate-950">{formatInrInteger(bill.total)}</p>
              </div>
              {bill.itemLines.length > 0 ? (
                <p className="mt-1 truncate text-[11px] font-medium text-slate-600" title={bill.itemLines.map((line) => `${shortItemName(line.itemName)} ${formatBillQty(line)}`).join(' · ')}>
                  {bill.itemLines.map((line) => `${shortItemName(line.itemName)} ${formatBillQty(line)}`).join(' · ')}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </Collapsible>

      <Collapsible title={`Payments (${data.payments.length})`} defaultOpen>
        <PaymentGroups payments={data.payments} total={data.collections} />
      </Collapsible>

      <Collapsible title="Stock" defaultOpen={data.stockMovements.length > 0}>
        {data.stockMovements.length === 0 ? <EmptyState>No changes.</EmptyState> : null}
        <div className="space-y-1.5">
          {data.stockMovements.map((row) => (
            <div key={row.key} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{row.itemName}</p>
                <span className={`shrink-0 text-right font-mono text-sm font-bold ${row.qty >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {row.qty >= 0 ? '+' : '-'}{formatBagCount(Math.abs(row.qty), row.sample)} / {formatStockQty(Math.abs(row.qty), row.sample)}
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-slate-500">
                {row.action}
                {row.customerName ? ` · ${row.customerName}` : ''}
                {row.count > 1 ? ` · ${row.count} entries` : ''}
                {row.notes.length > 0 ? ` · ${row.notes.join(' · ')}` : ''}
              </p>
            </div>
          ))}
        </div>
      </Collapsible>
    </div>
  )
}

function PaymentGroups({ payments, total }: { payments: CalendarSidebarPayment[]; total: number }) {
  const groups = [...payments.reduce((map, payment) => {
    const current = map.get(payment.customerId) ?? { customerId: payment.customerId, customerName: payment.customerName, payments: [] as CalendarSidebarPayment[], total: 0 }
    current.payments.push(payment)
    current.total += payment.amount
    map.set(payment.customerId, current)
    return map
  }, new Map<string, { customerId: string; customerName: string; payments: CalendarSidebarPayment[]; total: number }>()).values()]

  if (groups.length === 0) return <EmptyState>No payments on this date.</EmptyState>

  return (
    <div className="space-y-1.5">
      {groups.map((group) => (
        <div key={group.customerId} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{group.customerName}</p>
            <p className="shrink-0 font-mono text-sm font-bold text-emerald-700">{formatInrInteger(group.total)}</p>
          </div>
        </div>
      ))}
      <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-right font-mono text-sm font-bold text-emerald-800">Total: {formatInrInteger(total)}</div>
    </div>
  )
}

function shortItemName(value: string) {
  return value.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
}

function formatBillQty(line: { qty: number; bags: number }) {
  const parts: string[] = []
  if (line.bags > 0) parts.push(`${formatNumber(line.bags)} bags`)
  if (line.qty > 0) parts.push(`${formatNumber(line.qty)} kg`)
  return parts.join(' / ') || '-'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 }).format(value)
}

function DayMetric({ label, value, tone, surface }: { label: string; value: string; tone: string; surface: string }) {
  return (
    <div className={`min-w-0 rounded-md border px-2 py-1.5 ${surface}`}>
      <p className="truncate text-[9px] font-semibold uppercase tracking-[0.07em] text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-[13px] font-bold leading-tight tabular-nums ${tone}`}>{value}</p>
    </div>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2 text-sm text-slate-500">{children}</p>
}

function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-t border-slate-200 pt-2">
      <button type="button" className="flex w-full items-center justify-between gap-3 rounded-lg py-0.5 text-left transition hover:text-blue-700" onClick={() => setOpen((value) => !value)}>
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</span>
        <ChevronRight size={15} className={`text-slate-400 transition ${open ? 'rotate-90' : ''}`} />
      </button>
      {open ? <div className="mt-2">{children}</div> : null}
    </section>
  )
}
