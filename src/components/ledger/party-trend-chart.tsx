import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMonthYear } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

export type TrendPoint = { month: string; debit: number; credit: number }

const BILLED = '#3b82f6' // blue-500
const RECEIVED = '#10b981' // emerald-500

function compactInr(value: number) {
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(1)}Cr`
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`
  if (value >= 1_000) return `₹${Math.round(value / 1_000)}k`
  return `₹${Math.round(value)}`
}

export function PartyTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-xs text-slate-400">No billing or collection activity yet.</p>
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="0" />
        <XAxis
          dataKey="month"
          tickFormatter={formatMonthYear}
          tick={{ fontSize: 11, fill: '#64748b' }}
          axisLine={{ stroke: '#cbd5e1' }}
          tickLine={false}
        />
        <YAxis tickFormatter={compactInr} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={52} />
        <Tooltip
          cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
          formatter={(value, name) => [formatInrInteger(Number(value ?? 0)), String(name ?? '')]}
          labelFormatter={(label) => formatMonthYear(String(label))}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e2e8f0' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        <Bar dataKey="debit" name="Billed" fill={BILLED} radius={[3, 3, 0, 0]} maxBarSize={26} />
        <Bar dataKey="credit" name="Received" fill={RECEIVED} radius={[3, 3, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  )
}
