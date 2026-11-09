import { createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/data-table'
import { MoneyCell } from '@/components/ui/money-cell'
import { StatusChip } from '@/components/ui/status-chip'
import { FilterBar, KpiCard, MonthPicker, PageShell, SectionCard, TabBar } from '@/components/ui/business-kit'
import { useState } from 'react'

export const Route = createFileRoute('/dev/components')({ component: ComponentsPreview })

type DemoRow = { id: string; amountPaise: number; status: string }
const columns: ColumnDef<DemoRow, unknown>[] = [
  { accessorKey: 'id', header: 'Reference' },
  { accessorKey: 'amountPaise', header: 'Amount', cell: ({ row }) => <MoneyCell valuePaise={row.original.amountPaise} /> },
  { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusChip tone={row.original.status === 'Paid' ? 'success' : 'warning'}>{row.original.status}</StatusChip> },
]
const rows: DemoRow[] = Array.from({ length: 500 }, (_, index) => ({ id: `DEMO-${index + 1}`, amountPaise: (index + 1) * 12500, status: index % 2 ? 'Paid' : 'Pending' }))

function ComponentsPreview() {
  const [tab, setTab] = useState<'all' | 'paid'>('all')
  const [search, setSearch] = useState('')
  const [month, setMonth] = useState('2026-11')
  return <PageShell toolbar={<FilterBar search={search} onSearchChange={setSearch} actions={<MonthPicker value={month} onChange={setMonth} />} />}>
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-950">Component states</h2>
      <p className="mt-1 text-xs text-slate-500">Development preview using synthetic records.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">{(['neutral', 'selection', 'success', 'warning', 'danger'] as const).map((tone) => <StatusChip key={tone} tone={tone}>{tone}</StatusChip>)}<MoneyCell valuePaise={123456789} /></div>
    </section>
    <SectionCard title="Shared controls" subtitle="Component kit states" actions={<TabBar options={[{ value: 'all', label: 'All' }, { value: 'paid', label: 'Paid' }]} value={tab} onChange={setTab} />}>
      <KpiCard label="Demo amount" value={<MoneyCell valuePaise={123456789} />} delta="+4% vs last month" href="/dev/components" />
    </SectionCard>
    <section className="space-y-2"><h2 className="text-sm font-semibold text-slate-950">Populated: 500 rows</h2><DataTable data={rows} columns={columns} /></section>
    <section className="space-y-2"><h2 className="text-sm font-semibold text-slate-950">Empty</h2><DataTable data={[]} columns={columns} /></section>
    <section className="space-y-2"><h2 className="text-sm font-semibold text-slate-950">Loading</h2><DataTable data={[]} columns={columns} loading /></section>
    <section className="space-y-2"><h2 className="text-sm font-semibold text-slate-950">Error</h2><DataTable data={[]} columns={columns} error="Unable to load records." /></section>
  </PageShell>
}
