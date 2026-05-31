export function PartyStatementPreview(props: {
  title: string
  subtitle: string
  summary: Array<{ label: string; value: string }>
  contextLine?: string
  columns: string[]
  rows: string[][]
  emptyMessage: string
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Live preview</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">{props.title}</h3>
          <p className="mt-1 text-sm text-slate-500">{props.subtitle}</p>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {props.summary.map((row) => (
            <div key={row.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{row.label}</p>
              <p className="font-mono text-sm font-semibold text-slate-900">{row.value}</p>
            </div>
          ))}
        </div>

        {props.contextLine ? <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{props.contextLine}</p> : null}

        {props.rows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-16 text-center text-sm text-slate-500">{props.emptyMessage}</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            <div className="max-h-[620px] overflow-auto no-scrollbar">
              <table className="w-full min-w-[820px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-100">{props.columns.map((column) => <th key={column} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{column}</th>)}</tr>
                </thead>
                <tbody>
                  {props.rows.slice(0, 80).map((row, index) => (
                    <tr key={index} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                      {props.columns.map((column, cellIndex) => (
                        <td key={`${column}-${cellIndex}`} className="px-3 py-2 align-top text-sm text-slate-700">{row[cellIndex] || '-'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {props.rows.length > 80 && <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">Preview shows first 80 rows. Export includes all rows.</p>}
          </div>
        )}
      </div>
    </section>
  )
}
