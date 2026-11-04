import { computeBillNet } from '@/domain/supplier-purchases'
import { FIRM_HEADER, CHITTY_DOC_NAME } from '@/config/firm'
import { formatFullDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'
import { gramsToKgText, milliToRateText } from '@/domain/supplier-units'

export type ChittyLine = { itemName: string; weightG: number; rateMilli: number; amountPaise: number }
export type ChittyAdjustment = { type: string; amountPaise: number; note?: string }
export type ChittyBardan = {
  bardanG: number
  rateMilli: number
  method: string
  creditPaise: number
  cashAmountPaise: number
  date: string
  note: string
}
export type ChittyPaymentRow = {
  date: string
  mode: string
  reference: string
  amountPaise: number
  pinned: boolean
}
export type ChittyStatus = 'open' | 'partial' | 'nil' | 'cancelled'

export type BillChittyData = {
  inNo: string
  date: string
  supplierName: string
  pool: 'kacha' | 'gst'
  taxMode: string
  gstRateBp: number
  supplierBillNo: string
  vehicleNo: string
  lines: ChittyLine[]
  adjustments: ChittyAdjustment[]
  bardan: ChittyBardan[]
  paidRows: ChittyPaymentRow[]
  cancelled?: boolean
  cancelReason?: string
  statusOverride?: ChittyStatus
}

export type ChittyTotals = {
  linesTotalPaise: number
  bardanCreditPaise: number
  qualityCutPaise: number
  otherAdjustmentsPaise: number
  taxablePaise: number
  taxPaise: number
  rcmLiabilityPaise: number
  roundOffPaise: number
  netPaise: number
  paidPaise: number
  duePaise: number
  status: ChittyStatus
}

/**
 * The one totals computation shared by the chitty page (view) and the new-bill
 * split-screen (preview). Mode never changes the numbers — only rendering.
 */
export function computeChittyTotals(data: BillChittyData, _mode: 'view' | 'preview' = 'view'): ChittyTotals {
  const net = computeBillNet(
    data.lines.map((l) => ({ amountPaise: l.amountPaise })),
    data.adjustments.map((a) => ({ type: a.type, amountPaise: a.amountPaise })),
    data.bardan.map((b) => ({ method: b.method, creditPaise: b.creditPaise, cashAmountPaise: b.cashAmountPaise })),
    data.taxMode,
    data.gstRateBp,
  )
  const paidPaise = data.paidRows.reduce((sum, row) => sum + row.amountPaise, 0)
  const duePaise = Math.max(0, net.netPaise - paidPaise)
  const status: ChittyStatus = data.cancelled
    ? 'cancelled'
    : (data.statusOverride ?? (duePaise === 0 ? 'nil' : paidPaise > 0 ? 'partial' : 'open'))
  return {
    linesTotalPaise: net.linesTotalPaise,
    bardanCreditPaise: net.bardanDeductPaise,
    qualityCutPaise: net.qualityCutPaise,
    otherAdjustmentsPaise: net.otherAdjustmentsPaise,
    taxablePaise: net.taxablePaise,
    taxPaise: net.taxPaise,
    rcmLiabilityPaise: net.rcmLiabilityPaise,
    roundOffPaise: net.roundOffPaise,
    netPaise: net.netPaise,
    paidPaise,
    duePaise,
    status,
  }
}

const ADJUSTMENT_LABEL: Record<string, string> = {
  labour: 'Labour',
  transport: 'Transport',
  quality_cut: 'Quality Cut',
  other: 'Other',
}

const BARDAN_METHOD_LABEL: Record<string, string> = {
  deduct: 'Deduct',
  in_kind: 'In Kind',
  cash_back: 'Cash Back',
  advance: 'Advance',
}

/** Blank placeholder used for empty fields in preview mode. */
function Blank() {
  return <span className="inline-block w-14 border-b border-dotted border-slate-300" aria-hidden="true" />
}

function PoolChip({ pool }: { pool: 'kacha' | 'gst' }) {
  return (
    <span
      className={`inline-flex h-4.5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold uppercase ${
        pool === 'gst' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
      }`}
      title={pool === 'gst' ? 'GST pool' : 'Kacha pool'}
    >
      {pool === 'gst' ? 'G' : 'K'}
    </span>
  )
}

export function StatusStamp({ status }: { status: ChittyStatus }) {
  const styles: Record<ChittyStatus, string> = {
    open: 'border-rose-300 text-rose-600',
    partial: 'border-amber-300 text-amber-700',
    nil: 'border-emerald-300 text-emerald-700',
    cancelled: 'border-slate-400 text-slate-500 line-through',
  }
  return (
    <span className={`inline-flex items-center rounded border-2 px-2 py-0.5 text-xs font-bold uppercase tracking-widest ${styles[status]}`}>
      {status}
    </span>
  )
}

/**
 * Paper-style purchase chitty. mode="view" renders stored data; mode="preview"
 * renders draft data with dotted blanks for empty fields. Totals come from the
 * shared computeChittyTotals in both modes.
 */
export function BillChitty({ data, mode = 'view' }: { data: BillChittyData; mode?: 'view' | 'preview' }) {
  const t = computeChittyTotals(data, mode)
  const preview = mode === 'preview'

  return (
    <div className="print-chitty mx-auto w-full max-w-[840px] rounded-lg border border-slate-200 bg-white px-8 py-6 text-[13px] text-slate-800 shadow-sm">
      {/* Firm header */}
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
        <div>
          <p className="text-lg font-bold tracking-wide text-slate-900">{FIRM_HEADER}</p>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{CHITTY_DOC_NAME}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-base font-bold text-slate-900">{data.inNo || (preview ? '' : '—')}{preview && !data.inNo ? <Blank /> : null}</p>
          <p className="text-xs text-slate-500">{data.date ? formatFullDate(data.date) : preview ? <Blank /> : '—'}</p>
        </div>
      </div>

      {/* Supplier meta */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 py-3 text-[13px]">
        <div className="flex gap-1.5">
          <span className="w-24 shrink-0 text-slate-400">Supplier</span>
          <span className="font-semibold text-slate-900">{data.supplierName || (preview ? <Blank /> : '—')}</span>
        </div>
        <div className="flex gap-1.5">
          <span className="w-24 shrink-0 text-slate-400">Pool</span>
          <span className="flex items-center gap-1.5">
            <PoolChip pool={data.pool} />
            <span className="capitalize text-slate-700">{data.pool}</span>
          </span>
        </div>
        <div className="flex gap-1.5">
          <span className="w-24 shrink-0 text-slate-400">Supplier Bill</span>
          <span className="text-slate-700">{data.supplierBillNo || (preview ? <Blank /> : '—')}</span>
        </div>
        <div className="flex gap-1.5">
          <span className="w-24 shrink-0 text-slate-400">Vehicle</span>
          <span className="text-slate-700">{data.vehicleNo || (preview ? <Blank /> : '—')}</span>
        </div>
      </div>

      {/* Lines */}
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-y border-slate-300 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <th className="w-8 py-1.5 pr-2 font-semibold">#</th>
            <th className="py-1.5 pr-2 font-semibold">Item</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Weight (kg)</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Rate (₹/kg)</th>
            <th className="py-1.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.length === 0 && (
            <tr>
              <td className="py-1.5 text-slate-400">1</td>
              <td>{preview ? <Blank /> : '—'}</td>
              <td className="text-right">{preview ? <Blank /> : '—'}</td>
              <td className="text-right">{preview ? <Blank /> : '—'}</td>
              <td className="text-right">{preview ? <Blank /> : '—'}</td>
            </tr>
          )}
          {data.lines.map((line, index) => (
            <tr key={index} className="border-b border-slate-100">
              <td className="py-1.5 pr-2 text-slate-400">{index + 1}</td>
              <td className="py-1.5 pr-2 font-medium text-slate-900">{line.itemName || (preview ? <Blank /> : '—')}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{line.weightG > 0 ? gramsToKgText(line.weightG) : preview ? <Blank /> : '—'}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{line.rateMilli > 0 ? `₹${milliToRateText(line.rateMilli)}` : preview ? <Blank /> : '—'}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{formatPaiseInr(line.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Adjustments */}
      {(data.adjustments.length > 0 || t.bardanCreditPaise > 0 || t.qualityCutPaise > 0 || t.otherAdjustmentsPaise !== 0 || t.taxPaise > 0 || t.roundOffPaise !== 0) && (
        <div className="mt-3 space-y-1 border-t border-dashed border-slate-200 pt-2.5 text-[13px]">
          {data.adjustments.map((a, index) => (
            <div key={index} className="flex justify-between">
              <span className="text-slate-600">
                {ADJUSTMENT_LABEL[a.type] ?? a.type}
                {a.note ? <span className="text-slate-400"> · {a.note}</span> : null}
              </span>
              <span className="font-mono tabular-nums">
                {a.amountPaise >= 0 ? '+' : '-'}
                {formatPaiseInr(Math.abs(a.amountPaise))}
              </span>
            </div>
          ))}
          {t.bardanCreditPaise > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-600">Bardan deduct</span>
              <span className="font-mono tabular-nums text-amber-700">-{formatPaiseInr(t.bardanCreditPaise)}</span>
            </div>
          )}
          {t.taxPaise > 0 && data.taxMode === 'gst' && (
            <div className="flex justify-between">
              <span className="text-slate-600">GST @ {data.gstRateBp / 100}%</span>
              <span className="font-mono tabular-nums">+{formatPaiseInr(t.taxPaise)}</span>
            </div>
          )}
          {data.taxMode === 'rcm' && t.rcmLiabilityPaise > 0 && (
            <div className="flex justify-between text-slate-500">
              <span>RCM liability ({data.gstRateBp / 100}%) — ours, not added</span>
              <span className="font-mono tabular-nums">{formatPaiseInr(t.rcmLiabilityPaise)}</span>
            </div>
          )}
          {t.roundOffPaise !== 0 && (
            <div className="flex justify-between text-slate-400">
              <span>Round off</span>
              <span className="font-mono tabular-nums">
                {t.roundOffPaise > 0 ? '+' : '-'}
                {formatPaiseInr(Math.abs(t.roundOffPaise))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Bardan block */}
      <div className="mt-3 rounded border border-slate-200 bg-slate-50/60 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Bardan (empty bags)</p>
        {data.bardan.length === 0 ? (
          <p className="mt-1 text-xs font-semibold text-amber-600">Bardan pending</p>
        ) : (
          <div className="mt-1 space-y-0.5">
            {data.bardan.map((entry, index) => (
              <p key={index} className="text-xs text-slate-600">
                <span className="font-mono tabular-nums text-slate-800">{gramsToKgText(entry.bardanG)} kg</span>
                {' · '}
                <span className="font-medium">{BARDAN_METHOD_LABEL[entry.method] ?? entry.method}</span>
                {entry.creditPaise > 0 && <> · credit <span className="font-mono tabular-nums">{formatPaiseInr(entry.creditPaise)}</span></>}
                {entry.cashAmountPaise > 0 && <> · cash <span className="font-mono tabular-nums">{formatPaiseInr(entry.cashAmountPaise)}</span></>}
                {entry.date && <> · {formatFullDate(entry.date)}</>}
                {entry.note && <> · <span className="italic text-slate-500">{entry.note}</span></>}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Net payable */}
      <div className="mt-4 flex items-end justify-between border-t-2 border-slate-800 pt-2.5">
        <span className="text-sm font-bold uppercase tracking-wider text-slate-700">Net Payable</span>
        <span className="font-mono text-2xl font-bold tabular-nums text-slate-900">{formatPaiseInr(t.netPaise)}</span>
      </div>

      {/* Paid list */}
      {data.paidRows.length > 0 && (
        <div className="mt-3 space-y-1 text-[13px]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Paid</p>
          {data.paidRows.map((row, index) => (
            <div key={index} className="flex justify-between">
              <span className="text-slate-600">
                {row.date ? formatFullDate(row.date) : '—'}
                {' · '}
                <span className="uppercase">{row.mode || '—'}</span>
                {row.reference ? ` · ${row.reference}` : ''}
                {' · '}
                <span className={`rounded px-1 text-[10px] font-semibold ${row.pinned ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                  {row.pinned ? 'pinned' : 'FIFO'}
                </span>
              </span>
              <span className="font-mono tabular-nums text-emerald-700">{formatPaiseInr(row.amountPaise)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Due + stamp */}
      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold uppercase tracking-wider text-slate-700">Due</span>
          <StatusStamp status={t.status} />
          {t.status === 'cancelled' && data.cancelReason && <span className="text-xs italic text-slate-400">{data.cancelReason}</span>}
        </div>
        <span className={`font-mono text-xl font-bold tabular-nums ${t.duePaise > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatPaiseInr(t.duePaise)}</span>
      </div>
    </div>
  )
}
