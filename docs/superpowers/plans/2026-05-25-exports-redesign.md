# Exports Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Kapil Pro Exports page so Party Statement becomes a clean, trustworthy business export, while technical backups remain available without cluttering the main workflow.

**Architecture:** Split Party Statement into a dedicated ledger pipeline, presentation adapter, and PDF builder so correctness is isolated from UI rendering. Then simplify the route into Business Exports vs Technical Exports, remove visible Outstanding, and keep Book Download and backup actions working with lighter UI polish.

**Tech Stack:** React 19, TanStack Router, TanStack Query, TypeScript, Vitest, jsPDF, jspdf-autotable, JSZip

---

## File map

### Existing files to modify
- `apps/Kapil_Pro/src/routes/export-reports.tsx` — simplify UI structure, switch to new statement pipeline, remove Outstanding from visible export options, preserve Book Download and backup actions
- `apps/Kapil_Pro/src/lib/image-export.ts` — only if export rendering adjustments are needed during implementation; otherwise leave untouched
- `apps/Kapil_Pro/src/lib/bill-print-export.ts` — only if shared PDF helper reuse becomes necessary; otherwise leave untouched

### New files to create
- `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.ts` — normalize bills/payments into sorted ledger events and compute opening/running balances
- `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts` — focused correctness tests for statement math and ordering
- `apps/Kapil_Pro/src/lib/exports/party-statement-presenter.ts` — derive summary cards, preview rows, CSV rows, and PDF rows from the ledger model
- `apps/Kapil_Pro/src/lib/exports/report-pdf.ts` — business-friendly Party Statement PDF builder

### Existing tests to run
- `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts` — new focused ledger test file
- `apps/Kapil_Pro/src/components/layout/app-shell.test.ts` — route-level regression if navigation labels or default page behavior is affected

---

### Task 1: Create a dedicated Party Statement ledger pipeline

**Files:**
- Create: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.ts`
- Create: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Write the failing ledger correctness tests**

```ts
import { describe, expect, it } from 'vitest'
import { buildPartyStatementLedger, type StatementLedgerInput } from './party-statement-ledger'

