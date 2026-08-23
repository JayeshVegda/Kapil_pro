import { Bar, Cell, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RateTrendPoint } from '@/domain/calendar-visuals'
import { formatInrInteger } from '@/lib/inr-format'

const SELLING_COLOR = '#1d4ed8'
const MARKET_COLOR = '#b45309'

type TrendRow = RateTrendPoint & { label: string }

function buildRows(series: Array<RateTrendPoint>): Array<TrendRow> {
  return series.map((point) => ({ ...point, label: String(point.day) }))
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: RateTrendPoint }> }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs shadow-md">
      <p className="font-semibold text-slate-900">Day {point.day}</p>
      <p className="mt-0.5 text-blue-700">Selling {point.selling == null ? '-' : `${formatInrInteger(point.selling)}/kg`}</p>
      <p className="text-amber-700">Market {point.market == null ? '-' : `${formatInrInteger(point.market)}/kg`}</p>
      <p className={point.premium != null && point.premium < 0 ? 'text-rose-700' : 'text-emerald-700'}>
        Premium {point.premium == null ? '-' : `${point.premium >= 0 ? '+' : '-'}${formatInrInteger(Math.abs(point.premium))}/kg`}
      </p>
    </div>
  )
}

export function RateTrendStrip({ series }: { series: Array<RateTrendPoint> }) {
  const rows = buildRows(series)
  const premiumBound = Math.max(50, ...rows.map((row) => Math.abs(row.premium ?? 0)))
  const hasAnySelling = rows.some((row) => row.selling != null)

  if (!hasAnySelling) return null

  return (
    <div className="border-b border-slate-200 px-2 pb-1 pt-2 sm:px-3" data-testid="rate-trend-strip">
      <div className="mb-0.5 flex items-center gap-3 px-1 text-[10px] font-medium text-slate-500">
        <span className="font-semibold uppercase tracking-[0.06em] text-slate-400">Rate trend</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: SELLING_COLOR }} /> Selling</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: MARKET_COLOR }} /> Market</span>
        <span>bars = premium vs market</span>
      </div>
      <div className="h-[76px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 6, bottom: 0, left: 6 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
              interval={4}
            />
            <YAxis hide domain={['dataMin - 20', 'dataMax + 20']} />
            <YAxis yAxisId="premium" hide domain={[-premiumBound, premiumBound]} />
            <Tooltip content={<TrendTooltip />} />
            <Bar yAxisId="premium" dataKey="premium" barSize={3} radius={1} name="Premium">
              {rows.map((row) => (
                <Cell
                  key={row.day}
                  fill={(row.premium ?? 0) >= 0 ? '#10b981' : '#f43f5e'}
                  fillOpacity={row.premium == null ? 0 : 0.75}
                />
              ))}
            </Bar>
            <Line type="monotone" dataKey="market" stroke={MARKET_COLOR} strokeWidth={1.5} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="selling" stroke={SELLING_COLOR} strokeWidth={2} dot={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
