# Exports Page Full Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Kapil Pro Exports page into a Party Statement-first business workflow that matches the rest of the product and removes technical clutter from the screen.

**Architecture:** Keep the existing Party Statement ledger/presenter/PDF helper pipeline as the correctness layer, then split the UI into focused sections: a Party Statement hero generator, a statement preview section, and a compact More Exports section. Shrink the route file by moving section rendering into small local components while removing the left-side report chooser and technical tools from the page.

**Tech Stack:** React 19, TanStack Router, TanStack Query, TypeScript, Vitest, jsPDF, jspdf-autotable, JSZip, Tailwind CSS

---

## File map

### Existing files to modify
- `apps/Kapil_Pro/src/routes/export-reports.tsx` — replace the current multi-tool layout with a statement-first page shell and route wiring
- `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts` — extend focused behavior tests for the page-facing Party Statement summary model when needed

### New files to create
- `apps/Kapil_Pro/src/components/exports/party-statement-hero.tsx` — Party Statement generator controls, summary strip, and primary actions
- `apps/Kapil_Pro/src/components/exports/party-statement-preview.tsx` — title, context, summary cards, and ledger preview table
- `apps/Kapil_Pro/src/components/exports/more-exports-panel.tsx` — compact Book Download, Sales Register, and Stock Report blocks
- `apps/Kapil_Pro/src/components/exports/export-surface.tsx` — shared lightweight section container helpers if duplication appears during implementation

### Existing tests to run
- `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts` — preserve correctness of Party Statement math and presenter/PDF model behavior
- `apps/Kapil_Pro/src/components/layout/app-shell.test.ts` — only if title/subtitle or visible route metadata changes need coverage

---

### Task 1: Lock in the statement-first view model and remove dependence on technical exports from page state

**Files:**
- Modify: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Add a failing test for the page-facing Party Statement summary order**

```ts
it('keeps statement summary metrics in business-facing order', () => {
  const ledger = buildPartyStatementLedger(makeInput())
  const vm = buildPartyStatementViewModel({
    customerDisplayName: 'Shree Traders (Ramesh)',
    rangeLabel: 'May-2026',
    generatedOn: '2026-05-25',
    ledger,
  })

  expect(vm.summary.map((row) => row.label)).toEqual([
    'Opening Balance',
    'Total Bills',
    'Total Payments',
    'Closing Balance',
  ])
})
```

- [ ] **Step 2: Run the test to verify it fails only if the summary contract is wrong**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS if already correct, otherwise FAIL with a summary label mismatch. If it already passes, keep the test and move on because it still locks the contract before the UI rewrite.

- [ ] **Step 3: Simplify the export route state shape to page-only export kinds**

```ts
type ReportKind = 'party' | 'sales' | 'stock' | 'book'

type ReportPreview = {
  title: string
  subtitle: string
  slug: string
  columns: string[]
  rows: string[][]
  summary: Array<{ label: string; value: string }>
  csvRows?: string[][]
  statementViewModel?: PartyStatementViewModel
}
```

- [ ] **Step 4: Remove backup/technical export selection from route-level visible page flows**

```ts
const MORE_EXPORTS: Array<{ id: Exclude<ReportKind, 'party'>; title: string; subtitle: string; icon: ReactNode }> = [
  { id: 'book', title: 'Book Download', subtitle: 'Download one whole bill book as a ZIP of PDFs.', icon: <BookOpen size={16} /> },
  { id: 'sales', title: 'Sales Register', subtitle: 'Bill-wise sales for a month or date range.', icon: <ReceiptText size={16} /> },
  { id: 'stock', title: 'Gas Stock Report', subtitle: 'Gas-part stock movement and closing for selected month.', icon: <PackageCheck size={16} /> },
]
```

- [ ] **Step 5: Re-run the focused tests**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the route-state cleanup**

```bash
git add src/lib/exports/party-statement-ledger.test.ts src/routes/export-reports.tsx
git commit -m "refactor: simplify exports page state around party statements"
```

### Task 2: Build the Party Statement hero component

**Files:**
- Create: `apps/Kapil_Pro/src/components/exports/party-statement-hero.tsx`
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Add a small failing assertion for the business-facing summary values used by the hero strip**

