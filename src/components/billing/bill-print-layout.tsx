import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

/** Printable bill width (cm); keep in sync with print / new-bill pages. */
export const BILL_PRINT_PAGE_WIDTH_CM = 14

export type BillPrintLineRow = {
  itemName: string
  qty: number
  rate: number
  amount: number
  bags: number
}

export type BillPrintCreditRow = { date: string; amount: number }

export type BillPrintLayoutProps = {
  bookNo: number
  billNo: number
  date: string
  customerName: string
  mkt: number
  itemRows: BillPrintLineRow[]
  gstAmount: number
  transport: number
  gstRate: number
  currentBillTotal: number
  previousBalance: number
  previousBillDate: string
  periodCreditEntries: BillPrintCreditRow[]
  subtotal: number
  finalTotal: number
  totalQty: number
  totalBags: number
  lrList: string[]
}

/**
 * Single source of truth for on-screen and print bill layout (matches Print Bill page).
 */
export function BillPrintLayout({
  bookNo,
  billNo,
  date,
  customerName,
  mkt,
  itemRows,
  gstAmount,
  transport,
  gstRate,
  currentBillTotal,
  previousBalance,
  previousBillDate,
  periodCreditEntries,
  subtotal,
  finalTotal,
  totalQty,
  totalBags,
  lrList,
}: BillPrintLayoutProps) {
  return (
    <>
      <div className="mb-2 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Kapil Products</p>
          <p className="text-xs text-slate-600">MKT: {mkt}</p>
        </div>
        <div className="text-right text-xs text-slate-600">
          <p>
            Date: <span className="font-semibold text-slate-800">{formatFullDate(date)}</span>
          </p>
          <p>
            No: {bookNo}/{billNo}
          </p>
        </div>
      </div>

      <p className="mb-2 text-sm text-slate-700">
        M/s. <span className="font-semibold text-slate-900">{customerName}</span>
      </p>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50">
            <th className="border border-slate-300 px-2 py-1 text-left">Particulars</th>
            <th className="border border-slate-300 px-2 py-1 text-right">Qty</th>
            <th className="border border-slate-300 px-2 py-1 text-right">Rate</th>
            <th className="border border-slate-300 px-2 py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {itemRows.map((row, index) => (
            <tr key={`${row.itemName}-${index}`}>
              <td className="border border-slate-300 px-2 py-1">{row.itemName}</td>
              <td className="border border-slate-300 px-2 py-1 text-right">{row.qty} kg</td>
              <td className="border border-slate-300 px-2 py-1 text-right">{formatInrInteger(row.rate)}</td>
              <td className="border border-slate-300 px-2 py-1 text-right">{formatInrInteger(row.amount)}</td>
            </tr>
          ))}
          {gstAmount > 0 && (
            <tr>
              <td className="border border-slate-300 px-2 py-1">GST ({gstRate}%)</td>
              <td className="border border-slate-300 px-2 py-1" />
              <td className="border border-slate-300 px-2 py-1" />
              <td className="border border-slate-300 px-2 py-1 text-right">{formatInrInteger(gstAmount)}</td>
            </tr>
          )}
          {transport > 0 && (
            <tr>
              <td className="border border-slate-300 px-2 py-1">Transport</td>
              <td className="border border-slate-300 px-2 py-1" />
              <td className="border border-slate-300 px-2 py-1" />
              <td className="border border-slate-300 px-2 py-1 text-right">+ {formatInrInteger(transport)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="my-3 border-t border-slate-300" />
      <div className="space-y-1.5 text-xs">
        {currentBillTotal !== 0 && (
          <div className="flex items-center justify-between">
            <span>Current Bill Total</span>
            <span className="font-mono font-semibold">{formatInrInteger(currentBillTotal)}</span>
          </div>
        )}
        {previousBalance !== 0 && (
          <div className="flex items-center justify-between">
            <span>
              Previous Balance [dt. {previousBillDate === 'Opening' ? 'Opening' : formatFullDate(previousBillDate)}]
            </span>
            <span className="font-mono">+ {formatInrInteger(previousBalance)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span>Sub Total</span>
          <span className="font-mono">{formatInrInteger(subtotal)}</span>
        </div>
        {periodCreditEntries.length > 0 && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
            {periodCreditEntries.map((entry, index) => (
              <div key={`${entry.date}-${entry.amount}-${index}`} className="flex items-center justify-between text-[11px] text-slate-600">
                <span>Credited on {formatFullDate(entry.date)}</span>
                <span className="font-mono">- {formatInrInteger(entry.amount)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-300 pt-1.5 text-base font-bold">
          <span>Total</span>
          <span className="font-mono">{formatInrInteger(finalTotal)}</span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] leading-tight">
        <div>
          <p className="text-slate-500">Weight</p>
          <p className="font-semibold text-slate-800">{Math.round(totalQty)} kg</p>
        </div>
        <div>
          <p className="text-slate-500">Bags</p>
          <p className="font-semibold text-slate-800">{Math.round(totalBags)}</p>
        </div>
        <div>
          <p className="text-slate-500">LR No.</p>
          <p className="font-semibold text-slate-800">{lrList.length ? lrList.join(', ') : '-'}</p>
        </div>
      </div>
    </>
  )
}
