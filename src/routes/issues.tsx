import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Info, RefreshCw, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { probeBackend, probeCollections, probeMarketFeed, runSanityChecks } from '@/data/health'
import { isBackgroundSyncQuery } from '@/lib/query-scope'
import { pollWhileTabVisible } from '@/lib/poll-while-visible'
import type { Finding, FindingSeverity } from '@/domain/health-checks'

export const Route = createFileRoute('/issues')({
  component: IssuesPage,
})

type ErroredQuery = { key: string; message: string }

function useErroredQueries() {
  const queryClient = useQueryClient()
  const [errored, setErrored] = useState<ErroredQuery[]>([])

  const read = useCallback(() => {
    const list = queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => {
        if (query.state.status !== 'error') return false
        if (isBackgroundSyncQuery(query.queryKey)) return false
        return String(query.queryKey[0] ?? '') !== 'issues-'
      })
      .map((query) => ({
        key: JSON.stringify(query.queryKey),
        message: query.state.error instanceof Error ? query.state.error.message : String(query.state.error ?? 'unknown error'),
      }))
    setErrored(list)
  }, [queryClient])

  useEffect(() => {
    const cache = queryClient.getQueryCache()
    const unsubscribe = cache.subscribe(read)
    read()
    return unsubscribe
  }, [queryClient, read])

  return errored
}

const SEVERITY_META: Record<FindingSeverity, { icon: typeof Info; classes: string; label: string }> = {
  error: { icon: XCircle, classes: 'border-rose-200 bg-rose-50 text-rose-900', label: 'Error' },
  warn: { icon: AlertTriangle, classes: 'border-amber-200 bg-amber-50 text-amber-900', label: 'Warning' },
  info: { icon: Info, classes: 'border-slate-200 bg-slate-50 text-slate-700', label: 'Info' },
  ok: { icon: CheckCircle2, classes: 'border-emerald-200 bg-emerald-50 text-emerald-800', label: 'OK' },
}

function FindingRow({ finding }: { finding: Finding }) {
  const meta = SEVERITY_META[finding.severity]
  const Icon = meta.icon
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3.5 py-2.5 ${meta.classes}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-bold">{finding.title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed opacity-80">{finding.detail}</p>
      </div>
    </div>
  )
}

