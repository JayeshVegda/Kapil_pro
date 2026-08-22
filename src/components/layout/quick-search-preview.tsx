import { FilePenLine, FileText, Landmark, Plus, ReceiptText } from 'lucide-react'
import type { QuickSearchResult } from '@/data/quick-search'
import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

type QuickSearchPreviewProps = {
  result: QuickSearchResult | undefined
  query: string
  onAction: (action: 'primary' | 'secondary' | 'tertiary', result: QuickSearchResult) => void
}

export function QuickSearchPreview({ result, query, onAction }: QuickSearchPreviewProps) {
  if (!result) {
    return (
      <aside className="hidden bg-slate-50 p-4 transition duration-200 md:block">
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white px-4 text-center text-sm text-slate-500">
          {query.length > 0 ? 'Select a result to preview it.' : 'Recent activity and today rate appear here.'}
        </div>
      </aside>
    )
  }

  return (
    <aside className="hidden translate-x-0 bg-slate-50 p-4 transition duration-200 ease-out md:block">
      <div className="h-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{result.kind}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{result.previewTitle || result.title}</h2>
          <p className="mt-1 text-sm text-slate-500">{result.subtitle}</p>
        </div>
        <div className="max-h-[54dvh] overflow-auto p-4">
          {result.kind === 'Bill' && result.details?.bill ? <BillPreview result={result} onAction={onAction} /> : null}
          {result.kind === 'Customer' && result.details?.customer ? <CustomerPreview result={result} onAction={onAction} /> : null}
          {result.kind === 'Rate' && result.details?.rate ? <RatePreview result={result} onAction={onAction} /> : null}
          {(!result.details || result.kind === 'Payment') && <FallbackPreview result={result} />}
        </div>
      </div>
    </aside>
  )
}

function BillPreview({ result, onAction }: { result: QuickSearchResult; onAction: QuickSearchPreviewProps['onAction'] }) {
  const bill = result.details?.bill
  if (!bill) return null
  const paid = bill.pendingAmount <= 1
  return (
    <div className="space-y-4">
      <button type="button" className="text-left text-lg font-semibold text-blue-700 hover:text-blue-800" onClick={() => onAction('secondary', result)}>
        {bill.customerName}
      </button>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((item, index) => (
              <tr key={`${item.name}-${index}`} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">{item.name}</td>
                <td className="px-3 py-2 text-right text-slate-600">{formatInrInteger(item.rate)}</td>
                <td className="px-3 py-2 text-right text-slate-600">{item.qty}</td>
                <td className="px-3 py-2 text-right font-medium text-slate-900">{formatInrInteger(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Total amount" value={formatInrInteger(bill.total)} strong />
        <div className={`rounded-lg border px-3 py-2 ${paid ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <p className="text-xs font-semibold uppercase tracking-[0.08em]">{paid ? 'Paid' : 'Pending'}</p>
          <p className="mt-1 text-lg font-bold">{paid ? formatInrInteger(bill.paidAmount) : formatInrInteger(bill.pendingAmount)}</p>
        </div>
        <Metric label="LR number" value={bill.lrNo || '-'} />
        <Metric label="Transport" value={formatInrInteger(bill.transport)} />
      </div>
      <ActionRow
        actions={[
          { label: 'View PDF', icon: FileText, onClick: () => onAction('primary', result) },
          { label: 'Edit', icon: FilePenLine, onClick: () => onAction('secondary', result) },
          { label: 'Record Payment', icon: ReceiptText, onClick: () => onAction('tertiary', result) },
        ]}
      />
    </div>
  )
}

function CustomerPreview({ result, onAction }: { result: QuickSearchResult; onAction: QuickSearchPreviewProps['onAction'] }) {
  const customer = result.details?.customer
  if (!customer) return null
  const balanceTone = customer.balanceLabel === 'Due' ? 'text-red-700' : customer.balanceLabel === 'Advance' ? 'text-green-700' : 'text-slate-700'
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Current balance</p>
        <p className={`mt-1 text-3xl font-bold ${balanceTone}`}>{formatInrInteger(Math.abs(customer.balance))}</p>
        <p className="text-sm font-medium text-slate-500">{customer.balanceLabel}</p>
      </div>
      <div className="rounded-lg border border-slate-200">
        <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Last 3 bills</div>
        {customer.lastBills.length === 0 ? <p className="px-3 py-3 text-sm text-slate-500">No bills yet.</p> : null}
        {customer.lastBills.map((bill) => (
          <div key={bill.id} className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2 first:border-t-0">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">Bill {bill.billRef}</span>
              <span className="block text-xs text-slate-500">{formatFullDate(bill.date)}</span>
            </span>
            <span className="text-sm font-semibold text-slate-900">{formatInrInteger(bill.amount)}</span>
          </div>
        ))}
      </div>
      <Metric label="Last payment" value={customer.lastPayment ? `${formatFullDate(customer.lastPayment.date)} · ${formatInrInteger(customer.lastPayment.amount)}` : '-'} />
      <ActionRow
        actions={[
          { label: 'Open Ledger', icon: Landmark, onClick: () => onAction('primary', result) },
          { label: 'New Bill', icon: FileText, onClick: () => onAction('secondary', result) },
          { label: 'Add Payment', icon: Plus, onClick: () => onAction('tertiary', result) },
        ]}
      />
    </div>
  )
}

function RatePreview({ result, onAction }: { result: QuickSearchResult; onAction: QuickSearchPreviewProps['onAction'] }) {
  const rate = result.details?.rate
  if (!rate) return null
  return (
    <div className="space-y-4">
      <div>
        <p className="text-2xl font-bold text-slate-950">{formatFullDate(rate.date)}</p>
        {typeof rate.change === 'number' ? (
          <p className={`mt-1 text-sm font-semibold ${rate.change >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {rate.change >= 0 ? '↑' : '↓'} {formatInrInteger(Math.abs(rate.change))} vs yesterday
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Vilaity" value={formatInrInteger(rate.vilaity)} strong />
        <Metric label="Honey Europe" value={formatInrInteger(rate.honeyEurope)} />
        <Metric label="Honey Gulf" value={formatInrInteger(rate.honeyGulf)} />
        <Metric label="Delhi Local" value={formatInrInteger(rate.delhiLocal)} />
        <Metric label="LME 3M" value={rate.lme3m ? String(rate.lme3m) : '-'} />
      </div>
      <ActionRow actions={[{ label: 'Use in Bill', icon: FileText, onClick: () => onAction('primary', result) }]} />
    </div>
  )
}

function FallbackPreview({ result }: { result: QuickSearchResult }) {
  return (
    <div className="space-y-2">
      {(result.previewLines ?? []).map((line) => (
        <Metric key={`${line.label}-${line.value}`} label={line.label} value={line.value} />
      ))}
      <p className="mt-5 rounded-md bg-slate-900 px-3 py-2 text-center text-xs font-semibold text-white">{result.actionLabel || 'Open'}</p>
    </div>
  )
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-1 truncate ${strong ? 'text-lg font-bold text-slate-950' : 'text-sm font-semibold text-slate-800'}`}>{value}</p>
    </div>
  )
}

function ActionRow({ actions }: { actions: Array<{ label: string; icon: typeof FileText; onClick: () => void }> }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button
            key={action.label}
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
            onClick={action.onClick}
          >
            <Icon size={14} />
            {action.label}
          </button>
        )
      })}
    </div>
  )
}
