import type { CurrentStockRecord, MonthlyStockReportRow } from '@/data/stock'
import { formatInQty } from '@/lib/inr-format'

export type StockInventorySummary = {
  buckets: number
  stock: number
  currentReceived: number
  currentSold: number
  previousReceived: number
  previousSold: number
  yearReceived: number
  yearSold: number
  currentMonthClosing: number
  previousMonthClosing: number
  netChange: number
  percentage: number
}

export function buildStockInventorySummary({
  stockItems,
  currentRows,
  previousRows,
  fiscalRows,
}: {
  stockItems: CurrentStockRecord[]
  currentRows: MonthlyStockReportRow[]
  previousRows: MonthlyStockReportRow[]
  fiscalRows: MonthlyStockReportRow[]
}): StockInventorySummary {
  const stock = stockItems.reduce((sum, item) => sum + item.currentStock, 0)
  const currentMonthClosing = currentRows.reduce((sum, row) => sum + row.closing, 0)
  const previousMonthClosing = previousRows.reduce((sum, row) => sum + row.closing, 0)
  const netChange = currentMonthClosing - previousMonthClosing
  const percentage = previousMonthClosing ? (netChange / Math.abs(previousMonthClosing)) * 100 : currentMonthClosing ? 100 : 0

  return {
    buckets: stockItems.length,
    stock,
    currentReceived: currentRows.reduce((sum, row) => sum + row.stockIn, 0),
    currentSold: currentRows.reduce((sum, row) => sum + row.sold, 0),
    previousReceived: previousRows.reduce((sum, row) => sum + row.stockIn, 0),
    previousSold: previousRows.reduce((sum, row) => sum + row.sold, 0),
    yearReceived: fiscalRows.reduce((sum, row) => sum + row.stockIn, 0),
    yearSold: fiscalRows.reduce((sum, row) => sum + row.sold, 0),
    currentMonthClosing,
    previousMonthClosing,
    netChange,
    percentage,
  }
}

export function StockInventoryStrip({
  rows,
  summary,
  item,
  onSelect,
}: {
  rows: CurrentStockRecord[]
  summary: StockInventorySummary
  item?: CurrentStockRecord
  onSelect: (item: CurrentStockRecord) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 min-[760px]:grid-cols-2 min-[1180px]:grid-cols-4 min-[1560px]:grid-cols-5">
      <SummaryCard summary={summary} item={item} />
      {rows.length === 0 && <p className="rounded-lg border border-slate-200 bg-white px-3 py-10 text-center text-sm text-slate-500 shadow-sm min-[760px]:col-span-1">No stock buckets found.</p>}
      {rows.map((row) => (
        <InventoryCard key={row.id} item={row} onClick={() => onSelect(row)} />
      ))}
    </div>
  )
}

function SummaryCard({ summary, item }: { summary: StockInventorySummary; item?: CurrentStockRecord }) {
  const trendLabel = summary.netChange >= 0 ? 'up' : 'down'
  const netBags = Math.abs(kgToBags(summary.netChange, item))

  return (
    <article className="min-h-[160px] overflow-hidden rounded-lg border border-blue-900/70 bg-[#173d8f] p-3 text-white shadow-sm min-[1180px]:col-span-2">
      <div className="flex h-full flex-col justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-blue-100/80">Total Inventory</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-mono text-3xl font-bold leading-none tracking-tight">{formatBagCount(summary.stock, item)}</p>
            <p className="font-mono text-sm font-semibold text-blue-100/90">{formatStockQty(summary.stock, item)}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 text-xs min-[460px]:grid-cols-3">
          <BlueMetric label="This Month" made={summary.currentReceived} sold={summary.currentSold} item={item} />
          <BlueMetric label="Last Month" made={summary.previousReceived} sold={summary.previousSold} item={item} sub={`${netBags.toFixed(netBags >= 10 ? 0 : 1)} bags ${trendLabel} (${formatPercent(summary.percentage)})`} />
          <BlueMetric label="Financial Year" made={summary.yearReceived} sold={summary.yearSold} item={item} />
        </div>
      </div>
    </article>
  )
}

function BlueMetric({ label, made, sold, item, sub }: { label: string; made: number; sold: number; item?: CurrentStockRecord; sub?: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.08] px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.08em] text-blue-100/80">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-semibold">Made {formatBagCount(made, item)}</p>
      <p className="truncate font-mono text-[11px] text-blue-100/80">{formatStockQty(made, item)}</p>
      <p className="mt-1 truncate font-mono text-xs font-semibold">Sold {formatBagCount(sold, item)}</p>
      <p className="truncate font-mono text-[11px] text-blue-100/80">{formatStockQty(sold, item)}</p>
      {sub && <p className="mt-1 truncate text-[10px] text-blue-100/80">{sub}</p>}
    </div>
  )
}

function InventoryCard({ item, onClick }: { item: CurrentStockRecord; onClick: () => void }) {
  const net = item.stockInThisMonth + item.adjustmentThisMonth - item.soldThisMonth

  return (
    <button
      type="button"
      className="min-h-[160px] overflow-hidden rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-200 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-300/50"
      onClick={onClick}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-[15px] font-semibold tracking-tight text-slate-950">{item.itemName}</h4>
          <p className="mt-0.5 truncate text-xs text-slate-500">{item.customerName}</p>
        </div>
        <div>
          <p className={`font-mono text-2xl font-bold leading-none tracking-tight ${item.currentStock < 0 ? 'text-red-700' : 'text-slate-950'}`}>{formatBagCount(item.currentStock, item)}</p>
          <p className="mt-1 font-mono text-xs font-semibold text-slate-500">{formatStockQty(item.currentStock, item)}</p>
        </div>
        <div className="grid grid-cols-3 border-t border-slate-100 pt-2 text-[11px]">
          <MovementMetric label="In" value={formatBagCount(item.stockInThisMonth, item)} tone="green" />
          <MovementMetric label="Sold" value={formatBagCount(item.soldThisMonth, item)} tone="red" />
          <MovementMetric label="Net" value={formatBagCount(net, item)} tone={net < 0 ? 'red' : 'green'} />
        </div>
      </div>
    </button>
  )
}

function MovementMetric({ label, value, tone }: { label: string; value: string; tone: 'green' | 'red' }) {
  const toneClass = tone === 'green' ? 'text-emerald-700' : 'text-red-700'
  return (
    <div className="min-w-0 border-l border-slate-100 px-2 first:border-l-0 first:pl-0 last:pr-0">
      <p className="text-[10px] uppercase tracking-[0.06em] text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-mono font-semibold ${toneClass}`}>{value}</p>
    </div>
  )
}

export function kgToBags(value: number, item?: { type?: string; bagWeight?: number } | null) {
  if (item?.type !== 'gas') return value
  return value / (item.bagWeight || 50)
}

function unitLabel(item?: { unit: string } | null) {
  if (!item?.unit) return 'kg'
  return item.unit === 'piece' ? 'pieces' : item.unit
}

export function formatBagCount(qty: number, item?: { type?: string; bagWeight?: number } | null) {
  if (item?.type !== 'gas') return formatInQty(qty, 'kg')
  const bagWeight = item.bagWeight || 50
  const bags = qty / bagWeight
  return `${bags.toFixed(Number.isInteger(bags) ? 0 : 1)} bags`
}

export function formatStockQty(qty: number, item?: { type?: string; unit?: string; bagWeight?: number } | null) {
  if (item?.type === 'gas') return formatInQty(qty, 'kg')
  return formatInQty(qty, unitLabel(item ? { unit: item.unit ?? '' } : null))
}

export function formatPercent(value: number) {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`
}
