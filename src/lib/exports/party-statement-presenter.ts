import { formatFullDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import type { StatementLedger } from './party-statement-ledger'

export type PartyStatementViewModel = {
  title: string
  subtitle: string
  columns: string[]
  rows: string[][]
  summary: Array<{ label: string; value: string }>
  csvRows: string[][]
}

export function buildPartyStatementViewModel(input: {
  customerDisplayName: string
  rangeLabel: string
  generatedOn: string
  ledger: StatementLedger
}): PartyStatementViewModel {
  const totalBills = input.ledger.rows.filter((row) => row.kind === 'bill').reduce((sum, row) => sum + row.debit, 0)
  const totalPayments = input.ledger.rows.filter((row) => row.kind === 'payment').reduce((sum, row) => sum + row.credit, 0)
  const columns = ['Date', 'Entry', 'Ref', 'Debit', 'Credit', 'Running Balance']
  const rows = input.ledger.rows.map((row) => [
    formatFullDate(row.date),
    row.kind === 'bill' ? 'Bill' : 'Payment',
    row.ref,
    row.debit ? formatInrInteger(row.debit) : '',
    row.credit ? formatInrInteger(row.credit) : '',
    formatInrInteger(row.runningBalance),
  ])

  return {
    title: `${input.customerDisplayName} Statement`,
    subtitle: `${input.rangeLabel} | Generated ${formatFullDate(input.generatedOn)}`,
    columns,
    rows,
    summary: [
      { label: 'Opening Balance', value: formatInrInteger(input.ledger.openingBalance) },
      { label: 'Total Bills', value: formatInrInteger(totalBills) },
      { label: 'Total Payments', value: formatInrInteger(totalPayments) },
      { label: 'Closing Balance', value: formatInrInteger(input.ledger.closingBalance) },
    ],
    csvRows: [
      columns,
      ...input.ledger.rows.map((row) => [
        row.date,
        row.kind === 'bill' ? 'Bill' : 'Payment',
        row.ref,
        row.debit ? String(row.debit) : '',
        row.credit ? String(row.credit) : '',
        String(row.runningBalance),
      ]),
    ],
  }
}
