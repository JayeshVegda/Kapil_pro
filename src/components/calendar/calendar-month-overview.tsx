import { formatMonthYear } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { Activity, CircleDollarSign, ReceiptText, TrendingUp, type LucideIcon } from 'lucide-react'
import type { MonthlyItemComparisons } from '@/domain/monthly-item-rollup'
import type { GasSalesMetrics } from '@/domain/gas-sales-reporting'

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
  soldBags: number
  soldKg: number
  gas: GasSalesMetrics
  leadingGasItem: { name: string; kg: number; bags: number } | null
}

export function CalendarMonthOverview({ monthKey, sales, collections, avgRate, netPosition, topBuyer, topCollection, rateDelta, itemComparisons, soldBags, soldKg, gas, leadingGasItem }: CalendarMonthOverviewProps) {
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
        <OverviewLine icon={TrendingUp} label="Gas selling rate" value={gas.weightedSellingRate == null ? '-' : `${formatInrInteger(gas.weightedSellingRate)}/kg`} detail={gas.premiumPerKg == null ? 'Bill market comparison unavailable' : `${gas.premiumPerKg >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(gas.premiumPerKg))}/kg vs bill market`} tone="text-blue-800" iconTone="bg-blue-50 text-blue-700" />
        <OverviewLine icon={ReceiptText} label="Leading gas item" value={leadingGasItem?.name ?? '-'} detail={leadingGasItem ? `${formatNumber(leadingGasItem.kg)} kg · ${formatNumber(leadingGasItem.bags)} bags` : 'No gas sales yet'} tone="text-slate-800" iconTone="bg-slate-100 text-slate-600" />
        <OverviewLine icon={Activity} label="Collection cover" value={sales > 0 ? `${Math.round((collections / sales) * 100)}%` : '-'} detail={netPosition >= 0 ? `${formatInrInteger(netPosition)} surplus` : `${formatInrInteger(Math.abs(netPosition))} gap`} tone={netPosition >= 0 ? 'text-emerald-800' : 'text-red-700'} iconTone={netPosition >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'} />
        <OverviewLine icon={ReceiptText} label="Sold volume" value={`${formatNumber(soldBags)} bags`} detail={`${formatNumber(soldKg)} kg from bills`} tone="text-amber-800" iconTone="bg-amber-50 text-amber-700" />
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