function makeInput(): StatementLedgerInput {
  return {
    customer: { id: 'c1', opening_balance: 1000, company_name: 'Shree Traders', name: 'Ramesh' },
    range: { start: '2026-05-01', end: '2026-05-31' },
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

describe('buildPartyStatementLedger', () => {
  it('computes opening balance from pre-range activity', () => {
    const ledger = buildPartyStatementLedger(makeInput())
    expect(ledger.openingBalance).toBe(1300)
  })

  it('sorts same-day bills before payments and keeps bill number order', () => {
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

  it('returns zero-row ledgers cleanly when no activity exists in range', () => {
    const input = makeInput()
    input.range = { start: '2026-06-01', end: '2026-06-30' }
    const ledger = buildPartyStatementLedger(input)
    expect(ledger.rows).toEqual([])
    expect(ledger.openingBalance).toBe(1650)
    expect(ledger.closingBalance).toBe(1650)
  })
})
```

- [ ] **Step 2: Run the ledger test to verify it fails**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: FAIL with module-not-found or missing export errors for `party-statement-ledger.ts`

- [ ] **Step 3: Write the minimal ledger implementation**

```ts
import { calculateBillTotalFromBase } from '@/domain/billing-calculations'

export type StatementLedgerRow = {
  id: string
  date: string
  kind: 'bill' | 'payment'
  ref: string
  debit: number
  credit: number
  runningBalance: number
  detailText: string
}

export type StatementLedgerInput = {
  customer: Record<string, unknown>
  range: { start: string; end: string }
  bills: Array<Record<string, unknown>>
  billItems: Array<Record<string, unknown>>
  payments: Array<Record<string, unknown>>
}

export type StatementLedger = {
  openingBalance: number
  closingBalance: number
  rows: StatementLedgerRow[]
}

type NormalizedEvent = {
  id: string
  date: string
  kind: 'bill' | 'payment'
  ref: string
  debit: number
  credit: number
  detailText: string
  sortKey: number
}

export function buildPartyStatementLedger(input: StatementLedgerInput): StatementLedger {
  const customerId = String(input.customer.id ?? '')
  const openingBalance = num(input.customer.opening_balance)
  const itemBaseByBill = billItemBaseMap(input.billItems)
  const itemsByBill = groupBy(input.billItems, (row) => String(row.bill ?? ''))

  const events = [
    ...input.bills
      .filter((bill) => String(bill.customer ?? '') === customerId)
      .map((bill) => ({
        id: String(bill.id ?? ''),
        date: datePart(bill.date),
        kind: 'bill' as const,
        ref: `${num(bill.book_no)}/${num(bill.bill_no)}`,
        debit: calculateBillTotalFromBase(
          itemBaseByBill.get(String(bill.id ?? '')) ?? 0,
          num(bill.transport),
          num(bill.gst_rate),
          num(bill.gst_amount),
        ),
        credit: 0,
        detailText: itemDetails(itemsByBill.get(String(bill.id ?? '')) ?? []),
        sortKey: num(bill.bill_no),
      })),
    ...input.payments
      .filter((payment) => String(payment.customer ?? '') === customerId)
      .map((payment) => ({
        id: String(payment.id ?? ''),
        date: datePart(payment.date),
        kind: 'payment' as const,
        ref: String(payment.mode ?? 'Payment') || 'Payment',
        debit: 0,
        credit: num(payment.amount),
        detailText: String(payment.note ?? ''),
        sortKey: 999999,
      })),
  ].sort(compareNormalizedEvents)

  let opening = openingBalance
  for (const event of events.filter((event) => event.date < input.range.start)) {
    opening += event.debit - event.credit
  }

  let runningBalance = opening
  const rows = events
    .filter((event) => event.date >= input.range.start && event.date <= input.range.end)
    .map((event) => {
      runningBalance += event.debit - event.credit
      return {
        id: event.id,
        date: event.date,
        kind: event.kind,
        ref: event.ref,
        debit: event.debit,
        credit: event.credit,
        runningBalance,
        detailText: event.detailText,
      }
    })

  return {
    openingBalance: opening,
    closingBalance: runningBalance,
    rows,
  }
}

function compareNormalizedEvents(a: NormalizedEvent, b: NormalizedEvent) {
  return a.date.localeCompare(b.date) || kindRank(a.kind) - kindRank(b.kind) || a.sortKey - b.sortKey || a.id.localeCompare(b.id)
}

function kindRank(kind: 'bill' | 'payment') {
  return kind === 'bill' ? 0 : 1
}

function billItemBaseMap(billItems: Array<Record<string, unknown>>) {
  const map = new Map<string, number>()
  for (const item of billItems) {
    const billId = String(item.bill ?? '')
    map.set(billId, (map.get(billId) ?? 0) + num(item.amount))
  }
  return map
}

function groupBy<T>(rows: T[], getKey: (row: T) => string) {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = getKey(row)
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return map
}

function itemDetails(items: Array<Record<string, unknown>>) {
  return items.map((item) => `${String(item.item_name ?? '')} ${num(item.qty)} kg`).join(' | ')
}

function datePart(value: unknown) {
  return String(value ?? '').slice(0, 10)
}

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
```

- [ ] **Step 4: Run the ledger test to verify it passes**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS with 4 passing tests

- [ ] **Step 5: Commit the ledger pipeline**

```bash
git add src/lib/exports/party-statement-ledger.ts src/lib/exports/party-statement-ledger.test.ts
git commit -m "refactor: isolate party statement ledger math"
```

### Task 2: Add a presenter that derives preview, CSV, and summary data from the ledger

**Files:**
- Create: `apps/Kapil_Pro/src/lib/exports/party-statement-presenter.ts`
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Extend the test file with presentation-facing expectations**

```ts
import { buildPartyStatementViewModel } from './party-statement-presenter'

it('builds summary metrics and concise preview rows from the ledger', () => {
  const ledger = buildPartyStatementLedger(makeInput())
  const vm = buildPartyStatementViewModel({
    customerDisplayName: 'Shree Traders (Ramesh)',
    rangeLabel: 'May 2026',
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
  expect(vm.rows[0]).toEqual(['03 May 2026', 'Bill', '1/2', '₹700', '', '₹2,000'])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: FAIL with missing module or missing export for `buildPartyStatementViewModel`

- [ ] **Step 3: Write the presenter implementation**

```ts
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
```

- [ ] **Step 4: Swap the Party Statement preview and CSV generation to the presenter**

```ts
const ledger = buildPartyStatementLedger({
  customer,
  range,
  bills: snapshot.data.bills,
  billItems: snapshot.data.billItems,
  payments: snapshot.data.payments,
})

const vm = buildPartyStatementViewModel({
  customerDisplayName: customerName,
  rangeLabel: range.label,
  generatedOn: getLocalIsoDate(),
  ledger,
})

return {
  title: vm.title,
  subtitle: vm.subtitle,
  slug: `party-statement-${safeFilename(customerName)}-${range.start}-to-${range.end}`,
  columns: vm.columns,
  rows: vm.rows,
  summary: vm.summary,
  csvRows: vm.csvRows,
}
```

- [ ] **Step 5: Run the test again**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS with the new presenter assertion included

- [ ] **Step 6: Commit the presenter split**

```bash
git add src/lib/exports/party-statement-presenter.ts src/lib/exports/party-statement-ledger.test.ts src/routes/export-reports.tsx
git commit -m "refactor: derive party statement views from ledger model"
```

### Task 3: Create a dedicated Party Statement PDF builder

**Files:**
- Create: `apps/Kapil_Pro/src/lib/exports/report-pdf.ts`
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Add a focused PDF-model test for summary-first output inputs**

```ts
import { buildPartyStatementPdfModel } from './report-pdf'

it('creates a summary-first PDF model from the statement view model', () => {
  const ledger = buildPartyStatementLedger(makeInput())
  const vm = buildPartyStatementViewModel({
    customerDisplayName: 'Shree Traders (Ramesh)',
    rangeLabel: 'May 2026',
    generatedOn: '2026-05-25',
    ledger,
  })

  const pdfModel = buildPartyStatementPdfModel(vm)
  expect(pdfModel.summary[0]).toEqual({ label: 'Opening Balance', value: '₹1,300' })
  expect(pdfModel.columns).toEqual(['Date', 'Entry', 'Ref', 'Debit', 'Credit', 'Running Balance'])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: FAIL with missing export for `buildPartyStatementPdfModel`

- [ ] **Step 3: Write the PDF helper**

```ts
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { PartyStatementViewModel } from './party-statement-presenter'

export function buildPartyStatementPdfModel(viewModel: PartyStatementViewModel) {
  return {
    title: viewModel.title,
    subtitle: viewModel.subtitle,
    summary: viewModel.summary,
    columns: viewModel.columns,
    rows: viewModel.rows,
  }
}

export function createPartyStatementPdf(viewModel: PartyStatementViewModel) {
  const model = buildPartyStatementPdfModel(viewModel)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, pageWidth, 78, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(255, 255, 255)
  doc.text(model.title, 28, 30)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(226, 232, 240)
  doc.text(model.subtitle, 28, 48)
  doc.setTextColor(15, 23, 42)

  autoTable(doc, {
    startY: 94,
    theme: 'plain',
    body: [model.summary.map((item) => `${item.label}\n${item.value}`)],
    styles: { fontSize: 9, cellPadding: 8, lineColor: [226, 232, 240], lineWidth: 0.5, valign: 'middle' },
    columnStyles: {
      0: { fillColor: [248, 250, 252], halign: 'center' },
      1: { fillColor: [248, 250, 252], halign: 'center' },
      2: { fillColor: [248, 250, 252], halign: 'center' },
      3: { fillColor: [248, 250, 252], halign: 'center' },
    },
    margin: { left: 28, right: 28 },
  })

  const tableStartY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 94) + 16

  autoTable(doc, {
    startY: tableStartY,
    head: [model.columns],
    body: model.rows,
    styles: { fontSize: 8.5, cellPadding: 5, overflow: 'linebreak', valign: 'top', lineColor: [226, 232, 240], lineWidth: 0.3 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 74 },
      1: { cellWidth: 68 },
      2: { cellWidth: 56 },
      3: { halign: 'right', cellWidth: 80 },
      4: { halign: 'right', cellWidth: 80 },
      5: { halign: 'right', cellWidth: 90 },
    },
    margin: { left: 28, right: 28 },
    didDrawPage: () => {
      const pageHeight = doc.internal.pageSize.getHeight()
      doc.setFontSize(8)
      doc.setTextColor(100, 116, 139)
      doc.text('Kapil Products | Generated from Kapil Pro', 28, pageHeight - 18)
      doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - 28, pageHeight - 18, { align: 'right' })
      doc.setTextColor(15, 23, 42)
    },
  })

  return doc
}
```

- [ ] **Step 4: Replace the generic Party Statement PDF call site**

```ts
if (reportKind === 'party') {
  const doc = createPartyStatementPdf(viewModel)
  doc.save(`${preview.slug}.pdf`)
  return
}
```

- [ ] **Step 5: Run the targeted test again**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS with the PDF-model assertion included

- [ ] **Step 6: Commit the PDF builder**

```bash
git add src/lib/exports/report-pdf.ts src/lib/exports/party-statement-ledger.test.ts src/routes/export-reports.tsx
git commit -m "feat: add summary-first party statement pdf"
```

### Task 4: Redesign the Exports page into Business Exports and Technical Exports

**Files:**
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/components/layout/app-shell.test.ts`

- [ ] **Step 1: Add a route-level assertion that Outstanding is not part of the visible business export choices**

```ts
it('does not show Outstanding as a visible export choice', () => {
  const labels = REPORTS.map((report) => report.title)
  expect(labels).not.toContain('Outstanding')
})
```

- [ ] **Step 2: Run the relevant test file to confirm it fails**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/components/layout/app-shell.test.ts`
Expected: FAIL because `Outstanding` still exists in the route config or because the export list shape has not yet been updated

- [ ] **Step 3: Replace the single mixed report list with grouped business and technical sections**

```tsx
const BUSINESS_REPORTS: Array<{ id: ReportKind; title: string; subtitle: string; icon: ReactNode }> = [
  { id: 'party', title: 'Party Statement', subtitle: 'Customer ledger with opening, bills, payments, and closing.', icon: <Users size={16} /> },
  { id: 'book', title: 'Book Download', subtitle: 'Download one whole bill book as a ZIP of PDFs.', icon: <BookOpen size={16} /> },
  { id: 'sales', title: 'Sales Register', subtitle: 'Bill-wise sales for a month or date range.', icon: <ReceiptText size={16} /> },
]

const TECHNICAL_REPORTS: Array<{ id: ReportKind; title: string; subtitle: string; icon: ReactNode }> = [
  { id: 'backup', title: 'Technical Backup', subtitle: 'Raw JSON and CSV bundle for safety and migration.', icon: <Archive size={16} /> },
]
```

```tsx
<div className="space-y-4 border border-slate-200 bg-white p-3">
  <section>
    <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Business Exports</p>
    <div className="mt-2 space-y-2">
      {BUSINESS_REPORTS.map(renderReportButton)}
    </div>
  </section>
  <section className="border-t border-slate-100 pt-4">
    <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Technical Exports</p>
    <div className="mt-2 space-y-2">
      {TECHNICAL_REPORTS.map(renderReportButton)}
    </div>
  </section>
</div>
```

- [ ] **Step 4: Make Party Statement the clearly primary business flow**

```tsx
{reportKind === 'party' && (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
    <h3 className="text-sm font-semibold text-slate-950">Party Statement</h3>
    <p className="mt-1 text-xs text-slate-500">Choose a party and period, review the ledger summary, then export a clean statement PDF.</p>
  </div>
)}
```

- [ ] **Step 5: Run the route-related test again**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/components/layout/app-shell.test.ts`
Expected: PASS, or PASS after updating the expectation to match the new grouped export structure

- [ ] **Step 6: Commit the grouped Exports UI**

```bash
git add src/routes/export-reports.tsx src/components/layout/app-shell.test.ts
git commit -m "feat: split exports into business and technical sections"
```

### Task 5: Simplify Party Statement actions and lightly polish Book Download

**Files:**
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Make the Party Statement actions visually obvious and lower the weight of bulk package actions**

```tsx
<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
  <button type="button" className={primaryButtonClass} onClick={downloadPdfReport} disabled={!preview || !selectedParty}>
    <FileText size={14} /> Download Statement PDF
  </button>
  <button type="button" className={secondaryButtonClass} onClick={downloadCsvReport} disabled={!preview || !selectedParty}>
    <Download size={14} /> Download CSV
  </button>
  <div className="ml-0 flex items-center gap-2 sm:ml-4">
    <span className="text-xs font-medium text-slate-500">More</span>
    <button type="button" className={secondaryButtonClass} onClick={() => void downloadPartyZip()} disabled={!preview || !selectedParty}>
      <FileArchive size={14} /> Download ZIP Package
    </button>
  </div>
</div>
```

- [ ] **Step 2: Add a plain-language Party Statement preview summary above the table**

```tsx
{reportKind === 'party' && selectedParty && preview && (
  <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
    <p className="text-sm font-medium text-slate-900">Showing statement for {displayCustomer(selectedParty)}</p>
    <p className="mt-1 text-xs text-slate-500">Period: {dateRange.label}</p>
    <p className="mt-1 text-xs text-slate-500">Closing balance: {preview.summary.find((row) => row.label === 'Closing Balance')?.value ?? '-'}</p>
  </div>
)}
```

- [ ] **Step 3: Lightly polish the Book Download copy only**

```tsx
{reportKind === 'book' && (
  <p className="mt-1 text-xs text-slate-500">Select a bill book to preview count, date range, and download the ZIP package.</p>
)}
```

- [ ] **Step 4: Run the statement-focused test suite to ensure the refactor did not break the shared flow**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the action and copy polish**

```bash
git add src/routes/export-reports.tsx
git commit -m "feat: simplify party statement export actions"
```

### Task 6: Preserve backup functionality and verify the full page behavior

**Files:**
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Keep backup actions intact under Technical Exports and guard against accidental regression**

```tsx
{reportKind === 'backup' && (
  <>
    <button type="button" className={primaryButtonClass} onClick={downloadBackupJson}>
      <Download size={14} /> Full Backup JSON
    </button>
    <button type="button" className={secondaryButtonClass} onClick={downloadRawCsvBundle}>
      <FileArchive size={14} /> Raw CSV Bundle
    </button>
  </>
)}
```

- [ ] **Step 2: Run the focused unit tests**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `cd /opt/docker/apps/Kapil_Pro && npm run typecheck`
Expected: PASS with generated router updated as needed

- [ ] **Step 4: Run the full test suite**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test`
Expected: PASS

- [ ] **Step 5: Run the production build**

Run: `cd /opt/docker/apps/Kapil_Pro && npm run build`
Expected: PASS with successful Vite bundle output

- [ ] **Step 6: Manually verify the page in the running app**

Run:
```bash
cd /opt/docker/apps/Kapil_Pro && python /home/ubuntu/.claude/skills/webapp-testing/scripts/with_server.py --server "npm run dev" --port 5173 -- python /tmp/verify_exports_page.py
```

Use this Playwright script:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1200})
    page.goto("http://127.0.0.1:5173/export-reports")
    page.wait_for_load_state("networkidle")
    page.screenshot(path="/tmp/exports-page.png", full_page=True)
    assert page.get_by_text("Business Exports").is_visible()
    assert page.get_by_text("Technical Exports").is_visible()
    assert page.get_by_text("Party Statement").is_visible()
    assert page.get_by_text("Outstanding").count() == 0
    browser.close()
```

Expected: screenshot captured successfully, grouped sections visible, Party Statement visible, Outstanding absent

- [ ] **Step 7: Commit the verified redesign**

```bash
git add src/routes/export-reports.tsx src/lib/exports/party-statement-ledger.ts src/lib/exports/party-statement-ledger.test.ts src/lib/exports/party-statement-presenter.ts src/lib/exports/report-pdf.ts
git commit -m "feat: redesign exports around trusted party statements"
```

## Self-review

### Spec coverage
- Business vs Technical split: covered in Task 4
- Party Statement data correctness: covered in Task 1 and Task 2
- Business-friendly PDF redesign: covered in Task 3
- Remove Outstanding from visible exports: covered in Task 4
- Light Book Download polish: covered in Task 5
- Preserve backup functionality: covered in Task 6

### Placeholder scan
- No TBD/TODO markers remain
- Every code-modifying step includes concrete code
- Every verification step includes exact commands and expected results

### Type consistency
- `buildPartyStatementLedger` is the single source for opening/running/closing balance math
- `buildPartyStatementViewModel` consumes the ledger and is reused by preview/CSV/PDF steps
- `createPartyStatementPdf` consumes the presenter model rather than route-local row shaping

## Notes for execution
- Do not expand scope into a full Sales Register redesign.
- Do not remove backup exports.
- Keep Book Download behavior working even if its layout is lightly polished.
- If route-level tests prove brittle, prefer adding a focused unit test near the new export helpers rather than introducing broad UI mocks.