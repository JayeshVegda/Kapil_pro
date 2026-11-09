import { useMemo } from 'react'
import { computeBillNet } from '@/domain/supplier-purchases'
import { FIRM_NAME } from '@/config/firm'
import { formatFullDate } from '@/lib/date'
import { formatPaiseInr } from '@/lib/inr-format'
import { gramsToKgText, milliToRateText } from '@/domain/supplier-units'

export type ChittyLine = {
  itemName: string
  weightG: number
  rateMilli: number
  amountPaise: number
  bardanG?: number
  bardanText?: string
}
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
  /** Pool drives the firm-heading ink: kacha = slate-950, gst = red. */
  pool?: 'kacha' | 'gst'
  taxMode: string
  gstRateBp: number
  supplierBillNo: string
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
 * Shared totals calculation for view and preview modes.
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

function Blank() {
  return <span className="inline-block w-14 border-b border-dotted border-slate-300" aria-hidden="true" />
}

export function StatusStamp({ status }: { status: ChittyStatus }) {
  const styles: Record<ChittyStatus, string> = {
    open: 'border-rose-300 text-rose-600 bg-rose-50/50',
    partial: 'border-amber-300 text-amber-700 bg-amber-50/50',
    nil: 'border-emerald-300 text-emerald-700 bg-emerald-50/50',
    cancelled: 'border-slate-400 text-slate-500 bg-slate-50 line-through',
  }
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${styles[status]}`}
    >
      {status}
    </span>
  )
}

/**
 * Standardized, minimal paper-style purchase chitty.
 * - Top left: Kapil Product, down: Jamnagar
 * - Top right: Bill No, down: Date (in red ink if GST bill)
 * - Party line clean (no kacha / gst badges)
 * - Table: Item #, Item Description, Bardan, Weight, Rate, Amount
 * - One prominent bold & bigger Bill Net Amount (no duplicate Item Gross Subtotal)
 * - Payments & Credits Applied in clean grayish background
 * - Balance Due with single final amount (NIL if 0, no trailing noise)
 */
export function BillChitty({
  data,
  mode = 'view',
  density = 'regular',
}: {
  data: BillChittyData
  mode?: 'view' | 'preview'
  density?: 'regular' | 'comfortable'
}) {
  const t = computeChittyTotals(data, mode)
  const preview = mode === 'preview'
  const comfortable = density === 'comfortable'
  const isGst = data.pool === 'gst' || data.taxMode === 'gst'
  const brandColor = isGst ? '#dc2626' : '#0f172a'

  const totalWeightG = data.lines.reduce((s, l) => s + (l.weightG || 0), 0)
  const bardanDeductG = data.bardan
    .filter((b) => b.method === 'deduct')
    .reduce((s, b) => s + (b.bardanG || 0), 0)

  const hasAdjustments =
    data.adjustments.length > 0 ||
    t.bardanCreditPaise > 0 ||
    t.qualityCutPaise > 0 ||
    t.taxPaise > 0 ||
    t.rcmLiabilityPaise > 0 ||
    t.roundOffPaise !== 0

  const hasPaidRows = data.paidRows.length > 0

  return (
    <div
      className={`print-chitty mx-auto w-full max-w-[530px] rounded-xl border border-slate-200 bg-white ${
        comfortable ? 'p-8 text-[14px]' : 'p-5 sm:p-6 text-[13px]'
      } text-slate-800 shadow-sm`}
    >
      {/* 1. HEADER: Firm Name + Jamnagar (Left) | Bill No & Date (Right) */}
      <div className="flex items-start justify-between border-b border-slate-900 pb-3">
        <div>
          <h1
            className="text-xl sm:text-2xl font-black tracking-tight"
            style={{ color: brandColor }}
          >
            {FIRM_NAME}
          </h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mt-0.5">
            Jamnagar
          </p>
        </div>

        <div className="text-right">
          <div>
            <span className="text-[11px] font-semibold text-slate-400 mr-1.5">Bill No:</span>
            <span
              className={`font-mono text-base font-extrabold ${
                isGst ? 'text-rose-600' : 'text-slate-900'
              }`}
            >
              {data.inNo || (preview ? '' : '—')}
              {preview && !data.inNo ? <Blank /> : null}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">Date:</span>
            {data.date ? formatFullDate(data.date) : preview ? <Blank /> : '—'}
          </p>
        </div>
      </div>

      {/* 2. PARTY META: Supplier Strip (Clean — no kacha / gst badge) */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 border-b border-slate-100 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Party:</span>
          <span className="font-bold text-slate-900 text-sm">
            {data.supplierName || (preview ? <Blank /> : '—')}
          </span>
          {data.supplierBillNo && (
            <span className="text-slate-500 text-xs">
              (Bill: <span className="font-mono font-medium text-slate-700">{data.supplierBillNo}</span>)
            </span>
          )}
        </div>
      </div>

      {/* 3. MATERIAL LINES TABLE: #, Item Description, Bardan, Weight, Rate, Amount */}
      <div className="hidden py-2.5 sm:block print:block">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <th className="w-6 py-2 pr-1.5 text-left">#</th>
              <th className="py-2 px-1.5 text-left whitespace-nowrap">Item Description</th>
              <th className="py-2 px-1.5 text-right whitespace-nowrap">Bardan</th>
              <th className="py-2 px-1.5 text-right whitespace-nowrap">Weight</th>
              <th className="py-2 px-1.5 text-right whitespace-nowrap">Rate</th>
              <th className="py-2 pl-1.5 text-right whitespace-nowrap">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.lines.length === 0 && (
              <tr>
                <td className="py-2 pr-1.5 text-slate-300">1</td>
                <td className="py-2 px-1.5">{preview ? <Blank /> : '—'}</td>
                <td className="py-2 px-1.5 text-right">{preview ? <Blank /> : '—'}</td>
                <td className="py-2 px-1.5 text-right">{preview ? <Blank /> : '—'}</td>
                <td className="py-2 px-1.5 text-right">{preview ? <Blank /> : '—'}</td>
                <td className="py-2 pl-1.5 text-right">{preview ? <Blank /> : '—'}</td>
              </tr>
            )}
            {data.lines.map((line, index) => {
              const bardanDisplay =
                line.bardanG && line.bardanG > 0
                  ? `${gramsToKgText(line.bardanG)} kg`
                  : line.bardanText
                    ? line.bardanText
                    : data.lines.length === 1 && bardanDeductG > 0
                      ? `${gramsToKgText(bardanDeductG)} kg`
                      : preview
                        ? ''
                        : '—'

              return (
                <tr key={index}>
                  <td className="py-2 pr-1.5 text-slate-400 font-mono text-[11px]">{index + 1}</td>
                  <td className="py-2 px-1.5 font-semibold text-slate-900">
                    {line.itemName || (preview ? <Blank /> : '—')}
                  </td>
                  <td className="py-2 px-1.5 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
                    {bardanDisplay || (preview ? <Blank /> : '—')}
                  </td>
                  <td className="py-2 px-1.5 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                    {line.weightG > 0 ? `${gramsToKgText(line.weightG)} kg` : preview ? <Blank /> : '—'}
                  </td>
                  <td className="py-2 px-1.5 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                    {line.rateMilli > 0 ? `₹${milliToRateText(line.rateMilli)}/kg` : preview ? <Blank /> : '—'}
                  </td>
                  <td className="py-2 pl-1.5 text-right font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap">
                    {formatPaiseInr(line.amountPaise)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 3b. STACKED LINES: phone fallback for the same table above; print keeps the table */}
      <ol className="divide-y divide-slate-100 py-2.5 sm:hidden print:hidden">
        {data.lines.length === 0 && (
          <li className="py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 font-semibold text-slate-900">{preview ? <Blank /> : '—'}</span>
              <span className="font-mono text-right">{preview ? <Blank /> : '—'}</span>
            </div>
          </li>
        )}
        {data.lines.map((line, index) => {
          const bardanDisplay =
            line.bardanG && line.bardanG > 0
              ? `${gramsToKgText(line.bardanG)} kg`
              : line.bardanText
                ? line.bardanText
                : data.lines.length === 1 && bardanDeductG > 0
                  ? `${gramsToKgText(bardanDeductG)} kg`
                  : ''
          return (
            <li key={index} className="py-2">
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 text-xs font-bold text-slate-900">
                  <span className="mr-1 font-mono text-[11px] font-medium text-slate-400">{index + 1}</span>
                  {line.itemName || (preview ? <Blank /> : '—')}
                </span>
                <span className="shrink-0 font-mono text-xs font-bold text-slate-900 tabular-nums">
                  {formatPaiseInr(line.amountPaise)}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono text-slate-600 tabular-nums">
                {bardanDisplay && <span>Bardan {bardanDisplay}</span>}
                {line.weightG > 0 && <span>{gramsToKgText(line.weightG)} kg</span>}
                {line.rateMilli > 0 && <span>₹{milliToRateText(line.rateMilli)}/kg</span>}
              </div>
            </li>
          )
        })}
      </ol>

      {/* 4. FINANCIAL SUMMARY & ADJUSTMENTS */}
      <div className="border-t border-slate-200 pt-2.5 space-y-2 text-xs">
        {/* These adjustments are already included in the bill net below. */}
        {hasAdjustments && (
          <div className="space-y-1 py-1 border-b border-dashed border-slate-200">
            {t.bardanCreditPaise > 0 && (
              <div className="flex justify-between items-center text-rose-700">
                <span>Less: Bardan</span>
                <span className="font-mono font-semibold tabular-nums">− {formatPaiseInr(t.bardanCreditPaise)}</span>
              </div>
            )}
            {/* Quality Cut */}
            {data.adjustments
              .filter((a) => a.type === 'quality_cut')
              .map((a, idx) => (
                <div key={`qc-${idx}`} className="flex justify-between items-center text-rose-700">
                  <span>
                    {a.amountPaise >= 0 ? 'Less: Quality Cut' : 'Add: Quality Credit'} {a.note ? <span className="text-slate-400">({a.note})</span> : ''}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">
                    {a.amountPaise >= 0 ? '−' : '+'} {formatPaiseInr(Math.abs(a.amountPaise))}
                  </span>
                </div>
              ))}

            {/* Other Adjustments */}
            {data.adjustments
              .filter((a) => a.type !== 'quality_cut')
              .map((a, idx) => {
                const isAdd = a.amountPaise >= 0
                return (
                  <div
                    key={`adj-${idx}`}
                    className={`flex justify-between items-center ${isAdd ? 'text-slate-700' : 'text-rose-700'}`}
                  >
                    <span>
                      {isAdd ? 'Add: ' : 'Less: '}
                      {ADJUSTMENT_LABEL[a.type] ?? a.type}
                      {a.note ? <span className="text-slate-400 font-normal"> ({a.note})</span> : ''}
                    </span>
                    <span className="font-mono font-semibold tabular-nums">
                      {isAdd ? '+ ' : '− '}
                      {formatPaiseInr(Math.abs(a.amountPaise))}
                    </span>
                  </div>
                )
              })}

            {/* GST */}
            {t.taxPaise > 0 && data.taxMode === 'gst' && (
              <div className="flex justify-between items-center text-slate-700">
                <span>Add: GST @ {data.gstRateBp / 100}%</span>
                <span className="font-mono font-semibold tabular-nums">
                  + {formatPaiseInr(t.taxPaise)}
                </span>
              </div>
            )}

            {/* RCM Liability */}
            {data.taxMode === 'rcm' && t.rcmLiabilityPaise > 0 && (
              <div className="flex justify-between items-center text-slate-400 text-[11px] italic">
                <span>RCM Liability ({data.gstRateBp / 100}%) · reverse charge</span>
                <span className="font-mono tabular-nums">{formatPaiseInr(t.rcmLiabilityPaise)}</span>
              </div>
            )}

            {/* Round off */}
            {t.roundOffPaise !== 0 && (
              <div className="flex justify-between items-center text-slate-500 text-[11px]">
                <span>Round off</span>
                <span className="font-mono tabular-nums">
                  {t.roundOffPaise > 0 ? '+ ' : '− '}
                  {formatPaiseInr(Math.abs(t.roundOffPaise))}
                </span>
              </div>
            )}
          </div>
        )}

        {/* 3. TOTAL: Bill Net Amount (Bold and Bigger — no duplicate gross subtotal) */}
        <div className="flex justify-between items-baseline py-1 text-slate-900">
          <span className="font-black text-sm sm:text-base tracking-tight">
            Bill Net Amount
            {totalWeightG > 0 && (
              <span className="text-slate-400 font-mono ml-1.5 font-normal text-xs">
                ({gramsToKgText(totalWeightG)} kg)
              </span>
            )}
          </span>
          <span className="font-mono font-black text-sm sm:text-base tabular-nums">
            {formatPaiseInr(t.netPaise)}
          </span>
        </div>

        {/* 4. PAYMENT: Payments & Credits Applied: Grayish Background Container */}
        {hasPaidRows && (
          <div className="rounded-lg bg-slate-100/90 border border-slate-200/80 p-3 my-2 space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Payments &amp; Credits Applied
            </div>
            {data.paidRows.map((row, index) => (
              <div key={index} className="flex items-center justify-between text-xs text-slate-800">
                <span>
                  {row.date ? `Paid on ${formatFullDate(row.date)}` : row.reference || 'Credit applied'}
                  {row.mode || (row.reference && row.date) ? (
                    <span className="text-slate-500 font-mono text-[11px] ml-1">
                      ({[row.mode.toUpperCase(), row.reference].filter(Boolean).join(' · ')})
                    </span>
                  ) : null}
                </span>
                <span className="font-mono font-bold tabular-nums text-slate-900">
                  − {formatPaiseInr(row.amountPaise)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 5. BARDAN: Bardan Deductions & Credit (Placed AFTER Payments, BEFORE Balance Due) */}
        {data.bardan.length > 0 && (
          <div className="rounded-lg bg-slate-100/90 border border-slate-200/80 p-3 my-2 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <span>Bardan (Bags) Details</span>
              {bardanDeductG > 0 && (
                <span className="font-mono text-slate-700 font-semibold text-[11px]">
                  {gramsToKgText(bardanDeductG)} kg
                </span>
              )}
            </div>
            {data.bardan.map((entry, index) => {
              const detailText = entry.method === 'deduct'
                ? `Included in bill net · ${formatPaiseInr(entry.creditPaise)}`
                : entry.method === 'advance'
                  ? `Pool credit · ${formatPaiseInr(entry.creditPaise)}`
                  : entry.method === 'cash_back'
                    ? `Cash memo · ${formatPaiseInr(entry.cashAmountPaise)}`
                    : 'Settled in kind'
              return (
                <div key={index} className="flex items-center justify-between text-xs text-slate-800">
                  <span>
                    Bardan ({BARDAN_METHOD_LABEL[entry.method] ?? entry.method})
                    {entry.bardanG > 0 && (
                      <span className="font-mono text-slate-500 ml-1">
                        · {gramsToKgText(entry.bardanG)} kg
                        {entry.rateMilli > 0 ? ` @ ₹${milliToRateText(entry.rateMilli)}/kg` : ''}
                      </span>
                    )}
                    {entry.note ? <span className="text-slate-500 ml-1">({entry.note})</span> : ''}
                  </span>
                  <span className="text-right text-slate-500 text-[11px] tabular-nums">{detailText}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 6. FINAL TOTAL: BALANCE DUE (ALWAYS AT THE VERY BOTTOM — NOTHING FOLLOWS) */}
      <div className="mt-4 pt-3 border-t-2 border-slate-900 flex items-baseline justify-between">
        <div>
          <span className="text-xs font-black uppercase tracking-wider text-slate-900">
            Balance Due
          </span>
        </div>

        <div className="text-right">
          {t.duePaise <= 0 ? (
            <span
              className={`font-mono ${
                comfortable ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'
              } font-black uppercase tracking-wider text-emerald-700`}
            >
              nil
            </span>
          ) : (
            <span
              className={`font-mono ${
                comfortable ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'
              } font-black tabular-nums text-rose-600`}
            >
              {formatPaiseInr(t.duePaise)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Dedicated KPI box rendered immediately after Bill Chitty.
 * Displays:
 * 1. Purchase rate/price for the items & overall average
 * 2. Amount and details of last payment paid
 * 3. Operational metadata not represented in Bill Chitty (Kacha/GST, status, settlement, notes)
 */
export function BillChittyKpiBox({
  data,
  duePaise,
  lastPayment,
}: {
  data: BillChittyData
  duePaise?: number
  lastPayment?: { amountPaise: number; date: string; mode?: string; reference?: string } | null
}) {
  const totals = computeChittyTotals(data, 'view')
  const totalWeightG = data.lines.reduce((s, l) => s + (l.weightG || 0), 0)
  const effectiveDuePaise = duePaise !== undefined ? duePaise : totals.duePaise

  // Last payment info from data.paidRows or prop
  const effectiveLastPayment = useMemo(() => {
    if (data.paidRows.length > 0) {
      const sorted = [...data.paidRows].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      return sorted[0]
    }
    return lastPayment ?? null
  }, [data.paidRows, lastPayment])

  // Average purchase rate across all lines (milli-rupees per kg)
  const avgRateMilli =
    totalWeightG > 0
      ? Math.round((totals.linesTotalPaise * 10000) / totalWeightG)
      : data.lines[0]?.rateMilli ?? 0

  const isGst = data.pool === 'gst' || data.taxMode === 'gst'

  return (
    <section aria-label="Bill settlement" className="rounded-xl border border-slate-200 bg-white p-4 text-slate-900 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h4 className="text-sm font-semibold">Bill settlement</h4>
          <p className="mt-0.5 text-xs text-slate-500">{data.inNo || 'New bill'}{data.supplierName ? ` · ${data.supplierName}` : ''}</p>
        </div>
        <div className="flex gap-1.5 text-xs">
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">{isGst ? 'GST' : 'Kacha'}</span>
          <span className={`rounded border px-2 py-1 ${data.cancelled ? 'border-slate-200 bg-slate-50 text-slate-600' : effectiveDuePaise <= 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : totals.paidPaise > 0 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
            {data.cancelled ? 'Cancelled' : effectiveDuePaise <= 0 ? 'Paid' : totals.paidPaise > 0 ? 'Part paid' : 'Unpaid'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="py-3 sm:pr-4"><p className="text-xs text-slate-500">Bill amount</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{formatPaiseInr(totals.netPaise)}</p><p className="mt-1 text-xs text-slate-500">{totalWeightG > 0 ? `${gramsToKgText(totalWeightG)} kg` : 'No weight'}{avgRateMilli > 0 ? ` · Avg ₹${milliToRateText(avgRateMilli)}/kg` : ''}</p></div>
        <div className="py-3 sm:px-4"><p className="text-xs text-slate-500">Paid so far</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-700">{formatPaiseInr(totals.paidPaise)}</p><p className="mt-1 text-xs text-slate-500">{effectiveLastPayment ? `Last ${effectiveLastPayment.date ? formatFullDate(effectiveLastPayment.date) : 'credit'} · ${formatPaiseInr(effectiveLastPayment.amountPaise)}` : 'No payment recorded'}</p></div>
        <div className="py-3 sm:pl-4"><p className="text-xs text-slate-500">Still to pay</p><p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${effectiveDuePaise > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatPaiseInr(Math.max(0, effectiveDuePaise))}</p><p className="mt-1 text-xs text-slate-500">{data.bardan.length > 0 ? `${data.bardan.length} bardan entries` : 'No bardan recorded'}</p></div>
      </div>
      {data.lines.length > 0 && <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">{data.lines.map((line, index) => <span key={`${line.itemName}-${index}`}>{line.itemName} · {gramsToKgText(line.weightG)} kg @ ₹{milliToRateText(line.rateMilli)}/kg</span>)}</div>}
    </section>
  )
}
