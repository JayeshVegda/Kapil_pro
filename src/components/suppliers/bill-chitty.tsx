import { useMemo } from 'react'
import { StickyNote } from 'lucide-react'
import { computeBillNet } from '@/domain/supplier-purchases'
import { FIRM_CITY, FIRM_NAME } from '@/config/firm'
import { formatFullDate } from '@/lib/date'
import { purchaseReceiptBagCount } from '@/domain/purchase-receipt-memos'
import { formatPaiseInr } from '@/lib/inr-format'
import { gramsToKgText } from '@/domain/supplier-units'

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
  itemName?: string
  bagCount?: number
  bardanG: number
  rateMilli: number
  method: string
  creditPaise: number
  cashAmountPaise: number
  date: string
  note: string
}
export type ChittyPaymentRow = {
  hasNote?: boolean
  creditLabel?: string
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
  bagsAtReceiptKg?: number | null
  vehicleNo?: string
  lines: ChittyLine[]
  adjustments: ChittyAdjustment[]
  bardan: ChittyBardan[]
  paidRows: ChittyPaymentRow[]
  advancePaise?: number
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
  advancePaise: number
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
  const advancePaise = data.cancelled ? 0 : Math.max(0, data.advancePaise ?? paidPaise - net.netPaise)
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
    advancePaise,
    status,
  }
}

const adjustmentNames: Record<string, string> = { labour: 'Labour', transport: 'Transport', quality_cut: 'Quality Cut' }
const rateDisplay = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const weightDisplay = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 })
const breakdownCardClass = 'mt-2 rounded-md border border-slate-300 bg-slate-200/80 px-2.5 py-1.5 text-[11px] leading-snug print:[print-color-adjust:exact]'
export const formatChittyRate = (rateMilli: number) => `₹${rateDisplay.format(rateMilli / 1000)}`
const signedMoney = (paise: number) => `${paise < 0 ? '−' : '+'}${formatPaiseInr(Math.abs(paise))}`


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