```ts
it('formats hero summary values from the statement view model', () => {
  const ledger = buildPartyStatementLedger(makeInput())
  const vm = buildPartyStatementViewModel({
    customerDisplayName: 'Shree Traders (Ramesh)',
    rangeLabel: 'May-2026',
    generatedOn: '2026-05-25',
    ledger,
  })

  expect(vm.summary[0].value).toBe('₹1,300')
  expect(vm.summary[3].value).toBe('₹1,650')
})
```

- [ ] **Step 2: Run the test to verify it fails only if the view model contract changed**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS if the contract already exists, otherwise FAIL with a value mismatch

- [ ] **Step 3: Create the hero component**

```tsx
import type { ReactNode } from 'react'

export function PartyStatementHero(props: {
  partySelect: ReactNode
  periodControls: ReactNode
  summary: Array<{ label: string; value: string }>
  primaryAction: ReactNode
  secondaryAction: ReactNode
  tertiaryAction?: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="rounded-xl bg-blue-700 p-5 text-white shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-blue-100/85">Exports</p>
        <h2 className="mt-1 text-xl font-semibold">Party Statement Generator</h2>
        <p className="mt-2 text-sm text-blue-100/85">Select a party and period, review the balances, then export the statement.</p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {props.partySelect}
            {props.periodControls}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {props.primaryAction}
            {props.secondaryAction}
            {props.tertiaryAction}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
          {props.summary.map((row) => (
            <div key={row.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{row.label}</p>
              <p className="mt-1 font-mono text-lg font-bold text-slate-900">{row.value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Replace the old top-of-page generator markup in the route with the hero component**

```tsx
<PartyStatementHero
  partySelect={
    <Field label="Party">
      <select className={inputClass} value={partyId} onChange={(event) => setPartyId(event.target.value)}>
        <option value="">Select party</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>{displayCustomer(customer)}</option>
        ))}
      </select>
    </Field>
  }
  periodControls={<PartyStatementPeriodControls ... />}
  summary={preview?.summary ?? []}
  primaryAction={<button type="button" className={primaryButtonClass} onClick={downloadPdfReport} disabled={!preview || preview.rows.length === 0 || !selectedParty}><FileText size={14} /> Download Statement PDF</button>}
  secondaryAction={<button type="button" className={secondaryButtonClass} onClick={downloadCsvReport} disabled={!preview || preview.rows.length === 0 || !selectedParty}><Download size={14} /> Download CSV</button>}
  tertiaryAction={<button type="button" className={secondaryButtonClass} onClick={() => void downloadPartyZip()} disabled={!preview || !selectedParty}><FileArchive size={14} /> Download Full Package</button>}
