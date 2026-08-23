import { formatMonthYear } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { Activity, CircleDollarSign, ReceiptText, TrendingUp, type LucideIcon } from 'lucide-react'
import type { MonthlyItemComparisons } from '@/domain/monthly-item-rollup'

export type CalendarMonthOverviewProps = {
  monthKey: string
  avgRate: number | null
  rateDelta: number | null
  topBuyer: { customerName: string; sales: number; bags: number; qty: number; avgRate: number } | null
  topCollection: { customerName: string; amount: number } | null
  itemComparisons: MonthlyItemComparisons
  leadingGasItem: { name: string; kg: number; bags: number } | null
  bestDay: { day: number; sales: number } | null
}

export function CalendarMonthOverview({ monthKey, avgRate, rateDelta, topBuyer, topCollection, itemComparisons, leadingGasItem, bestDay }: CalendarMonthOverviewProps) {
  const mixRows = [
    { label: 'Spindle 7.5GM', metric: itemComparisons.spindle75 },
    { label: 'Spindle 8.5GM', metric: itemComparisons.spindle85 },
    { label: 'Tapper Plug', metric: itemComparisons.tapperPlug },
  ]
  const totalBags = mixRows.reduce((sum, row) => sum + row.metric.bags, 0)

  return (
    <div className="space-y-5" data-testid="month-context-panel">
      <div className="rounded-xl bg-blue-700 p-4 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-blue-100/85">Month context</p>
        <h2 className="mt-1 text-xl font-bold leading-tight">{formatMonthYear(monthKey)}</h2>
        <div className="mt-3 space-y-2">
          {totalBags > 0 ? (
            mixRows.map((row) => {
              const share = totalBags > 0 ? row.metric.bags / totalBags : 0
              const delta = Math.round(row.metric.bags - row.metric.previousBags)
              return (
                <div key={row.label}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate font-semibold text-blue-50">{row.label}</span>
                    <span className="shrink-0 font-mono font-bold text-white tabular-nums">{formatNumber(row.metric.bags)} bags</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full rounded-full bg-white/80" style={{ width: `${Math.max(share * 100, 2)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] font-medium text-blue-100/85">
                    {Math.round(share * 100)}% of volume · {delta >= 0 ? '+' : '-'}{formatNumber(Math.abs(delta))} ({formatNumber(row.metric.previousBags)} last month)
                  </p>
                </div>
              )
            })
          ) : (
            <p className="text-xs font-medium text-blue-100/85">No item sales yet this month.</p>
          )}
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <OverviewLine icon={ReceiptText} label="Top buyer" value={topBuyer ? topBuyer.customerName : '-'} detail={topBuyer ? `${formatInrInteger(topBuyer.sales)} · ${formatNumber(topBuyer.bags)} bags · avg ${formatInrInteger(topBuyer.avgRate)}` : 'No sales yet'} tone="text-blue-800" iconTone="bg-blue-50 text-blue-700" />
        <OverviewLine icon={CircleDollarSign} label="Top collection" value={topCollection ? topCollection.customerName : '-'} detail={topCollection ? formatInrInteger(topCollection.amount) : 'No collection yet'} tone="text-emerald-800" iconTone="bg-emerald-50 text-emerald-700" />
        <OverviewLine icon={TrendingUp} label="Rate movement" value={avgRate != null ? `${formatInrInteger(Math.round(avgRate))}/kg` : '-'} detail={rateDelta == null ? 'No last-month rate' : `${rateDelta >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(rateDelta))}/kg vs last month`} tone="text-sky-800" iconTone="bg-sky-50 text-sky-700" />
        <OverviewLine icon={ReceiptText} label="Leading gas item" value={leadingGasItem?.name ?? '-'} detail={leadingGasItem ? `${formatNumber(leadingGasItem.kg)} kg · ${formatNumber(leadingGasItem.bags)} bags` : 'No gas sales yet'} tone="text-slate-800" iconTone="bg-slate-100 text-slate-600" />
        <OverviewLine icon={Activity} label="Best sales day" value={bestDay ? `Day ${bestDay.day}` : '-'} detail={bestDay ? formatInrInteger(bestDay.sales) : 'No sales yet'} tone="text-slate-900" iconTone="bg-amber-50 text-amber-700" />
      </div>

      <Divider />
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

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)
}
