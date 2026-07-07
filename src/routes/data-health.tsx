import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { applyDataHealthFix, loadDataHealthIssues, previewDataHealthFix, type DataHealthFixPreview, type DataHealthIssue } from '@/data/data-health'
import { toUserMessage } from '@/app/errors'

export const Route = createFileRoute('/data-health')({
  component: DataHealthPage,
})

function DataHealthPage() {
  const queryClient = useQueryClient()
  const [fixPreview, setFixPreview] = useState<{ issue: DataHealthIssue; preview: DataHealthFixPreview } | null>(null)
  const [statusText, setStatusText] = useState('')
  const healthQuery = useQuery({
    queryKey: ['data-health'],
    queryFn: loadDataHealthIssues,
  })
  const issues = healthQuery.data ?? []
  const high = issues.filter((issue) => issue.severity === 'High').length
  const medium = issues.filter((issue) => issue.severity === 'Medium').length
  const low = issues.filter((issue) => issue.severity === 'Low').length
  const previewMutation = useMutation({
    mutationFn: previewDataHealthFix,
    onSuccess: (preview, issue) => {
      setFixPreview({ issue, preview })
      setStatusText('')
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })
  const applyMutation = useMutation({
    mutationFn: applyDataHealthFix,
    onSuccess: async () => {
      setFixPreview(null)
      setStatusText('Fix applied. Health checks refreshed.')
      await queryClient.invalidateQueries({ queryKey: ['data-health'] })
    },
    onError: (error) => setStatusText(toUserMessage(error)),
  })

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Data Health</h2>
            <p className="mt-1 text-xs text-slate-500">Checks bill item links, customer links, and duplicate bills.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Metric label="High" value={high} tone="red" />
            <Metric label="Medium" value={medium} tone="amber" />
            <Metric label="Low" value={low} tone="slate" />
          </div>
        </div>
        {statusText && <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{statusText}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {healthQuery.isLoading && <p className="text-sm text-slate-500">Checking data...</p>}
        {healthQuery.isError && <p className="text-sm text-red-600">Unable to load data health checks.</p>}
        {!healthQuery.isLoading && !healthQuery.isError && issues.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 size={16} />
            No data health warnings found.
          </div>
        )}
        {!healthQuery.isLoading && !healthQuery.isError && issues.length > 0 && (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Severity</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Area</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Issue</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Fix</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, index) => (
                  <tr key={issue.id} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                    <td className="px-3 py-3"><SeverityBadge severity={issue.severity} /></td>
                    <td className="px-3 py-3 text-sm text-slate-700">{issue.area}</td>
                    <td className="px-3 py-3">
                      <p className="text-sm font-medium text-slate-900">{issue.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{issue.detail}</p>
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-700">
                      {issue.fixKind ? (
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => previewMutation.mutate(issue)}
                          disabled={previewMutation.isPending}
                        >
                          Review Fix
                        </button>
                      ) : (
                        fixLink(issue)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {fixPreview && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">{fixPreview.preview.title}</h3>
              <p className="mt-1 text-xs text-slate-500">Review before applying this data change.</p>
            </div>
            <div className="space-y-3 px-4 py-4">
              <PreviewBlock label="Before" value={fixPreview.preview.before} />
              <PreviewBlock label="After" value={fixPreview.preview.after} />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setFixPreview(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => applyMutation.mutate(fixPreview.issue)}
                disabled={applyMutation.isPending}
              >
                {applyMutation.isPending ? 'Applying...' : 'Apply Fix'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'red' | 'amber' | 'slate' }) {
  const toneClass = tone === 'red' ? 'text-red-700 bg-red-50 border-red-200' : tone === 'amber' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-slate-700 bg-slate-50 border-slate-200'
  return (
    <div className={`min-w-20 rounded-lg border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em]">{label}</p>
      <p className="font-mono text-lg font-bold">{value}</p>
    </div>
  )
}

function SeverityBadge({ severity }: { severity: DataHealthIssue['severity'] }) {
  const styles = severity === 'High' ? 'bg-red-100 text-red-700' : severity === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>
      <AlertTriangle size={12} />
      {severity}
    </span>
  )
}

function PreviewBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-800">{value}</p>
    </div>
  )
}

function fixLink(issue: DataHealthIssue) {
  if (issue.area === 'Items') return <Link to="/items" className="font-medium text-blue-700 hover:underline">Open Items</Link>
  return <Link to="/transactions" search={{ focusKind: '', focusId: '' }} className="font-medium text-blue-700 hover:underline">Open Logs</Link>
}
