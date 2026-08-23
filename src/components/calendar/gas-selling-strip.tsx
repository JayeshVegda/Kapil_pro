import type { GasSalesGroup } from '@/domain/gas-sales-reporting'
import { formatInrInteger } from '@/lib/inr-format'

function formatKgRate(value: number | null | undefined) {
  return value != null && value > 0 ? `${formatInrInteger(Math.round(value))}/kg` : null
}

function ItemChip({ item }: { item: GasSalesGroup }) {
  const buckets: Array<{ key: string; tag: string | null; rate: string | null; premium: number | null }> = []
  if (item.nonGst) {
    buckets.push({ key: 'plain', tag: item.gst ? 'plain' : null, rate: formatKgRate(item.nonGst.weightedSellingRate), premium: item.nonGst.premiumPerKg })
  }
  if (item.gst) {
    buckets.push({ key: 'gst', tag: 'GST incl.', rate: formatKgRate(item.gst.weightedSellingRateWithGst ?? item.gst.weightedSellingRate), premium: null })
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
      <span className="font-semibold text-slate-900">{item.label}</span>
      <span className="text-amber-700 tabular-nums">{formatBags(item.bags)}</span>
      {buckets.map((bucket) => (
        <span key={bucket.key} className="tabular-nums">
          {bucket.tag && <span className="text-slate-400">{bucket.tag} </span>}
          <span className={bucket.key === 'gst' ? 'text-sky-700' : 'text-blue-700'}>{bucket.rate}</span>
        </span>
      ))}
      {buckets[0]?.premium != null && (
        <span className={`font-semibold tabular-nums ${buckets[0].premium >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {buckets[0].premium >= 0 ? '+' : '-'}{formatInrInteger(Math.abs(Math.round(buckets[0].premium)))} vs mkt
        </span>
      )}
    </span>
  )
}

function formatBags(value: number) {
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)} bags`
}

/** One-line-per-item gas selling summary replacing the old chart + legend band. */
export function GasSellingStrip({ items }: { items: Array<GasSalesGroup> }) {
  if (items.length === 0) return null
  return (
    <div className="border-b border-slate-200 bg-slate-50/60 px-3 py-2 sm:px-4" data-testid="gas-selling-strip">
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">Gas selling</span>
        {items.map((item) => <ItemChip key={item.key} item={item} />)}
      </div>
    </div>
  )
}