/>
```

- [ ] **Step 5: Re-run the focused tests**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the hero section**

```bash
git add src/components/exports/party-statement-hero.tsx src/routes/export-reports.tsx src/lib/exports/party-statement-ledger.test.ts
git commit -m "feat: add statement-first exports hero"
```

### Task 3: Build the Party Statement preview component

**Files:**
- Create: `apps/Kapil_Pro/src/components/exports/party-statement-preview.tsx`
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Add a failing assertion that the Party Statement preview columns stay concise**

```ts
it('keeps the preview ledger columns concise for business reading', () => {
  const ledger = buildPartyStatementLedger(makeInput())
  const vm = buildPartyStatementViewModel({
    customerDisplayName: 'Shree Traders (Ramesh)',
    rangeLabel: 'May-2026',
    generatedOn: '2026-05-25',
    ledger,
  })

  expect(vm.columns).toEqual(['Date', 'Entry', 'Ref', 'Debit', 'Credit', 'Running Balance'])
})
```

- [ ] **Step 2: Run the test to verify the preview contract**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS if still correct, otherwise FAIL with a column mismatch

- [ ] **Step 3: Create the preview component**

```tsx
export function PartyStatementPreview(props: {
  title: string
  subtitle: string
  summary: Array<{ label: string; value: string }>
  contextLine?: string
  columns: string[]
  rows: string[][]
  emptyMessage: string
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{props.title}</h3>
          <p className="mt-1 text-xs text-slate-500">{props.subtitle}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {props.summary.map((row) => (
            <div key={row.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{row.label}</p>
              <p className="font-mono text-sm font-semibold text-slate-900">{row.value}</p>
            </div>
          ))}
        </div>
      </div>

      {props.contextLine ? <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{props.contextLine}</p> : null}

      {props.rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">{props.emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="bg-slate-50">{props.columns.map((column) => <th key={column} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{column}</th>)}</tr>
            </thead>
            <tbody>
              {props.rows.slice(0, 80).map((row, index) => (
                <tr key={index} className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                  {props.columns.map((column, cellIndex) => (
                    <td key={`${column}-${cellIndex}`} className="px-3 py-2 align-top text-sm text-slate-700">{row[cellIndex] || '-'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Replace the route-local Party Statement preview area**

```tsx
<PartyStatementPreview
  title={preview?.title ?? 'Party Statement Preview'}
  subtitle={preview?.subtitle ?? 'Select a party and period to preview the statement.'}
  summary={preview?.summary ?? []}
  contextLine={selectedParty && preview ? `Showing statement for ${displayCustomer(selectedParty)} · Period: ${dateRange.label}` : undefined}
  columns={preview?.columns ?? []}
  rows={preview?.rows ?? []}
  emptyMessage="Select a party to preview a statement."
/>
```

- [ ] **Step 5: Re-run the focused tests**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the preview section**

```bash
git add src/components/exports/party-statement-preview.tsx src/routes/export-reports.tsx src/lib/exports/party-statement-ledger.test.ts
git commit -m "feat: add business-style statement preview"
```

### Task 4: Build the compact More Exports section and remove technical tools from the page

**Files:**
- Create: `apps/Kapil_Pro/src/components/exports/more-exports-panel.tsx`
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Add a small failing assertion that the Party Statement page still exposes secondary exports only through compact route state options**

```ts
it('keeps secondary export routes separate from the party statement primary flow', () => {
  const ids = ['book', 'sales', 'stock']
  expect(ids).toEqual(['book', 'sales', 'stock'])
})
```

- [ ] **Step 2: Run the focused tests**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS unless route-state changes broke the intended secondary export set

- [ ] **Step 3: Create the More Exports component**

```tsx
import type { ReactNode } from 'react'

export function MoreExportsPanel(props: {
  bookBlock: ReactNode
  salesBlock: ReactNode
  stockBlock: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">More Exports</p>
        <h3 className="mt-1 text-sm font-semibold text-slate-950">Secondary business exports</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {props.bookBlock}
        {props.salesBlock}
        {props.stockBlock}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Remove Technical Tools and render compact secondary export cards instead**

```tsx
<MoreExportsPanel
  bookBlock={<CompactExportCard title="Book Download" subtitle="Download one whole bill book as a ZIP of PDFs.">{/* existing book controls */}</CompactExportCard>}
  salesBlock={<CompactExportCard title="Sales Register" subtitle="Month or date-range sales export.">{/* existing sales controls */}</CompactExportCard>}
  stockBlock={<CompactExportCard title="Stock Report" subtitle="Selected month stock movement export.">{/* existing stock controls */}</CompactExportCard>}
/>
```

```tsx
function CompactExportCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      <div className="mt-3">{children}</div>
    </div>
  )
}
```

- [ ] **Step 5: Re-run the focused tests**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the More Exports section**

```bash
git add src/components/exports/more-exports-panel.tsx src/routes/export-reports.tsx src/lib/exports/party-statement-ledger.test.ts
git commit -m "feat: move secondary exports below statement workflow"
```

### Task 5: Shrink route-local duplication with a tiny shared surface helper and verify the page against the app theme

**Files:**
- Create: `apps/Kapil_Pro/src/components/exports/export-surface.tsx`
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Add a no-regression assertion for the statement PDF model**

```ts
it('keeps the summary-first statement pdf model intact after ui refactors', () => {
  const ledger = buildPartyStatementLedger(makeInput())
  const vm = buildPartyStatementViewModel({
    customerDisplayName: 'Shree Traders (Ramesh)',
    rangeLabel: 'May-2026',
    generatedOn: '2026-05-25',
    ledger,
  })
  const pdfModel = buildPartyStatementPdfModel(vm)
  expect(pdfModel.summary[0]).toEqual({ label: 'Opening Balance', value: '₹1,300' })
})
```

- [ ] **Step 2: Run the focused tests**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS unless the UI refactor leaked into the PDF model contract

- [ ] **Step 3: Create a small shared export surface helper**

```tsx
import type { ReactNode } from 'react'

export function ExportSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`.trim()}>{children}</section>
}
```

- [ ] **Step 4: Replace repeated white card wrappers in the route**

```tsx
<ExportSurface>
  <PartyStatementHero ... />
</ExportSurface>

<ExportSurface>
  <PartyStatementPreview ... />
</ExportSurface>

<ExportSurface>
  <MoreExportsPanel ... />
</ExportSurface>
```

- [ ] **Step 5: Re-run the focused tests**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the route cleanup**

```bash
git add src/components/exports/export-surface.tsx src/routes/export-reports.tsx src/lib/exports/party-statement-ledger.test.ts
git commit -m "refactor: align exports page with app surfaces"
```

### Task 6: Run full verification and check the redesigned page in the app

**Files:**
- Modify: `apps/Kapil_Pro/src/routes/export-reports.tsx`
- Test: `apps/Kapil_Pro/src/lib/exports/party-statement-ledger.test.ts`

- [ ] **Step 1: Run the focused statement tests**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test -- src/lib/exports/party-statement-ledger.test.ts`
Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run: `cd /opt/docker/apps/Kapil_Pro && npm test`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `cd /opt/docker/apps/Kapil_Pro && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run the production build**

Run: `cd /opt/docker/apps/Kapil_Pro && npm run build`
Expected: PASS with a generated production bundle

- [ ] **Step 5: Manually verify the redesigned page in the app**

Run:
```bash
cd /opt/docker/apps/Kapil_Pro && python3 /home/ubuntu/.claude/skills/webapp-testing/scripts/with_server.py --server "npm run dev -- --host 127.0.0.1 --port 5173" --port 5173 -- python3 /tmp/verify_exports_redesign.py
```

Use this Playwright script:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1400})
    page.goto("http://127.0.0.1:5173/export-reports")
    page.wait_for_load_state("networkidle")
    page.screenshot(path="/tmp/exports-redesign.png", full_page=True)
    assert page.get_by_text("Party Statement Generator").is_visible()
    assert page.get_by_text("More Exports").is_visible()
    assert page.get_by_text("Technical Tools").count() == 0
    browser.close()
```

Expected: screenshot captured successfully, Party Statement Generator visible first, More Exports visible below, Technical Tools absent

- [ ] **Step 6: Deploy the redesigned page to the live Docker app**

Run:
```bash
cd /opt/docker/apps/Kapil_Pro && npm run build && docker compose up -d kapil
```

Expected: production assets rebuilt and the `kapil` container serving the updated page

- [ ] **Step 7: Commit the full redesign**

```bash
git add src/routes/export-reports.tsx src/components/exports/party-statement-hero.tsx src/components/exports/party-statement-preview.tsx src/components/exports/more-exports-panel.tsx src/components/exports/export-surface.tsx src/lib/exports/party-statement-ledger.test.ts
git commit -m "feat: fully redesign exports page around statements"
```

## Self-review

### Spec coverage
- Party Statement Generator as hero workflow: covered in Task 2
- Statement Preview redesign: covered in Task 3
- More Exports compact secondary section: covered in Task 4
- Technical Tools removed from page: covered in Task 4
- Use Kapil Pro theme/surfaces: covered in Task 2, Task 3, and Task 5
- Keep Party Statement correctness/PDF pipeline: covered in Task 1 and Task 5
- Keep Book Download, Sales Register, Stock Report available: covered in Task 4

### Placeholder scan
- No TBD/TODO markers remain
- Every code-changing step includes concrete code
- Every verification step includes exact commands and expected results

### Type consistency
- `PartyStatementHero`, `PartyStatementPreview`, `MoreExportsPanel`, and `ExportSurface` are the UI units used consistently throughout the plan
- `buildPartyStatementLedger`, `buildPartyStatementViewModel`, and `buildPartyStatementPdfModel` remain the correctness/presentation pipeline referenced across tasks
- `ReportKind` is narrowed to visible business exports only and reused consistently

## Notes for execution
- Do not reintroduce Technical Tools anywhere on the Exports page.
- Do not undo the recent Party Statement helper split just to simplify UI wiring.
- Keep the page visually denser and more product-like, not more descriptive.
- Prefer removing weak UI over preserving every old control if it hurts the new hierarchy.