export function BillChitty({
  data,
  mode = 'view',
  density = 'regular',
}: {
  data: BillChittyData
  mode?: 'view' | 'preview'
  density?: 'regular' | 'comfortable' | 'dialog'
}) {
  const totals = computeChittyTotals(data, mode)
  const supplier = data.supplierName.trim()
  const isGst = data.pool === 'gst' || data.taxMode === 'gst'
  const showBardanColumn = data.lines.some((line) => purchaseReceiptBagCount(line.bardanText) > 0)
  const bagWeight = data.bagsAtReceiptKg ?? 0
  const details = [
    ['Supplier invoice no.', data.supplierBillNo.trim()],
    ['Bag weight memo', bagWeight > 0 ? `${weightDisplay.format(bagWeight)} kg` : ''],
    ['Vehicle no.', data.vehicleNo?.trim()],
  ]
  const adjustments = data.adjustments.filter((row) => row.amountPaise !== 0).map((row) => {
    const note = row.note?.trim().replace(/^other$/i, '')
    return {
      label: note || adjustmentNames[row.type] || 'Adjustment',
      amount: row.type === 'quality_cut' ? -row.amountPaise : row.amountPaise,
      hasNote: Boolean(note),
    }
  })
  const gstRateLabel = data.taxMode === 'gst' && totals.taxPaise > 0 ? `GST ${data.gstRateBp / 100}%` : null
  const gstAmount = gstRateLabel ? signedMoney(totals.taxPaise) : null
  const adjustmentsTotal = adjustments.reduce((sum, row) => sum + row.amount, 0)
  const deductedBardan = data.bardan.filter((entry) => entry.method === 'deduct')
  const nonDeductedBardan = data.bardan.filter((entry) => entry.method !== 'deduct')
  const deductedG = deductedBardan.reduce((sum, entry) => sum + entry.bardanG, 0)
  const paidRows = data.paidRows.filter((row) => row.amountPaise !== 0)

  function renderBardan(entry: ChittyBardan, index: number) {
    const item = entry.itemName || (data.lines.length === 1 ? data.lines[0].itemName : '')
    const caption = entry.method === 'in_kind' ? 'Settled in kind' : entry.method === 'cash_back' ? 'Cash memo' : 'Pool credit'
    return (
      <li key={index} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {item && <span className="font-semibold break-words">{item}</span>}
          {entry.bagCount ? <span className="whitespace-nowrap">{entry.bagCount} bags ·</span> : null}
          <span className="whitespace-nowrap">{weightDisplay.format(entry.bardanG / 1000)} kg{entry.method === 'deduct' && entry.rateMilli > 0 ? ` × ${formatChittyRate(entry.rateMilli)}` : ''}</span>
        </span>
        {entry.method === 'deduct' ? <span className="whitespace-nowrap font-semibold tabular-nums text-rose-700">{signedMoney(-entry.creditPaise)}</span>
          : <span className="text-slate-600">{caption}{entry.method === 'cash_back' ? ` · ${signedMoney(entry.cashAmountPaise)}` : entry.method === 'advance' ? ` · ${signedMoney(entry.creditPaise)}` : ''}</span>}
      </li>
    )
  }

  return (
    <article aria-label="Purchase bill" className={`${supplier ? 'print-chitty' : 'print:hidden'} @container mx-auto w-full rounded-xl border border-slate-200 bg-white text-xs text-slate-800 shadow-sm ${density === 'dialog' ? 'max-w-3xl p-4 sm:p-5' : 'max-w-[570px] p-4 sm:p-6'}`}>
      <header className="border-b-2 border-slate-900 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
          <div>
            <p className={`text-lg font-black tracking-tight ${isGst ? 'text-rose-600' : 'text-slate-900'}`}>{FIRM_NAME}</p>
            <p className="text-xs font-medium text-slate-600">{FIRM_CITY}</p>
          </div>
          <div className="tabular-nums sm:text-right">
            <p className={`font-semibold ${isGst ? 'text-rose-600' : 'text-slate-900'}`}>Bill No: {data.inNo || '—'}</p>
            <p className="mt-0.5 text-slate-600">Date: {data.date ? formatFullDate(data.date) : '—'}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-semibold tracking-wide text-slate-600">SUPPLIER</span>
          <span className={`min-w-0 break-words text-sm font-bold ${supplier ? 'text-slate-950' : 'text-rose-700'}`}>{supplier || 'Supplier not selected'}</span>
        </div>
        {details.some(([, value]) => value) && <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
          {details.map(([label, value]) => value && <div key={label} className="min-w-0"><dt className="inline font-semibold">{label} </dt><dd className="inline break-words">{value}</dd></div>)}
        </dl>}
        {data.cancelled && <p className="mt-1 font-bold text-rose-700">VOID</p>}
      </header>

      <div className="mt-2 hidden @md:block print:block">
        <table className="w-full border-collapse text-left tabular-nums">
          <thead className="border-b border-slate-200 text-slate-600">
            <tr>
              <th scope="col" className="py-2 pr-1">#</th>
              <th scope="col" className="px-1 py-2">Item</th>
              {showBardanColumn && <th scope="col" className="px-1 py-2 text-right">Bags</th>}
              <th scope="col" className="px-1 py-2 text-right">Gross weight</th>
              <th scope="col" className="px-1 py-2 text-right">Rate</th>
              <th scope="col" className="py-2 pl-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.lines.map((line, index) => (
              <tr key={index}>
                <td className="py-2 pr-1 text-slate-500">{index + 1}</td>
                <th scope="row" className="break-words px-1 py-2 font-semibold">{line.itemName}</th>
                {showBardanColumn && <td className="px-1 py-2 text-right">{purchaseReceiptBagCount(line.bardanText) || '—'}</td>}
                <td className="whitespace-nowrap px-1 py-2 text-right">{gramsToKgText(line.weightG)} kg</td>
                <td className="whitespace-nowrap px-1 py-2 text-right">{formatChittyRate(line.rateMilli)}/kg</td>
                <td className="whitespace-nowrap py-2 pl-1 text-right font-semibold">{formatPaiseInr(line.amountPaise)}</td>
              </tr>
            ))}
            {gstRateLabel && (
              <tr>
                <td colSpan={showBardanColumn ? 4 : 3} />
                <td className="whitespace-nowrap px-1 py-2 text-right font-semibold">{gstRateLabel}</td>
                <td className="whitespace-nowrap py-2 pl-1 text-right font-semibold">{gstAmount}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 @md:hidden print:hidden">
        <ol className="divide-y divide-slate-100">
          {data.lines.map((line, index) => {
            const bags = purchaseReceiptBagCount(line.bardanText)
            return <li key={index} className="py-2">
              <div className="flex justify-between gap-2 font-semibold"><span className="min-w-0 break-words">{index + 1}. {line.itemName}</span><span className="shrink-0 tabular-nums">{formatPaiseInr(line.amountPaise)}</span></div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 tabular-nums text-slate-600">{bags > 0 && <span>{bags} bags</span>}<span>{gramsToKgText(line.weightG)} kg gross</span><span className="whitespace-nowrap">{formatChittyRate(line.rateMilli)}/kg</span></div>
            </li>
          })}
          {gstRateLabel && <li className="flex justify-end gap-4 py-2 font-semibold tabular-nums"><span>{gstRateLabel}</span><span className="whitespace-nowrap">{gstAmount}</span></li>}
        </ol>
      </div>

      <section className="mt-2 border-y border-slate-300 bg-slate-50 py-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-2">
          <h2 className="text-xs font-bold tracking-wide text-slate-950">BILL NET AMOUNT</h2>
          <strong className="text-lg font-black tabular-nums text-slate-950">{formatPaiseInr(totals.netPaise)}</strong>
        </div>
      </section>

      {adjustments.length > 0 && <section className={breakdownCardClass}>
        <h2 className="font-bold">ADJUSTMENTS</h2>
        <dl>
          {adjustments.map((row, index) => <div key={index} className={`flex justify-between gap-2 py-0.5 ${row.amount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            <dt className="min-w-0 break-words">{row.hasNote && <StickyNote size={13} className="mr-1 inline-block align-text-bottom" aria-hidden="true" />}{row.amount < 0 ? 'Less' : 'Add'}: {row.label}</dt>
            <dd className="shrink-0 font-semibold tabular-nums">{signedMoney(row.amount)}</dd>
          </div>)}
          {adjustments.length > 1 && <div className="mt-1 flex justify-between gap-2 border-t border-slate-300 pt-1 font-semibold"><dt>Adjustments total</dt><dd className="tabular-nums">{signedMoney(adjustmentsTotal)}</dd></div>}
        </dl>
      </section>}

      {data.bardan.length > 0 && <section className={breakdownCardClass}>
        <h2 className="font-bold">BARDAN</h2>
        {deductedBardan.length > 0 && <ul>{deductedBardan.map(renderBardan)}</ul>}
        {deductedBardan.length > 1 && <div className="flex flex-wrap justify-between gap-x-2 border-t border-slate-300 pt-1 font-semibold"><span>Bardan total · {weightDisplay.format(deductedG / 1000)} kg</span><span className="tabular-nums text-rose-700">{signedMoney(-totals.bardanCreditPaise)}</span></div>}
        {nonDeductedBardan.length > 0 && <ul className={deductedBardan.length ? 'mt-1 border-t border-slate-300 pt-0.5' : undefined}>{nonDeductedBardan.map(renderBardan)}</ul>}
      </section>}
      {totals.rcmLiabilityPaise > 0 && <p className="mt-2 text-slate-600">RCM liability ({data.gstRateBp / 100}%) · {signedMoney(totals.rcmLiabilityPaise)} · outside bill net</p>}

      {paidRows.length > 0 && <section className={breakdownCardClass}>
        <h2 className="font-bold">PAYMENT</h2>
        <dl>{paidRows.map((row, index) => {
          const label = row.creditLabel || (row.date ? `Paid on ${formatFullDate(row.date)}` : row.reference || 'Credit applied')
          return <div key={index} className="flex justify-between gap-2 py-0.5">
            <dt className="min-w-0 break-words">{row.hasNote && <StickyNote size={13} className="mr-1 inline-block align-text-bottom text-rose-700" role="img" aria-label="Payment note recorded" />}{label}{row.mode ? ` (${row.mode})` : ''}</dt>
            <dd className="shrink-0 font-semibold tabular-nums text-rose-700">{signedMoney(-row.amountPaise)}</dd>
          </div>
        })}</dl>
      </section>}

      <section className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t-2 border-slate-900 pt-2.5">
        <h2 className="font-bold tracking-wide text-slate-950">{totals.duePaise === 0 && totals.advancePaise > 0 ? 'ADVANCE' : 'BALANCE DUE'}</h2>
        {totals.status === 'cancelled' ? <strong className="text-slate-700">VOID</strong>
          : totals.duePaise > 0 ? <strong className="text-xl font-black tabular-nums text-rose-700">{formatPaiseInr(totals.duePaise)}</strong>
          : totals.advancePaise > 0 ? <strong className="text-xl font-black tabular-nums text-emerald-700">{formatPaiseInr(totals.advancePaise)}</strong>
          : !supplier || !data.lines.length ? <strong className="text-slate-600">—</strong>
          : <strong className="text-base font-black text-emerald-700">PAID IN FULL</strong>}
      </section>

    </article>
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
        <div className="py-3 sm:pr-4"><p className="text-xs text-slate-500">Bill amount</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{formatPaiseInr(totals.netPaise)}</p><p className="mt-1 text-xs text-slate-500">{totalWeightG > 0 ? `${gramsToKgText(totalWeightG)} kg gross` : 'No weight'}{avgRateMilli > 0 ? ` · Avg ${formatChittyRate(avgRateMilli)}/kg` : ''}</p></div>
        <div className="py-3 sm:px-4"><p className="text-xs text-slate-500">Paid so far</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-700">{formatPaiseInr(totals.paidPaise)}</p><p className="mt-1 text-xs text-slate-500">{effectiveLastPayment ? `Last ${effectiveLastPayment.date ? formatFullDate(effectiveLastPayment.date) : 'credit'} · ${formatPaiseInr(effectiveLastPayment.amountPaise)}` : 'No payment recorded'}</p></div>
        <div className="py-3 sm:pl-4"><p className="text-xs text-slate-500">Still to pay</p><p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${effectiveDuePaise > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatPaiseInr(Math.max(0, effectiveDuePaise))}</p><p className="mt-1 text-xs text-slate-500">{data.bardan.length > 0 ? `${data.bardan.length} bardan entries` : 'No bardan recorded'}</p></div>
      </div>
      {data.lines.length > 0 && <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">{data.lines.map((line, index) => <span key={`${line.itemName}-${index}`}>{line.itemName} · {gramsToKgText(line.weightG)} kg @ {formatChittyRate(line.rateMilli)}/kg</span>)}</div>}
    </section>
  )
}
