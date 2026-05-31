import { formatMonthYear } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { formatBagCount } from '@/components/stock/stock-inventory-strip'
import { Activity, CircleDollarSign, PackageCheck, ReceiptText, TrendingUp, type LucideIcon } from 'lucide-react'
import type { MonthlyItemComparisons } from '@/domain/monthly-item-rollup'

export type CalendarStockSample = { type?: string; unit?: string; bagWeight?: number } | null | undefined

export type CalendarMonthOverviewProps = {
  monthKey: string
  sales: number
  collections: number
  avgRate: number | null
  netPosition: number
  topBuyer: { customerName: string; sales: number; bags: number; qty: number; avgRate: number } | null
  topCollection: { customerName: string; amount: number } | null
  rateDelta: number | null
  itemComparisons: MonthlyItemComparisons
  stock: {
    opening: number
    received: number
    sold: number
    adjustment: number
    closing: number
    net: number
    sample?: CalendarStockSample
    itemLines: Array<{ itemName: string; received: number; sold: number; adjustment: number; closing: number; bagWeight?: number; type?: string; unit?: string }>
  }
}

export function CalendarMonthOverview({ monthKey, sales, collections, avgRate, netPosition, topBuyer, topCollection, rateDelta, itemComparisons, stock }: CalendarMonthOverviewProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-700 p-4 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-blue-100/85">Month signals</p>
        <h2 className="mt-1 text-xl font-bold leading-tight">{formatMonthYear(monthKey)}</h2>
        <div className="mt-3 space-y-1.5">
          <SignalLine label="Spindle" value={`${formatNumber(itemComparisons.spindle.bags)} bags`} detail={formatVsLastMonth(itemComparisons.spindle.bags, itemComparisons.spindle.previousBags, 'bags')} />
          <SignalLine label="Tapper Plug" value={`${formatNumber(itemComparisons.tapperPlug.bags)} bags`} detail={formatVsLastMonth(itemComparisons.tapperPlug.bags, itemComparisons.tapperPlug.previousBags, 'bags')} />
          <SignalLine label="Tapper Plug Parties" value={`${formatNumber(itemComparisons.tapperPlug.partyCount)}`} detail={formatVsLastMonth(itemComparisons.tapperPlug.partyCount, itemComparisons.tapperPlug.previousPartyCount, 'party')} />
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <OverviewLine icon={ReceiptText} label="Top buyer" value={topBuyer ? topBuyer.customerName : '-'} detail={topBuyer ? `${formatInrInteger(topBuyer.sales)} · ${formatNumber(topBuyer.bags)} bags · avg ${formatInrInteger(topBuyer.avgRate)}` : 'No sales yet'} tone="text-blue-800" iconTone="bg-blue-50 text-blue-700" />
        <OverviewLine icon={CircleDollarSign} label="Top collection" value={topCollection ? topCollection.customerName : '-'} detail={topCollection ? formatInrInteger(topCollection.amount) : 'No collection yet'} tone="text-emerald-800" iconTone="bg-emerald-50 text-emerald-700" />
        <OverviewLine icon={TrendingUp} label="Rate movement" value={avgRate != null ? formatInrInteger(Math.round(avgRate)) : '-'} detail={rateDelta == null ? 'No last-month rate' : `${rateDelta >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(rateDelta))} vs last month`} tone="text-sky-800" iconTone="bg-sky-50 text-sky-700" />
        <OverviewLine icon={Activity} label="Collection cover" value={sales > 0 ? `${Math.round((collections / sales) * 100)}%` : '-'} detail={netPosition >= 0 ? `${formatInrInteger(netPosition)} surplus` : `${formatInrInteger(Math.abs(netPosition))} gap`} tone={netPosition >= 0 ? 'text-emerald-800' : 'text-red-700'} iconTone={netPosition >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'} />
      </div>

      <Divider />

      <div>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <PackageCheck size={15} />
          </span>
          Stock movement
        </div>
        <div className="mt-3 space-y-2 text-sm">
          {stock.itemLines.slice(0, 5).map((row) => (
            <OverviewLine
              key={`${row.itemName}-${row.received}-${row.sold}`}
              label={row.itemName}
              value={formatBagCount(row.closing, row)}
              detail={`In ${formatBagCount(row.received, row)} · Sold ${formatBagCount(row.sold, row)}${row.adjustment ? ` · Adj ${formatBagCount(row.adjustment, row)}` : ''}`}
            />
          ))}
          {stock.itemLines.length === 0 ? <OverviewLine label="No stock movement" value="-" /> : null}
          <OverviewLine
            label="Total net"
            value={`${stock.net > 0 ? '+' : stock.net < 0 ? '-' : '±'}${formatBagCount(Math.abs(stock.net), stock.sample)}`}
            tone={stock.net >= 0 ? 'text-emerald-800' : 'text-red-700'}
            detail={`Opening ${formatBagCount(stock.opening, stock.sample)} · Closing ${formatBagCount(stock.closing, stock.sample)}`}
          />
        </div>
      </div>
    </div>
  )
}

function OverviewLine({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'text-slate-900',
  iconTone = 'bg-slate-100 text-slate-500',
}: {
  icon?: LucideIcon
  label: string
  value: string
  detail?: string
  tone?: string
  iconTone?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 truncate text-slate-600">
        {Icon ? (
          <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${iconTone}`}>
            <Icon size={14} />
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="block truncate">{label}</span>
          {detail ? <span className="mt-0.5 block truncate text-xs text-slate-500">{detail}</span> : null}
        </span>
      </span>
      <span className={`shrink-0 font-mono font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  )
}

function Divider() {
  return <div className="h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
}

function SignalLine({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-semibold text-blue-50">{label}</span>
        <span className="shrink-0 font-mono font-bold text-white">{value}</span>
      </div>
      <p className="mt-0.5 truncate text-[11px] font-medium text-blue-100/85">{detail}</p>
    </div>
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)
}

function formatVsLastMonth(current: number, previous: number, unit = '') {
  const delta = Math.round(current - previous)
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '±'
  const suffix = unit ? ` ${unit}` : ''
  return `vs ${sign}${formatNumber(Math.abs(delta))}${suffix} (${formatNumber(previous)} last month)`
}
