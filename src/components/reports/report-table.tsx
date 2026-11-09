import type { ReactNode } from 'react'

export function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: ReactNode[][] }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-xs"><thead className="bg-slate-50 text-left uppercase text-slate-500"><tr>{headers.map((header) => <th key={header} className="px-3 py-2">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-slate-100">{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 tabular-nums">{cell}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <p className="p-6 text-center text-xs text-slate-500">No records in this period.</p>}</div></section>
}
