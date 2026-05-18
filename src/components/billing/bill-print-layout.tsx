import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'

/** Phone / narrow-receipt width for preview, print, PDF, and JPG (shared with print CSS). */
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
 * Single source of truth for on-screen and print bill layout.
 * Uses `bill-print-*` classes so copied HTML + getBillPrintPopupStyles() works without Tailwind.
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
    <div className="bill-print-root">
      <div className="bill-print-header">
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Kapil Products</p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#475569' }}>MKT: {mkt}</p>
        </div>
        <div className="bill-print-header-meta">
          <p style={{ margin: 0 }}>
            Date: <strong>{formatFullDate(date)}</strong>
          </p>
          <p style={{ margin: '4px 0 0' }}>
            No: {bookNo}/{billNo}
          </p>
        </div>
      </div>

      <p className="bill-print-party">
        M/s. <strong>{customerName}</strong>
      </p>

      <table className="bill-print-table">
        <colgroup>
          <col style={{ width: '34%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '26%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>Particulars</th>
            <th className="bill-print-col-qty">Qty</th>
            <th className="bill-print-col-rate">Rate</th>
            <th className="bill-print-col-amt">Amount</th>
          </tr>
        </thead>
        <tbody>
          {itemRows.map((row, index) => (
            <tr key={`${row.itemName}-${index}`}>
              <td>{row.itemName}</td>
              <td className="bill-print-col-qty">{row.qty} kg</td>
              <td className="bill-print-col-rate">{formatInrInteger(row.rate)}</td>
              <td className="bill-print-col-amt">{formatInrInteger(row.amount)}</td>
            </tr>
          ))}
          {gstAmount > 0 && (
            <tr>
              <td>{gstRate > 0 ? `GST (${gstRate}%)` : 'GST'}</td>
              <td className="bill-print-col-qty" />
              <td className="bill-print-col-rate" />
              <td className="bill-print-col-amt">{formatInrInteger(gstAmount)}</td>
            </tr>
          )}
          {transport > 0 && (
            <tr>
              <td>Transport</td>
              <td className="bill-print-col-qty" />
              <td className="bill-print-col-rate" />
              <td className="bill-print-col-amt">+ {formatInrInteger(transport)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <hr className="bill-print-divider" />

      <div className="bill-print-summary">
        <div className="bill-print-summary-line">
          <span className="bill-print-summary-label">Current Bill Total</span>
          <span className="bill-print-summary-value">{formatInrInteger(currentBillTotal)}</span>
        </div>
        {previousBalance !== 0 && (
          <div className="bill-print-summary-line">
            <span className="bill-print-summary-label">
              Previous Balance [dt. {previousBillDate === 'Opening' ? 'Opening' : formatFullDate(previousBillDate)}]
            </span>
            <span className="bill-print-summary-value">+ {formatInrInteger(previousBalance)}</span>
          </div>
        )}
        <div className="bill-print-summary-line">
          <span className="bill-print-summary-label">Sub Total</span>
          <span className="bill-print-summary-value">{formatInrInteger(subtotal)}</span>
        </div>
        {periodCreditEntries.length > 0 && (
          <div className="bill-print-credits">
            {periodCreditEntries.map((entry, index) => (
              <div key={`${entry.date}-${entry.amount}-${index}`} className="bill-print-credit-line">
                <span>Credited on {formatFullDate(entry.date)}</span>
                <span className="bill-print-summary-value" style={{ fontSize: 11 }}>
                  − {formatInrInteger(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="bill-print-total">
          <span>Total</span>
          <span className="bill-print-summary-value">{formatInrInteger(finalTotal)}</span>
        </div>
      </div>

      <div className="bill-print-footer">
        <div>
          <p className="bill-print-footer-label">Weight</p>
          <p className="bill-print-footer-value">{Math.round(totalQty)} kg</p>
        </div>
        <div>
          <p className="bill-print-footer-label">Bags</p>
          <p className="bill-print-footer-value">{Math.round(totalBags)}</p>
        </div>
        <div>
          <p className="bill-print-footer-label">LR No.</p>
          <p className="bill-print-footer-value">{lrList.length ? lrList.join(', ') : '—'}</p>
        </div>
      </div>
    </div>
  )
}
