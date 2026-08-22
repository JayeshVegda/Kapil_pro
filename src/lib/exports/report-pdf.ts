import { createStyledPdf } from '@/lib/exports/pdf-engine'
import type { PartyStatementViewModel } from './party-statement-presenter'
import type { BillPrintLayoutProps } from '@/components/billing/bill-print-layout'
import { formatRate } from '@/lib/inr-format'

export function buildPartyStatementPdfModel(viewModel: PartyStatementViewModel) {
  return {
    title: viewModel.title,
    subtitle: viewModel.subtitle,
    summary: viewModel.summary,
    columns: viewModel.columns,
    rows: viewModel.rows,
  }
}

export async function createPartyStatementPdf(viewModel: PartyStatementViewModel) {
  const model = buildPartyStatementPdfModel(viewModel)
  return createStyledPdf({
    title: model.title,
    subtitle: model.subtitle,
    summary: model.summary,
    orientation: 'portrait',
    sections: [
      {
        kind: 'table',
        // Statement columns: Date, Type, Ref, Debit, Credit, Balance (+ Details).
        columns: model.columns.map((header) => ({
          header,
          align: /debit|credit|balance|amount/i.test(header) ? ('right' as const) : ('left' as const),
          ...(/^date$/i.test(header) ? { width: 62 } : {}),
          ...(/^type$/i.test(header) ? { width: 48 } : {}),
        })),
        rows: model.rows,
      },
    ],
  })
}

/**
 * Creates a proper structured invoice PDF from bill props.
 * Includes item table (product, qty, unit, rate, amount), GST, transport,
 * bill total, previous balance, credits, and final balance due.
 * Uses the same Geist-font engine as all other report PDFs.
 */
export async function createBillDetailPdf(props: BillPrintLayoutProps): Promise<ArrayBuffer> {
  const inr = (n: number) => {
    if (!Number.isFinite(n)) return '0'
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n)
  }

  const itemRows = props.itemRows.map((row) => {
    const isGas = row.type === 'gas'
    const unit = isGas ? 'kg' : (row.unit || 'pcs')
    const qty = isGas ? `${row.qty} kg` : `${Math.round(row.qty)} ${unit}`
    const bags = isGas && row.bags > 0 ? `${row.bags} bags` : ''
    return [
      row.itemName,
      qty,
      bags,
      formatRate(row.rate),
      inr(row.amount),
    ]
  })

  const itemTotal = props.itemRows.reduce((s, r) => s + r.amount, 0)
  const hasGst = props.gstAmount > 0 || props.gstRate > 0
  const hasTransport = props.transport > 0
  const hasPrevBalance = props.previousBalance !== 0
  const hasCredits = props.periodCreditEntries.length > 0

  const chargeRows: [string, string][] = [
    ['Item Total', inr(itemTotal)],
    ...(hasGst ? [['GST' + (props.gstRate > 0 ? ` (${props.gstRate}%)` : ''), inr(props.gstAmount)] as [string, string]] : []),
    ...(hasTransport ? [['Transport', inr(props.transport)] as [string, string]] : []),
    ['Bill Total', inr(props.currentBillTotal)],
    ...(hasPrevBalance ? [['Previous Balance', inr(props.previousBalance)] as [string, string]] : []),
    ...(hasPrevBalance ? [['Sub-Total', inr(props.subtotal)] as [string, string]] : []),
    ...(hasCredits
      ? props.periodCreditEntries.map((c) => [`Payment (${c.date})`, `-${inr(c.amount)}`] as [string, string])
      : []),
    ['Balance Due', inr(props.finalTotal)],
  ]

  // Build summary chips
  const summary = [
    { label: 'Bill', value: `${props.bookNo}/${props.billNo}` },
    { label: 'Date', value: props.date },
    { label: 'Customer', value: props.customerName },
    { label: 'Balance Due', value: inr(props.finalTotal) },
  ]

  const doc = await createStyledPdf({
    title: 'Kapil Products — Invoice',
    subtitle: `Bill ${props.bookNo}/${props.billNo} · ${props.customerName} · ${props.date}`,
    summary,
    orientation: 'portrait',
    sections: [
      {
        kind: 'table',
        title: 'Items',
        columns: [
          { header: 'Product', align: 'left' },
          { header: 'Qty', align: 'right' },
          { header: 'Bags', align: 'right' },
          { header: 'Rate', align: 'right' },
          { header: 'Amount', align: 'right' },
        ],
        rows: itemRows,
        footerRow: ['Total', '', '', '', inr(itemTotal)],
      },
      {
        kind: 'keyValues',
        title: 'Charges & Balance',
        rows: chargeRows.map(([label, value]) => ({ label, value })),
      },
      ...(props.lrList.length > 0
        ? [{
            kind: 'keyValues' as const,
            title: 'LR Numbers',
            rows: props.lrList.map((lr, i) => ({ label: `LR ${i + 1}`, value: lr })),
          }]
        : []),
    ],
  })

  return doc.output('arraybuffer')
}
