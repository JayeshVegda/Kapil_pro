import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  createColumnHelper,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { RowMenu } from '@/components/ui/row-menu'
import { formatFullDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'

export type BillsTableRow = {
  id: string
  inNo: string
  date: string
  supplierId: string
  supplierName: string
  pool: 'kacha' | 'gst'
  itemsSummary: string
  totalKg: number
  netPaise: number
  paidPaise: number
  duePaise: number
  daysOld: number
  bardanPending: boolean
  status: 'open' | 'partial' | 'nil' | 'cancelled'
  cancelled: boolean
}

export type BillsTableActions = {
  onRecordPayment?: (row: BillsTableRow) => void
  onAddBardan?: (row: BillsTableRow) => void
  onSettleNil?: (row: BillsTableRow) => void
  onEdit?: (row: BillsTableRow) => void
  onCancel?: (row: BillsTableRow) => void
}

const col = createColumnHelper<BillsTableRow>()

export function itemsSummary(lines: Array<{ itemName: string; weightG?: number; rateMilli?: number }>, max = 2): string {
  if (lines.length === 0) return ''
  const names = lines.map((l) => l.itemName.trim()).filter(Boolean)
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`
}

function PoolChip({ pool }: { pool: 'kacha' | 'gst' }) {
  return (
    <span
      className={`inline-flex h-4 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold uppercase ${
        pool === 'gst' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
      }`}
      title={pool === 'gst' ? 'GST pool' : 'Kacha pool'}
    >
      {pool === 'gst' ? 'G' : 'K'}
    </span>
  )
}

const STATUS_STYLE: Record<BillsTableRow['status'], string> = {
  nil: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-800',
  open: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-500 line-through',
}

function SortIndicator({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  if (sorted === 'asc') return <ArrowUp size={10} />
  if (sorted === 'desc') return <ArrowDown size={10} />
  return <ArrowUpDown size={10} className="opacity-40" />
}

/** Dense bills table: sticky header, sticky IN No column, tabular figures. */
export function PurchaseBillsTable({
  rows,
  showSupplier = true,
  actions,
  selection,
  emptyMessage,
}: {
  rows: BillsTableRow[]
  showSupplier?: boolean
  actions?: BillsTableActions
  selection?: { selectedIds: Set<string>; onToggle: (id: string) => void }
  emptyMessage?: string
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }])
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({})
  const [columnMenuOpen, setColumnMenuOpen] = useState(false)
  const columnMenuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const selectedRows = useMemo(() => rows.filter((r) => selection?.selectedIds.has(r.id)), [rows, selection])
  const anchor = selectedRows[0]

  useEffect(() => {
    if (!columnMenuOpen) return
    function onPointer(event: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) setColumnMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [columnMenuOpen])

  const columns = useMemo<ColumnDef<BillsTableRow, any>[]>(() => {
    const defs: ColumnDef<BillsTableRow, any>[] = []
    if (selection) {
      defs.push(
        col.display({
          id: 'select',
          enableSorting: false,
          enableHiding: false,
          size: 34,
          header: () => null,
          cell: ({ row }) => {
            const r = row.original
            const eligible = !anchor || (anchor.supplierId === r.supplierId && anchor.pool === r.pool) || selection.selectedIds.has(r.id)
            return (
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-blue-600 disabled:opacity-30"
                disabled={!eligible}
                checked={selection.selectedIds.has(r.id)}
                onChange={() => selection.onToggle(r.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select ${r.inNo}`}
              />
            )
          },
        }),
      )
    }
    defs.push(
      col.accessor('inNo', {
        header: 'IN No',
        size: 110,
        cell: ({ row }) => (
          <Link
            to="/purchase-bills/$billId"
            params={{ billId: row.original.inNo }}
            onClick={(e) => e.stopPropagation()}
            className={`font-mono font-semibold text-blue-700 hover:underline ${row.original.cancelled ? 'line-through opacity-60' : ''}`}
          >
            {row.original.inNo || row.original.id.slice(0, 8)}
          </Link>
        ),
      }),
      col.accessor('date', { header: 'Date', size: 96, cell: ({ getValue }) => <span className="text-slate-600">{formatFullDate(getValue())}</span> }),
    )
    if (showSupplier) {
      defs.push(col.accessor('supplierName', { header: 'Supplier', size: 160, cell: ({ getValue }) => <span className="font-medium text-slate-800">{getValue()}</span> }))
    }
    defs.push(
      col.accessor('pool', { header: 'Pool', size: 44, cell: ({ getValue }) => <PoolChip pool={getValue()} /> }),
      col.accessor('itemsSummary', { header: 'Items', size: 210, cell: ({ getValue, row }) => <span className={`block truncate ${row.original.cancelled ? 'line-through opacity-60' : ''} text-slate-700`} title={getValue()}>{getValue() || '—'}</span> }),
      col.accessor('totalKg', { header: () => <span className="ml-auto">Weight</span>, size: 84, cell: ({ getValue }) => <span className="block text-right font-mono tabular-nums text-slate-600">{getValue().toFixed(3)}</span> }),
      col.accessor('netPaise', { header: () => <span className="ml-auto">Net</span>, size: 104, cell: ({ getValue }) => <span className="block text-right font-mono tabular-nums text-slate-800">{formatPaiseInr(getValue())}</span> }),
      col.accessor('paidPaise', { header: () => <span className="ml-auto">Paid</span>, size: 104, cell: ({ getValue }) => <span className="block text-right font-mono tabular-nums text-emerald-700">{formatPaiseInr(getValue())}</span> }),
      col.accessor('duePaise', { header: () => <span className="ml-auto">Due</span>, size: 104, cell: ({ getValue }) => <span className="block text-right font-mono font-semibold tabular-nums text-rose-600">{formatPaiseInr(getValue())}</span> }),
      col.accessor('daysOld', { header: () => <span className="ml-auto">Age</span>, size: 56, cell: ({ getValue }) => <span className={`block text-right font-mono tabular-nums ${getValue() > 10 ? 'font-bold text-rose-600' : getValue() >= 7 ? 'font-semibold text-amber-600' : 'text-slate-500'}`}>{getValue()}d</span> }),
      col.accessor('bardanPending', { header: 'Bardan', size: 74, cell: ({ getValue }) => (getValue() ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Pending</span> : <span className="text-[10px] text-slate-400">Settled</span>) }),
      col.accessor('status', { header: 'Status', size: 72, cell: ({ getValue }) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLE[getValue() as BillsTableRow['status']]}`}>{getValue()}</span> }),
      col.display({
        id: 'actions',
        header: () => null,
        enableHiding: false,
        size: 34,
        cell: ({ row }) => {
          const r = row.original
          const items = [
            actions?.onRecordPayment && { label: 'Record Payment', onSelect: () => actions.onRecordPayment!(r) },
            actions?.onAddBardan && { label: 'Add Bardan', onSelect: () => actions.onAddBardan!(r) },
            actions?.onSettleNil && { label: 'Settle to NIL', onSelect: () => actions.onSettleNil!(r), disabled: r.duePaise <= 0 },
            actions?.onEdit && { label: 'Edit', onSelect: () => actions.onEdit!(r) },
            actions?.onCancel && { label: 'Cancel Bill', onSelect: () => actions.onCancel!(r), danger: true, disabled: r.cancelled },
          ].filter(Boolean) as Array<{ label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }>
          if (items.length === 0) return null
          return <RowMenu label={`Actions for ${r.inNo}`} items={items} />
        },
      }),
    )
    return defs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSupplier, actions, selection, anchor?.supplierId, anchor?.pool])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  })

  const hideableColumns = table.getAllLeafColumns().filter((c) => c.getCanHide())

  return (
    <div className="min-w-0">
      <div className="mb-1 flex justify-end">
        <div ref={columnMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setColumnMenuOpen((v) => !v)}
            className="inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 text-[10px] font-medium text-slate-500 hover:text-slate-700"
            title="Toggle columns"
          >
            <Columns3 size={12} /> Columns
          </button>
          {columnMenuOpen && (
            <div className="absolute right-0 z-40 mt-1 w-40 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
              {hideableColumns.map((column) => (
                <label key={column.id} className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                  <input type="checkbox" checked={column.getIsVisible()} onChange={column.getToggleVisibilityHandler()} className="accent-blue-600" />
                  <span className="capitalize">{column.id.replace(/([A-Z])/g, ' $1').trim()}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    className={`whitespace-nowrap border-b border-slate-200 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 ${
                      header.column.id === 'inNo' ? 'sticky left-0 z-10 bg-slate-50' : ''
                    }`}
                  >
                    {header.column.getCanSort() ? (
                      <button type="button" onClick={header.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-slate-800">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIndicator sorted={header.column.getIsSorted()} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.getRowModel().rows.map((row) => {
              const r = row.original
              return (
                <tr key={row.id} onClick={() => void navigate({ to: '/purchase-bills/$billId', params: { billId: r.inNo } })} className="h-[34px] cursor-pointer transition hover:bg-slate-50">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`px-2 py-0 align-middle ${
                        cell.column.id === 'inNo' ? 'sticky left-0 z-10 bg-white font-medium shadow-[1px_0_0_0_#e2e8f0]' : ''
                      } ${r.cancelled ? 'opacity-60' : ''}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-xs italic text-slate-400">
                  {emptyMessage ?? 'No purchase bills match.'}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50/80 font-semibold text-slate-700">
                <td colSpan={showSupplier ? 4 : 3} className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                  Totals ({rows.length})
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{rows.reduce((s, r) => s + r.totalKg, 0).toFixed(3)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(rows.reduce((s, r) => s + r.netPaise, 0))}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(rows.reduce((s, r) => s + r.paidPaise, 0))}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(rows.reduce((s, r) => s + r.duePaise, 0))}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
