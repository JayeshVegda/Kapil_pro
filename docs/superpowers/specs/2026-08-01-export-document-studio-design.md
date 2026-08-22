# Export Document Studio Design

## Objective

Rebuild `/export-reports` into a simple reporting workspace for the three reports Kapil operators use most:

1. Party Statement
2. Monthly Report
3. Sales Report

Keep the existing Bill Book ZIP tool as a smaller utility. Do not add purchases, expenses, accounting statements, report scheduling, email delivery, permissions, saved report templates, or server-side job infrastructure.

## Product Direction

The page should work like a document studio, not a menu of export utilities:

`Choose report -> set filters -> verify summary and preview -> download`

The selected report controls its filters, summary, preview, and formats. PDF, Excel, and CSV must use the same calculated report model displayed on screen.

## Page Structure

### Report navigation

Use three clear tabs at the top:

- Party Statement
- Monthly Report
- Sales Report

The initial tab is Party Statement. The current report may be represented in the URL so refresh/back navigation does not unexpectedly change the workspace.

### Workspace

Below the tabs, use a two-part responsive layout:

- compact filter and summary panel
- larger report preview panel with download actions

On narrow screens these stack vertically. Keep the existing slate/blue Kapil Pro visual language, compact spacing, aligned financial numbers, and restrained status colors.

### Bill Book utility

Place Bill Book below the primary workspace in a collapsed or visually secondary section named **Bulk Bill Files**. Preserve its existing book selection, preview, register, workbook, bill JPG/PDF, and ZIP behavior.

## Party Statement

### Filters

- Party
- This month, last month, current financial year, or custom range
- Month or custom start/end controls when relevant
- Include item details toggle
- Include individual bills in the ZIP package toggle

### Summary and preview

- Opening balance
- Total billed
- Total received
- Closing balance expressed as due, advance, or clear
- Chronological ledger containing date, type, reference, debit, credit, running balance, and details

Continue using the existing dedicated party-statement ledger and presenter pipeline. Preserve business ordering and range-based opening-balance behavior.

### Downloads

- Statement PDF
- Excel workbook
- CSV ledger
- Complete party ZIP

The ZIP continues to include the statement, workbook, bill/payment summaries, raw CSV data, and optional individual bill JPG/PDF files.

## Monthly Report

The Monthly Report is a shareable/exportable selling-performance report. It reuses the existing Company Report and gas-sales definitions without copying financial math into the route.

### Filters

- Month
- Optional comparison with previous month, enabled by default

Customer/item filtering is excluded from the first implementation to keep the workflow small.

### Summary

- Total invoiced sales
- Gas line sales before GST and transport
- Gas kilograms and bags
- Weighted average selling rate
- Weighted bill market rate
- Premium or discount per kg
- Collections
- Bill count
- Active customer count

### Detail sections

- Current month versus previous month
- Item-wise gas sales
- Customer-wise gas sales
- Daily sales and collection summary

### Downloads

- Monthly PDF
- Multi-sheet Excel workbook
- CSV bundle ZIP containing summary, item, customer, and daily files

## Sales Report

### Filters

- Date preset or custom date range
- Optional party
- Optional item
- Gas, electronic, or all item types
- Grouping: bill, customer, item, or day

Book/GST filters and configurable columns are deferred until actual use demonstrates a need.

### Summary

- Invoice count
- Invoice total
- Item sales before GST and transport
- Quantity and bags where meaningful
- Weighted selling rate for gas selections

### Detail

The bill-level detail dataset contains:

- Date
- Book/bill reference
- Party
- Item/type
- Quantity/unit
- Bags
- Selling rate
- Bill market rate
- Premium/discount for gas
- Item amount
- Transport
- GST
- Invoice total
- LR number

Grouped previews summarize this detail without discarding the underlying bill rows used by Excel/CSV.

### Downloads

- PDF of the visible grouped report
- Excel with Summary and Detail sheets
- CSV containing raw detail rows

## Shared Report Contract

Create a small common report contract with:

- report title and selected period
- summary metrics
- preview columns and rows
- typed raw rows for spreadsheet/CSV output
- optional workbook sheets

Do not build a generic report-builder framework. Each report retains a focused domain builder and adapts to the small shared presentation contract.

## Code Boundaries

Reduce responsibility in `src/routes/export-reports.tsx` by extracting only the high-value boundaries:

- report tabs/workspace UI
- monthly report domain builder
- sales report domain builder
- party ZIP builder
- book ZIP builder

Reuse the existing PDF engine, XLSX writer, bill print layout, image export, party ledger, gas-sales reporting, and PocketBase snapshot loader.

## Data Rules

- Invoice total remains item base plus transport plus GST.
- Gas weighted selling rate is gas line amount divided by gas kilograms.
- Weighted bill market rate uses the market rate saved on each parent bill.
- Missing market rates remain unavailable rather than zero.
- Electronic quantities use their configured unit and never contribute to gas-rate calculations.
- Financial ordering is business date, created timestamp, then record ID.
- Preview, PDF, Excel, and CSV totals come from the same report result.

## Error and Progress Behavior

- Disable downloads until required filters and data are ready.
- Give report-specific empty states.
- Show clear generation progress for Party and Book ZIP files.
- If an individual bill cannot render, identify that bill and stop with a useful error; do not download a silently incomplete package.
- Remove the duplicated party options currently rendered by the page.

## Testing

Add focused tests for:

- monthly summary and comparison calculations
- sales filters and grouping
- gas/electronic separation
- missing market-rate behavior
- party statement ordering and balance regression
- report format consistency using the shared report result
- ZIP manifest contents without snapshotting binary files
- tab order and primary actions

Verify typecheck, unit tests, production build, responsive layouts, report downloads, and the deployed route.

## Delivery Sequence

1. Extract pure monthly and sales report builders with tests.
2. Build the three-tab workspace using existing UI primitives.
3. Reconnect Party Statement without changing its established calculations.
4. Add Monthly Report preview and downloads.
5. Replace the old Sales Register with filtered/grouped Sales Report.
6. Move Book Download into Bulk Bill Files.
7. Verify generated formats and deploy.

## Explicitly Deferred

- scheduled or emailed reports
- role-based report permissions
- saved custom templates
- arbitrary column designer
- purchases, expenses, P&L, balance sheet, or cash flow
- server-side export queues
- background job infrastructure
- report annotations
