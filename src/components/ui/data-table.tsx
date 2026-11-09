import { useState } from 'react'
import { flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type PaginationState, type SortingState, type VisibilityState, type RowSelectionState } from '@tanstack/react-table'
import type { ReactNode } from 'react'

export function DataTable<T>({ data, columns, loading = false, error, empty = 'No records found.', initialPageSize = 25, selectable = false, footerTotals }: {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  loading?: boolean
  error?: string
  empty?: string
  initialPageSize?: 25 | 50 | 100
  selectable?: boolean
  footerTotals?: ReactNode
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: initialPageSize })
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const table = useReactTable({ data, columns, enableRowSelection: selectable, state: { sorting, pagination, columnVisibility, rowSelection }, onSortingChange: setSorting, onPaginationChange: setPagination, onColumnVisibilityChange: setColumnVisibility, onRowSelectionChange: setRowSelection, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel() })
  return <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-end gap-3 border-b border-slate-100 px-3 py-1.5 text-xs text-slate-600">
      {selectable && <label className="mr-auto flex items-center gap-1.5"><input type="checkbox" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} /> Select page ({table.getSelectedRowModel().rows.length})</label>}
      <details className="relative"><summary className="cursor-pointer select-none">Columns</summary><div className="absolute right-0 z-30 min-w-36 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">{table.getAllLeafColumns().map((column) => <label key={column.id} className="flex items-center gap-2 py-1"><input type="checkbox" checked={column.getIsVisible()} onChange={column.getToggleVisibilityHandler()} />{typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}</label>)}</div></details>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50">
          {table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header, index) => <th key={header.id} scope="col" className={`border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 ${index === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
            {header.isPlaceholder ? null : <button type="button" disabled={!header.column.getCanSort()} onClick={header.column.getToggleSortingHandler()} className="text-left disabled:cursor-default" aria-label={`Sort by ${String(header.column.columnDef.header ?? 'column')}`}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === 'asc' ? ' ↑' : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}</button>}
          </th>)}</tr>)}
        </thead>
        <tbody>{!loading && !error && table.getRowModel().rows.map((row) => <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70">{row.getVisibleCells().map((cell, index) => <td key={cell.id} className={`px-3 py-2 align-middle ${index === 0 ? 'sticky left-0 bg-white font-medium' : ''}`}>{index === 0 && selectable && <input type="checkbox" aria-label={`Select row ${row.index + 1}`} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} className="mr-2" />}{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {(loading || error || table.getRowModel().rows.length === 0) && <p role={error ? 'alert' : 'status'} className="border-t border-slate-100 px-4 py-8 text-center text-sm text-slate-500">{loading ? 'Loading…' : error ?? empty}</p>}
    {footerTotals && <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-right text-xs font-semibold text-slate-900">{footerTotals}</div>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
      <span>{data.length === 0 ? '0 rows' : `${pagination.pageIndex * pagination.pageSize + 1}–${Math.min((pagination.pageIndex + 1) * pagination.pageSize, data.length)} of ${data.length}`}</span>
      <div className="flex items-center gap-2"><label>Rows <select aria-label="Rows per page" value={pagination.pageSize} onChange={(event) => table.setPageSize(Number(event.target.value))} className="rounded-md border border-slate-300 bg-white px-1.5 py-1">{[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40">Previous</button>
        <span>{pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}</span>
        <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40">Next</button>
      </div>
    </div>
  </div>
}
