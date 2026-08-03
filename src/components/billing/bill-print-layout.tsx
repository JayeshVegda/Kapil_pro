import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { getBillingUnit, isGasBillingItem } from '@/domain/billing-modes'

/** Phone / narrow-receipt width for preview, print, PDF, and JPG (shared with print CSS). */
export const BILL_PRINT_PAGE_WIDTH_CM = 14

export type BillPrintLineRow = {
  itemName: string
  qty: number
  rate: number
  amount: number
  bags: number
  type?: string
  unit?: string
  bagWeight?: number
}

export type BillPrintCreditRow = { id?: string; date: string; amount: number }

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
  const hasGst = gstAmount > 0 || gstRate > 0
  const gasQty = itemRows.filter(isGasBillingItem).reduce((sum, row) => sum + row.qty, 0)
  const electronicQty = itemRows.filter((row) => !isGasBillingItem(row)).reduce((sum, row) => sum + row.qty, 0)
  const qtyFooterLabel = electronicQty > 0 && gasQty === 0 ? 'Units' : electronicQty > 0 ? 'Qty' : 'Weight'
  const qtyFooterValue =
    electronicQty > 0 && gasQty > 0
      ? `${Math.round(gasQty)} kg / ${Math.round(electronicQty)} pcs`
      : electronicQty > 0
        ? `${Math.round(electronicQty)} pcs`
        : `${Math.round(totalQty)} kg`
  const visibleBags = itemRows.reduce((sum, row) => sum + (isGasBillingItem(row) ? row.bags : 0), 0)

  return (
    <div className="bill-print-root">
      <div className="bill-print-header">
        <div className="bill-print-header-brand">
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Kapil Products</p>
          <p className="bill-print-market-line">
            MKT: {mkt}
            {hasGst ? (
              <>
                <span className="bill-print-market-separator">|</span>
                <span className="bill-print-gst-label">BILL</span>
              </>
            ) : null}
          </p>
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
              <td className="bill-print-col-qty">{formatPrintQty(row.qty, getBillingUnit(row))}</td>
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
              {previousBalance >= 0 ? 'Previous Balance' : 'Previous Advance'} [dt. {previousBillDate === 'Opening' ? 'Opening' : formatFullDate(previousBillDate)}]
            </span>
            <span className="bill-print-summary-value">
              {previousBalance >= 0 ? '+ ' : '− '}
              {formatInrInteger(Math.abs(previousBalance))}
            </span>
          </div>
        )}
        <div className="bill-print-summary-line">
          <span className="bill-print-summary-label">Sub Total</span>
          <span className="bill-print-summary-value">{formatInrInteger(subtotal)}</span>
        </div>
        {periodCreditEntries.length > 0 && (
          <div className="bill-print-credits">
            {periodCreditEntries.map((entry, index) => (
                <div key={entry.id ?? `${entry.date}-${entry.amount}-${index}`} className="bill-print-credit-line">
                <span>Credited on {formatFullDate(entry.date)}</span>
                <span className="bill-print-summary-value" style={{ fontSize: 11 }}>
                  − {formatInrInteger(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="bill-print-total">
          <span>{finalTotal >= 0 ? 'Amount Due' : 'Advance Balance'}</span>
          <span className="bill-print-summary-value">{formatInrInteger(Math.abs(finalTotal))}</span>
        </div>
      </div>

      <div className="bill-print-footer">
        <div>
          <p className="bill-print-footer-label">{qtyFooterLabel}</p>
          <p className="bill-print-footer-value">{qtyFooterValue}</p>
        </div>
        <div>
          <p className="bill-print-footer-label">Bags</p>
          <p className="bill-print-footer-value">{Math.round(visibleBags || totalBags)}</p>
        </div>
        <div>
          <p className="bill-print-footer-label">LR No.</p>
          <p className="bill-print-footer-value">{lrList.length ? lrList.join(', ') : '—'}</p>
        </div>
      </div>
    </div>
  )
}

function formatPrintQty(qty: number, unit: string) {
  const rounded = Number.isInteger(qty) ? String(Math.round(qty)) : String(qty)
  return `${rounded} ${unit === 'piece' ? 'pcs' : unit}`
}