function IssuesPage() {
  const queryClient = useQueryClient()
  const erroredQueries = useErroredQueries()
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null)

  useEffect(() => {
    setLastRunAt(new Date())
  }, [])

  const backendQuery = useQuery({
    queryKey: ['issues-backend'],
    queryFn: probeBackend,
    refetchInterval: pollWhileTabVisible(20_000),
  })
  const collectionsQuery = useQuery({
    queryKey: ['issues-collections'],
    queryFn: probeCollections,
    refetchInterval: pollWhileTabVisible(60_000),
  })
  const marketFeedQuery = useQuery({
    queryKey: ['issues-market-feed'],
    queryFn: probeMarketFeed,
    refetchInterval: pollWhileTabVisible(60_000),
  })
  const sanityQuery = useQuery({
    queryKey: ['issues-sanity'],
    queryFn: () => runSanityChecks(new Date().toISOString().slice(0, 10)),
    refetchInterval: pollWhileTabVisible(60_000),
    retry: 0,
  })

  const rerunAll = () => {
    setLastRunAt(new Date())
    void queryClient.invalidateQueries({ queryKey: ['issues-'] })
  }

  const backend = backendQuery.data ?? { online: false, latencyMs: null, error: backendQuery.error?.message ?? 'checking…' }
  const findings: Finding[] = [
    ...(sanityQuery.data?.findings ?? (sanityQuery.error ? [{ severity: 'error' as const, title: 'Sanity checks could not run', detail: sanityQuery.error.message }] : [])),
    ...(collectionsQuery.data ? [] : [{ severity: 'error' as const, title: 'Collection probes failed', detail: collectionsQuery.error?.message ?? 'unavailable' }]),
  ]
  const errorCount =
    (backend.online ? 0 : 1) +
    erroredQueries.length +
    findings.filter((f) => f.severity === 'error').length
  const warnCount = findings.filter((f) => f.severity === 'warn').length

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {!backend.online && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <XCircle size={20} className="mt-0.5 shrink-0 text-rose-600" />
            <div>
              <p className="text-sm font-bold text-rose-900">PocketBase is not responding — this is why the dashboard and sync look broken.</p>
              <p className="mt-1 text-xs leading-relaxed text-rose-700">
                Every page reads through the local PocketBase (port 8090). It is offline right now, so data cannot load.
                The scheduled task <code className="rounded bg-rose-100 px-1 font-mono">Kapil Billing Watchdog</code> restarts it automatically within 10 minutes,
                or start it now with <code className="rounded bg-rose-100 px-1 font-mono">windows\start-kapil-task.bat</code>. Caddy/UI can still look alive while the backend is down — that is expected.
              </p>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Issues</h2>
            <p className="mt-1 text-xs text-slate-500">
              Live system console: backend health, failed data loads (what the browser console shows), collection access, feeds, and data sanity.
              For book-quality checks see <Link to="/data-health" className="font-medium text-blue-600 hover:underline">Data Health</Link>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-center">
              <span className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold ${errorCount > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                {errorCount} error{errorCount === 1 ? '' : 's'}
              </span>
              <span className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold ${warnCount > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                {warnCount} warning{warnCount === 1 ? '' : 's'}
              </span>
            </div>
            <button
              type="button"
              onClick={rerunAll}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <RefreshCw size={13} /> Re-run checks
            </button>
          </div>
        </div>
        {lastRunAt && <p className="mt-2 text-[11px] text-slate-400">Auto-refreshes every 20–60s while the tab is open · last run {lastRunAt.toLocaleTimeString()}</p>}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Backend (PocketBase :8090)</p>
          {backendQuery.isLoading ? (
            <p className="mt-2 text-xs text-slate-500">Checking…</p>
          ) : backend.online ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} /> Online · {backend.latencyMs} ms</p>
          ) : (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-rose-700"><XCircle size={14} /> Offline{backend.error ? ` · ${backend.error}` : ''}</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Market rate feed (rss.zayu.dev)</p>
          {marketFeedQuery.isLoading ? (
            <p className="mt-2 text-xs text-slate-500">Checking…</p>
          ) : marketFeedQuery.data?.reachable ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} /> {marketFeedQuery.data.detail}</p>
          ) : (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-amber-700"><AlertTriangle size={14} /> Unreachable · {marketFeedQuery.data?.detail ?? '—'}</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Failed data loads (live queries)</p>
          {erroredQueries.length === 0 ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} /> None — every query is healthy</p>
          ) : (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-rose-700"><XCircle size={14} /> {erroredQueries.length} failed query load(s)</p>
          )}
        </div>
      </section>

      {erroredQueries.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Failed data loads</h3>
          <p className="mt-1 text-xs text-slate-500">These are the same errors you would see in the browser console, per query. Use the header Refresh button to retry all of them.</p>
          <div className="mt-3 space-y-2">
            {erroredQueries.map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold text-rose-900">{item.key}</p>
                  <p className="mt-0.5 text-[11px] text-rose-700">{item.message}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Collection access</h3>
        <p className="mt-1 text-xs text-slate-500">Every collection the app or Muse depends on, probed as the app sees it. Casting/stock are gated on purpose.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500">
                <th className="py-2 pr-3">Collection</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Rows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(collectionsQuery.data ?? []).map((probe) => (
                <tr key={probe.name}>
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-slate-700">{probe.name}</td>
                  <td className="py-1.5 pr-3">
                    {probe.ok ? (
                      <span className="font-semibold text-emerald-700">readable</span>
                    ) : probe.intentionallyGated ? (
                      <span className="font-semibold text-slate-500">gated (expected)</span>
                    ) : (
                      <span className="font-semibold text-rose-700">not readable</span>
                    )}
                  </td>
                  <td className="py-1.5 font-mono tabular-nums text-slate-700">{probe.totalItems ?? '—'}</td>
                </tr>
              ))}
              {collectionsQuery.isLoading && (
                <tr><td colSpan={3} className="py-2 text-slate-500">Probing collections…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Findings</h3>
        <p className="mt-1 text-xs text-slate-500">Feeds, rates, and data sanity — things that are technically "working" but will bite the books.</p>
        <div className="mt-3 space-y-2">
          {sanityQuery.isLoading && <p className="text-xs text-slate-500">Running sanity checks…</p>}
          {!sanityQuery.isLoading && findings.length === 0 && (
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 size={14} /> No findings — feeds fresh, data sane.</p>
          )}
          {findings.map((finding, index) => (
            <FindingRow key={`${finding.title}-${index}`} finding={finding} />
          ))}
        </div>
      </section>
    </div>
  )
}
