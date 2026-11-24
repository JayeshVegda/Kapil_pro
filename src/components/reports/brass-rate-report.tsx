import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { KpiCard } from '@/components/ui/business-kit'
import { buttonClass } from '@/components/ui/form-control-classes'
import { Panel } from '@/components/ui/panel'
import { loadBrassRateHistory } from '@/data/brass-rate-report'
import { brassRateSeries, summarizeBrassSeries, type BrassRateKey, type BrassRateSeries } from '@/domain/brass-rate-report'
import { formatFullDate } from '@/lib/date'

const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const axisDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const historyPageSize = 20
const periods = [{ days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '1 year' }, { days: 0, label: 'All time' }]

function formatQuote(value: number | null | undefined, series: BrassRateSeries) {
  if (value == null) return '—'
  return `${series.unit.startsWith('₹') ? '₹' : ''}${number.format(value)}`
}

function signed(value: number) {
  return `${value > 0 ? '+' : ''}${number.format(value)}`
}

export function BrassRateReport({ asOfDate }: { asOfDate: string }) {
  const [days, setDays] = useState(90)
  const [selectedKey, setSelectedKey] = useState<BrassRateKey>('vilaity')
  const [page, setPage] = useState(0)
  const history = useQuery({ queryKey: ['brass-rate-history'], queryFn: loadBrassRateHistory, staleTime: 60_000 })
  const available = (history.data ?? []).filter((row) => row.date <= asOfDate)
  const latestDate = available.at(-1)?.date
  const startDate = latestDate && days > 0
    ? new Date(Date.parse(`${latestDate}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10)
    : available[0]?.date
  const visible = startDate ? available.filter((row) => row.date >= startDate) : []
  const seriesWithQuotes = brassRateSeries.flatMap((series) => {
    const latest = visible.findLast((row) => row.rates[series.key] !== undefined)
    return latest ? [{ series, date: latest.date, rate: latest.rates[series.key] }] : []
  })
  const series = seriesWithQuotes.find(({ series }) => series.key === selectedKey)?.series ?? seriesWithQuotes[0]?.series
  const summary = series ? summarizeBrassSeries(visible, series.key) : null
  const points = summary?.points ?? []
  const lastPage = Math.max(0, Math.ceil(points.length / historyPageSize) - 1)
  const visiblePage = Math.min(page, lastPage)
  const lastIndex = points.length - visiblePage * historyPageSize
  const historyRows = points.slice(Math.max(0, lastIndex - historyPageSize), lastIndex).reverse()

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Brass Rate</h1>
        {latestDate && <p className="mt-1 text-xs text-muted-foreground">Latest saved bulletin {formatFullDate(latestDate)}</p>}
      </div>
      <button type="button" onClick={() => void history.refetch()} disabled={history.isFetching} className={buttonClass('secondary')}>
        <RefreshCw size={14} className={history.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
        Refresh
      </button>
    </div>

    {history.isPending && <Panel role="status" className="text-sm text-muted-foreground">Loading brass rate history…</Panel>}
    {history.isError && <Panel role="alert" className="text-sm text-rose-700">{history.data ? 'Refresh failed. Showing the last loaded history.' : 'Brass rate history could not load.'}</Panel>}
    {history.isSuccess && !latestDate && <Panel className="text-sm text-muted-foreground">No saved brass rates through {formatFullDate(asOfDate)}.</Panel>}

    {series && summary && latestDate && <>
      <Panel className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Rate series
          <select className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground" value={series.key} onChange={(event) => { setSelectedKey(event.target.value as BrassRateKey); setPage(0) }}>
            {seriesWithQuotes.map(({ series: quote }) => <option key={quote.key} value={quote.key}>{quote.label}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Rate history range">
          {periods.map((period) => <button key={period.days} type="button" aria-pressed={period.days === days} className={buttonClass(period.days === days ? 'primary' : 'secondary')} onClick={() => { setDays(period.days); setPage(0) }}>{period.label}</button>)}
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={`Latest ${series.label}`} value={formatQuote(summary.latest?.rate, series)} subtext={summary.latest ? formatFullDate(summary.latest.date) : undefined} />
        <KpiCard label="Period change" value={summary.change === null ? '—' : signed(summary.change)} subtext={summary.changePercent === null ? undefined : `${signed(summary.changePercent)}% from first quote`} />
        <KpiCard label="Period average" value={formatQuote(summary.average, series)} />
        <KpiCard label="Period low / high" value={`${formatQuote(summary.low, series)} / ${formatQuote(summary.high, series)}`} />
      </div>

      <Panel>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{series.label} trend <span className="font-normal text-muted-foreground">· {series.unit}</span></h2>
          <p className="text-xs text-muted-foreground">{formatFullDate(startDate ?? latestDate)} to {formatFullDate(latestDate)} · {points.length} quotes</p>
        </div>
        <div className="h-64 min-w-0 sm:h-80" role="group" aria-label={`${series.label} historical rates in ${series.unit}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 10, right: 16, left: 0, bottom: 4 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} minTickGap={34} tickFormatter={(value: number) => axisDate.format(value)} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
              <YAxis width={60} domain={['auto', 'auto']} tickFormatter={(value: number) => number.format(value)} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
              <Tooltip labelFormatter={(value) => formatFullDate(new Date(Number(value)).toISOString().slice(0, 10))} formatter={(value) => [formatQuote(Number(value), series), series.label]} contentStyle={{ borderRadius: 8, background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
              <Line type="linear" dataKey="rate" stroke="var(--chart-1)" strokeWidth={2} dot={points.length === 1} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel>
          <h2 className="mb-2 text-sm font-semibold">Daily history · {series.label}</h2>
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border text-muted-foreground"><tr><th scope="col" className="py-2">Date</th><th scope="col" className="py-2 text-right">Rate ({series.unit})</th><th scope="col" className="py-2 text-right">Change</th></tr></thead>
            <tbody className="divide-y divide-border tabular-nums">{historyRows.map((row, index) => {
              const previous = points[lastIndex - index - 2]
              return <tr key={row.date}><td className="py-2">{formatFullDate(row.date)}</td><td className="py-2 text-right font-semibold">{formatQuote(row.rate, series)}</td><td className="py-2 text-right">{previous ? signed(row.rate - previous.rate) : '—'}</td></tr>
            })}</tbody>
          </table>
          {lastPage > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
            <span>Page {visiblePage + 1} of {lastPage + 1}</span>
            <div className="flex gap-2"><button type="button" className={buttonClass('secondary')} disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous</button><button type="button" className={buttonClass('secondary')} disabled={visiblePage === lastPage} onClick={() => setPage(visiblePage + 1)}>Next</button></div>
          </div>}
        </Panel>
        <Panel>
          <h2 className="mb-2 text-sm font-semibold">Latest quotes by series</h2>
          <ul className="divide-y divide-border text-xs">
            {seriesWithQuotes.map(({ series: quote, date, rate }) => <li key={quote.key}>
              <button type="button" aria-pressed={series.key === quote.key} onClick={() => { setSelectedKey(quote.key); setPage(0) }} className="flex w-full flex-wrap justify-between gap-x-3 gap-y-1 rounded px-2 py-2.5 text-left hover:bg-muted aria-pressed:bg-muted">
                <span><span className="block font-medium">{quote.label}</span><span className="text-muted-foreground">{formatFullDate(date)}</span></span>
                <span className="text-right tabular-nums"><span className="block font-semibold">{formatQuote(rate, quote)}</span><span className="text-muted-foreground">{quote.unit}</span></span>
              </button>
            </li>)}
          </ul>
        </Panel>
      </div>
    </>}
  </div>
}
