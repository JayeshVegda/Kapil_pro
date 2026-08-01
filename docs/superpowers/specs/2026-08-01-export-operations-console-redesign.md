# Export Operations Console Redesign

## Purpose

Replace the current Export Reports interface with a compact operations console for sales and gas reporting. The page must help the operator choose a report, adjust a small set of relevant filters, immediately inspect real data, and export the same result.

Purchasing, profit-and-loss reporting, scheduling, permissions, and an arbitrary report builder are outside this scope.

## Information Architecture

The report switcher contains five focused views:

1. **Party Statement** — bills, payments, opening balance, and running balance.
2. **Monthly Summary** — invoice sales, collections, gas sales, kilograms, bags, weighted selling rate, weighted market rate, and premium.
3. **Sales Register** — invoice and item-level selling activity with party, item, type, and date filters.
4. **Rate Analysis** — selling-rate variation by party and item, including weighted average, market rate, premium, minimum rate, and maximum rate.
5. **Outstanding** — customer balances and ageing based on bills, payments, and opening balances.

Bill Book remains available through a secondary **More exports** control. It is not a primary report tab.

## Default State

The page opens on Party Statement. After report data loads, it selects the customer from the most recent bill. The initial period is the latest calendar month containing a bill for that customer. This prevents the page from opening as a blank form or silently choosing an empty current month.

If there are no customers with bills, the page shows a directed empty state and leaves the customer unselected.

## Page Layout

Use the approved Operations Console direction:

- A compact page header contains the page title, current report context, export actions, and a More exports menu.
- A horizontal five-tab report switcher sits below the header and can scroll on narrow screens.
- A single inline filter bar changes controls according to the active report.
- A restrained KPI strip appears only after valid data is available.
- A full-width preview occupies the main page area.

The existing application sidebar remains unchanged. The report page avoids a second large sidebar, oversized introduction, wizard, or stack of floating cards.

Visual styling stays compatible with the application shell: white and cool-slate surfaces, deep cobalt for the selected state, square-to-subtle corner radii, compact data typography, clear table rules, and visible keyboard focus. The signature element is a green **Live preview** indicator with a result count and active-period label directly above the data surface.

## Report Behavior

### Party Statement

Filters: party and period. KPIs: opening balance, billed amount, payments, closing balance, and bill count. Preview: chronological ledger with debit, credit, and running balance. Exports: PDF, Excel, CSV, and Full Package. The package may include bill images and bill PDFs when enabled.

### Monthly Summary

Filter: month. The default month is the latest month containing sales. KPIs emphasize sales and gas: invoice sales, collections, gas kilograms, bags, weighted selling rate, weighted market rate, and premium. Preview includes daily rows and compact item/party breakdowns. Exports: PDF, multi-sheet Excel, and CSV package.

### Sales Register

Filters: period, party, item, item type, and grouping. Preview switches between grouped results and transaction detail without changing the underlying filtered dataset. Exports: PDF, Excel, and CSV.

### Rate Analysis

Filters: period, party, and gas item. The calculation uses quantity-weighted rates, never a simple average of invoice rates. Preview shows party/item groups with quantity, bags, sales, weighted selling rate, weighted market rate, premium, minimum selling rate, and maximum selling rate. Exports: PDF, Excel, and CSV.

### Outstanding

Filters: as-of date, customer, and balance status. KPIs: total outstanding, customers with balances, overdue amount, and largest balance. Preview shows customer, opening balance, billed amount, payments, closing balance, oldest unpaid activity date, and ageing band. Ageing is an operational estimate derived from available bill and payment history; it is not invoice-allocation accounting. Exports: PDF, Excel, and CSV.

## Live Preview Data Flow

The page loads report options and the report snapshot together rather than waiting for a manually selected party. Once loaded, a deterministic initializer derives the most recent customer and active month. User selections then drive pure report builders through memoized calculations.

Every preview has four explicit states:

- Loading: skeleton rows and a clear loading label.
- Ready: live indicator, active filters, result count, KPIs, and table.
- Empty: explains that no rows match and suggests changing the period or filters.
- Error: explains that report data could not load and provides a retry action.

Preview calculations and downloadable files use the same report result object so displayed totals cannot drift from exports.

## Component Boundaries

- `ReportConsoleHeader`: title, current context, export actions, and More exports.
- `ReportTabs`: accessible five-report switcher.
- `ReportFilterBar`: report-specific controls supplied by each report view.
- `ReportKpiStrip`: compact formatted summaries.
- `LivePreviewFrame`: loading, ready, empty, and error handling plus result metadata.
- One report view component per tab, backed by a pure domain builder.
- Existing PDF, XLSX, CSV, bill-image, and ZIP utilities remain the export engines.

The route coordinates selection and data loading; calculation logic stays in domain modules. The redesign may split the current oversized route into focused components but will not refactor unrelated application code.

## Verification

- Unit tests cover default-customer/month selection, rate weighting, min/max rates, outstanding balances, and empty datasets.
- Component tests cover tab changes and all preview states.
- Export builder tests verify preview and exported totals share the same result.
- Type checking, the full test suite, and a production build must pass.
- The deployed page must be checked with live data to confirm automatic selection, filter refresh, ready/empty/error messaging, and reachable production assets.

