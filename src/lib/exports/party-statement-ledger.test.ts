import { describe, expect, it } from 'vitest'
import { buildPartyStatementLedger } from './party-statement-ledger'
import { buildPartyStatementViewModel } from './party-statement-presenter'
import { buildPartyStatementPdfModel } from './report-pdf'

function makeInput() {
  return {
    customer: { id: 'c1', opening_balance: 1000, company_name: 'Shree Traders', name: 'Ramesh' },
    range: { start: '2026-05-01', end: '2026-05-31', label: 'May-2026' },
    bills: [
      { id: 'b0', customer: 'c1', book_no: 1, bill_no: 1, date: '2026-04-29', customer_name: 'Shree Traders', transport: 0, gst_rate: 0, gst_amount: 0 },
      { id: 'b1', customer: 'c1', book_no: 1, bill_no: 2, date: '2026-05-03', customer_name: 'Shree Traders', transport: 0, gst_rate: 0, gst_amount: 0 },
      { id: 'b2', customer: 'c1', book_no: 1, bill_no: 3, date: '2026-05-03', customer_name: 'Shree Traders', transport: 0, gst_rate: 0, gst_amount: 0 },
    ],
    billItems: [
      { bill: 'b0', item_name: 'Gas', qty: 10, amount: 500 },
      { bill: 'b1', item_name: 'Gas', qty: 10, amount: 700 },
      { bill: 'b2', item_name: 'Gas', qty: 10, amount: 300 },
    ],
    payments: [
      { id: 'p0', customer: 'c1', date: '2026-04-30', amount: 200, mode: 'Cash', note: '' },
      { id: 'p1', customer: 'c1', date: '2026-05-03', amount: 400, mode: 'Cash', note: '' },
      { id: 'p2', customer: 'c1', date: '2026-05-15', amount: 250, mode: 'UPI', note: 'Part payment' },
    ],
  }
}

describe('party statement ledger', () => {
  it('computes opening balance from pre-range activity', () => {
    const ledger = buildPartyStatementLedger(makeInput())
    expect(ledger.openingBalance).toBe(1300)
  })

  it('sorts same-day bills before payments and preserves bill order', () => {
    const ledger = buildPartyStatementLedger(makeInput())
    expect(ledger.rows.map((row) => `${row.date}:${row.kind}:${row.ref}`)).toEqual([
      '2026-05-03:bill:1/2',
      '2026-05-03:bill:1/3',
      '2026-05-03:payment:Cash',
      '2026-05-15:payment:UPI',
    ])
  })

  it('computes running and closing balances from the sorted ledger', () => {
    const ledger = buildPartyStatementLedger(makeInput())
    expect(ledger.rows.map((row) => row.runningBalance)).toEqual([2000, 2300, 1900, 1650])
    expect(ledger.closingBalance).toBe(1650)
  })

  it('returns zero in-range rows cleanly when no activity exists in range', () => {
    const input = makeInput()
    input.range = { start: '2026-06-01', end: '2026-06-30', label: 'Jun-2026' }
    const ledger = buildPartyStatementLedger(input)
    expect(ledger.rows).toEqual([])
    expect(ledger.openingBalance).toBe(1650)
    expect(ledger.closingBalance).toBe(1650)
  })

  it('builds summary metrics and concise preview rows from the ledger', () => {
    const ledger = buildPartyStatementLedger(makeInput())
    const vm = buildPartyStatementViewModel({
      customerDisplayName: 'Shree Traders (Ramesh)',
      rangeLabel: 'May-2026',
      generatedOn: '2026-05-25',
      ledger,
    })

    expect(vm.summary).toEqual([
      { label: 'Opening Balance', value: '₹1,300' },
      { label: 'Total Bills', value: '₹1,000' },
      { label: 'Total Payments', value: '₹650' },
      { label: 'Closing Balance', value: '₹1,650' },
    ])
    expect(vm.columns).toEqual(['Date', 'Entry', 'Ref', 'Debit', 'Credit', 'Running Balance'])
    expect(vm.rows[0]).toEqual(['03-05-2026', 'Bill', '1/2', '₹700', '', '₹2,000'])
  })

  it('creates a summary-first PDF model from the statement view model', () => {
    const ledger = buildPartyStatementLedger(makeInput())
    const vm = buildPartyStatementViewModel({
      customerDisplayName: 'Shree Traders (Ramesh)',
      rangeLabel: 'May-2026',
      generatedOn: '2026-05-25',
      ledger,
    })

    const pdfModel = buildPartyStatementPdfModel(vm)
    expect(pdfModel.summary[0]).toEqual({ label: 'Opening Balance', value: '₹1,300' })
    expect(pdfModel.columns).toEqual(['Date', 'Entry', 'Ref', 'Debit', 'Credit', 'Running Balance'])
  })
})
