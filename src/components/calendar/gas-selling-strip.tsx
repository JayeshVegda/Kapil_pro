import type { GasSalesGroup } from '@/domain/gas-sales-reporting'

function formatBags(value: number) {
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)} bags`
}

function ItemChip({ item }: { item: GasSalesGroup }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
      <span className="font-semibold text-slate-900">{item.label}</span>
      <span className="text-amber-700 tabular-nums">{formatBags(item.bags)}</span>
      <span className="text-slate-500 tabular-nums">{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(item.kg))} kg</span>
    </span>
  )
}

/** One-line-per-item gas volume summary. */
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
