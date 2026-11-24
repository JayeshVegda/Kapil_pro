import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Edit3, Printer, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { CastingTicket, formatCastingWeekday } from '@/components/casting/casting-ticket'
import { inputClass } from '@/components/ui/form-control-classes'
import { Panel } from '@/components/ui/panel'
import { loadCastingSessions } from '@/data/casting'
import { formatFullDate } from '@/lib/date'

export const Route = createFileRoute('/casting/bill')({ component: CastingBillPage })

const actionClass = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600'

export function CastingBillPage() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const sessionsQuery = useQuery({ queryKey: ['casting-sessions'], queryFn: () => loadCastingSessions() })
  const needle = search.trim().toLowerCase()
  const sessions = (sessionsQuery.data ?? []).filter((session) =>
    [session.date, formatFullDate(session.date), formatCastingWeekday(session.date)].some((value) => value.toLowerCase().includes(needle)),
  )
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0]

  return (
    <div className="mx-auto grid w-full max-w-7xl items-start gap-5 px-3 pb-8 pt-4 sm:px-5 lg:grid-cols-[17rem_minmax(0,1fr)] print:block print:p-0">
      <Panel className="space-y-3 print:hidden">
        <h1 className="text-sm font-semibold text-slate-950">Casting bills</h1>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputClass} w-full pl-9`} aria-label="Search bills by date or weekday" placeholder="Search date or weekday" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto lg:max-h-[34rem]">
          {sessions.map((session) => (
            <button key={session.id} type="button" aria-pressed={selected?.id === session.id} onClick={() => setSelectedId(session.id)}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2.5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 aria-pressed:border-blue-200 aria-pressed:bg-blue-50 aria-pressed:font-semibold aria-pressed:text-blue-900">
              <span className="tabular-nums">{formatFullDate(session.date)}</span>
              <span className="text-xs">{formatCastingWeekday(session.date)}</span>
            </button>
          ))}
          {!sessionsQuery.isLoading && !sessionsQuery.isError && sessions.length === 0 && <p className="py-2 text-sm text-slate-500">No matching casting bills.</p>}
        </div>
      </Panel>

      <div className="min-w-0 space-y-4 print:space-y-0">
        {sessionsQuery.isLoading && <Panel className="text-sm text-slate-500 print:hidden">Loading casting bills…</Panel>}
        {sessionsQuery.isError && <Panel className="text-sm text-rose-700 print:hidden" role="alert">Unable to load casting bills.</Panel>}
        {selected && !sessionsQuery.isError && <>
          <Panel className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div className="flex items-center gap-2.5">
              <CalendarDays size={18} className="text-slate-500" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold tabular-nums text-slate-950">{formatFullDate(selected.date)}</p>
                <p className="text-xs text-slate-500">{formatCastingWeekday(selected.date)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/casting/log" search={{ sessionId: selected.id, sessionDate: selected.date, action: 'edit' }} className={actionClass}><Edit3 size={15} /> Edit</Link>
              <Link to="/casting/log" search={{ sessionId: selected.id, sessionDate: selected.date, action: 'delete' }} className={`${actionClass} border-rose-200 text-rose-700 hover:bg-rose-50`}><Trash2 size={15} /> Delete</Link>
              <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-700"><Printer size={15} /> Print chitti</button>
            </div>
          </Panel>
          <CastingTicket session={selected} />
        </>}
      </div>
    </div>
  )
}
