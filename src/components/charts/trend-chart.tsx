import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART_THEME } from './chart-theme'
import { cn } from '@/lib/utils'

export type TrendSeries = {
  dataKey: string
  name: string
  color?: string
  type?: 'bar' | 'line'
  dashed?: boolean
  yAxisId?: string
}

export type TrendChartProps = {
  data: readonly Record<string, unknown>[]
  xKey: string
  series: readonly TrendSeries[]
  height?: number
  formatY?: (value: number) => string
  formatTooltip?: (value: number) => string
  className?: string
  ariaLabel?: string
}

/**
 * Standard Recharts wrapper with unified executive blue/emerald palette and semantic benchmarking.
 * Capped at 24 points to keep rendering performant.
 */
export function TrendChart({
  data,
  xKey,
  series,
  height = 220,
  formatY = (v) => v.toLocaleString('en-IN'),
  formatTooltip = (v) => v.toLocaleString('en-IN'),
  className,
  ariaLabel = 'Trend chart',
}: TrendChartProps) {
  // Cap at 24 points
  const points = (data ?? []).slice(-24)

  if (points.length === 0) {
    return (
      <div
        style={{ height }}
        className={cn('flex items-center justify-center text-xs text-slate-400', className)}
      >
        No trend data available for this period.
      </div>
    )
  }

  const hasSecondaryAxis = series.some((s) => s.yAxisId === 'right')

  return (
    <div style={{ height }} className={cn('w-full', className)} aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.colors.grid} vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: CHART_THEME.typography.fontSize, fill: CHART_THEME.colors.text }}
            axisLine={{ stroke: CHART_THEME.colors.axis }}
            tickLine={false}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: CHART_THEME.typography.fontSize, fill: CHART_THEME.colors.text }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatY}
          />
          {hasSecondaryAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: CHART_THEME.typography.fontSize, fill: CHART_THEME.colors.text }}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatY}
            />
          )}
          <Tooltip
            contentStyle={CHART_THEME.tooltipStyle}
            formatter={(value: unknown) => [
              formatTooltip(Number(value) || 0),
              '',
            ]}
          />
          {series.length > 1 && (
            <Legend
              wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
              iconType="circle"
              iconSize={8}
            />
          )}

          {series.map((s, idx) => {
            const color =
              s.color ??
              (idx === 0
                ? CHART_THEME.colors.primary
                : idx === 1
                  ? CHART_THEME.colors.secondary
                  : CHART_THEME.colors.neutral)

            if (s.type === 'line') {
              return (
                <Line
                  key={s.dataKey}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.name}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? '4 4' : undefined}
                  dot={{ r: 3, fill: color }}
                  activeDot={{ r: 5 }}
                  yAxisId={s.yAxisId ?? 'left'}
                />
              )
            }

            return (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.name}
                fill={color}
                radius={[4, 4, 0, 0]}
                yAxisId={s.yAxisId ?? 'left'}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
