import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatFullDate, formatMonthYear } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

const BLUE = '#3b82f6'
const GREEN = '#10b981'
const SLATE = '#64748b'
const GRID = '#e2e8f0'

export function compactInr(value: number) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(1)}Cr`
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(1)}L`
  if (abs >= 1_000) return `${sign}₹${Math.round(abs / 1_000)}k`
  return `${sign}₹${Math.round(abs)}`
}

const tooltipStyle = { fontSize: 12, borderRadius: 8, borderColor: GRID } as const

/** Monthly sales vs collections, the report's main trend view. */
export function SalesCollectionTrendChart({ data }: { data: Array<{ month: string; sales: number; collections: number }> }) {
  if (data.length === 0) return <p className="py-10 text-center text-xs text-slate-400">No monthly activity yet.</p>
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="26%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={formatMonthYear} tick={{ fontSize: 11, fill: SLATE }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
        <YAxis tickFormatter={compactInr} tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} width={54} />
        <Tooltip
          cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
          formatter={(value, name) => [formatInrInteger(Number(value ?? 0)), String(name ?? '')]}
          labelFormatter={(label) => formatMonthYear(String(label))}
          contentStyle={tooltipStyle}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        <Bar dataKey="sales" name="Sales" fill={BLUE} radius={[3, 3, 0, 0]} maxBarSize={24} />
        <Bar dataKey="collections" name="Collections" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Quantity-weighted gas selling rate against the market rate saved on each bill. */
export function GasSellingRateTrendChart({
  data,
}: {
  data: Array<{ month: string; sellingRate: number | null; marketRate: number | null; kg: number }>
}) {
  if (data.length === 0) return <p className="py-10 text-center text-xs text-slate-400">No gas sales recorded yet.</p>
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={formatMonthYear} tick={{ fontSize: 11, fill: SLATE }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
        <YAxis tickFormatter={(value) => `₹${Math.round(Number(value))}`} tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} width={58} />
        <Tooltip
          formatter={(value, name) => {
            if (name === 'Gas kg') return [new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value ?? 0)), 'Gas kg']
            return [value == null ? '—' : `${formatInrInteger(Number(value))}/kg`, String(name ?? '')]
          }}
          labelFormatter={(label) => formatMonthYear(String(label))}
          contentStyle={tooltipStyle}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        <Line type="monotone" dataKey="sellingRate" name="Selling rate" stroke={BLUE} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
        <Line type="monotone" dataKey="marketRate" name="Bill market rate" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2.5 }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Collection efficiency as a single radial gauge. */
export function CollectionEfficiencyGauge({ value, tone }: { value: number; tone: 'green' | 'amber' | 'red' }) {
  const bounded = Math.max(0, Math.min(100, value))
  const fill = tone === 'green' ? GREEN : tone === 'amber' ? '#f59e0b' : '#f43f5e'
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={170}>
        <RadialBarChart data={[{ value: bounded }]} innerRadius="72%" outerRadius="100%" startAngle={220} endAngle={-40}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={8} fill={fill} background={{ fill: '#f1f5f9' }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <p className="font-mono text-2xl font-bold text-slate-900">{Math.round(value)}%</p>
        <p className="text-xs text-slate-500">collected of billed</p>
      </div>
    </div>
  )
}

export type AgingBucketKey = 'current' | 'days31to60' | 'days61to90' | 'above90'

const AGING_META: Array<{ key: AgingBucketKey; label: string; color: string }> = [
  { key: 'current', label: '0–30d', color: '#93c5fd' },
  { key: 'days31to60', label: '31–60d', color: '#fbbf24' },
  { key: 'days61to90', label: '61–90d', color: '#fb923c' },
  { key: 'above90', label: '90d+', color: '#f43f5e' },
]

/** Receivable aging as clickable horizontal bars; clicking selects the drill-down bucket. */
export function ReceivableAgingBars({
  aging,
  selected,
  onSelect,
}: {
  aging: Record<AgingBucketKey, number>
  selected: AgingBucketKey
  onSelect: (bucket: AgingBucketKey) => void
}) {
  const data = AGING_META.map((meta) => ({ ...meta, amount: aging[meta.key] }))
  return (
    <ResponsiveContainer width="100%" height={168}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
        <XAxis type="number" tickFormatter={compactInr} tick={{ fontSize: 10, fill: SLATE }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
          formatter={(value) => [formatInrInteger(Number(value ?? 0)), 'Outstanding']}
          contentStyle={tooltipStyle}
        />
        <Bar dataKey="amount" radius={[0, 4, 4, 0]} maxBarSize={22} onClick={(entry) => onSelect((entry as unknown as { key: AgingBucketKey }).key)} className="cursor-pointer">
          {data.map((entry) => (
            <Cell key={entry.key} fill={entry.color} opacity={selected === entry.key ? 1 : 0.45} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Weekly totals for recent activity — replaces the old daily heatmap. */
export function WeeklySalesChart({ daily, weeks = 12 }: { daily: Array<{ date: string; sales: number; bags: number }>; weeks?: number }) {
  const data = useMemo(() => {
    const byWeek = new Map<string, { weekStart: string; sales: number; bags: number }>()
    for (const day of daily) {
      const date = new Date(`${day.date}T00:00:00`)
      if (Number.isNaN(date.getTime())) continue
      // Weeks start on Monday to match business bookkeeping.
      const monday = new Date(date)
      monday.setDate(date.getDate() - ((date.getDay() + 6) % 7))
      const key = monday.toISOString().slice(0, 10)
      const entry = byWeek.get(key) ?? { weekStart: key, sales: 0, bags: 0 }
      entry.sales += day.sales
      entry.bags += day.bags
      byWeek.set(key, entry)
    }
    return [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(-weeks)
  }, [daily, weeks])

  if (data.length === 0) return <p className="py-10 text-center text-xs text-slate-400">No sales recorded yet.</p>
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="weekStart"
          tickFormatter={(value) => formatFullDate(String(value)).slice(0, 5)}
          tick={{ fontSize: 10, fill: SLATE }}
          axisLine={{ stroke: '#cbd5e1' }}
          tickLine={false}
        />
        <YAxis tickFormatter={compactInr} tick={{ fontSize: 10, fill: SLATE }} axisLine={false} tickLine={false} width={50} />
        <Tooltip
          cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
          formatter={(value, name) => (name === 'Sales' ? [formatInrInteger(Number(value ?? 0)), 'Sales'] : [String(value), 'Bags'])}
          labelFormatter={(label) => `Week of ${formatFullDate(String(label))}`}
          contentStyle={tooltipStyle}
        />
        <Bar dataKey="sales" name="Sales" fill={BLUE} radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Tiny inline trend used inside KPI cards. */
export function KpiSparkline({ values, color = BLUE }: { values: number[]; color?: string }) {
  const data = values.map((value, index) => ({ index, value }))
  if (data.length < 2) return null
  return (
    <ResponsiveContainer width="100%" height={30}>
      <LineChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
